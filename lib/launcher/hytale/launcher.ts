/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 * 
 * Hytale game launcher.
 * Orchestrates the full launch process: installation, JRE, session, and game process.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn, ChildProcess } from 'node:child_process'
import fetch from 'node-fetch'
import EventEmitter from '../../utils/events'
import type { HytaleLauncherEvents } from '../../../types/events'
import type { IHytaleLoader, HytaleSessionResponse, HytaleInstance } from '../../../types/hytale'
import type { File } from '../../../types/file'
import type { Account } from '../../../types/account'
import { HYTALE_SESSION_URL } from '../../auth/kintare'
import {
  getHytaleClientFolder,
  getHytaleGameFolder,
  getHytaleClientExecutable,
  getHytaleJavaPath,
  getHytaleUserDataFolder,
  setHytaleRoot
} from './constants'
import { HytaleInstaller } from './installer'
import { HytalePatcher } from './patcher'
import { checkGameInstallation } from './checker'
import { EMLLibError, ErrorType } from '../../../types/errors'

type LauncherEvents = HytaleLauncherEvents

export interface HytaleLaunchOptions {
  /** The Hytale instance configuration */
  instance: HytaleInstance
  /** The loader configuration from AdminTool */
  loader: IHytaleLoader
  /** The account to use for launching */
  account: Account
  /** Force offline mode even for Kintare accounts */
  forceOffline?: boolean
  /** Install server files alongside client */
  installServer?: boolean
}

export interface LaunchCallbacks {
  /** Called when the game process starts */
  onGameSpawned?: (pid: number) => void
  /** Called when the game process exits */
  onGameExited?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export class HytaleLauncher extends EventEmitter<LauncherEvents> {
  private serverId: string
  private installer: HytaleInstaller | null = null
  private patcher: HytalePatcher | null = null
  private currentProcess: ChildProcess | null = null

  /**
   * Create a new HytaleLauncher.
   * @param serverId The server/launcher ID used for folder structure.
   * @param root Optional custom root folder name. If provided, files will be stored in 
   *   `{appdata}/.{root}/.{serverId}/` instead of `{appdata}/.{serverId}/`.
   */
  constructor(serverId: string, root?: string) {
    super()
    this.serverId = serverId
    
    // Set custom root if provided (must be done before any path operations)
    if (root) {
      setHytaleRoot(root)
    }
  }

  /**
   * Launch Hytale game.
   * 
   * @param options Launch options including instance, loader, and account.
   * @param callbacks Optional callbacks for game lifecycle events.
   * @returns The spawned child process.
   */
  async launch(options: HytaleLaunchOptions, callbacks?: LaunchCallbacks): Promise<ChildProcess> {
    const { instance, loader, account, forceOffline, installServer: _installServer } = options

    this.emit('hytale_launch_start', { instanceId: instance.id, buildIndex: loader.build_index })
    this.emit('hytale_launch_check', { instanceId: instance.id })

    // Initialize sub-components
    this.installer = new HytaleInstaller(this.serverId, instance.id)
    this.patcher = new HytalePatcher(this.serverId, instance.id)

    // Set auth headers for private instances
    if (instance.token) {
      this.installer.setAuthHeaders({ 'Authorization': `Bearer ${instance.token}` })
    }

    // Forward events from sub-components
    this.setupEventForwarding(this.installer)
    this.setupEventForwarding(this.patcher)

    // Check if installation is needed
    const checkResult = await checkGameInstallation(this.serverId, instance.id, loader.build_index)

    if (!checkResult.isComplete || checkResult.needsUpdate) {
      this.emit('hytale_launch_debug', `Installation needed: isComplete=${checkResult.isComplete}, needsUpdate=${checkResult.needsUpdate}`)
      
      // Install or update game from official Hytale servers
      await this.installer.install(loader)
    } else {
      this.emit('hytale_launch_debug', 'Game installation verified')
      
      // Ensure JRE is installed (might have been removed)
      const javaPath = getHytaleJavaPath(this.serverId)
      try {
        await fs.access(javaPath)
      } catch {
        await this.installer.installJRE()
      }
    }

    // Download Hytale files (mods) from AdminTool
    try {
      const files = await this.fetchHytaleFiles(instance)
      if (files.length > 0) {
        await this.installer.downloadFiles(files)
      }
    } catch (err) {
      this.emit('hytale_launch_debug', `Files download failed: ${err}`)
      // Continue launch even if files download fails
    }

    // Determine auth mode
    const isKintareAccount = account.meta?.type === 'kintare'
    const useOnlineAuth = isKintareAccount && !forceOffline

    this.emit('hytale_launch_session', { accountType: useOnlineAuth ? 'kintare' : 'offline' })

    // Get session tokens if online
    let sessionData: HytaleSessionResponse | null = null
    if (useOnlineAuth) {
      try {
        sessionData = await this.getHytaleSession(account)
        this.emit('hytale_launch_session_ready', { accountType: 'kintare', online: true })
      } catch (err) {
        // Fallback to offline mode
        this.emit('hytale_launch_debug', `Session fetch failed, falling back to offline: ${err}`)
        this.emit('hytale_launch_session_ready', { accountType: 'offline', online: false })
      }
    } else {
      this.emit('hytale_launch_session_ready', { accountType: 'offline', online: false })
    }

    // Build launch arguments
    const clientPath = getHytaleClientExecutable(this.serverId, instance.id)
    const javaPath = getHytaleJavaPath(this.serverId)
    const gameFolder = getHytaleGameFolder(this.serverId, instance.id)
    const clientFolder = getHytaleClientFolder(this.serverId, instance.id)
    const userDir = getHytaleUserDataFolder(this.serverId, instance.id)

    // Ensure user data directory exists
    await fs.mkdir(userDir, { recursive: true })

    // Ensure executable permissions
    await this.ensureExecutable(clientPath)

    const args = this.buildLaunchArgs({
      gameFolder,  // --app-dir should point to where Client/ and Server/ folders are
      userDir,
      javaPath,
      account,
      sessionData
    })

    this.emit('hytale_launch_debug', `Launch args: ${args.join(' ')}`)

    // Spawn process
    const child = await this.spawnGame(clientPath, args, clientFolder, callbacks)

    this.emit('hytale_launch_launch', {
      buildIndex: loader.build_index,
      online: sessionData !== null,
      pid: child.pid
    })

    this.currentProcess = child
    return child
  }

  /**
   * Get Hytale session tokens from Kintare.
   */
  private async getHytaleSession(account: Account): Promise<HytaleSessionResponse> {
    if (account.meta?.type !== 'kintare') {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Hytale online session requires a Kintare account')
    }

    if (!account.accessToken) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Account has no access token for Hytale session')
    }

    const response = await fetch(HYTALE_SESSION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.accessToken}`
      },
      body: JSON.stringify({
        uuid: account.uuid
      })
    })

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error')
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Session request failed: ${response.status} - ${text}`)
    }

    return await response.json() as HytaleSessionResponse
  }

  /**
   * Build launch arguments for the Hytale client.
   */
  private buildLaunchArgs(opts: {
    gameFolder: string  // Where Client/ and Server/ folders are
    userDir: string
    javaPath: string
    account: Account
    sessionData: HytaleSessionResponse | null
  }): string[] {
    const args = [
      '--app-dir', opts.gameFolder,  // Points to game folder, not Client subfolder
      '--user-dir', opts.userDir,
      '--java-exec', opts.javaPath,
      '--uuid', opts.account.uuid,
      '--name', opts.account.name
    ]

    if (opts.sessionData) {
      args.push('--auth-mode', 'authenticated')
      args.push('--identity-token', opts.sessionData.identityToken)
      args.push('--session-token', opts.sessionData.sessionToken)
    } else {
      args.push('--auth-mode', 'offline')
    }

    return args
  }

  /**
   * Spawn the game process.
   */
  private spawnGame(
    clientPath: string,
    args: string[],
    cwd: string,
    callbacks?: LaunchCallbacks
  ): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env }

      // Handle Wayland on Linux
      if (process.platform === 'linux' && this.isWaylandSession()) {
        env.SDL_VIDEODRIVER = 'wayland'
        this.emit('hytale_launch_debug', 'Wayland session detected, using wayland video driver')
      }

      try {
        const child = spawn(clientPath, args, {
          windowsHide: true,
          shell: false,
          cwd,
          detached: process.platform !== 'darwin',
          stdio: ['ignore', 'pipe', 'pipe'],
          env
        })

        // Don't keep parent alive for detached process
        child.unref()

        child.on('spawn', () => {
          this.emit('hytale_launch_debug', `Game process spawned with PID: ${child.pid}`)
          callbacks?.onGameSpawned?.(child.pid!)
          resolve(child)
        })

        child.on('error', (error: NodeJS.ErrnoException) => {
          this.emit('hytale_launch_debug', `Game spawn error: ${error.message}`)
          reject(new EMLLibError(ErrorType.LAUNCH_ERROR, `Failed to launch game: ${error.message}`))
        })

        // Handle stdout/stderr
        child.stdout?.on('data', (data: Buffer) => {
          this.emit('hytale_launch_data', data.toString())
        })

        child.stderr?.on('data', (data: Buffer) => {
          this.emit('hytale_launch_data', data.toString())
        })

        // Handle exit
        let exited = false
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
          if (exited) return
          exited = true

          this.emit('hytale_launch_close', { 
            exitCode: code ?? 0, 
            instanceId: cwd.split(path.sep).pop() || '' 
          })
          callbacks?.onGameExited?.(code, signal)
          this.currentProcess = null
        }

        child.once('exit', onExit)
        child.once('close', (code) => onExit(code, null))
      } catch (err) {
        reject(new EMLLibError(ErrorType.LAUNCH_ERROR, `Failed to spawn game: ${err}`))
      }
    })
  }

  /**
   * Check if running in a Wayland session.
   */
  private isWaylandSession(): boolean {
    return process.platform === 'linux' && (
      process.env.XDG_SESSION_TYPE === 'wayland' ||
      process.env.WAYLAND_DISPLAY !== undefined ||
      process.env.DISPLAY === undefined
    )
  }

  /**
   * Ensure file has executable permissions.
   */
  private async ensureExecutable(filePath: string): Promise<void> {
    if (process.platform === 'win32') return

    try {
      const stat = await fs.stat(filePath)
      if ((stat.mode & 0o100) === 0) {
        await fs.chmod(filePath, 0o755)
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Forward events from sub-component to this launcher.
   */
  private setupEventForwarding(emitter: EventEmitter<any>): void {
    const eventNames = [
      'hytale_pwr_download_start', 'hytale_pwr_download_progress', 'hytale_pwr_download_end',
      'hytale_pwr_patch_start', 'hytale_pwr_patch_progress', 'hytale_pwr_patch_end', 'hytale_pwr_patch_error',
      'hytale_patch_download_start', 'hytale_patch_download_progress', 'hytale_patch_download_end',
      'hytale_jre_check', 'hytale_jre_download_start', 'hytale_jre_download_progress', 'hytale_jre_download_end',
      'hytale_jre_install_start', 'hytale_jre_install_progress', 'hytale_jre_install_end', 'hytale_jre_ready',
      'hytale_files_download_start', 'hytale_files_download_progress', 'hytale_files_download_end',
      'hytale_butler_download_start', 'hytale_butler_download_progress', 'hytale_butler_download_end', 'hytale_butler_ready'
    ] as const

    for (const eventName of eventNames) {
      emitter.on(eventName as any, (...args: any[]) => {
        this.emit(eventName as any, ...args)
      })
    }
  }

  /**
   * Stop the currently running game process.
   */
  kill(): boolean {
    if (this.currentProcess) {
      this.currentProcess.kill()
      this.currentProcess = null
      return true
    }
    return false
  }

  /**
   * Check if a game is currently running.
   */
  isRunning(): boolean {
    return this.currentProcess !== null && !this.currentProcess.killed
  }

  /**
   * Get the current game process PID.
   */
  getPid(): number | null {
    return this.currentProcess?.pid ?? null
  }

  /**
   * Fetch Hytale files (mods) from AdminTool.
   * Uses authenticated fetch if instance has password/token.
   * 
   * @param instance The Hytale instance configuration.
   * @returns Array of files to download.
   */
  private async fetchHytaleFiles(instance: HytaleInstance): Promise<File[]> {
    if (!instance.url) return []

    // Use same /api/files endpoint as Minecraft (shared)
    const endpoint = `${instance.url}/api/files`
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    }

    // Add authentication if available
    if (instance.token) {
      headers['Authorization'] = `Bearer ${instance.token}`
    } else if (instance.password) {
      headers['X-Instance-Password'] = instance.password
    }

    try {
      const res = await fetch(endpoint, { headers })
      
      if (!res.ok) {
        if (res.status === 404) {
          // Endpoint doesn't exist, no files to download
          return []
        }
        throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to fetch Hytale files: ${res.statusText}`)
      }

      const data = await res.json() as { files: File[] }
      return data.files ?? []
    } catch (err: any) {
      if (err instanceof EMLLibError) throw err
      // Network error or endpoint not available
      this.emit('hytale_launch_debug', `Hytale files endpoint not available: ${err.message}`)
      return []
    }
  }
}

export default HytaleLauncher

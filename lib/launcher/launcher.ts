/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import type { CleanerEvents, DownloaderEvents, FilesManagerEvents, InstanceEvents, JavaEvents, LauncherEvents, LokiEvents, PatcherEvents } from '../../types/events'
import EventEmitter from '../utils/events'
import manifests from '../utils/manifests'
import utils from '../utils/utils'
import type { Config, FullConfig } from './../../types/config'
import path_ from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import FilesManager from './filesmanager'
import Downloader from '../utils/downloader'
import Cleaner from '../utils/cleaner'
import Java from '../java/java'
import LoaderManager from './loadermanager'
import ArgumentsManager from './argumentsmanager'
import { spawn } from 'node:child_process'
import type { ILokiConfig } from '../../types/file'
import { InstanceManager } from '../utils/instance'
import type { Instance } from '../../types/instance'

/**
 * Launch Minecraft.
 * @workInProgress
 */
export default class Launcher extends EventEmitter<
  LauncherEvents & DownloaderEvents & CleanerEvents & FilesManagerEvents & JavaEvents & LokiEvents & PatcherEvents & InstanceEvents
> {
  private config: FullConfig
  private instanceManager: InstanceManager | null = null
  private lokiAgentPath: string | null = null
  private lokiEnforceSecureProfile: boolean = true

  /**
   * @param config The configuration of the Launcher.
   */
  constructor(config: Config) {
    super()

    // Parse URL: can be string (backward compatible) or Instance object
    let baseUrl: string | undefined
    let instanceId: string | null = null
    let password: string | null = null
    let token: string | null = null

    if (config.url) {
      if (typeof config.url === 'string') {
        // Backward compatible: simple URL string
        baseUrl = config.url
      } else {
        // New format: Instance object
        const instance = config.url as Instance
        baseUrl = instance.url
        instanceId = instance.instanceId ?? null
        password = instance.password ?? null
        token = instance.token ?? null
      }
    }

    // Create InstanceManager if we have a URL
    if (baseUrl) {
      this.instanceManager = new InstanceManager({
        url: baseUrl,
        instanceId: instanceId ?? undefined,
        password: password ?? undefined,
        token: token ?? undefined
      }, config.serverId, config.root)
      
      // Forward instance events to launcher
      this.instanceManager.forwardEvents(this)
    }

    config.cleaning = {
      clean: config.cleaning?.clean === true,
      ignored: config.cleaning?.ignored || [
        'runtime/',
        'crash-reports/',
        'logs/',
        'resourcepacks/',
        'resources/',
        'saves/',
        'shaderpacks/',
        'options.txt',
        'optionsof.txt'
      ]
    }
    config.minecraft = {
      version: config.minecraft?.version ? config.minecraft?.version : config.url ? null : 'latest_release',
      args: config.minecraft?.args || []
    }
    
    // Calculate root path: custom root + serverId, or default serverId location
    // Root is sanitized like Minecraft folders: lowercase, special chars replaced, dot prefix
    const rootPath = config.root 
      ? path_.join(utils.getAppDataFolder(), utils.getServerFolderName(config.root), utils.getServerFolderName(config.serverId))
      : utils.getServerFolder(config.serverId)
    
    config.java = {
      install: config.java?.install || 'auto',
      distribution: config.java?.distribution || 'mojang',
      absolutePath: config.java?.absolutePath
        ? config.java.absolutePath
        : config.java?.relativePath
          ? path_.join(rootPath, config.java.relativePath, '/')
          : path_.join(rootPath, 'runtime', 'jre-${X}', 'bin', 'java'),
      args: config.java?.args || []
    }
    config.window = {
      width: config.window?.width || 854,
      height: config.window?.height || 480,
      fullscreen: config.window?.fullscreen || false
    }
    config.memory = {
      min: config.memory?.min || 512,
      max: config.memory?.max && config.memory.max > (config.memory.min || 512) ? config.memory.max : 1023
    }

    this.config = { 
      ...(config as FullConfig), 
      url: baseUrl ?? '',
      instanceId,
      password,
      root: rootPath 
    }
  }

  /**
   * Launch Minecraft.
   *
   * This method will patch the [Log4j vulnerability](https://help.minecraft.net/hc/en-us/articles/4416199399693-Security-Vulnerability-in-Minecraft-Java-Edition).
   */
  async launch() {
    //* Authenticate instance if needed
    if (this.instanceManager) {
      await this.instanceManager.ensureAuthenticated()
    }

    //* Init launch
    const manifest = await manifests.getMinecraftManifest(this.config.minecraft.version, this.config.url, this.instanceManager ?? undefined)
    const loader = await manifests.getLoaderInfo(this.config.minecraft.version, this.config.url, this.instanceManager ?? undefined)
    this.config.minecraft.version = manifest.id

    // Resolve Java settings from AdminTool (per-OS) with local config override
    const { distribution: adminToolDistribution, args: adminToolJavaArgs, majorVersion: adminToolMajorVersion } = this.resolveJavaConfig(loader.java)
    
    // Local config > AdminTool config (per-OS) > Default ('mojang')
    const javaDistribution = this.config.java.distribution || adminToolDistribution || 'mojang'
    
    // Java major version override from AdminTool (per-OS)
    const javaMajorVersionOverride = adminToolMajorVersion

    const filesManager = new FilesManager(this.config, manifest, loader, this.instanceManager ?? undefined)
    const loaderManager = new LoaderManager(this.config, manifest, loader)
    const argumentsManager = new ArgumentsManager(this.config, manifest, adminToolJavaArgs)
    const authHeaders = this.instanceManager?.getAuthHeaders() ?? {}
    const downloader = new Downloader(this.config.root, authHeaders)
    const cleaner = new Cleaner(this.config.root)
    const java = new Java(manifest.id, this.config.serverId, {
      distribution: javaDistribution,
      url: this.config.url,
      majorVersionOverride: javaMajorVersionOverride
    })

    filesManager.forwardEvents(this)
    loaderManager.forwardEvents(this)
    downloader.forwardEvents(this)
    cleaner.forwardEvents(this)
    java.forwardEvents(this)

    //* Compute download
    this.emit('launch_compute_download')

    const javaFiles = await filesManager.getJava()
    const modpackFiles = await filesManager.getModpack()
    const librariesFiles = await filesManager.getLibraries()
    const assetsFiles = await filesManager.getAssets()
    const log4jFiles = await filesManager.getLog4j()

    const javaFilesToDownload = await downloader.getFilesToDownload(javaFiles.java)
    const modpackFilesToDownload = await downloader.getFilesToDownload(modpackFiles.modpack)
    const librariesFilesToDownload = await downloader.getFilesToDownload(librariesFiles.libraries)
    const assetsFilesToDownload = await downloader.getFilesToDownload(assetsFiles.assets)
    const log4jFilesToDownload = await downloader.getFilesToDownload(log4jFiles.log4j)
    const filesToDownload = [
      ...javaFilesToDownload,
      ...modpackFilesToDownload,
      ...librariesFilesToDownload,
      ...assetsFilesToDownload,
      ...log4jFilesToDownload
    ]

    //* Download
    this.emit('launch_download', { total: { amount: filesToDownload.length, size: filesToDownload.reduce((acc, file) => acc + file.size!, 0) } })

    await downloader.download(javaFilesToDownload, true)
    await downloader.download(modpackFilesToDownload, true)
    await downloader.download(librariesFilesToDownload, true)
    await downloader.download(assetsFilesToDownload, true)
    await downloader.download(log4jFilesToDownload, true)

    //* Install loader
    this.emit('launch_install_loader', loader)

    await new Promise((r) => setTimeout(r, 1000)) // Avoid "Error: ADM-ZIP: Invalid or unsupported zip format. No END header found" error
    const loaderFiles = await loaderManager.setupLoader()
    await downloader.download(loaderFiles.libraries)

    //* Extract natives
    this.emit('launch_extract_natives')

    const extractedNatives = await filesManager.extractNatives([...librariesFiles.libraries, ...loaderFiles.libraries])

    //* Copy assets
    this.emit('launch_copy_assets')

    const copiedAssets = await filesManager.copyAssets()

    //* Check Java
    this.emit('launch_check_java')

    // Determine effective Java major version (override or manifest)
    const effectiveJavaMajorVersion = javaMajorVersionOverride ?? manifest.javaVersion?.majorVersion ?? 8

    // For Mojang: Java was downloaded via filesManager.getJava(), no verification needed
    // For Adoptium/Corretto: Discover existing, download only if needed, then verify
    if (javaDistribution !== 'mojang') {
      // Try to find existing compatible Java installation
      const existingJava = await java.discoverBest()
      
      if (existingJava) {
        // Found compatible Java - update the path to use it
        this.config.java.absolutePath = existingJava.execPath
        this.emit('launch_debug', `Using existing Java ${existingJava.semverStr} at ${existingJava.path}`)
      } else {
        // No compatible Java found - download it
        this.emit('launch_debug', `No compatible Java found, downloading ${javaDistribution}...`)
        await java.download()
      }
      
      // Verify the Java installation
      await java.check(this.config.java.absolutePath, effectiveJavaMajorVersion)
    }

    //* Check Loki agent
    const lokiAccountTypes = loader.loki?.accountTypes ?? 'default'
    const lokiCompatibleAccount = lokiAccountTypes === 'all' || ['kintare', 'yggdrasil'].includes(this.config.account.meta.type)
    if (loader.loki && lokiCompatibleAccount) {
      this.emit('launch_check_loki')
      this.lokiAgentPath = await this.handleLokiAgent(loader.loki, downloader)
      this.lokiEnforceSecureProfile = loader.loki.enforceSecureProfile ?? true
    } else if (loader.loki && !lokiCompatibleAccount) {
      this.emit('launch_debug', `Loki agent skipped: account type '${this.config.account.meta.type}' not compatible (accountTypes: '${lokiAccountTypes}')`)
    }

    //* Path loader
    this.emit('launch_patch_loader')

    const patchedFiles = await loaderManager.patchLoader(loaderFiles.installProfile)

    //* Clean
    this.emit('launch_clean')

    const files = [
      ...javaFiles.files,
      ...modpackFiles.files,
      ...librariesFiles.files,
      ...assetsFiles.files,
      ...log4jFiles.files,
      ...extractedNatives.files,
      ...copiedAssets.files,
      ...loaderFiles.files,
      ...patchedFiles.files
    ]
    await cleaner.clean(files, this.config.cleaning.ignored, !this.config.cleaning.clean)

    //* Launch
    this.emit('launch_launch', { version: manifest.id, type: loader.type, loaderVersion: loader.loaderVersion })

    const args = argumentsManager.getArgs(
      [...loaderFiles.libraries, ...librariesFiles.libraries], 
      loader, 
      loaderFiles.loaderManifest,
      this.lokiAgentPath,
      this.lokiEnforceSecureProfile
    )

    const blindArgs = args.map((arg, i) => (i === args.findIndex((p) => p === '--accessToken') + 1 ? '**********' : arg))
    this.emit('launch_debug', `Launching Minecraft with args: ${blindArgs.join(' ')}`)

    this.run(this.config.java.absolutePath.replace('${X}', manifest.javaVersion?.majorVersion.toString() ?? '8'), args)
  }

  private async run(javaPath: string, args: string[]) {
    const minecraft = spawn(javaPath, args, { cwd: this.config.root, detached: true })
    minecraft.stdout.on('data', (data: Buffer) => this.emit('launch_data', data.toString('utf8').replace(/\n$/, '')))
    minecraft.stderr.on('data', (data: Buffer) => this.emit('launch_data', data.toString('utf8').replace(/\n$/, '')))
    minecraft.on('close', (code) => this.emit('launch_close', code ?? 0))
  }

  /**
   * Get the InstanceManager for this launcher.
   * Useful for setting password after `instance_password_required` event.
   * @returns The InstanceManager or null if no URL configured.
   */
  getInstanceManager(): InstanceManager | null {
    return this.instanceManager
  }

  /**
   * Switch to a different instance without recreating the Launcher.
   * This will:
   * 1. Update the internal config with new instance settings
   * 2. Create a new InstanceManager for the new instance
   * 3. Emit `instance_switched` event so your app can reload UI data
   * 
   * @param newInstance The new instance to switch to (URL string or Instance object)
   * @param serverId The server ID for the new instance (determines data folder)
   * 
   * @example
   * ```typescript
   * launcher.on('instance_switched', async ({ newInstanceId, newUrl }) => {
   *   // Reload UI data for new instance
   *   const news = new News({ url: newUrl, instanceId: newInstanceId }, serverId)
   *   myNewsData = await news.getNews()
   * })
   * 
   * // Switch to a different instance
   * await launcher.switchInstance({ url: 'https://eml.example.com', instanceId: 'other-server' }, 'other-server')
   * ```
   */
  async switchInstance(newInstance: string | Instance, serverId: string): Promise<void> {
    // Store previous instance ID for event
    const previousInstanceId = this.config.instanceId

    // Parse new instance
    let baseUrl: string
    let instanceId: string | null = null
    let password: string | null = null

    if (typeof newInstance === 'string') {
      baseUrl = newInstance
    } else {
      baseUrl = newInstance.url
      instanceId = newInstance.instanceId ?? null
      password = newInstance.password ?? null
    }

    // Update config
    this.config.url = baseUrl
    this.config.instanceId = instanceId
    this.config.password = password
    this.config.serverId = serverId
    this.config.root = utils.getServerFolder(serverId)

    // Update Java path template for new root
    if (!this.config.java.absolutePath.startsWith('/') && !this.config.java.absolutePath.match(/^[A-Za-z]:/)) {
      // Relative path - update with new root
      this.config.java.absolutePath = path_.join(this.config.root, 'runtime', 'jre-${X}', 'bin', 'java')
    }

    // Create new InstanceManager
    this.instanceManager = new InstanceManager({
      url: baseUrl,
      instanceId: instanceId ?? undefined,
      password: password ?? undefined
    }, serverId)

    // Forward events from new InstanceManager
    this.instanceManager.forwardEvents(this)

    // Reset Loki state (will be re-checked on next launch)
    this.lokiAgentPath = null
    this.lokiEnforceSecureProfile = true

    // Emit switched event so app can reload UI
    this.emit('instance_switched', {
      previousInstanceId,
      newInstanceId: instanceId,
      newUrl: baseUrl
    })
  }

  /**
   * Get the current instance configuration.
   * @returns Object with url, instanceId, and serverId
   */
  getCurrentInstance(): { url: string; instanceId: string | null; serverId: string } {
    return {
      url: this.config.url,
      instanceId: this.config.instanceId,
      serverId: this.config.serverId
    }
  }

  /**
   * Resolve Java configuration from AdminTool with per-OS support.
   * Only uses OS-specific settings from AdminTool (no global AdminTool setting).
   * Priority: Local config > AdminTool per-OS > Library default ('mojang')
   * @param javaConfig The Java config from AdminTool loader response.
   * @returns Resolved distribution, args, and majorVersion override for the current OS.
   */
  private resolveJavaConfig(javaConfig?: import('../../types/file').IJavaConfig): {
    distribution: 'mojang' | 'adoptium' | 'corretto' | undefined
    args: string[]
    majorVersion: number | undefined
  } {
    if (!javaConfig) {
      return { distribution: undefined, args: [], majorVersion: undefined }
    }

    // Get OS-specific config only (no global AdminTool fallback)
    const osKey = process.platform as 'win32' | 'darwin' | 'linux'
    const osMap: Record<string, 'windows' | 'darwin' | 'linux'> = {
      win32: 'windows',
      darwin: 'darwin',
      linux: 'linux'
    }
    const osConfig = javaConfig[osMap[osKey]]

    // Only use OS-specific settings, no global AdminTool fallback
    // If no OS-specific config, return undefined to use library default
    const distribution = osConfig?.distribution
    const args = osConfig?.args ?? []
    const majorVersion = osConfig?.majorVersion

    return { distribution, args, majorVersion }
  }

  /**
   * Handle Kintare Loki Java agent download and version management.
   * Downloads the agent if not present or if version changed.
   * @param lokiConfig The Loki configuration from AdminTool.
   * @param downloader The downloader instance.
   * @returns The absolute path to the kintare-loki.jar file.
   */
  private async handleLokiAgent(lokiConfig: ILokiConfig, downloader: Downloader): Promise<string> {
    const lokiDir = path_.join(this.config.root, 'runtime', 'loki')
    const lokiJarPath = path_.join(lokiDir, 'kintare-loki.jar')
    const lokiVersionPath = path_.join(lokiDir, 'version.txt')

    this.emit('loki_check', { version: lokiConfig.version })

    // Check if we need to update
    let needsUpdate = false
    let oldVersion: string | null = null

    if (!existsSync(lokiJarPath)) {
      needsUpdate = true
      this.emit('launch_debug', 'Loki agent not found, downloading...')
    } else if (existsSync(lokiVersionPath)) {
      try {
        oldVersion = (await fs.readFile(lokiVersionPath, 'utf-8')).trim()
        if (oldVersion !== lokiConfig.version) {
          needsUpdate = true
          this.emit('loki_update', { oldVersion, newVersion: lokiConfig.version })
          this.emit('launch_debug', `Loki agent version changed: ${oldVersion} -> ${lokiConfig.version}`)
        }
      } catch {
        needsUpdate = true
      }
    } else {
      // No version file, assume we need to update
      needsUpdate = true
    }

    if (needsUpdate) {
      // Delete old jar if exists
      if (existsSync(lokiJarPath)) {
        await fs.unlink(lokiJarPath)
      }

      // Ensure directory exists
      await fs.mkdir(lokiDir, { recursive: true })

      // Download the new jar
      this.emit('loki_download_start', { version: lokiConfig.version, size: lokiConfig.size })
      
      await downloader.download([{
        name: 'kintare-loki.jar',
        path: path_.join('runtime', 'loki', '/'),
        url: lokiConfig.url,
        size: lokiConfig.size,
        sha1: lokiConfig.sha1,
        type: 'OTHER'
      }])

      // Write version file
      await fs.writeFile(lokiVersionPath, lokiConfig.version, 'utf-8')

      this.emit('loki_download_end', { version: lokiConfig.version, path: lokiJarPath })
    }

    this.emit('loki_ready', { version: lokiConfig.version, path: lokiJarPath })
    this.emit('launch_debug', `Loki agent ready: v${lokiConfig.version} at ${lokiJarPath}`)

    return lokiJarPath
  }
}
/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 * 
 * Butler utility for handling PWR patch operations.
 * Butler is itch.io's patching tool that can apply PWR (wharf) delta patches.
 * 
 * Note: Currently, AdminTool provides pre-patched files, so Butler is reserved
 * for future delta-patching support where we download PWR files from Hytale servers.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import extract from 'extract-zip'
import fetch from 'node-fetch'
import EventEmitter from './events'
import type { HytaleLauncherEvents } from '../../types/events'
import {
  buildButlerUrl,
  getButlerFolder,
  getButlerPath
} from '../launcher/hytale/constants'
import { EMLLibError, ErrorType } from '../../types/errors'

/**
 * Options for applying a PWR patch.
 */
export interface ApplyPatchOptions {
  /** 
   * Path to signature file (.pws) for verification.
   * Verifies build against signature after patching.
   */
  signature?: string
  /** Staging directory for Butler operations */
  stagingDir?: string
}

export class Butler extends EventEmitter<Pick<HytaleLauncherEvents, 
  'hytale_butler_download_start' | 
  'hytale_butler_download_progress' | 
  'hytale_butler_download_end' | 
  'hytale_butler_ready'
>> {
  private serverId: string

  /**
   * Create a Butler utility instance.
   * @param serverId The server/launcher ID for path resolution.
   */
  constructor(serverId: string) {
    super()
    this.serverId = serverId
  }

  /**
   * Check if Butler is installed.
   * @returns True if Butler executable exists.
   */
  async isInstalled(): Promise<boolean> {
    const butlerPath = getButlerPath(this.serverId)
    try {
      await fs.access(butlerPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the path to the Butler executable.
   * @returns The absolute path to Butler.
   */
  getPath(): string {
    return getButlerPath(this.serverId)
  }

  /**
   * Ensure Butler is installed, downloading if necessary.
   * @returns The path to the Butler executable.
   */
  async ensureInstalled(): Promise<string> {
    const butlerPath = getButlerPath(this.serverId)

    if (await this.isInstalled()) {
      this.emit('hytale_butler_ready', { path: butlerPath, version: 'LATEST' })
      return butlerPath
    }

    return this.download()
  }

  /**
   * Download and install Butler.
   * @returns The path to the installed Butler executable.
   */
  async download(): Promise<string> {
    const butlerFolder = getButlerFolder(this.serverId)
    const butlerPath = getButlerPath(this.serverId)
    const zipPath = path.join(butlerFolder, 'butler.zip')

    // Create directory
    await fs.mkdir(butlerFolder, { recursive: true })

    this.emit('hytale_butler_download_start', { version: 'LATEST' })

    // Download Butler (uses LATEST like Butter Launcher)
    const url = buildButlerUrl()
    const response = await fetch(url)

    if (!response.ok || !response.body) {
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to download Butler: ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0
    let downloadedSize = 0

    // Stream to file with progress
    const chunks: Buffer[] = []
    
    for await (const chunk of response.body) {
      chunks.push(Buffer.from(chunk))
      downloadedSize += chunk.length
      
      this.emit('hytale_butler_download_progress', {
        percent: totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0,
        downloadedSize,
        totalSize
      })
    }

    // Write zip file
    await fs.writeFile(zipPath, Buffer.concat(chunks))

    // Extract
    await extract(zipPath, { dir: butlerFolder })

    // Make executable on Unix
    if (process.platform !== 'win32') {
      await fs.chmod(butlerPath, 0o755)
    }

    // Clean up zip
    await fs.unlink(zipPath)

    this.emit('hytale_butler_download_end', { version: 'LATEST', path: butlerPath })
    this.emit('hytale_butler_ready', { version: 'LATEST', path: butlerPath })

    return butlerPath
  }

  /**
   * Apply a PWR patch to a target directory.
   * This is used for delta-patching from Hytale's official patch servers.
   * 
   * @param pwrFile Path to the .pwr patch file.
   * @param targetDir Directory to apply the patch to.
   * @param options Optional settings for patching.
   * @returns Promise that resolves when patching is complete.
   */
  async applyPatch(
    pwrFile: string,
    targetDir: string,
    options: ApplyPatchOptions = {}
  ): Promise<void> {
    const butlerPath = await this.ensureInstalled()
    
    // Build args with JSON mode for progress parsing
    const args = ['apply', '-j']
    
    // Add staging dir
    args.push('--staging-dir', options.stagingDir || path.join(targetDir, '.butler-staging'))
    
    // Add signature if provided (.pws file)
    if (options.signature) {
      args.push('--signature', options.signature)
    }
    
    // Add patch file and target
    args.push(pwrFile, targetDir)

    return new Promise((resolve, reject) => {
      const proc = spawn(butlerPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stderr = ''

      proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(l => l.trim())
        for (const line of lines) {
          try {
            const json = JSON.parse(line)
            if (json.type === 'progress' && json.progress !== undefined) {
              this.emit('hytale_butler_patch_progress' as any, {
                percent: Math.round(json.progress * 100)
              })
            } else if (json.type === 'log') {
              this.emit('hytale_launch_debug' as any, `Butler: ${json.message}`)
            }
          } catch {
            // Not JSON, just log it
            this.emit('hytale_launch_debug' as any, `Butler: ${line}`)
          }
        }
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new EMLLibError(
            ErrorType.INSTALL_ERROR,
            `Butler patch failed with code ${code}: ${stderr}`
          ))
        }
      })

      proc.on('error', (err) => {
        reject(new EMLLibError(ErrorType.INSTALL_ERROR, `Failed to run Butler: ${err.message}`))
      })
    })
  }

  /**
   * Verify a directory against a signature file.
   * 
   * @param signatureFile Path to the .pwr.sig signature file.
   * @param targetDir Directory to verify.
   * @returns Promise that resolves to true if verification passes.
   */
  async verify(signatureFile: string, targetDir: string): Promise<boolean> {
    const butlerPath = await this.ensureInstalled()
    
    const args = ['verify', signatureFile, targetDir]

    return new Promise((resolve, reject) => {
      const proc = spawn(butlerPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stderr = ''

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(true)
        } else {
          // Verification failed but not an error - just means files don't match
          resolve(false)
        }
      })

      proc.on('error', (err) => {
        reject(new EMLLibError(ErrorType.VERIFY_ERROR, `Failed to run Butler verify: ${err.message}`))
      })
    })
  }
}

export default Butler

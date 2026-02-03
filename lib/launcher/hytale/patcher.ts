/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 * 
 * Hytale online patch manager.
 * Handles swapping the game executable with a patched version from AdminTool.
 * 
 * Flow:
 * 1. Official game is installed from Hytale servers via Butler/PWR
 * 2. AdminTool provides a patched executable that enables online play
 * 3. This module downloads and swaps the executable, keeping backups
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import fetch from 'node-fetch'
import EventEmitter from '../../utils/events'
import type { HytaleLauncherEvents } from '../../../types/events'
import type { IHytaleLoader, IHytaleClientPatchConfig, HytalePatchState, PatchState, PatchHealth } from '../../../types/hytale'
import {
  getHytaleOS,
  getHytaleClientExecutable,
  getHytalePatchStateFolder
} from './constants'
import { EMLLibError, ErrorType } from '../../../types/errors'

const PATCH_STATE_FILENAME = 'state.json'

type PatcherEvents = Pick<HytaleLauncherEvents,
  'hytale_online_patch_start' |
  'hytale_online_patch_progress' |
  'hytale_online_patch_end' |
  'hytale_online_patch_applied' |
  'hytale_online_patch_reverted' |
  'hytale_launch_debug'
>

/**
 * Calculate SHA256 hash of a file.
 */
async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const input = fsSync.createReadStream(filePath)
  await pipeline(input, hash)
  return hash.digest('hex')
}

/**
 * Normalize hash for comparison.
 */
function normalizeHash(h: string): string {
  return h.trim().toLowerCase()
}

/**
 * Check if file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure directory exists.
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export class HytalePatcher extends EventEmitter<PatcherEvents> {
  private serverId: string
  private instanceId: string

  constructor(serverId: string, instanceId: string) {
    super()
    this.serverId = serverId
    this.instanceId = instanceId
  }

  /**
   * Get paths for patch management.
   * Patch state is stored at instance level to avoid interfering with PWR validation.
   */
  private getPatchPaths(clientPath: string) {
    const exeName = path.basename(clientPath)

    const root = getHytalePatchStateFolder(this.serverId, this.instanceId)

    return {
      root,
      originalBackup: path.join(root, `original_${exeName}`),
      patchedBackup: path.join(root, `patched_${exeName}`),
      statePath: path.join(root, PATCH_STATE_FILENAME)
    }
  }

  /**
   * Read patch state from disk.
   */
  private async readPatchState(statePath: string): Promise<HytalePatchState | null> {
    try {
      if (!await fileExists(statePath)) return null
      const raw = await fs.readFile(statePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      if (typeof parsed.enabled !== 'boolean') return null
      return parsed as HytalePatchState
    } catch {
      return null
    }
  }

  /**
   * Write patch state to disk.
   */
  private async writePatchState(statePath: string, state: HytalePatchState): Promise<void> {
    await ensureDir(path.dirname(statePath))
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  /**
   * Get OS-specific patch config from loader.
   */
  private getPatchConfig(loader: IHytaleLoader): IHytaleClientPatchConfig | undefined {
    const os = getHytaleOS()
    return loader[os]
  }

  /**
   * Check if online patch is available for client.
   */
  isPatchAvailable(loader: IHytaleLoader): boolean {
    const config = this.getPatchConfig(loader)
    return !!(config?.patch_url && config?.patch_hash)
  }

  /**
   * Get current patch state for the client.
   */
  async getClientPatchState(loader: IHytaleLoader): Promise<PatchState> {
    const available = this.isPatchAvailable(loader)

    if (!available) {
      return { supported: true, available: false, enabled: false, downloaded: false }
    }

    const clientPath = getHytaleClientExecutable(this.serverId, this.instanceId)
    if (!await fileExists(clientPath)) {
      return { supported: true, available, enabled: false, downloaded: false }
    }

    const paths = this.getPatchPaths(clientPath)
    const state = await this.readPatchState(paths.statePath)

    return {
      supported: true,
      available,
      enabled: !!state?.enabled,
      downloaded: await fileExists(paths.patchedBackup)
    }
  }

  /**
   * Get patch health status.
   */
  async getClientPatchHealth(loader: IHytaleLoader): Promise<PatchHealth> {
    const config = this.getPatchConfig(loader)
    const expectedHash = config?.patch_hash

    const clientPath = getHytaleClientExecutable(this.serverId, this.instanceId)
    if (!await fileExists(clientPath) || !expectedHash) {
      return {
        patched: false,
        outdated: false,
        needsRepair: false,
        currentBuildIndex: undefined,
        expectedBuildIndex: loader.build_index
      }
    }

    const paths = this.getPatchPaths(clientPath)
    const state = await this.readPatchState(paths.statePath)

    try {
      const currentHash = await sha256File(clientPath)
      const isPatched = normalizeHash(currentHash) === normalizeHash(expectedHash)

      // Check if outdated (state says enabled but hash doesn't match latest)
      const outdated = state?.enabled && !isPatched && state.patch_hash !== expectedHash

      return {
        patched: isPatched,
        outdated: !!outdated,
        needsRepair: !!(state?.enabled && !isPatched && !outdated),
        currentBuildIndex: state?.build_index,
        expectedBuildIndex: loader.build_index
      }
    } catch {
      return {
        patched: false,
        outdated: false,
        needsRepair: true,
        currentBuildIndex: state?.build_index,
        expectedBuildIndex: loader.build_index
      }
    }
  }

  /**
   * Enable the online patch (swap to patched executable).
   */
  async enableClientPatch(loader: IHytaleLoader): Promise<'enabled' | 'already-enabled' | 'skipped'> {
    const config = this.getPatchConfig(loader)
    const url = config?.patch_url
    const expectedHash = config?.patch_hash

    if (!url || !expectedHash) {
      this.emit('hytale_launch_debug', 'No patch URL or hash configured, skipping patch')
      return 'skipped'
    }

    const clientPath = getHytaleClientExecutable(this.serverId, this.instanceId)
    if (!await fileExists(clientPath)) {
      this.emit('hytale_launch_debug', 'Client executable not found, skipping patch')
      return 'skipped'
    }

    const paths = this.getPatchPaths(clientPath)
    await ensureDir(paths.root)

    // Check if already patched with correct hash
    try {
      const currentHash = await sha256File(clientPath)
      if (normalizeHash(currentHash) === normalizeHash(expectedHash)) {
        this.emit('hytale_launch_debug', 'Client already patched with correct hash')
        return 'already-enabled'
      }
    } catch {
      // Continue
    }

    // Ensure we have the patched executable
    let patchedOk = false
    if (await fileExists(paths.patchedBackup)) {
      try {
        const cachedHash = await sha256File(paths.patchedBackup)
        patchedOk = normalizeHash(cachedHash) === normalizeHash(expectedHash)
      } catch {
        patchedOk = false
      }
    }

    if (!patchedOk) {
      // Download patched executable
      this.emit('hytale_launch_debug', `Downloading patched executable from ${url}`)
      await this.downloadPatchedExecutable(url, paths.patchedBackup, expectedHash)
    }

    // Backup original if not yet done
    if (!await fileExists(paths.originalBackup)) {
      this.emit('hytale_launch_debug', 'Backing up original executable')
      await fs.copyFile(clientPath, paths.originalBackup)
    }

    // Swap to patched
    this.emit('hytale_launch_debug', 'Applying patched executable')
    await fs.copyFile(paths.patchedBackup, clientPath)

    // Set executable permission on non-Windows
    if (process.platform !== 'win32') {
      await fs.chmod(clientPath, 0o755)
    }

    // Update state
    await this.writePatchState(paths.statePath, {
      enabled: true,
      patch_hash: expectedHash,
      patch_url: url,
      build_index: loader.build_index,
      updatedAt: Date.now()
    })

    this.emit('hytale_online_patch_applied', {
      originalBackup: paths.originalBackup,
      patchedPath: clientPath
    })

    return 'enabled'
  }

  /**
   * Disable the online patch (restore original executable).
   */
  async disableClientPatch(loader: IHytaleLoader): Promise<'disabled' | 'already-disabled' | 'skipped'> {
    const clientPath = getHytaleClientExecutable(this.serverId, this.instanceId)
    if (!await fileExists(clientPath)) {
      return 'skipped'
    }

    const paths = this.getPatchPaths(clientPath)
    const state = await this.readPatchState(paths.statePath)

    if (!state?.enabled) {
      return 'already-disabled'
    }

    // Restore original
    if (!await fileExists(paths.originalBackup)) {
      throw new EMLLibError(ErrorType.MISSING_FILE, 'Original executable backup not found')
    }

    this.emit('hytale_launch_debug', 'Restoring original executable')
    await fs.copyFile(paths.originalBackup, clientPath)

    // Set executable permission
    if (process.platform !== 'win32') {
      await fs.chmod(clientPath, 0o755)
    }

    // Update state
    await this.writePatchState(paths.statePath, {
      enabled: false,
      patch_hash: state.patch_hash,
      patch_url: state.patch_url,
      build_index: loader.build_index,
      updatedAt: Date.now()
    })

    this.emit('hytale_online_patch_reverted', { restoredPath: clientPath })

    return 'disabled'
  }

  /**
   * Download the patched executable.
   */
  private async downloadPatchedExecutable(
    url: string,
    destPath: string,
    expectedHash: string
  ): Promise<void> {
    this.emit('hytale_online_patch_start', { url })

    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to download patch: ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0
    let downloadedSize = 0

    const hash = crypto.createHash('sha256')
    const chunks: Buffer[] = []

    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      chunks.push(buffer)
      hash.update(buffer)
      downloadedSize += buffer.length

      this.emit('hytale_online_patch_progress', {
        percent: totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0,
        downloadedSize,
        totalSize
      })
    }

    // Verify hash
    const actualHash = hash.digest('hex')
    if (normalizeHash(actualHash) !== normalizeHash(expectedHash)) {
      throw new EMLLibError(
        ErrorType.HASH_ERROR,
        `Patch hash mismatch. Expected ${expectedHash}, got ${actualHash}`
      )
    }

    await ensureDir(path.dirname(destPath))
    await fs.writeFile(destPath, Buffer.concat(chunks))

    this.emit('hytale_online_patch_end', { path: destPath })
  }
}

export default HytalePatcher

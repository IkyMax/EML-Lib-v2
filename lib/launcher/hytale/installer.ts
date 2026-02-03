/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 * 
 * Hytale game installer.
 * Downloads official game from Hytale servers using PWR format + Butler.
 * Supports incremental updates with optional online patches.
 * 
 * Install flows:
 * 
 * FRESH INSTALL (0 → N):
 * 1. Download full PWR from /0/{N}.pwr
 * 2. Apply PWR via Butler
 * 3. Apply online patches (if configured)
 * 
 * INCREMENTAL UPDATE (e.g., 2 → 5):
 * 1. Apply PWR 2→3, then 3→4, then 4→5 (NOT 2→5 directly)
 * 2. Update manifest after EACH step (crash recovery)
 * 3. Apply online patches ONLY after final step (5)
 *    → Patches are NOT applied after intermediate steps (3, 4)
 * 
 * DOWNGRADE (N → M where M < N):
 * 1. Delete game folder
 * 2. Fresh install to M
 * 3. Apply online patches
 * 
 * Online patches modify the client/server executables (e.g., Kintare patch).
 * They are only applied ONCE after the final PWR update completes.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'

import crypto from 'node:crypto'
import https from 'node:https'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import extract from 'extract-zip'
import * as tar from 'tar'
import fetch from 'node-fetch'
import EventEmitter from '../../utils/events'
import Downloader from '../../utils/downloader'
import type { HytaleLauncherEvents } from '../../../types/events'
import type {
  IHytaleLoader,
  IHytaleJREManifest,
  IHytaleJREDownload,
  HytaleInstallManifest
} from '../../../types/hytale'
import type { File } from '../../../types/file'
import {
  HYTALE_JRE_MANIFEST_URL,
  buildPwrUrl,
  buildIncrementalPwrUrl,
  buildButlerUrl,
  getHytaleOS,
  getHytaleArch,
  getHytaleInstanceFolder,
  getHytaleGameFolder,
  getHytaleStagingFolder,
  getHytaleJREFolder,
  getHytaleJavaPath,
  getButlerFolder,
  getButlerPath,
  getHytaleClientExecutable,
  getHytaleServerExecutable,
  getHytaleModsFolder,
  getHytalePatchStateFolder
} from './constants'
import type { PwrUrls } from './constants'
import { writeInstallManifest, readInstallManifest } from './checker'
import { EMLLibError, ErrorType } from '../../../types/errors'

type InstallerEvents = Pick<HytaleLauncherEvents,
  'hytale_pwr_download_start' |
  'hytale_pwr_download_progress' |
  'hytale_pwr_download_end' |
  'hytale_pwr_patch_start' |
  'hytale_pwr_patch_progress' |
  'hytale_pwr_patch_end' |
  'hytale_pwr_patch_error' |
  'hytale_jre_check' |
  'hytale_jre_download_start' |
  'hytale_jre_download_progress' |
  'hytale_jre_download_end' |
  'hytale_jre_install_start' |
  'hytale_jre_install_progress' |
  'hytale_jre_install_end' |
  'hytale_jre_ready' |
  'hytale_files_download_start' |
  'hytale_files_download_progress' |
  'hytale_files_download_end' |
  'hytale_butler_download_start' |
  'hytale_butler_download_progress' |
  'hytale_butler_download_end' |
  'hytale_butler_ready' |
  'hytale_online_patch_start' |
  'hytale_online_patch_progress' |
  'hytale_online_patch_end' |
  'hytale_online_patch_applied' |
  'hytale_online_patch_reverted' |
  'hytale_launch_debug'
>

/**
 * Result of applying an online patch.
 */
interface PatchResult {
  /** Whether the patch was applied (false if already up-to-date) */
  applied: boolean
  /** URL the patch was downloaded from */
  url: string
  /** SHA256 hash of the patch (if known) */
  hash?: string
}

export class HytaleInstaller extends EventEmitter<InstallerEvents> {
  private serverId: string
  private instanceId: string
  private authHeaders: Record<string, string> = {}

  constructor(serverId: string, instanceId: string) {
    super()
    this.serverId = serverId
    this.instanceId = instanceId
  }

  /**
   * Set authentication headers for private instance file downloads.
   * @param headers Authentication headers (e.g., { Authorization: 'Bearer token' })
   */
  setAuthHeaders(headers: Record<string, string>): void {
    this.authHeaders = headers
  }

  /**
   * Install or update the Hytale game.
   * 
   * PWR files are applied to the `game/` subfolder using staging.
   * Game folder structure: instance/game/Client/, instance/game/Server/
   * 
   * Fresh install flow:
   * 1. Download PWR + signature from /0/{build}.pwr
   * 2. Apply PWR via Butler with signature validation
   * 3. Apply online patches (optional, from AdminTool)
   * 
   * Upgrade flow (LINEAR: 5→6→7, not 5→7):
   * 1. Restore original executables (revert patches)
   * 2. For each step from current to target:
   *    - Download incremental PWR + sig from /{n}/{n+1}.pwr
   *    - Apply PWR via Butler with signature validation
   * 3. Re-apply online patches
   * 
   * Downgrade flow (target < current):
   * 1. Delete game/ folder completely
   * 2. Download fresh PWR from /0/{target}.pwr
   * 3. Apply PWR via Butler
   * 4. Apply online patches
   * 
   * @param loader The loader config from AdminTool.
   * @returns The installation manifest.
   */
  async install(loader: IHytaleLoader): Promise<HytaleInstallManifest> {
    const targetBuildIndex = loader.build_index
    const versionType = loader.version_type ?? 'release'
    const os = getHytaleOS()
    const patchConfig = loader[os]

    // Ensure instance and game folders exist
    const instanceFolder = getHytaleInstanceFolder(this.serverId, this.instanceId)
    const gameFolder = getHytaleGameFolder(this.serverId, this.instanceId)
    const stagingFolder = getHytaleStagingFolder(this.serverId, this.instanceId)
    await fs.mkdir(instanceFolder, { recursive: true })
    await fs.mkdir(gameFolder, { recursive: true })
    await fs.mkdir(stagingFolder, { recursive: true })

    // Check existing installation
    const existingManifest = await readInstallManifest(this.serverId, this.instanceId)
    const currentBuildIndex = existingManifest?.build_index ?? 0

    if (currentBuildIndex === targetBuildIndex) {
      // Check if files actually exist (manifest might be stale)
      const clientExe = getHytaleClientExecutable(this.serverId, this.instanceId)
      let filesExist = false
      try {
        await fs.access(clientExe)
        filesExist = true
      } catch {
        filesExist = false
      }

      if (filesExist) {
        this.emit('hytale_launch_debug', `Already installed at build ${targetBuildIndex}`)
        
        // Ensure JRE is installed
        const jreVersion = await this.installJRE()
        
        // Apply online patches if configured (with manifest tracking)
        let clientPatchResult: PatchResult | undefined
        let serverPatchResult: PatchResult | undefined

        if (patchConfig?.patch_url) {
          // Check if patch is already applied
          const shouldSkipClientPatch = existingManifest?.clientPatch?.url === patchConfig.patch_url &&
            existingManifest?.clientPatch?.hash === patchConfig.patch_hash

          if (shouldSkipClientPatch) {
            this.emit('hytale_launch_debug', `Client patch already recorded in manifest, skipping`)
          } else {
            clientPatchResult = await this.applyOnlinePatch(
              getHytaleClientExecutable(this.serverId, this.instanceId),
              patchConfig.patch_url,
              patchConfig.patch_hash,
              patchConfig.original_url,
              'client'
            )
          }
        }

        if (loader.server?.patch_url) {
          const shouldSkipServerPatch = existingManifest?.serverPatch?.url === loader.server.patch_url

          if (shouldSkipServerPatch) {
            this.emit('hytale_launch_debug', `Server patch already recorded in manifest, skipping`)
          } else {
            serverPatchResult = await this.applyOnlinePatch(
              getHytaleServerExecutable(this.serverId, this.instanceId),
              loader.server.patch_url,
              loader.server.patch_hash,
              loader.server.original_url,
              'server'
            )
          }
        }

        // Update manifest if patches were applied
        if (clientPatchResult?.applied || serverPatchResult?.applied) {
          const updatedManifest: HytaleInstallManifest = {
            ...existingManifest!,
            jreVersion,
            clientPatch: clientPatchResult ? {
              url: clientPatchResult.url,
              hash: clientPatchResult.hash!,
              appliedAt: new Date().toISOString()
            } : existingManifest?.clientPatch,
            serverPatch: serverPatchResult ? {
              url: serverPatchResult.url,
              hash: serverPatchResult.hash,
              appliedAt: new Date().toISOString()
            } : existingManifest?.serverPatch
          }
          await writeInstallManifest(this.serverId, this.instanceId, updatedManifest)
          return updatedManifest
        }
        
        return existingManifest!
      } else {
        // Files missing, need to reinstall
        this.emit('hytale_launch_debug', `Manifest says build ${targetBuildIndex} but files missing, reinstalling`)
      }
    }

    // Install Butler if needed
    const butlerPath = await this.ensureButler()

    if (currentBuildIndex > 0 && targetBuildIndex > currentBuildIndex) {
      // UPGRADE FLOW: Sequential incremental updates (1→2→3, not 1→3)
      // Each step downloads the incremental PWR and applies it with signature verification
      // IMPORTANT: Update manifest after EACH step to survive interruptions (power loss, crash)
      // NOTE: Online patches are ONLY applied after the FINAL step (not intermediate ones)
      //       e.g., 2→3→4→5 applies patches once after 5, not after 3 or 4
      this.emit('hytale_launch_debug', `Upgrading: ${currentBuildIndex} -> ${targetBuildIndex} (incremental, patches after final step only)`)

      // Step 1: Restore original executables BEFORE applying any PWR updates
      // Butler expects unmodified files - patched executables will cause hash mismatches
      this.emit('hytale_launch_debug', 'Reverting online patches before update...')
      await this.restoreOriginalExecutable('client', patchConfig?.original_url, patchConfig?.original_hash)
      if (loader.server?.original_url) {
        await this.restoreOriginalExecutable('server', loader.server.original_url, loader.server.original_hash)
      }

      // Step 2: Apply incremental updates one at a time
      for (let fromBuild = currentBuildIndex; fromBuild < targetBuildIndex; fromBuild++) {
        const toBuild = fromBuild + 1
        this.emit('hytale_launch_debug', `Applying incremental update: ${fromBuild} -> ${toBuild}`)
        
        const { pwrPath, sigPath } = await this.downloadPWR(toBuild, versionType, fromBuild)
        await this.applyPWR(pwrPath, sigPath, butlerPath, gameFolder, stagingFolder)
        await this.cleanupPWR(pwrPath, sigPath)
        
        // Update manifest after each successful step to survive power loss/crashes
        const stepManifest: HytaleInstallManifest = {
          build_index: toBuild,
          version_type: versionType,
          installedAt: new Date().toISOString(),
          jreVersion: existingManifest?.jreVersion ?? 'pending',
          serverInstalled: true
        }
        await writeInstallManifest(this.serverId, this.instanceId, stepManifest)
        this.emit('hytale_launch_debug', `Updated manifest to build ${toBuild}`)
      }
    } else if (currentBuildIndex > 0 && targetBuildIndex < currentBuildIndex) {
      // DOWNGRADE FLOW: delete -> fresh install
      this.emit('hytale_launch_debug', `Downgrading: ${currentBuildIndex} -> ${targetBuildIndex} (full reinstall)`)

      // Step 1: Delete game folder completely
      await fs.rm(gameFolder, { recursive: true, force: true })
      await fs.mkdir(gameFolder, { recursive: true })
      this.emit('hytale_launch_debug', 'Deleted existing game files for downgrade')

      // Step 2: Download and apply FRESH PWR (from /0/)
      const { pwrPath, sigPath } = await this.downloadPWR(targetBuildIndex, versionType)
      await this.applyPWR(pwrPath, sigPath, butlerPath, gameFolder, stagingFolder)
      await this.cleanupPWR(pwrPath, sigPath)
    } else {
      // FRESH INSTALL: full PWR -> patch
      this.emit('hytale_launch_debug', `Fresh install: build ${targetBuildIndex}`)

      // Download and apply PWR (contains both Client/ and Server/)
      const { pwrPath, sigPath } = await this.downloadPWR(targetBuildIndex, versionType)
      await this.applyPWR(pwrPath, sigPath, butlerPath, gameFolder, stagingFolder)
      await this.cleanupPWR(pwrPath, sigPath)
    }

    // Step 3: Apply online patches (optional)
    // This runs ONLY after the final PWR update - not after intermediate steps
    // e.g., for upgrade 2→5: PWR 2→3→4→5 applied first, then patches applied once at the end
    let clientPatchResult: PatchResult | undefined
    let serverPatchResult: PatchResult | undefined

    if (patchConfig?.patch_url) {
      // Check if patch is already applied with matching hash in manifest
      const shouldSkipClientPatch = existingManifest?.clientPatch?.url === patchConfig.patch_url &&
        existingManifest?.clientPatch?.hash === patchConfig.patch_hash &&
        existingManifest?.build_index === targetBuildIndex

      if (shouldSkipClientPatch) {
        this.emit('hytale_launch_debug', `Client patch already recorded in manifest, skipping`)
        clientPatchResult = { applied: false, url: patchConfig.patch_url, hash: patchConfig.patch_hash }
      } else {
        this.emit('hytale_launch_debug', `Applying online patches after final update to build ${targetBuildIndex}`)
        clientPatchResult = await this.applyOnlinePatch(
          getHytaleClientExecutable(this.serverId, this.instanceId),
          patchConfig.patch_url,
          patchConfig.patch_hash,
          patchConfig.original_url,
          'client'
        )
      }
    }

    if (loader.server?.patch_url) {
      // Check if server patch is already applied
      const shouldSkipServerPatch = existingManifest?.serverPatch?.url === loader.server.patch_url &&
        existingManifest?.build_index === targetBuildIndex

      if (shouldSkipServerPatch) {
        this.emit('hytale_launch_debug', `Server patch already recorded in manifest, skipping`)
        serverPatchResult = { applied: false, url: loader.server.patch_url, hash: loader.server.patch_hash }
      } else {
        serverPatchResult = await this.applyOnlinePatch(
          getHytaleServerExecutable(this.serverId, this.instanceId),
          loader.server.patch_url,
          loader.server.patch_hash,
          loader.server.original_url,
          'server'
        )
      }
    }

    // Install JRE
    const jreVersion = await this.installJRE()

    // Write install manifest with patch info
    const manifest: HytaleInstallManifest = {
      build_index: targetBuildIndex,
      version_type: versionType,
      installedAt: new Date().toISOString(),
      jreVersion,
      serverInstalled: true, // PWR always contains both Client/ and Server/
      clientPatch: clientPatchResult ? {
        url: clientPatchResult.url,
        hash: clientPatchResult.hash!,
        appliedAt: new Date().toISOString()
      } : undefined,
      serverPatch: serverPatchResult ? {
        url: serverPatchResult.url,
        hash: serverPatchResult.hash,
        appliedAt: new Date().toISOString()
      } : undefined
    }

    await writeInstallManifest(this.serverId, this.instanceId, manifest)

    return manifest
  }

  /**
   * Update an existing installation to a new version.
   * @param loader The loader config from AdminTool.
   */
  async update(loader: IHytaleLoader): Promise<HytaleInstallManifest> {
    return this.install(loader)
  }

  /**
   * Restore original executable before applying update.
   * This reverts the online patch so Butler can apply incremental updates.
   * 
   * Restoration priority:
   * 1. Download from AdminTool's original_url (ensures validity for current build)
   * 2. Fall back to local backup if original_url is not available
   * 
   * @param type 'client' or 'server'
   * @param originalUrl URL to download original executable from AdminTool
   * @param originalHash Expected SHA256 hash of original executable
   */
  private async restoreOriginalExecutable(
    type: 'client' | 'server',
    originalUrl?: string,
    originalHash?: string
  ): Promise<void> {
    const exePath = type === 'client'
      ? getHytaleClientExecutable(this.serverId, this.instanceId)
      : getHytaleServerExecutable(this.serverId, this.instanceId)
    
    const exeName = path.basename(exePath)
    const patchDir = getHytalePatchStateFolder(this.serverId, this.instanceId)
    const originalBackup = path.join(patchDir, `original_${exeName}`)

    // Priority 1: Download from AdminTool's original_url
    if (originalUrl) {
      this.emit('hytale_launch_debug', `Downloading original ${type} from AdminTool for update validity`)
      
      try {
        const response = await fetch(originalUrl)
        if (!response.ok || !response.body) {
          throw new Error(`Failed to download: ${response.statusText}`)
        }
        
        const chunks: Buffer[] = []
        const hash = originalHash ? crypto.createHash('sha256') : null
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk)
          chunks.push(buffer)
          hash?.update(buffer)
        }
        
        // Verify hash if provided
        if (originalHash && hash) {
          const actualHash = hash.digest('hex')
          if (actualHash.toLowerCase() !== originalHash.toLowerCase()) {
            throw new EMLLibError(
              ErrorType.HASH_ERROR,
              `Original ${type} hash mismatch. Expected ${originalHash}, got ${actualHash}`
            )
          }
          this.emit('hytale_launch_debug', `Original ${type} hash verified: ${actualHash.substring(0, 16)}...`)
        }
        
        // Write to both the executable path and backup
        await fs.mkdir(patchDir, { recursive: true })
        const originalData = Buffer.concat(chunks)
        await fs.writeFile(exePath, originalData)
        await fs.writeFile(originalBackup, originalData)
        
        // Set executable permission
        if (process.platform !== 'win32') {
          await fs.chmod(exePath, 0o755)
        }
        
        this.emit('hytale_online_patch_reverted', { restoredPath: exePath, type })
        return
      } catch (error) {
        this.emit('hytale_launch_debug', `Failed to download original from AdminTool: ${error}, trying local backup`)
      }
    }

    // Priority 2: Use local backup
    try {
      await fs.access(originalBackup)
    } catch {
      this.emit('hytale_launch_debug', `No original ${type} backup found, skipping restore`)
      return
    }

    this.emit('hytale_launch_debug', `Restoring original ${type} executable from local backup`)

    // Restore original
    await fs.copyFile(originalBackup, exePath)

    // Set executable permission
    if (process.platform !== 'win32') {
      await fs.chmod(exePath, 0o755)
    }

    this.emit('hytale_online_patch_reverted', { restoredPath: exePath, type })
  }

  /**
   * Apply online patch (optional).
   * Matches Butter Launcher's patch mechanism.
   * 
   * @param targetPath Path to the executable to patch
   * @param patchUrl URL to download patch from
   * @param expectedHash Expected SHA256 hash of patch (optional, server has none)
   * @param originalUrl URL to original executable (for restore)
   * @param type 'client' or 'server' for logging
   * @returns Patch result with applied status and hash
   */
  private async applyOnlinePatch(
    targetPath: string,
    patchUrl: string,
    expectedHash: string | undefined,
    _originalUrl: string | undefined,
    type: 'client' | 'server'
  ): Promise<PatchResult> {
    const exeName = path.basename(targetPath)
    const patchDir = getHytalePatchStateFolder(this.serverId, this.instanceId)
    const originalBackup = path.join(patchDir, `original_${exeName}`)
    const patchedBackup = path.join(patchDir, `patched_${exeName}`)

    await fs.mkdir(patchDir, { recursive: true })

    // Check if current executable is already correctly patched (only if we have a hash)
    if (expectedHash) {
      try {
        const currentHash = await this.sha256File(targetPath)
        if (currentHash.toLowerCase() === expectedHash.toLowerCase()) {
          this.emit('hytale_launch_debug', `${type} already patched with correct hash`)
          return { applied: false, url: patchUrl, hash: expectedHash }
        }
      } catch {
        // File doesn't exist or can't be read
      }
    }

    // Ensure patched executable is downloaded
    let needsDownload = true
    let actualHash: string | undefined = expectedHash
    if (expectedHash) {
      try {
        await fs.access(patchedBackup)
        const cachedHash = await this.sha256File(patchedBackup)
        needsDownload = cachedHash.toLowerCase() !== expectedHash.toLowerCase()
      } catch {
        needsDownload = true
      }
    } else {
      // No hash for server, always check if cached version exists
      try {
        await fs.access(patchedBackup)
        needsDownload = false
      } catch {
        needsDownload = true
      }
    }

    if (needsDownload) {
      this.emit('hytale_online_patch_start', { url: patchUrl, type })

      const response = await fetch(patchUrl)
      if (!response.ok || !response.body) {
        throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to download ${type} patch: ${response.statusText}`)
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
          totalSize,
          type
        })
      }

      actualHash = hash.digest('hex')

      // Verify hash if provided
      if (expectedHash) {
        if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
          throw new EMLLibError(
            ErrorType.HASH_ERROR,
            `${type} patch hash mismatch. Expected ${expectedHash}, got ${actualHash}`
          )
        }
      }

      await fs.writeFile(patchedBackup, Buffer.concat(chunks))
      this.emit('hytale_online_patch_end', { path: patchedBackup, type })
    }

    // Backup original if not yet done
    try {
      await fs.access(originalBackup)
    } catch {
      this.emit('hytale_launch_debug', `Backing up original ${type} executable`)
      try {
        await fs.copyFile(targetPath, originalBackup)
      } catch {
        // Target might not exist yet (first install) - that's OK
        this.emit('hytale_launch_debug', `No original ${type} to backup (fresh install)`)
      }
    }

    // Apply patch
    this.emit('hytale_launch_debug', `Applying ${type} online patch`)
    await fs.copyFile(patchedBackup, targetPath)

    // Set executable permission
    if (process.platform !== 'win32') {
      await fs.chmod(targetPath, 0o755)
    }

    this.emit('hytale_online_patch_applied', {
      originalBackup,
      patchedPath: targetPath,
      type
    })

    return { applied: true, url: patchUrl, hash: actualHash }
  }

  /**
   * Calculate SHA256 hash of a file.
   */
  private async sha256File(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  /**
   * Clean up temporary PWR and signature files.
   */
  private async cleanupPWR(pwrPath: string, sigPath: string): Promise<void> {
    try {
      await fs.unlink(pwrPath)
    } catch {
      // Ignore
    }
    try {
      await fs.unlink(sigPath)
    } catch {
      // Ignore
    }
  }

  /**
   * Ensure Butler is installed.
   * @returns Path to the Butler executable.
   */
  private async ensureButler(): Promise<string> {
    const butlerPath = getButlerPath(this.serverId)
    const butlerFolder = getButlerFolder(this.serverId)

    // Check if Butler exists
    try {
      await fs.access(butlerPath)
      this.emit('hytale_butler_ready', { version: 'LATEST', path: butlerPath })
      return butlerPath
    } catch {
      // Need to download
    }

    this.emit('hytale_butler_download_start', { version: 'LATEST' })

    // Create folder
    await fs.mkdir(butlerFolder, { recursive: true })

    // Download Butler
    const url = buildButlerUrl()
    const zipPath = path.join(butlerFolder, 'butler.zip')

    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to download Butler: ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0
    let downloadedSize = 0

    const chunks: Buffer[] = []
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      chunks.push(buffer)
      downloadedSize += buffer.length

      this.emit('hytale_butler_download_progress', {
        percent: totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0,
        downloadedSize,
        totalSize
      })
    }

    await fs.writeFile(zipPath, Buffer.concat(chunks))

    this.emit('hytale_butler_download_end', { version: 'LATEST', path: zipPath })

    // Extract Butler
    await extract(zipPath, { dir: butlerFolder })
    await fs.unlink(zipPath)

    // Set executable permission
    if (process.platform !== 'win32') {
      await fs.chmod(butlerPath, 0o755)
    }

    this.emit('hytale_butler_ready', { version: 'LATEST', path: butlerPath })
    return butlerPath
  }

  /**
   * Download PWR file and signature from official Hytale servers.
   * Downloads both .pwr and .pwr.sig for integrity validation.
   * 
   * @param buildIndex Target build index.
   * @param versionType 'release' or 'pre-release'
   * @param fromBuildIndex Optional: current build index for incremental update.
   *                       If provided, downloads incremental PWR from /{from}/{to}.pwr
   *                       If omitted, downloads fresh PWR from /0/{to}.pwr
   * @returns Object with paths to downloaded PWR and signature files.
   */
  private async downloadPWR(
    buildIndex: number,
    versionType: 'release' | 'pre-release' = 'release',
    fromBuildIndex?: number
  ): Promise<{ pwrPath: string; sigPath: string }> {
    const os = getHytaleOS()
    const arch = getHytaleArch()
    const isIncremental = fromBuildIndex !== undefined && fromBuildIndex > 0
    
    const urls: PwrUrls = isIncremental
      ? buildIncrementalPwrUrl(fromBuildIndex, buildIndex, versionType, os, arch)
      : buildPwrUrl(buildIndex, versionType, os, arch)
    
    const instanceFolder = getHytaleInstanceFolder(this.serverId, this.instanceId)
    const pwrFilename = isIncremental
      ? `temp_${versionType}_${fromBuildIndex}_to_${buildIndex}.pwr`
      : `temp_${versionType}_0_to_${buildIndex}.pwr`
    const pwrPath = path.join(instanceFolder, pwrFilename)
    const sigPath = `${pwrPath}.sig`

    this.emit('hytale_pwr_download_start', {
      buildIndex,
      url: urls.pwr,
      isIncremental,
      fromBuildIndex: fromBuildIndex ?? 0
    })

    // Download PWR file using native https for reliability with large files
    await new Promise<void>((resolve, reject) => {
      const followRedirect = (url: string, redirectCount = 0): void => {
        if (redirectCount > 10) {
          reject(new Error('Too many redirects'))
          return
        }

        https.get(url, (response) => {
          // Handle redirects
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            const redirectUrl = response.headers.location.startsWith('http')
              ? response.headers.location
              : new URL(response.headers.location, url).href
            this.emit('hytale_launch_debug', `Following redirect to: ${redirectUrl}`)
            followRedirect(redirectUrl, redirectCount + 1)
            return
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download PWR: HTTP ${response.statusCode}`))
            return
          }

          const contentLength = response.headers['content-length']
          const totalSize = contentLength ? parseInt(contentLength, 10) : 0
          let downloadedSize = 0

          const writeStream = fsSync.createWriteStream(pwrPath)

          // Progress tracking
          const progressInterval = setInterval(() => {
            this.emit('hytale_pwr_download_progress', {
              percent: totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0,
              downloadedSize,
              totalSize,
              speed: 0
            })
          }, 500)

          response.on('data', (chunk: Buffer) => {
            downloadedSize += chunk.length
          })

          response.on('error', (err) => {
            clearInterval(progressInterval)
            writeStream.close()
            reject(err)
          })

          writeStream.on('error', (err) => {
            clearInterval(progressInterval)
            reject(err)
          })

          writeStream.on('finish', () => {
            clearInterval(progressInterval)
            this.emit('hytale_pwr_download_progress', {
              percent: 100,
              downloadedSize,
              totalSize,
              speed: 0
            })
            resolve()
          })

          response.pipe(writeStream)
        }).on('error', reject)
      }

      followRedirect(urls.pwr)
    })

    // Always download signature (both fresh installs and incremental have signatures)
    this.emit('hytale_launch_debug', `Downloading signature: ${urls.sig}`)
    const sigResponse = await fetch(urls.sig)
    if (!sigResponse.ok || !sigResponse.body) {
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to download signature: ${sigResponse.statusText}`)
    }

    const sigChunks: Buffer[] = []
    for await (const chunk of sigResponse.body) {
      sigChunks.push(Buffer.from(chunk))
    }
    await fs.writeFile(sigPath, Buffer.concat(sigChunks))

    // Verify file size
    const stats = await fs.stat(pwrPath)
    this.emit('hytale_pwr_download_end', {
      buildIndex,
      path: pwrPath,
      size: stats.size,
      isIncremental,
      fromBuildIndex: fromBuildIndex ?? 0
    })
    
    return { pwrPath, sigPath }
  }

  /**
   * Apply PWR patch using Butler.
   * 
   * Butler requires --staging-dir for ALL apply operations.
   * Staging directory MUST be clean before each operation.
   * 
   * Flow:
   * 1. Delete staging dir (clean slate)
   * 2. Create fresh staging dir
   * 3. Apply patch with signature verification
   * 4. Delete staging dir on success
   * 
   * @param pwrPath Path to the PWR file.
   * @param sigPath Path to the signature file.
   * @param butlerPath Path to Butler executable.
   * @param gameDir Target game directory (where Client/ and Server/ are).
   * @param stagingDir Staging directory for temporary files.
   */
  private async applyPWR(
    pwrPath: string,
    sigPath: string,
    butlerPath: string,
    gameDir: string,
    stagingDir: string
  ): Promise<void> {
    // Ensure game directory exists
    await fs.mkdir(gameDir, { recursive: true })
    
    // CRITICAL: Clean staging directory before each operation
    // Leftover files cause Butler to panic on subsequent patches
    await fs.rm(stagingDir, { recursive: true, force: true })
    await fs.mkdir(stagingDir, { recursive: true })
    this.emit('hytale_launch_debug', 'Created fresh staging directory')

    this.emit('hytale_pwr_patch_start', { path: pwrPath })

    return new Promise((resolve, reject) => {
      // Butler requires --staging-dir and --signature for ALL apply operations
      const args = ['apply', '--json', '--staging-dir', stagingDir, '--signature', sigPath, pwrPath, gameDir]
      
      const butlerProcess = spawn(butlerPath, args, { windowsHide: true })

      butlerProcess.on('error', (error) => {
        this.emit('hytale_pwr_patch_error', { error: error.message })
        reject(new EMLLibError(ErrorType.INSTALL_ERROR, `Butler failed to start: ${error.message}`))
      })

      // Parse Butler JSON output for progress and errors
      let stdoutOutput = ''
      if (butlerProcess.stdout) {
        const rl = readline.createInterface({
          input: butlerProcess.stdout,
          crlfDelay: Infinity
        })

        rl.on('line', (line) => {
          const trimmed = line.trim()
          if (!trimmed) return
          
          stdoutOutput += line + '\n'

          try {
            const obj = JSON.parse(trimmed)
            const type = typeof obj?.type === 'string' ? obj.type : ''
            
            // Log error messages
            if (type === 'error' || obj?.level === 'error') {
              this.emit('hytale_launch_debug', `Butler error: ${obj.message || JSON.stringify(obj)}`)
            }
            
            // Parse progress
            const isProgress =
              type.toLowerCase().includes('progress') ||
              typeof obj?.percentage === 'number' ||
              typeof obj?.percent === 'number'

            if (!isProgress) return

            let percent: number | undefined
            if (typeof obj.percentage === 'number') percent = obj.percentage
            else if (typeof obj.percent === 'number') percent = obj.percent
            else if (typeof obj.progress === 'number') percent = obj.progress

            if (typeof percent !== 'number' || Number.isNaN(percent)) return

            // Normalize 0..1 to 0..100
            if (percent > 0 && percent <= 1) percent = percent * 100
            percent = Math.max(0, Math.min(100, percent))

            this.emit('hytale_pwr_patch_progress', { percent: Math.round(percent) })
          } catch {
            // Not JSON, log as plain text
            this.emit('hytale_launch_debug', `Butler: ${trimmed}`)
          }
        })

        butlerProcess.on('close', () => rl.close())
      }

      // Accumulate stderr for error reporting
      let stderrOutput = ''
      butlerProcess.stderr?.on('data', (data) => {
        const chunk = data.toString()
        stderrOutput += chunk
        this.emit('hytale_launch_debug', `Butler stderr: ${chunk.trim()}`)
      })

      butlerProcess.on('close', (code) => {
        this.emit('hytale_pwr_patch_end', { exitCode: code ?? 0 })

        if (code !== 0) {
          const errorMsg = stderrOutput.trim() || `Butler exited with code ${code}`
          reject(new EMLLibError(ErrorType.INSTALL_ERROR, errorMsg))
        } else {
          // Clean up staging directory after successful patch
          fs.rm(stagingDir, { recursive: true, force: true })
            .then(() => this.emit('hytale_launch_debug', 'Cleaned up staging directory'))
            .catch(() => {}) // Ignore cleanup errors
          
          // Set executable permissions on non-Windows
          this.ensureClientExecutable(gameDir).then(resolve).catch(resolve)
        }
      })
    })
  }

  /**
   * Install JRE from official Hytale servers.
   * @returns The installed JRE version.
   */
  async installJRE(): Promise<string> {
    const javaPath = getHytaleJavaPath(this.serverId)

    this.emit('hytale_jre_check', {})

    // Check if JRE already exists
    try {
      await fs.access(javaPath)
      this.emit('hytale_jre_ready', { version: 'installed', path: javaPath })
      return 'installed'
    } catch {
      // Need to install
    }

    // Fetch JRE manifest from Hytale
    const manifestRes = await fetch(HYTALE_JRE_MANIFEST_URL)
    if (!manifestRes.ok) {
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to fetch JRE manifest: ${manifestRes.statusText}`)
    }
    const jreManifest: IHytaleJREManifest = await manifestRes.json() as IHytaleJREManifest

    // Get download info for current platform
    const os = getHytaleOS()
    const arch = getHytaleArch()

    // Platform-specific download URL lookup
    let downloadInfo: IHytaleJREDownload | undefined
    if (os === 'darwin' && arch === 'arm64') {
      downloadInfo = jreManifest.download_url.darwin?.arm64
    } else if (os === 'linux' && arch === 'amd64') {
      downloadInfo = jreManifest.download_url.linux?.amd64
    } else if (os === 'windows' && arch === 'amd64') {
      downloadInfo = jreManifest.download_url.windows?.amd64
    }

    if (!downloadInfo) {
      throw new EMLLibError(ErrorType.UNKNOWN_OS, `No JRE available for ${os}/${arch}`)
    }

    const jreFolder = getHytaleJREFolder(this.serverId)
    const archiveName = downloadInfo.url.split('/').pop()!
    const archivePath = path.join(jreFolder, archiveName)

    // Create JRE folder
    await fs.mkdir(jreFolder, { recursive: true })

    this.emit('hytale_jre_download_start', { version: jreManifest.version })

    // Download JRE
    const jreRes = await fetch(downloadInfo.url)
    if (!jreRes.ok || !jreRes.body) {
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Failed to download JRE: ${jreRes.statusText}`)
    }

    const contentLength = jreRes.headers.get('content-length')
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0
    let downloadedSize = 0

    const hash = crypto.createHash('sha256')
    const chunks: Buffer[] = []

    for await (const chunk of jreRes.body) {
      const buffer = Buffer.from(chunk)
      chunks.push(buffer)
      hash.update(buffer)
      downloadedSize += buffer.length

      this.emit('hytale_jre_download_progress', {
        percent: totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0,
        downloadedSize,
        totalSize,
        speed: 0
      })
    }

    // Verify hash
    const actualHash = hash.digest('hex')
    if (actualHash !== downloadInfo.sha256) {
      throw new EMLLibError(
        ErrorType.HASH_ERROR,
        `JRE hash mismatch. Expected ${downloadInfo.sha256}, got ${actualHash}`
      )
    }

    // Write archive
    await fs.writeFile(archivePath, Buffer.concat(chunks))

    this.emit('hytale_jre_download_end', { version: jreManifest.version, path: archivePath })
    this.emit('hytale_jre_install_start', { version: jreManifest.version })

    // Extract JRE
    await this.extractJRE(archivePath, jreFolder, jreManifest.version)

    // Clean up archive
    await fs.unlink(archivePath)

    this.emit('hytale_jre_install_end', { version: jreManifest.version, path: javaPath })
    this.emit('hytale_jre_ready', { version: jreManifest.version, path: javaPath })

    return jreManifest.version
  }

  /**
   * Extract JRE archive and normalize layout.
   */
  private async extractJRE(archivePath: string, jreFolder: string, _version: string): Promise<void> {
    // Clear existing JRE folder content (except archive)
    try {
      const files = await fs.readdir(jreFolder)
      for (const file of files) {
        if (file !== path.basename(archivePath)) {
          await fs.rm(path.join(jreFolder, file), { recursive: true, force: true })
        }
      }
    } catch {
      // Ignore
    }

    if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      this.emit('hytale_jre_install_progress', {
        percent: 0,
        currentFile: '',
        extractedFiles: 0,
        totalFiles: 0
      })

      await tar.x({
        file: archivePath,
        cwd: jreFolder,
        strip: 1
      })

      this.emit('hytale_jre_install_progress', {
        percent: 100,
        currentFile: '',
        extractedFiles: 1,
        totalFiles: 1
      })
    } else {
      let extractedFiles = 0

      await extract(archivePath, {
        dir: jreFolder,
        onEntry: (entry, zipfile) => {
          extractedFiles++
          this.emit('hytale_jre_install_progress', {
            percent: Math.round((extractedFiles / zipfile.entryCount) * 100),
            currentFile: entry.fileName,
            extractedFiles,
            totalFiles: zipfile.entryCount
          })
        }
      })

      // Move files from subdirectory to root if needed
      await this.normalizeJRELayout(jreFolder)
    }
  }

  /**
   * Normalize JRE layout - move files from nested directory to root.
   */
  private async normalizeJRELayout(jreFolder: string): Promise<void> {
    const files = await fs.readdir(jreFolder)
    
    for (const file of files) {
      if (file.startsWith('.')) continue
      
      const filePath = path.join(jreFolder, file)
      const stat = await fs.stat(filePath)
      
      if (stat.isDirectory()) {
        // Check if this is the nested JRE directory
        const subFiles = await fs.readdir(filePath)
        const hasJreContent = subFiles.some(f => f === 'bin' || f === 'lib' || f === 'Contents')
        
        if (hasJreContent) {
          // Move contents up
          for (const subFile of subFiles) {
            const from = path.join(filePath, subFile)
            const to = path.join(jreFolder, subFile)
            
            try {
              await fs.rename(from, to)
            } catch {
              // Try copy + delete if rename fails
              await fs.cp(from, to, { recursive: true })
              await fs.rm(from, { recursive: true, force: true })
            }
          }
          
          await fs.rm(filePath, { recursive: true, force: true })
          break
        }
      }
    }
  }

  /**
   * Ensure executable permissions on game binaries.
   */
  private async ensureClientExecutable(folder: string): Promise<void> {
    if (process.platform === 'win32') return

    const executableNames = ['Hytale', 'hytale', 'HytaleServer', 'hytale_server']

    for (const name of executableNames) {
      const filePath = path.join(folder, name)
      try {
        await fs.access(filePath)
        await fs.chmod(filePath, 0o755)
      } catch {
        // File doesn't exist, skip
      }
    }

    // Also check macOS app bundle
    const macAppPath = path.join(folder, 'Hytale.app', 'Contents', 'MacOS', 'Hytale')
    try {
      await fs.access(macAppPath)
      await fs.chmod(macAppPath, 0o755)
    } catch {
      // Not a macOS bundle, skip
    }
  }

  /**
   * Download Hytale files (mods) from AdminTool.
   * Uses the shared Downloader class for consistent download behavior.
   * Files are placed in UserData/Mods/ folder.
   * 
   * @param files Array of files to download (from /api/files endpoint, same as Minecraft).
   * @returns Number of files downloaded.
   */
  async downloadFiles(files: File[]): Promise<number> {
    if (!files || files.length === 0) {
      this.emit('hytale_files_download_end', { downloadedFiles: 0, totalSize: 0 })
      return 0
    }

    // Set destination to UserData/Mods folder
    const modsFolder = getHytaleModsFolder(this.serverId, this.instanceId)
    await fs.mkdir(modsFolder, { recursive: true })

    // Normalize file paths to be empty (all files go directly to Mods folder)
    const normalizedFiles = files.map(f => ({
      ...f,
      path: f.path || '',
      type: f.type || 'MOD' as const
    }))

    const totalSize = normalizedFiles.reduce((acc, f) => acc + (f.size ?? 0), 0)
    this.emit('hytale_files_download_start', { 
      totalFiles: normalizedFiles.length, 
      totalSize 
    })

    // Use shared Downloader with auth headers for private instances
    const downloader = new Downloader(modsFolder, this.authHeaders)

    downloader.on('download_progress', (progress) => {
      this.emit('hytale_files_download_progress', {
        downloadedFiles: progress.downloaded.amount,
        totalFiles: progress.total.amount,
        downloadedSize: progress.downloaded.size,
        totalSize: progress.total.size,
        speed: progress.speed
      })
    })

    await downloader.download(normalizedFiles)

    this.emit('hytale_files_download_end', { 
      downloadedFiles: normalizedFiles.length, 
      totalSize 
    })

    return normalizedFiles.length
  }
}

export default HytaleInstaller

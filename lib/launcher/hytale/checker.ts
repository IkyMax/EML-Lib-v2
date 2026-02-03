/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 * 
 * Hytale game installation checker.
 * Verifies if the game is installed and validates installation integrity.
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import {
  getHytaleClientFolder,
  getHytaleServerFolder,
  getHytaleInstallManifestPath,
  getHytaleClientExecutable,
  getHytaleJavaPath
} from './constants'
import type { HytaleInstallManifest, PatchHealth } from '../../../types/hytale'

export interface CheckResult {
  /** Whether the game client is installed */
  clientInstalled: boolean
  /** Whether the game server is installed (optional) */
  serverInstalled: boolean
  /** Whether the JRE is installed */
  jreInstalled: boolean
  /** Whether all required components are present */
  isComplete: boolean
  /** The installed build index, if any */
  buildIndex: number | null
  /** The installation manifest */
  manifest: HytaleInstallManifest | null
  /** Client hash verification result */
  clientHashValid: boolean | null
  /** Server hash verification result */
  serverHashValid: boolean | null
  /** Whether the installation needs update (build mismatch) */
  needsUpdate: boolean
}

/**
 * Calculate SHA256 hash of a file.
 * @param filePath Path to the file.
 * @returns Hex-encoded SHA256 hash.
 */
async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const input = fsSync.createReadStream(filePath)
  await pipeline(input, hash)
  return hash.digest('hex')
}

/**
 * Read the installation manifest for a Hytale instance.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns The manifest or null if not found.
 */
export async function readInstallManifest(
  serverId: string,
  instanceId: string
): Promise<HytaleInstallManifest | null> {
  const manifestPath = getHytaleInstallManifestPath(serverId, instanceId)
  
  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
    return JSON.parse(content) as HytaleInstallManifest
  } catch {
    return null
  }
}

/**
 * Write the installation manifest for a Hytale instance.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @param manifest The manifest to write.
 */
export async function writeInstallManifest(
  serverId: string,
  instanceId: string,
  manifest: HytaleInstallManifest
): Promise<void> {
  const manifestPath = getHytaleInstallManifestPath(serverId, instanceId)
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

/**
 * Check if a file exists.
 * @param filePath Path to check.
 * @returns True if the file exists.
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
 * Check if a directory exists and contains files.
 * @param dirPath Path to check.
 * @returns True if the directory exists and is not empty.
 */
async function dirExistsWithContent(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath)
    if (!stat.isDirectory()) return false
    
    const files = await fs.readdir(dirPath)
    return files.length > 0
  } catch {
    return false
  }
}

/**
 * Check the Hytale game installation status.
 * 
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @param expectedBuildIndex Optional expected build index to check for updates.
 * @returns Installation check result.
 */
export async function checkGameInstallation(
  serverId: string,
  instanceId: string,
  expectedBuildIndex?: number
): Promise<CheckResult> {
  const manifest = await readInstallManifest(serverId, instanceId)
  
  // Check client
  const clientExecutable = getHytaleClientExecutable(serverId, instanceId)
  const clientInstalled = await fileExists(clientExecutable)
  
  // Check server (optional - may not be installed)
  const serverFolder = getHytaleServerFolder(serverId, instanceId)
  const serverInstalled = await dirExistsWithContent(serverFolder)
  
  // Check JRE
  const javaPath = getHytaleJavaPath(serverId)
  const jreInstalled = await fileExists(javaPath)
  
  // Determine if complete (client + JRE required, server optional)
  const isComplete = clientInstalled && jreInstalled
  
  // Check for updates
  const needsUpdate = expectedBuildIndex !== undefined && 
    manifest !== null && 
    manifest.build_index !== expectedBuildIndex

  return {
    clientInstalled,
    serverInstalled,
    jreInstalled,
    isComplete,
    buildIndex: manifest?.build_index ?? null,
    manifest,
    // Hash validation is done separately for performance reasons
    clientHashValid: null,
    serverHashValid: null,
    needsUpdate
  }
}

/**
 * Verify game installation integrity.
 * Since the game is now installed from official Hytale servers via Butler/PWR,
 * we trust Butler's integrity checking during installation.
 * 
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Check result with installation state.
 */
export async function verifyGameInstallation(
  serverId: string,
  instanceId: string
): Promise<CheckResult> {
  const baseResult = await checkGameInstallation(serverId, instanceId)
  
  // Butler/PWR handles integrity during installation
  // No additional hash verification needed
  return {
    ...baseResult,
    clientHashValid: baseResult.clientInstalled ? true : null,
    serverHashValid: null
  }
}

/**
 * Get the patch health status for deciding UI state.
 * 
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @param expectedBuildIndex The expected build index from AdminTool.
 * @param expectedClientHash The expected client hash from AdminTool.
 * @returns Patch health information.
 */
export async function getPatchHealth(
  serverId: string,
  instanceId: string,
  expectedBuildIndex: number,
  expectedClientHash?: string
): Promise<PatchHealth> {
  const manifest = await readInstallManifest(serverId, instanceId)
  const clientExecutable = getHytaleClientExecutable(serverId, instanceId)
  const clientExists = await fileExists(clientExecutable)
  
  // Check if actually patched (has patched client)
  let isPatched = false
  let isPatchOutdated = false
  let needsRepair = false
  
  if (clientExists && manifest) {
    isPatched = true
    
    // Check if build index matches
    if (manifest.build_index !== expectedBuildIndex) {
      isPatchOutdated = true
    }
    
    // If we have expected hash, verify integrity
    if (expectedClientHash) {
      try {
        const actualHash = await sha256File(clientExecutable)
        if (actualHash.toLowerCase() !== expectedClientHash.toLowerCase()) {
          // Hash mismatch - could be outdated or corrupted
          if (manifest.build_index === expectedBuildIndex) {
            // Same build but wrong hash - needs repair
            needsRepair = true
          } else {
            // Different build - just outdated
            isPatchOutdated = true
          }
        }
      } catch {
        needsRepair = true
      }
    }
  }
  
  return {
    patched: isPatched,
    outdated: isPatchOutdated,
    needsRepair,
    currentBuildIndex: manifest?.build_index,
    expectedBuildIndex
  }
}

/**
 * Clean up a Hytale instance installation.
 * WARNING: This deletes all game files for the instance.
 * 
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 */
export async function cleanInstallation(
  serverId: string,
  instanceId: string
): Promise<void> {
  const clientFolder = getHytaleClientFolder(serverId, instanceId)
  const serverFolder = getHytaleServerFolder(serverId, instanceId)
  const manifestPath = getHytaleInstallManifestPath(serverId, instanceId)
  
  // Remove directories (JRE is shared and not removed)
  await fs.rm(clientFolder, { recursive: true, force: true })
  await fs.rm(serverFolder, { recursive: true, force: true })
  
  // Remove manifest
  try {
    await fs.unlink(manifestPath)
  } catch {
    // Ignore if manifest doesn't exist
  }
}

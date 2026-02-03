/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 * 
 * Hytale launcher constants and utility functions.
 */

import path from 'node:path'
import utils from '../../utils/utils'

// ============================================================================
// Root Configuration
// ============================================================================

/**
 * Custom root folder name. When set, paths will use:
 * `{appdata}/.{root}/.{serverId}/` instead of `{appdata}/.{serverId}/`
 */
let customRoot: string | null = null

/**
 * Set a custom root folder for Hytale installations.
 * This allows all Hytale data to be stored under a launcher-specific folder.
 * @param root The root folder name (e.g., 'kintare'). Pass null to reset to default.
 */
export function setHytaleRoot(root: string | null): void {
  customRoot = root
}

/**
 * Get the root folder for a given serverId, respecting custom root if set.
 * @param serverId The server/launcher ID.
 * @returns The base path for this server's data.
 */
function getRootFolder(serverId: string): string {
  if (customRoot) {
    return path.join(utils.getAppDataFolder(), utils.getServerFolderName(customRoot), utils.getServerFolderName(serverId))
  }
  return utils.getServerFolder(serverId)
}

// ============================================================================
// URL Constants
// ============================================================================

/**
 * Base URL for official Hytale game patches (PWR format).
 * Game is downloaded from here using Butler.
 */
export const HYTALE_PATCHES_BASE_URL = 'https://game-patches.hytale.com/patches'

/**
 * URL for Hytale JRE manifest.
 * Contains per-OS JRE download information.
 */
export const HYTALE_JRE_MANIFEST_URL = 'https://launcher.hytale.com/version/release/jre.json'

/**
 * Base URL for Butler tool downloads from itch.io broth.
 * Uses LATEST to always get the newest version (same as Butter Launcher).
 */
export const BUTLER_BROTH_URL = 'https://broth.itch.zone/butler'

/**
 * Patch state directory name.
 * Stored at instance level (NOT inside game/) to avoid interfering with PWR signature validation.
 */
export const PATCH_STATE_DIRNAME = '.eml-online-patch'

// ============================================================================
// OS/Arch Helpers
// ============================================================================

export type HytaleOS = 'windows' | 'darwin' | 'linux'
export type HytaleArch = 'amd64' | 'arm64'

/**
 * Get the current OS in Hytale format.
 * @returns The OS string used by Hytale APIs ('windows', 'darwin', 'linux').
 */
export function getHytaleOS(): HytaleOS {
  const os = utils.getOS()
  if (os === 'win') return 'windows'
  if (os === 'mac') return 'darwin'
  return 'linux'
}

/**
 * Get the current architecture in Hytale format.
 * @returns The architecture string used by Hytale APIs ('amd64' or 'arm64').
 */
export function getHytaleArch(): HytaleArch {
  // Hytale uses 'amd64' for x64 and 'arm64' for ARM
  if (process.arch === 'arm64') return 'arm64'
  return 'amd64'
}

/**
 * Get the OS string for Butler downloads.
 * Butler uses slightly different OS names.
 */
export function getButlerOS(): string {
  const os = utils.getOS()
  if (os === 'win') return 'windows'
  if (os === 'mac') return 'darwin'
  return 'linux'
}

/**
 * Get the arch string for Butler downloads.
 * Butler uses '386' for 32-bit, 'amd64' for 64-bit.
 */
export function getButlerArch(): string {
  if (process.arch === 'arm64') return 'amd64' // Butler may not have arm64, fallback to amd64
  return utils.getArch() === '64' ? 'amd64' : '386'
}

// ============================================================================
// URL Builders
// ============================================================================

/**
 * PWR and signature URLs.
 */
export interface PwrUrls {
  pwr: string
  sig: string
}

/**
 * Build URLs for a fresh PWR patch file (from scratch).
 * Used for first install.
 * A single PWR contains both Client/ and Server/ folders.
 * 
 * @param buildIndex The target build index/version number.
 * @param versionType 'release' or 'pre-release'
 * @param os The target OS.
 * @param arch The target architecture.
 * @returns Object with PWR and signature URLs.
 */
export function buildPwrUrl(
  buildIndex: number,
  versionType: 'release' | 'pre-release' = 'release',
  os: HytaleOS = getHytaleOS(),
  arch: HytaleArch = getHytaleArch()
): PwrUrls {
  // PWR URL: https://game-patches.hytale.com/patches/{os}/{arch}/{versionType}/0/{buildIndex}.pwr
  // The /0/ means "from scratch" - PWR contains the full game
  const base = `${HYTALE_PATCHES_BASE_URL}/${os}/${arch}/${versionType}/0/${buildIndex}.pwr`
  return {
    pwr: base,
    sig: `${base}.sig`
  }
}

/**
 * Build URLs for an incremental PWR patch file.
 * Updates are LINEAR: 5→6→7, not 5→7 directly.
 * 
 * @param fromBuildIndex The current installed build index.
 * @param toBuildIndex The next build index (must be fromBuildIndex + 1 for valid incremental).
 * @param versionType 'release' or 'pre-release'
 * @param os The target OS.
 * @param arch The target architecture.
 * @returns Object with PWR and signature URLs.
 */
export function buildIncrementalPwrUrl(
  fromBuildIndex: number,
  toBuildIndex: number,
  versionType: 'release' | 'pre-release' = 'release',
  os: HytaleOS = getHytaleOS(),
  arch: HytaleArch = getHytaleArch()
): PwrUrls {
  // Incremental PWR URL: https://game-patches.hytale.com/patches/{os}/{arch}/{versionType}/{from}/{to}.pwr
  const base = `${HYTALE_PATCHES_BASE_URL}/${os}/${arch}/${versionType}/${fromBuildIndex}/${toBuildIndex}.pwr`
  return {
    pwr: base,
    sig: `${base}.sig`
  }
}

/**
 * Build Butler download URL.
 * Uses LATEST to always get the newest version (same as Butter Launcher).
 * @param os Target OS.
 * @param arch Target architecture.
 * @returns The full URL to download Butler.
 */
export function buildButlerUrl(
  os: string = getButlerOS(),
  arch: string = getButlerArch()
): string {
  // Use LATEST/archive/default like Butter Launcher does
  return `${BUTLER_BROTH_URL}/${os}-${arch}/LATEST/archive/default`
}

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the base Hytale instances folder.
 * Stored alongside Minecraft instances in the same server folder.
 * @param serverId The server/launcher ID.
 * @returns Path to the instances folder.
 */
export function getHytaleInstancesFolder(serverId: string): string {
  return path.join(getRootFolder(serverId), 'instances')
}

/**
 * Get the Hytale instance folder.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the specific instance folder.
 */
export function getHytaleInstanceFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleInstancesFolder(serverId), instanceId)
}

/**
 * Get the game folder for a Hytale instance.
 * This is where PWR patches are applied (contains Client/ and Server/).
 * Separate from instance root to allow staging updates.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the game folder.
 */
export function getHytaleGameFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleInstanceFolder(serverId, instanceId), 'game')
}

/**
 * Get the staging folder for PWR updates.
 * Butler uses this for temporary files during patching.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the staging folder.
 */
export function getHytaleStagingFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleInstanceFolder(serverId, instanceId), 'staging')
}

/**
 * Get the client folder for a Hytale instance.
 * PWR extracts game files into game/Client/ subfolder.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the Client folder.
 */
export function getHytaleClientFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleGameFolder(serverId, instanceId), 'Client')
}

/**
 * Get the server folder for a Hytale instance.
 * PWR extracts server files into game/Server/ subfolder.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the Server folder.
 */
export function getHytaleServerFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleGameFolder(serverId, instanceId), 'Server')
}

/**
 * Get the shared Hytale JRE folder.
 * JRE is shared across all Hytale instances and updated according to Hytale API.
 * @param serverId The server/launcher ID.
 * @returns Path to the shared JRE folder.
 */
export function getHytaleJREFolder(serverId: string): string {
  return path.join(getRootFolder(serverId), 'runtime', 'hytale-jre')
}

/**
 * Get the UserData folder for a Hytale instance.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the UserData folder.
 */
export function getHytaleUserDataFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleInstanceFolder(serverId, instanceId), 'UserData')
}

/**
 * Get the mods folder for a Hytale instance.
 * All downloaded files from AdminTool go here.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the UserData/Mods folder.
 */
export function getHytaleModsFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleUserDataFolder(serverId, instanceId), 'Mods')
}

/**
 * Get the install manifest path for a Hytale instance.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the install.json file.
 */
export function getHytaleInstallManifestPath(serverId: string, instanceId: string): string {
  return path.join(getHytaleInstanceFolder(serverId, instanceId), 'install.json')
}

/**
 * Get the patch state folder for a Hytale instance.
 * Stored at instance level to avoid interfering with PWR signature validation.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the .eml-online-patch folder.
 */
export function getHytalePatchStateFolder(serverId: string, instanceId: string): string {
  return path.join(getHytaleInstanceFolder(serverId, instanceId), PATCH_STATE_DIRNAME)
}

/**
 * Get the Butler tool folder.
 * @param serverId The server/launcher ID.
 * @returns Path to the butler folder.
 */
export function getButlerFolder(serverId: string): string {
  return path.join(getRootFolder(serverId), 'runtime', 'butler')
}

/**
 * Get the Butler executable path.
 * @param serverId The server/launcher ID.
 * @returns Path to the butler executable.
 */
export function getButlerPath(serverId: string): string {
  const ext = utils.getOS() === 'win' ? '.exe' : ''
  return path.join(getButlerFolder(serverId), `butler${ext}`)
}

/**
 * Get the path to the Java executable within the Hytale JRE.
 * @param serverId The server/launcher ID.
 * @returns Path to the java executable.
 */
export function getHytaleJavaPath(serverId: string): string {
  const os = utils.getOS()
  const jreFolder = getHytaleJREFolder(serverId)
  
  if (os === 'win') {
    return path.join(jreFolder, 'bin', 'java.exe')
  } else if (os === 'mac') {
    return path.join(jreFolder, 'Contents', 'Home', 'bin', 'java')
  } else {
    return path.join(jreFolder, 'bin', 'java')
  }
}

/**
 * Get the Hytale client executable path.
 * Client executable is named HytaleClient (not Hytale).
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the client executable.
 */
export function getHytaleClientExecutable(serverId: string, instanceId: string): string {
  const os = utils.getOS()
  const clientFolder = getHytaleClientFolder(serverId, instanceId)
  
  if (os === 'win') {
    return path.join(clientFolder, 'HytaleClient.exe')
  } else if (os === 'mac') {
    // macOS may have app bundle or direct binary
    return path.join(clientFolder, 'HytaleClient')
  } else {
    return path.join(clientFolder, 'HytaleClient')
  }
}

/**
 * Get the Hytale server executable path.
 * @param serverId The server/launcher ID.
 * @param instanceId The Hytale instance ID.
 * @returns Path to the server JAR (platform-agnostic).
 */
export function getHytaleServerExecutable(serverId: string, instanceId: string): string {
  const serverFolder = getHytaleServerFolder(serverId, instanceId)
  // Server is Java-based and platform-agnostic
  return path.join(serverFolder, 'HytaleServer.jar')
}

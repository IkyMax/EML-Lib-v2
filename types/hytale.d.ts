/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

/**
 * Hytale loader info from AdminTool.
 * AdminTool provides the pinned build_index and online patch URLs.
 * The actual game is downloaded from official Hytale CDN.
 * 
 * PWR URL format: https://game-patches.hytale.com/patches/{os}/{arch}/{versionType}/0/{build_index}.pwr
 * PWR files always install from scratch (no incremental updates).
 * A single PWR contains both Client/ and Server/ folders.
 * 
 * Update flow:
 * 1. Restore original executable (if patched)
 * 2. Download full PWR from Hytale CDN
 * 3. Apply PWR via Butler
 * 4. Re-apply online patch from AdminTool
 */
export interface IHytaleLoader {
  /**
   * The pinned Hytale build number.
   * Game files are downloaded from Hytale CDN at:
   * https://game-patches.hytale.com/patches/{os}/{arch}/{versionType}/0/{build_index}.pwr
   */
  build_index: number

  /**
   * Version type: 'release' or 'pre-release'.
   * @default 'release'
   */
  version_type?: 'release' | 'pre-release'

  /**
   * Windows-specific CLIENT patch configuration.
   */
  windows?: IHytaleClientPatchConfig

  /**
   * Linux-specific CLIENT patch configuration.
   */
  linux?: IHytaleClientPatchConfig

  /**
   * macOS-specific CLIENT patch configuration.
   */
  darwin?: IHytaleClientPatchConfig

  /**
   * Server patch configuration.
   * Server patch URLs (no hash verification like Butter).
   */
  server?: IHytaleServerPatchConfig
}

/**
 * Per-OS CLIENT patch configuration from AdminTool.
 * Matches Butter Launcher's patch structure.
 * 
 * IMPORTANT: When providing patches, you MUST also provide original_url
 * to ensure update validity. The original file is used to restore the
 * executable before applying incremental PWR updates.
 */
export interface IHytaleClientPatchConfig {
  /**
   * URL to patched CLIENT executable.
   */
  patch_url: string

  /**
   * SHA256 hash of patched client executable (lowercase hex).
   * Recommended for integrity verification.
   */
  patch_hash?: string

  /**
   * URL to original (unpatched) CLIENT executable.
   * REQUIRED for updates: Used to restore original before applying PWR patches.
   * Must match what Hytale CDN provides for the current build_index.
   */
  original_url: string

  /**
   * SHA256 hash of original client executable (lowercase hex).
   * Recommended for integrity verification.
   */
  original_hash?: string
}

/**
 * Server patch configuration from AdminTool.
 * Matches Butter Launcher's server patch structure.
 * 
 * IMPORTANT: When providing patches, you MUST also provide original_url
 * to ensure update validity.
 */
export interface IHytaleServerPatchConfig {
  /**
   * URL to patched SERVER JAR.
   * Called 'server_url' in Butter.
   */
  patch_url: string

  /**
   * SHA256 hash of patched server JAR (lowercase hex).
   * Recommended for integrity verification.
   */
  patch_hash?: string

  /**
   * URL to original (unpatched) SERVER JAR.
   * REQUIRED for updates: Used to restore original before applying PWR patches.
   * Called 'unserver_url' in Butter.
   */
  original_url: string

  /**
   * SHA256 hash of original server JAR (lowercase hex).
   * Recommended for integrity verification.
   */
  original_hash?: string
}

/**
 * Hytale JRE manifest from launcher.hytale.com
 */
export interface IHytaleJREManifest {
  /**
   * JRE version string like "25.0.1_8".
   */
  version: string

  /**
   * Platform-specific download URLs.
   */
  download_url: {
    linux: {
      amd64: IHytaleJREDownload
    }
    darwin: {
      arm64: IHytaleJREDownload
    }
    windows: {
      amd64: IHytaleJREDownload
    }
  }
}

/**
 * JRE download info for a specific platform.
 */
export interface IHytaleJREDownload {
  /**
   * Download URL for the JRE archive.
   */
  url: string

  /**
   * SHA256 hash for verification.
   */
  sha256: string
}

/**
 * Patch state stored in instance/.eml-online-patch/state.json
 * Located at instance level to avoid interfering with PWR signature validation.
 */
export interface HytalePatchState {
  /**
   * Whether the patch is currently enabled.
   */
  enabled: boolean

  /**
   * SHA256 hash of the currently applied patch.
   */
  patch_hash?: string

  /**
   * URL of the currently applied patch.
   */
  patch_url?: string

  /**
   * The build index this state applies to.
   */
  build_index?: number

  /**
   * Timestamp when state was last updated.
   */
  updatedAt: number
}

/**
 * Install manifest stored in install.json
 * Tracks installation state to avoid redoing work on launcher restart.
 */
export interface HytaleInstallManifest {
  /**
   * The installed build number.
   */
  build_index: number

  /**
   * The version type ('release' or 'pre-release').
   */
  version_type?: 'release' | 'pre-release'

  /**
   * ISO timestamp of installation.
   */
  installedAt: string

  /**
   * Version of the installed JRE.
   */
  jreVersion?: string

  /**
   * Whether server files were also installed.
   */
  serverInstalled?: boolean

  /**
   * Client online patch state (if applied).
   */
  clientPatch?: {
    /** URL the patch was downloaded from */
    url: string
    /** SHA256 hash of the applied patch */
    hash: string
    /** ISO timestamp when patch was applied */
    appliedAt: string
  }

  /**
   * Server online patch state (if applied).
   */
  serverPatch?: {
    /** URL the patch was downloaded from */
    url: string
    /** SHA256 hash of the applied patch (if known) */
    hash?: string
    /** ISO timestamp when patch was applied */
    appliedAt: string
  }
}

/**
 * Simple patch state for UI display.
 */
export interface PatchState {
  /**
   * Whether patching is supported on this platform.
   */
  supported: boolean

  /**
   * Whether a patch is available for this build.
   */
  available: boolean

  /**
   * Whether the patch is currently enabled.
   */
  enabled: boolean

  /**
   * Whether the patched binary is downloaded.
   */
  downloaded: boolean
}

/**
 * Detailed patch health information for UI display.
 */
export interface PatchHealth {
  /**
   * Whether the client is currently patched.
   */
  patched: boolean

  /**
   * Whether the patch is outdated (new version available).
   */
  outdated: boolean

  /**
   * Whether repair is needed (hash mismatch).
   */
  needsRepair: boolean

  /**
   * Currently installed build index.
   */
  currentBuildIndex?: number

  /**
   * Expected build index from loader.
   */
  expectedBuildIndex: number
}

/**
 * Session response from Kintare session endpoint.
 */
export interface HytaleSessionResponse {
  /**
   * JWT identity token for Hytale client.
   */
  identityToken: string

  /**
   * JWT session token for Hytale client.
   */
  sessionToken: string

  /**
   * Token expiration timestamp (handled by client).
   */
  expiresAt: string
}

/**
 * Hytale instance configuration.
 * Mirrors Minecraft Instance structure for AdminTool connection.
 */
export interface HytaleInstance {
  /**
   * Unique identifier for this instance (used for local storage paths).
   */
  id: string

  /**
   * Display name for this instance.
   */
  name: string

  /**
   * The base URL of the EML AdminTool.
   * Example: `https://eml.mydomain.com`
   */
  url: string

  /**
   * Optional password for protected instances.
   */
  password?: string

  /**
   * Optional pre-authenticated JWT token.
   */
  token?: string
}

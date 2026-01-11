export interface File {
  /**
   * The name of the file.
   */
  name: string
  /**
   * The path of the file, without the name and the leading slash, but with the trailing slash (e.g. `'path/to/file/'`).
   */
  path: string
  /**
   * The size of the file in bytes.
   */
  size?: number
  /**
   * The SHA1 hash of the file.
   */
  sha1?: string
  /**
   * The URL to download the file.
   */
  url: string
  /**
   * The type of the file.
   *
   * `'JAVA'`: Java files
   *
   * `'ASSET'`: Minecraft asset
   *
   * `'LIBRARY'`: Minecraft library
   *
   * `'NATIVE'`: Minecraft native
   *
   * `'MOD'`: Mod from the modpack (hosted on the EML AdminTool)
   *
   * `'CONFIG'`: Configuration file
   *
   * `'OTHER'`: Other files
   */
  type: 'JAVA' | 'ASSET' | 'LIBRARY' | 'NATIVE' | 'MOD' | 'CONFIG' | 'BOOTSTRAP' | 'BACKGROUND' | 'FOLDER' | 'IMAGE' | 'OTHER'
  executable?: boolean
}

export interface ILoader {
  id?: number
  type: 'VANILLA' | 'FORGE' | 'FABRIC'
  minecraftVersion: string
  loaderVersion: string | null
  format: 'INSTALLER' | 'UNIVERSAL' | 'CLIENT'
  file: File
  updatedAt: Date
  /**
   * Optional Java configuration from AdminTool (per-OS only).
   * If not set for current OS, library default ('mojang') is used.
   * 
   * @example
   * ```json
   * {
   *   "java": {
   *     "windows": { "distribution": "adoptium", "majorVersion": 21 },
   *     "darwin": { "distribution": "corretto", "args": ["-XstartOnFirstThread"] },
   *     "linux": { "distribution": "adoptium", "majorVersion": 17 }
   *   }
   * }
   * ```
   */
  java?: IJavaConfig
  /**
   * Optional Kintare Loki Java agent configuration.
   * When configured, the launcher will:
   * 1. Download kintare-loki.jar to the runtime folder
   * 2. Check version and update if changed
   * 3. Add `-javaagent:path/to/kintare-loki.jar` to JVM args
   * 4. Add `-DLoki.enforce_secure_profile=true` to JVM args
   * 
   * @example
   * ```json
   * {
   *   "loki": {
   *     "version": "1.0.0",
   *     "url": "https://my-admintool.com/files/kintare-loki.jar",
   *     "sha1": "abc123...",
   *     "size": 12345
   *   }
   * }
   * ```
   */
  loki?: ILokiConfig
}

/**
 * Java configuration with per-OS settings.
 * Only OS-specific settings are used (no global fallback).
 * If no OS config is set, the library default ('mojang') is used.
 * 
 * Priority: Local launcher config > AdminTool per-OS > Library default ('mojang')
 */
export interface IJavaConfig {
  /**
   * Windows-specific Java configuration.
   */
  windows?: IJavaOSConfig
  /**
   * macOS-specific Java configuration.
   */
  darwin?: IJavaOSConfig
  /**
   * Linux-specific Java configuration.
   */
  linux?: IJavaOSConfig
}

/**
 * OS-specific Java configuration.
 */
export interface IJavaOSConfig {
  /**
   * Java distribution for this OS.
   */
  distribution?: 'mojang' | 'adoptium' | 'corretto'
  /**
   * JVM arguments for this OS.
   */
  args?: string[]
  /**
   * Override the Java major version.
   * When set, this version will be used regardless of what the Minecraft version requires.
   * Useful for forcing a specific Java version across all Minecraft versions.
   * 
   * @example
   * ```json
   * { "majorVersion": 21 }  // Always use Java 21
   * ```
   */
  majorVersion?: number
}

/**
 * Kintare Loki Java agent configuration.
 * When configured, the launcher will download and apply the Loki agent.
 */
export interface ILokiConfig {
  /**
   * Version of the Loki agent (e.g., "1.0.0").
   * If the version changes, the launcher will delete and re-download the agent.
   */
  version: string
  /**
   * URL to download the kintare-loki.jar file.
   */
  url: string
  /**
   * SHA1 hash of the jar file for verification.
   */
  sha1?: string
  /**
   * File size in bytes.
   */
  size?: number
  /**
   * Whether to enforce secure profile validation.
   * Adds `-DLoki.enforce_secure_profile=true` or `=false` to JVM args.
   * @default true
   */
  enforceSecureProfile?: boolean
  /**
   * Which account types should use the Loki agent.
   * - `"default"` - Only for `kintare` and `yggdrasil` accounts (default behavior)
   * - `"all"` - Apply Loki agent for all account types
   * @default "default"
   */
  accountTypes?: 'default' | 'all'
}

export interface ExtraFile extends File {
  extra: 'INSTALL' | 'LOADER' | 'MINECRAFT'
}
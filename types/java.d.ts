/**
 * Java distribution types supported by the library.
 */
export type JavaDistribution = 'mojang' | 'adoptium' | 'corretto'

/**
 * Java version information.
 */
export interface JavaVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Details about a discovered JVM installation.
 */
export interface JvmDetails {
  /** Parsed semantic version */
  semver: JavaVersion
  /** Version as string (e.g., "17.0.5") */
  semverStr: string
  /** Java vendor (e.g., "Eclipse Adoptium", "Amazon") */
  vendor: string
  /** Path to the Java root directory */
  path: string
  /** Path to the Java executable */
  execPath: string
  /** Architecture: 64-bit or 32-bit */
  arch: '64-bit' | '32-bit'
}

/**
 * Options for Java download and management.
 */
export interface JavaOptions {
  /**
   * The distribution to download Java from.
   * - `'mojang'`: Official Mojang distribution (default)
   * - `'adoptium'`: Eclipse Temurin (Adoptium)
   * - `'corretto'`: Amazon Corretto
   */
  distribution?: JavaDistribution
  /**
   * Override the Java major version.
   * When set, this version will be used regardless of what the Minecraft version requires.
   * Useful for forcing a specific Java version (e.g., always use Java 21).
   * 
   * Note: For Mojang distribution, this only affects the folder name (jre-{version}).
   * The actual Java version downloaded depends on Minecraft's manifest.
   * For Adoptium/Corretto, this determines which version to download.
   */
  majorVersionOverride?: number
}

/**
 * Adoptium API response structure.
 */
export interface AdoptiumJdk {
  binary: {
    architecture: string
    download_count: number
    heap_size: string
    image_type: 'jdk' | 'jre' | 'debugimage' | 'testimage'
    jvm_impl: string
    os: string
    package: {
      checksum: string
      checksum_link: string
      download_count: number
      link: string
      metadata_link: string
      name: string
      size: number
    }
    project: string
    scm_ref: string
    updated_at: string
  }
  release_name: string
  vendor: string
  version: {
    build: number
    major: number
    minor: number
    openjdk_version: string
    security: number
    semver: string
  }
}

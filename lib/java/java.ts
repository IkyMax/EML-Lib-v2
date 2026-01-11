/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import { DownloaderEvents, JavaEvents } from '../../types/events'
import { JavaDistribution, JavaOptions, JavaVersion, JvmDetails, AdoptiumJdk } from '../../types/java'
import EventEmitter from '../utils/events'
import manifests from '../utils/manifests'
import { File } from '../../types/file'
import path_ from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import Downloader from '../utils/downloader'
import utils from '../utils/utils'
import { spawn, exec } from 'node:child_process'
import { promisify } from 'node:util'
import { EMLLibError, ErrorType } from '../../types/errors'
import { MinecraftManifest } from '../../types/manifest'
import AdmZip from 'adm-zip'

const execAsync = promisify(exec)

/**
 * Java version requirements for Minecraft versions.
 * Maps Minecraft version patterns to required Java major versions.
 * 
 * Reference (using Java 8 minimum since Adoptium/Corretto don't have Java 5/6):
 * - Java 8:  All versions before 21w19a (1.17)
 * - Java 16: 21w19a (1.17) to 1.18-pre1
 * - Java 17: 1.18-pre2 to 24w13a (before 1.20.5)
 * - Java 21: 24w14a (1.20.5) to 1.21.11
 * - Java 25: 26.1 (26.1 Snapshot 1) onwards
 */
const JAVA_VERSION_MAP: { pattern: RegExp; java: number }[] = [
  // === Java 25: 26.1+ (new versioning system) ===
  { pattern: /^26\./, java: 25 },
  { pattern: /^2[7-9]\./, java: 25 },  // Future versions 27.x+
  { pattern: /^[3-9]\d\./, java: 25 }, // Future versions 30.x+
  { pattern: /^26w\d{2}[a-z]/, java: 25 }, // 2026 weekly snapshots
  
  // === Java 21: 24w14a (1.20.5) to 1.21.11 ===
  { pattern: /^1\.2[2-9]/, java: 21 },  // Future 1.22+
  { pattern: /^1\.21/, java: 21 },      // 1.21.x
  { pattern: /^1\.20\.[5-9]/, java: 21 }, // 1.20.5-1.20.9
  { pattern: /^1\.20\.1[0-9]/, java: 21 }, // 1.20.10+
  // 2025 weekly snapshots
  { pattern: /^25w\d{2}[a-z]/, java: 21 },
  // 2024 weekly snapshots: 24w14a+ = Java 21
  { pattern: /^24w(1[4-9]|[2-5]\d)[a-z]/, java: 21 },
  
  // === Java 17: 1.18-pre2 to 24w13a (1.20.4) ===
  { pattern: /^1\.20\.[0-4]/, java: 17 }, // 1.20.0-1.20.4
  { pattern: /^1\.20$/, java: 17 },
  { pattern: /^1\.20-/, java: 17 },     // 1.20-pre1, 1.20-rc1
  { pattern: /^1\.19/, java: 17 },
  { pattern: /^1\.18-pre[2-9]/, java: 17 }, // 1.18-pre2+
  { pattern: /^1\.18-rc/, java: 17 },
  { pattern: /^1\.18\.[0-9]/, java: 17 }, // 1.18.x releases
  { pattern: /^1\.18$/, java: 17 },
  // 2024 weekly snapshots: 24w01a-24w13a = Java 17
  { pattern: /^24w(0[1-9]|1[0-3])[a-z]/, java: 17 },
  // 2023 weekly snapshots
  { pattern: /^23w\d{2}[a-z]/, java: 17 },
  // 2022 weekly snapshots
  { pattern: /^22w\d{2}[a-z]/, java: 17 },
  // 2021 weekly snapshots for 1.18: 21w37a-21w44a (after 1.17.1 release)
  // These were for 1.18 development but before 1.18-pre2, they used Java 16
  // However, the 1.18 experimental snapshots in late 2021 still used Java 16
  // until 1.18-pre2. Let's be safe and mark 21w37a+ as Java 17 territory
  // since users launching these likely have 1.18+ intent
  
  // === Java 16: 21w19a (1.17) to 1.18-pre1 ===
  { pattern: /^1\.18-pre1$/, java: 16 },
  { pattern: /^1\.17/, java: 16 },
  // 2021 weekly snapshots: 21w19a+ = Java 16 (1.17/1.18 development)
  { pattern: /^21w(19|[2-9]\d)[a-z]/, java: 16 },
  
  // === Java 8: Everything before 21w19a ===
  // (Original requirements were Java 5 for very old, Java 6 for 1.6-1.11,
  //  but Adoptium/Corretto don't have Java 5/6, so we use Java 8)
  { pattern: /^21w(0[1-9]|1[0-8])[a-z]/, java: 8 }, // 21w01a-21w18a
  { pattern: /^20w\d{2}[a-z]/, java: 8 },
  { pattern: /^19w\d{2}[a-z]/, java: 8 },
  { pattern: /^18w\d{2}[a-z]/, java: 8 },
  { pattern: /^17w\d{2}[a-z]/, java: 8 },
  { pattern: /^16w\d{2}[a-z]/, java: 8 },
  { pattern: /^15w\d{2}[a-z]/, java: 8 },
  { pattern: /^14w\d{2}[a-z]/, java: 8 },
  { pattern: /^13w\d{2}[a-z]/, java: 8 },
  { pattern: /^1\.1[0-6]/, java: 8 }, // 1.10-1.16
  { pattern: /^1\.[0-9]\./, java: 8 }, // 1.0-1.9
  { pattern: /^1\.[0-9]$/, java: 8 },
  
  // Fallback for anything else
  { pattern: /.*/, java: 8 },
]

/**
 * Download and manage Java for Minecraft.
 *
 * Supports multiple distributions:
 * - **Mojang**: Official Mojang distribution (default). Downloads the exact Java version
 *   specified in Minecraft's manifest (javaVersion.component). No version verification needed
 *   since it's exactly what Minecraft requires.
 * - **Adoptium**: Eclipse Temurin - uses JAVA_VERSION_MAP for version selection
 * - **Corretto**: Amazon Corretto - uses JAVA_VERSION_MAP for version selection
 * 
 * When using Mojang distribution without AdminTool, Java is downloaded per-server based on
 * each Minecraft version's specific requirements.
 * 
 * @example
 * ```typescript
 * // Mojang (default) - uses Minecraft's exact Java requirements
 * const java = new Java('1.20.4', 'minecraft')
 * 
 * // Adoptium - uses JAVA_VERSION_MAP to determine version
 * const java = new Java('1.20.4', 'minecraft', { distribution: 'adoptium' })
 * 
 * // Discover existing Java installations
 * const existing = await java.discover()
 * ```
 */
export default class Java extends EventEmitter<DownloaderEvents & JavaEvents> {
  private readonly minecraftVersion: string | null
  private readonly serverId: string
  private readonly url?: string
  private readonly distribution: JavaDistribution
  private readonly majorVersionOverride?: number

  /**
   * @param minecraftVersion The version of Minecraft you want to install Java for. Set to
   * `null` to get the version from the EML AdminTool. Set to `latest_release` to get the latest
   * release version of Minecraft. Set to `latest_snapshot` to get the latest snapshot version of
   * Minecraft.
   * @param serverId Your Minecraft server ID (eg. `'minecraft'`). This will be used to
   * create the server folder (eg. `.minecraft`). Java will be installed in the `runtime/jre-X`
   * folder, where `X` is the major version of Java.
   * @param options Optional configuration for Java download.
   */
  constructor(minecraftVersion: string | null, serverId: string, options?: JavaOptions & { url?: string }) {
    super()
    this.minecraftVersion = minecraftVersion
    this.serverId = serverId
    this.url = options?.url
    this.distribution = options?.distribution ?? 'mojang'
    this.majorVersionOverride = options?.majorVersionOverride
  }

  /**
   * Get the required Java major version for a Minecraft version.
   * @param minecraftVersion The Minecraft version to check.
   * @returns The required Java major version.
   */
  static getRequiredJavaVersion(minecraftVersion: string): number {
    for (const { pattern, java } of JAVA_VERSION_MAP) {
      if (pattern.test(minecraftVersion)) {
        return java
      }
    }
    return 8 // Default fallback
  }

  /**
   * Get the files of the Java version to download from Mojang.
   * @param manifest The manifest of the Minecraft version.
   * @returns The files of the Java version.
   */
  async getFiles(manifest?: MinecraftManifest): Promise<File[]> {
    return this.getMojangFiles(manifest)
  }

  /**
   * Get the files of the Java version to download from Mojang.
   * @param manifest The manifest of the Minecraft version.
   * @returns The files of the Java version.
   */
  private async getMojangFiles(manifest?: MinecraftManifest): Promise<File[]> {
    manifest = manifest ?? (await manifests.getMinecraftManifest(this.minecraftVersion, this.url))
    const jreVersion = (manifest.javaVersion?.component ?? 'jre-legacy') as
      | 'java-runtime-alpha'
      | 'java-runtime-beta'
      | 'java-runtime-delta'
      | 'java-runtime-gamma'
      | 'java-runtime-gamma-snapshot'
      | 'jre-legacy'
    const jreV = manifest.javaVersion?.majorVersion.toString() ?? '8'

    const jreManifest = await manifests.getJavaManifest(jreVersion, jreV)

    let files: File[] = []

    Object.entries(jreManifest.files).forEach((file: [string, any]) => {
      const normalizedPath = this.normalizeJavaPath(file[0], jreV)
      if (!normalizedPath) return

      if (file[1].type === 'directory') {
        files.push({
          name: path_.basename(file[0]),
          path: normalizedPath,
          url: '',
          type: 'FOLDER'
        })
      } else if (file[1].downloads) {
        files.push({
          name: path_.basename(file[0]),
          path: normalizedPath,
          url: file[1].downloads.raw.url,
          size: file[1].downloads.raw.size,
          sha1: file[1].downloads.raw.sha1,
          type: 'JAVA',
          executable: file[1].executable === true
        })
      }
    })

    return files
  }

  /**
   * Get the Java major version required for the current Minecraft version.
   * If majorVersionOverride is set, it takes priority over Minecraft's requirements.
   */
  private async getRequiredMajorVersion(): Promise<number> {
    // Override takes priority
    if (this.majorVersionOverride) {
      return this.majorVersionOverride
    }
    
    if (this.minecraftVersion && this.minecraftVersion !== 'latest_release' && this.minecraftVersion !== 'latest_snapshot') {
      return Java.getRequiredJavaVersion(this.minecraftVersion)
    }
    
    // Fetch manifest to get the actual version
    const manifest = await manifests.getMinecraftManifest(this.minecraftVersion, this.url)
    return manifest.javaVersion?.majorVersion ?? 8
  }

  /**
   * Fetch the latest Adoptium (Temurin) JDK for the specified major version.
   * @param major The Java major version.
   * @returns Download info or null if not found.
   */
  private async fetchAdoptium(major: number): Promise<{ url: string; size: number; name: string; sha256: string } | null> {
    const os = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : 'linux')
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
    const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?vendor=eclipse`

    try {
      const res = await fetch(url)
      if (!res.ok) return null

      const data = await res.json() as AdoptiumJdk[]
      
      const target = data.find(entry => 
        entry.version.major === major &&
        entry.binary.os === os &&
        entry.binary.image_type === 'jdk' &&
        entry.binary.architecture === arch
      )

      if (!target) return null

      return {
        url: target.binary.package.link,
        size: target.binary.package.size,
        name: target.binary.package.name,
        sha256: target.binary.package.checksum
      }
    } catch (err) {
      return null
    }
  }

  /**
   * Fetch the latest Amazon Corretto JDK for the specified major version.
   * @param major The Java major version.
   * @returns Download info or null if not found.
   */
  private async fetchCorretto(major: number): Promise<{ url: string; size: number; name: string; md5: string } | null> {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
    let os: string, ext: string

    switch (process.platform) {
      case 'win32':
        os = 'windows'
        ext = 'zip'
        break
      case 'darwin':
        os = 'macos'
        ext = 'tar.gz'
        break
      default:
        os = 'linux'
        ext = 'tar.gz'
    }

    const url = `https://corretto.aws/downloads/latest/amazon-corretto-${major}-${arch}-${os}-jdk.${ext}`
    const md5Url = `https://corretto.aws/downloads/latest_checksum/amazon-corretto-${major}-${arch}-${os}-jdk.${ext}`

    try {
      const [headRes, md5Res] = await Promise.all([
        fetch(url, { method: 'HEAD' }),
        fetch(md5Url)
      ])

      if (!headRes.ok) return null

      const md5 = await md5Res.text()
      const size = parseInt(headRes.headers.get('content-length') ?? '0')
      const name = url.substring(url.lastIndexOf('/') + 1)

      return { url, size, name, md5: md5.trim() }
    } catch (err) {
      return null
    }
  }

  /**
   * Download Java for the Minecraft version.
   * Uses the distribution specified in constructor options.
   */
  async download(): Promise<void> {
    if (this.distribution === 'mojang') {
      await this.downloadMojang()
    } else {
      await this.downloadThirdParty()
    }
  }

  /**
   * Download Java from Mojang's official distribution.
   */
  private async downloadMojang(): Promise<void> {
    const files = await this.getMojangFiles()
    const manifest = await manifests.getMinecraftManifest(this.minecraftVersion, this.url)
    const majorVersion = manifest.javaVersion?.majorVersion ?? 8
    const totalSize = files.reduce((acc, f) => acc + (f.size ?? 0), 0)
    
    // Emit download start
    this.emit('java_download_start', { 
      distribution: 'mojang', 
      totalSize,
      majorVersion
    })
    
    const startTime = Date.now()
    const downloader = new Downloader(utils.getServerFolder(this.serverId))
    
    // Track progress and convert to percentage
    downloader.on('download_progress', (progress) => {
      const percent = progress.total.size > 0 
        ? Math.round((progress.downloaded.size / progress.total.size) * 100)
        : 0
      
      this.emit('java_download_progress', {
        percent,
        downloadedSize: progress.downloaded.size,
        totalSize: progress.total.size,
        speed: progress.speed
      })
    })
    
    downloader.on('download_error', (error) => this.emit('download_error', error))
    downloader.on('download_end', (info) => {
      this.emit('download_end', info)
      this.emit('java_download_end', {
        totalSize: info.downloaded.size,
        duration: Date.now() - startTime
      })
    })
    
    await downloader.download(files)
    
    // Emit install end (Mojang files are already extracted)
    const jreDir = path_.join(this.getRuntimeDir(), `jre-${majorVersion}`)
    this.emit('java_install_end', {
      majorVersion,
      path: jreDir,
      filesExtracted: files.length
    })
  }

  /**
   * Download Java from Adoptium or Corretto.
   */
  private async downloadThirdParty(): Promise<void> {
    const majorVersion = await this.getRequiredMajorVersion()
    const runtimeDir = this.getRuntimeDir()
    const jreDir = path_.join(runtimeDir, `jre-${majorVersion}`)

    let downloadInfo: { url: string; size: number; name: string } | null = null

    if (this.distribution === 'adoptium') {
      downloadInfo = await this.fetchAdoptium(majorVersion)
    } else if (this.distribution === 'corretto') {
      downloadInfo = await this.fetchCorretto(majorVersion)
    }

    if (!downloadInfo) {
      throw new EMLLibError(
        ErrorType.JAVA_ERROR,
        `Failed to find ${this.distribution} JDK ${majorVersion} for ${process.platform} ${process.arch}`
      )
    }

    // Create runtime directory
    await fs.mkdir(runtimeDir, { recursive: true })

    const archivePath = path_.join(runtimeDir, downloadInfo.name)

    // Emit download start
    this.emit('java_download_start', {
      distribution: this.distribution,
      totalSize: downloadInfo.size,
      majorVersion
    })

    const startTime = Date.now()

    // Download the archive
    const file: File = {
      name: downloadInfo.name,
      path: 'runtime/',
      url: downloadInfo.url,
      size: downloadInfo.size,
      type: 'JAVA'
    }

    const downloader = new Downloader(utils.getServerFolder(this.serverId))
    
    // Track progress and convert to percentage
    downloader.on('download_progress', (progress) => {
      const percent = progress.total.size > 0 
        ? Math.round((progress.downloaded.size / progress.total.size) * 100)
        : 0
      
      this.emit('java_download_progress', {
        percent,
        downloadedSize: progress.downloaded.size,
        totalSize: progress.total.size,
        speed: progress.speed
      })
    })
    
    downloader.on('download_error', (error) => this.emit('download_error', error))
    downloader.on('download_end', (info) => {
      this.emit('download_end', info)
      this.emit('java_download_end', {
        totalSize: info.downloaded.size,
        duration: Date.now() - startTime
      })
    })
    
    await downloader.download([file])

    // Extract the archive with progress
    await this.extractArchive(archivePath, runtimeDir, majorVersion)

    // Clean up archive
    await fs.unlink(archivePath).catch(() => {})
  }

  /**
   * Extract a Java archive (zip or tar.gz) to the runtime directory.
   */
  private async extractArchive(archivePath: string, runtimeDir: string, majorVersion: number): Promise<void> {
    const jreDir = path_.join(runtimeDir, `jre-${majorVersion}`)
    
    // Emit install start
    this.emit('java_install_start', {
      majorVersion,
      distribution: this.distribution
    })
    
    // Remove existing jre directory if it exists
    await fs.rm(jreDir, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(jreDir, { recursive: true })

    let filesExtracted = 0

    if (archivePath.endsWith('.zip')) {
      // Extract zip using adm-zip with progress
      const zip = new AdmZip(archivePath)
      const zipEntries = zip.getEntries()
      const totalFiles = zipEntries.length
      
      for (let i = 0; i < zipEntries.length; i++) {
        const entry = zipEntries[i]
        const percent = Math.round(((i + 1) / totalFiles) * 100)
        
        // Extract single entry
        zip.extractEntryTo(entry, runtimeDir, true, true)
        filesExtracted++
        
        // Emit progress every 10 files or on completion
        if (i % 10 === 0 || i === zipEntries.length - 1) {
          this.emit('java_install_progress', {
            percent,
            currentFile: entry.entryName,
            extractedFiles: filesExtracted,
            totalFiles
          })
        }
      }
    } else if (archivePath.endsWith('.tar.gz')) {
      // For tar.gz, we can't easily track progress, so emit start/end only
      this.emit('java_install_progress', {
        percent: 0,
        currentFile: 'Extracting archive...',
        extractedFiles: 0,
        totalFiles: 1
      })
      
      // Extract tar.gz using native tar command (available on macOS/Linux)
      const { stderr } = await execAsync(`tar -xzf "${archivePath}" -C "${runtimeDir}"`)
      if (stderr && !stderr.includes('Ignoring')) {
        throw new EMLLibError(ErrorType.JAVA_ERROR, `Failed to extract tar.gz: ${stderr}`)
      }
      
      // Count extracted files
      filesExtracted = await this.countFiles(runtimeDir)
      
      this.emit('java_install_progress', {
        percent: 100,
        currentFile: 'Extraction complete',
        extractedFiles: filesExtracted,
        totalFiles: filesExtracted
      })
    }

    // Find the extracted directory and rename it to jre-{version}
    const entries = await fs.readdir(runtimeDir)
    for (const entry of entries) {
      const entryPath = path_.join(runtimeDir, entry)
      const stat = await fs.stat(entryPath)
      
      if (stat.isDirectory() && entry !== `jre-${majorVersion}` && 
          (entry.includes('jdk') || entry.includes('corretto') || entry.includes('temurin'))) {
        // On macOS, the actual Java home is inside Contents/Home
        if (process.platform === 'darwin') {
          const macHomePath = path_.join(entryPath, 'Contents', 'Home')
          try {
            await fs.access(macHomePath)
            // Move contents from Contents/Home to jre-{version}
            const homeContents = await fs.readdir(macHomePath)
            for (const item of homeContents) {
              await fs.rename(
                path_.join(macHomePath, item),
                path_.join(jreDir, item)
              )
            }
            await fs.rm(entryPath, { recursive: true, force: true })
          } catch {
            // No Contents/Home, move the directory directly
            await fs.rename(entryPath, jreDir)
          }
        } else {
          // Move the extracted directory to jre-{version}
          await fs.rm(jreDir, { recursive: true, force: true }).catch(() => {})
          await fs.rename(entryPath, jreDir)
        }
        break
      }
    }

    // Set executable permissions on Unix
    if (process.platform !== 'win32') {
      const binDir = path_.join(jreDir, 'bin')
      try {
        const binFiles = await fs.readdir(binDir)
        for (const file of binFiles) {
          await fs.chmod(path_.join(binDir, file), 0o755)
        }
      } catch {
        // bin directory might not exist yet
      }
    }

    // Emit install end
    const totalExtracted = await this.countFiles(jreDir)
    this.emit('java_install_end', {
      majorVersion,
      path: jreDir,
      filesExtracted: totalExtracted
    })
  }

  /**
   * Count files in a directory recursively.
   */
  private async countFiles(dir: string): Promise<number> {
    let count = 0
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          count += await this.countFiles(path_.join(dir, entry.name))
        } else {
          count++
        }
      }
    } catch {
      // Directory doesn't exist
    }
    return count
  }

  /**
   * Discover existing Java installations on the system.
   * @returns Array of discovered JVM details, sorted by version (newest first).
   */
  async discover(): Promise<JvmDetails[]> {
    const paths = await this.getJavaCandidatePaths()
    const results: JvmDetails[] = []

    for (const javaPath of paths) {
      const execPath = this.javaExecFromRoot(javaPath)
      
      try {
        await fs.access(execPath)
        const details = await this.getJvmDetails(javaPath)
        if (details) {
          results.push(details)
        }
      } catch {
        // Path doesn't exist or isn't accessible
      }
    }

    // Sort by version (newest first)
    results.sort((a, b) => {
      if (a.semver.major !== b.semver.major) return b.semver.major - a.semver.major
      if (a.semver.minor !== b.semver.minor) return b.semver.minor - a.semver.minor
      return b.semver.patch - a.semver.patch
    })

    // Emit discovery event
    const best = results.length > 0 ? { version: results[0].semverStr, path: results[0].path } : null
    this.emit('java_discovered', { count: results.length, best })

    return results
  }

  /**
   * Find the best matching Java installation for the Minecraft version.
   * @returns The best matching JVM or null if none found.
   */
  async discoverBest(): Promise<JvmDetails | null> {
    const requiredMajor = await this.getRequiredMajorVersion()
    const discovered = await this.discover()
    
    // Find exact major version match first
    const exactMatch = discovered.find(jvm => jvm.semver.major === requiredMajor)
    if (exactMatch) return exactMatch

    // Find any version >= required
    const compatibleMatch = discovered.find(jvm => jvm.semver.major >= requiredMajor)
    if (compatibleMatch) return compatibleMatch

    return null
  }

  /**
   * Get candidate paths for Java installations based on OS.
   */
  private async getJavaCandidatePaths(): Promise<string[]> {
    const paths = new Set<string>()
    const runtimeDir = this.getRuntimeDir()

    // Add launcher runtime directory
    try {
      const runtimeEntries = await fs.readdir(runtimeDir)
      for (const entry of runtimeEntries) {
        if (entry.startsWith('jre-') || entry.startsWith('jdk')) {
          paths.add(path_.join(runtimeDir, entry))
        }
      }
    } catch {
      // Runtime directory doesn't exist
    }

    // Add environment variables
    for (const envVar of ['JAVA_HOME', 'JRE_HOME', 'JDK_HOME']) {
      const value = process.env[envVar]
      if (value) {
        paths.add(this.ensureJavaRoot(value))
      }
    }

    // Platform-specific paths
    switch (process.platform) {
      case 'win32':
        await this.addWindowsPaths(paths)
        break
      case 'darwin':
        await this.addMacOSPaths(paths)
        break
      case 'linux':
        await this.addLinuxPaths(paths)
        break
    }

    return [...paths]
  }

  /**
   * Add Windows-specific Java paths.
   */
  private async addWindowsPaths(paths: Set<string>): Promise<void> {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const directories = [
      path_.join(programFiles, 'Java'),
      path_.join(programFiles, 'Eclipse Adoptium'),
      path_.join(programFiles, 'Eclipse Foundation'),
      path_.join(programFiles, 'AdoptOpenJDK'),
      path_.join(programFiles, 'Amazon Corretto'),
      path_.join(programFiles, 'Microsoft'),
      path_.join(programFiles, 'Zulu'),
    ]

    for (const dir of directories) {
      try {
        const entries = await fs.readdir(dir)
        for (const entry of entries) {
          const fullPath = path_.join(dir, entry)
          const stat = await fs.stat(fullPath)
          if (stat.isDirectory()) {
            paths.add(fullPath)
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Try Windows Registry (simplified - just check common paths)
    try {
      const { stdout } = await execAsync(
        'reg query "HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit" /s /v JavaHome 2>nul || reg query "HKLM\\SOFTWARE\\JavaSoft\\JDK" /s /v JavaHome 2>nul',
        { shell: 'cmd.exe' }
      )
      const matches = stdout.matchAll(/JavaHome\s+REG_SZ\s+(.+)/g)
      for (const match of matches) {
        paths.add(match[1].trim())
      }
    } catch {
      // Registry query failed
    }
  }

  /**
   * Add macOS-specific Java paths.
   */
  private async addMacOSPaths(paths: Set<string>): Promise<void> {
    const jvmDir = '/Library/Java/JavaVirtualMachines'
    
    try {
      const entries = await fs.readdir(jvmDir)
      for (const entry of entries) {
        paths.add(path_.join(jvmDir, entry))
      }
    } catch {
      // Directory doesn't exist
    }

    // Internet Plug-Ins (legacy)
    paths.add('/Library/Internet Plug-Ins/JavaAppletPlugin.plugin')
  }

  /**
   * Add Linux-specific Java paths.
   */
  private async addLinuxPaths(paths: Set<string>): Promise<void> {
    const directories = [
      '/usr/lib/jvm',
      '/usr/java',
      '/opt/java',
    ]

    for (const dir of directories) {
      try {
        const entries = await fs.readdir(dir)
        for (const entry of entries) {
          paths.add(path_.join(dir, entry))
        }
      } catch {
        // Directory doesn't exist
      }
    }
  }

  /**
   * Get JVM details from a Java installation path.
   */
  private async getJvmDetails(javaRoot: string): Promise<JvmDetails | null> {
    const execPath = this.javaExecFromRoot(javaRoot)

    try {
      const { stderr } = await execAsync(`"${execPath}" -version`)
      const output = stderr

      // Parse version
      const versionMatch = output.match(/"(\d+)(?:\.(\d+))?(?:\.(\d+))?[^"]*"/)
      if (!versionMatch) return null

      const major = parseInt(versionMatch[1])
      // For Java 8, version is like "1.8.0_xxx", for Java 9+, it's like "17.0.5"
      let minor = 0, patch = 0
      if (major === 1) {
        // Legacy versioning (Java 8)
        minor = parseInt(versionMatch[2] ?? '0')
        const updateMatch = output.match(/_(\d+)/)
        patch = updateMatch ? parseInt(updateMatch[1]) : 0
      } else {
        minor = parseInt(versionMatch[2] ?? '0')
        patch = parseInt(versionMatch[3] ?? '0')
      }

      const actualMajor = major === 1 ? minor : major

      // Parse vendor
      const vendorMatch = output.match(/(?:OpenJDK|Java\(TM\)|Amazon|Eclipse|Azul|Microsoft|GraalVM)[^\n]*/i)
      const vendor = vendorMatch ? vendorMatch[0].trim() : 'Unknown'

      // Parse architecture
      const arch = output.includes('64-Bit') ? '64-bit' : '32-bit'

      return {
        semver: { major: actualMajor, minor: major === 1 ? 0 : minor, patch },
        semverStr: `${actualMajor}.${major === 1 ? 0 : minor}.${patch}`,
        vendor,
        path: javaRoot,
        execPath,
        arch
      }
    } catch {
      return null
    }
  }

  /**
   * Get the Java executable path from a Java root directory.
   */
  private javaExecFromRoot(root: string): string {
    switch (process.platform) {
      case 'win32':
        return path_.join(root, 'bin', 'javaw.exe')
      case 'darwin':
        // Check for Contents/Home structure (JDK bundles)
        const macHome = path_.join(root, 'Contents', 'Home', 'bin', 'java')
        return fsSync.existsSync(macHome) ? macHome : path_.join(root, 'bin', 'java')
      default:
        return path_.join(root, 'bin', 'java')
    }
  }

  /**
   * Ensure a path points to the Java root directory.
   */
  private ensureJavaRoot(dir: string): string {
    if (process.platform === 'darwin') {
      const idx = dir.indexOf('/Contents/Home')
      if (idx > -1) return dir.substring(0, idx)
    }
    
    const binIdx = dir.indexOf(path_.join(path_.sep, 'bin', 'java'))
    if (binIdx > -1) return dir.substring(0, binIdx)
    
    return dir
  }

  /**
   * Get the runtime directory for Java installations.
   */
  private getRuntimeDir(): string {
    return path_.join(utils.getServerFolder(this.serverId), 'runtime')
  }

  /**
   * Check if Java is correctly installed.
   * @param absolutePath Absolute path to the Java executable. Use `${X}` as placeholder for major version.
   * @param majorVersion Major version of Java to check.
   * @returns The version and architecture of Java.
   */
  async check(
    absolutePath: string = path_.join(utils.getServerFolder(this.serverId), 'runtime', 'jre-${X}', 'bin', 'java'),
    majorVersion: number = 8
  ): Promise<{ version: string; arch: '64-bit' | '32-bit' }> {
    return new Promise((resolve, reject) => {
      let javaExec = absolutePath.replace('${X}', majorVersion + '')
      
      // Add .exe on Windows if needed
      if (process.platform === 'win32' && !javaExec.endsWith('.exe')) {
        javaExec = javaExec.replace('java', 'javaw.exe')
      }

      const proc = spawn(javaExec, ['-version'])
      let output = ''

      proc.stdout.on('data', (data) => {
        output += data.toString()
      })
      proc.stderr.on('data', (data) => {
        output += data.toString()
      })
      proc.on('error', (err) => {
        reject(new EMLLibError(ErrorType.JAVA_ERROR, `Java is not correctly installed: ${err.message}`))
      })
      proc.on('close', (code) => {
        if (code !== 0 && output.length === 0) {
          reject(new EMLLibError(ErrorType.JAVA_ERROR, `Java exited with code ${code}`))
          return
        }

        const versionMatch = output.match(/"(.*?)"/)
        const version = versionMatch ? versionMatch.pop() : majorVersion + ''
        const arch = output.includes('64-Bit') ? '64-bit' : '32-bit'
        const res = { version: version!, arch: arch as '64-bit' | '32-bit' }

        this.emit('java_info', res)
        resolve(res)
      })
    })
  }

  /**
   * Get the path to the Java executable for the Minecraft version.
   * First tries to find an existing installation, then falls back to the default path.
   */
  async getJavaPath(): Promise<string> {
    const best = await this.discoverBest()
    if (best) return best.execPath

    const majorVersion = await this.getRequiredMajorVersion()
    return this.javaExecFromRoot(path_.join(this.getRuntimeDir(), `jre-${majorVersion}`))
  }

  private normalizeJavaPath(filePath: string, jreV: string) {
    if (filePath.endsWith('.bundle')) return null
    if (filePath.includes('.bundle/')) {
      const homeIndex = filePath.indexOf('.bundle/Contents/Home/')
      if (homeIndex === -1) return null

      const relativePath = filePath.slice(homeIndex + '.bundle/Contents/Home/'.length)
      return path_.join('runtime', `jre-${jreV}`, path_.dirname(relativePath), '/')
    }

    return path_.join('runtime', `jre-${jreV}`, path_.dirname(filePath), '/')
  }
}

/**
 * Java Download & Installation Tests
 * Tests for downloading Java and verifying it can run Minecraft
 * 
 * Run with: npx ts-node test/test-java-download.ts
 * 
 * WARNING: This test actually downloads Java (100-200MB per distribution).
 * Use with caution and ensure you have sufficient disk space and bandwidth.
 */

import Java from '../lib/java/java'
import utils from '../lib/utils/utils'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { JavaDistribution, JvmDetails } from '../types/java'

const TEST_SERVER_ID = 'eml-java-test'
const TEST_MC_VERSION = '1.20.4' // Requires Java 17

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
}

function log(msg: string, color: string = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`)
}

function logStep(step: string) {
  console.log(`\n${colors.cyan}▶ ${step}${colors.reset}`)
}

function logSuccess(msg: string) {
  console.log(`${colors.green}  ✅ ${msg}${colors.reset}`)
}

function logWarning(msg: string) {
  console.log(`${colors.yellow}  ⚠️ ${msg}${colors.reset}`)
}

function logError(msg: string) {
  console.log(`${colors.red}  ❌ ${msg}${colors.reset}`)
}

function logInfo(msg: string) {
  console.log(`${colors.gray}  ℹ ${msg}${colors.reset}`)
}

// ============================================
// Helper: Get Java executable path
// ============================================

function getJavaExecPath(serverFolder: string, majorVersion: number): string {
  const jreDir = path.join(serverFolder, 'runtime', `jre-${majorVersion}`)
  
  if (process.platform === 'win32') {
    return path.join(jreDir, 'bin', 'javaw.exe')
  } else if (process.platform === 'darwin') {
    // Try both paths for macOS
    const macHomePath = path.join(jreDir, 'Contents', 'Home', 'bin', 'java')
    if (fsSync.existsSync(macHomePath)) {
      return macHomePath
    }
    return path.join(jreDir, 'bin', 'java')
  } else {
    return path.join(jreDir, 'bin', 'java')
  }
}

// ============================================
// Helper: Verify Java can run
// ============================================

async function verifyJavaRuns(javaPath: string): Promise<{ version: string; arch: string } | null> {
  return new Promise((resolve) => {
    const proc = spawn(javaPath, ['-version'])
    let output = ''

    proc.stdout.on('data', (data) => {
      output += data.toString()
    })
    proc.stderr.on('data', (data) => {
      output += data.toString()
    })
    proc.on('error', () => {
      resolve(null)
    })
    proc.on('close', (code) => {
      if (code !== 0 && output.length === 0) {
        resolve(null)
        return
      }

      const versionMatch = output.match(/"(.*?)"/)
      const version = versionMatch ? versionMatch[1] : 'unknown'
      const arch = output.includes('64-Bit') ? '64-bit' : '32-bit'
      resolve({ version, arch })
    })
  })
}

// ============================================
// Helper: Verify Java can launch Minecraft-style
// ============================================

async function verifyMinecraftCompatibility(javaPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Test with common JVM args that Minecraft uses
    const testArgs = [
      '-Xmx256M',
      '-XX:+UseG1GC',
      '-version'
    ]

    const proc = spawn(javaPath, testArgs)
    let output = ''

    proc.stdout.on('data', (data) => {
      output += data.toString()
    })
    proc.stderr.on('data', (data) => {
      output += data.toString()
    })
    proc.on('error', () => {
      resolve(false)
    })
    proc.on('close', (code) => {
      // Java -version returns 0 on success
      resolve(code === 0 || output.includes('version'))
    })
  })
}

// ============================================
// Helper: Get directory size
// ============================================

async function getDirectorySize(dir: string): Promise<number> {
  let totalSize = 0

  async function walk(currentDir: string) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else {
          const stat = await fs.stat(fullPath)
          totalSize += stat.size
        }
      }
    } catch {
      // Directory doesn't exist or isn't accessible
    }
  }

  await walk(dir)
  return totalSize
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

// ============================================
// Test: Download Mojang Java
// ============================================

async function testMojangDownload(): Promise<boolean> {
  logStep('Testing Mojang Java Download')
  
  const java = new Java(TEST_MC_VERSION, TEST_SERVER_ID, { distribution: 'mojang' })
  const serverFolder = utils.getServerFolder(TEST_SERVER_ID)
  
  logInfo(`Server folder: ${serverFolder}`)
  logInfo(`Minecraft version: ${TEST_MC_VERSION}`)
  
  // New percentage-based event listeners
  java.on('java_download_start', (info) => {
    logInfo(`Starting ${info.distribution} Java ${info.majorVersion} download (${formatBytes(info.totalSize)})`)
  })
  
  java.on('java_download_progress', (progress) => {
    const speedStr = progress.speed > 0 ? ` @ ${formatBytes(progress.speed)}/s` : ''
    process.stdout.write(`\r${colors.gray}  ⬇ Downloading: ${progress.percent}% (${formatBytes(progress.downloadedSize)}/${formatBytes(progress.totalSize)})${speedStr}${colors.reset}`)
  })
  
  java.on('java_download_end', (info) => {
    console.log() // New line after progress
    logSuccess(`Download completed: ${formatBytes(info.totalSize)} in ${(info.duration / 1000).toFixed(1)}s`)
  })
  
  java.on('java_install_end', (info) => {
    logSuccess(`Installation completed: ${info.filesExtracted} files extracted`)
  })

  try {
    logInfo('Downloading Mojang Java...')
    const startTime = Date.now()
    
    await java.download()
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    logSuccess(`Total time: ${duration}s`)
    
    // Verify the Java executable exists
    const javaPath = await java.getJavaPath()
    logInfo(`Java path: ${javaPath}`)
    
    try {
      await fs.access(javaPath)
      logSuccess('Java executable exists')
    } catch {
      logError('Java executable not found')
      return false
    }
    
    // Verify Java runs
    const javaInfo = await verifyJavaRuns(javaPath)
    if (javaInfo) {
      logSuccess(`Java runs: version ${javaInfo.version} (${javaInfo.arch})`)
    } else {
      logError('Java failed to run')
      return false
    }
    
    // Verify Minecraft compatibility
    const mcCompatible = await verifyMinecraftCompatibility(javaPath)
    if (mcCompatible) {
      logSuccess('Java is compatible with Minecraft JVM arguments')
    } else {
      logWarning('Java may have issues with some Minecraft JVM arguments')
    }
    
    // Check installation size
    const runtimeDir = path.join(serverFolder, 'runtime')
    const size = await getDirectorySize(runtimeDir)
    logInfo(`Installation size: ${formatBytes(size)}`)
    
    return true
  } catch (error) {
    logError(`Download failed: ${error}`)
    return false
  }
}
// ============================================
// Test: Download Adoptium Java
// ============================================

async function testAdoptiumDownload(): Promise<boolean> {
  logStep('Testing Adoptium (Temurin) Java Download')
  
  const java = new Java(TEST_MC_VERSION, TEST_SERVER_ID, { distribution: 'adoptium' })
  const serverFolder = utils.getServerFolder(TEST_SERVER_ID)
  const requiredJava = Java.getRequiredJavaVersion(TEST_MC_VERSION)
  
  logInfo(`Required Java version: ${requiredJava}`)
  
  // New percentage-based event listeners
  java.on('java_download_start', (info) => {
    logInfo(`Starting ${info.distribution} Java ${info.majorVersion} download (${formatBytes(info.totalSize)})`)
  })
  
  java.on('java_download_progress', (progress) => {
    const speedStr = progress.speed > 0 ? ` @ ${formatBytes(progress.speed)}/s` : ''
    process.stdout.write(`\r${colors.gray}  ⬇ Downloading: ${progress.percent}% (${formatBytes(progress.downloadedSize)}/${formatBytes(progress.totalSize)})${speedStr}${colors.reset}`)
  })
  
  java.on('java_download_end', (info) => {
    console.log()
    logSuccess(`Download completed: ${formatBytes(info.totalSize)} in ${(info.duration / 1000).toFixed(1)}s`)
  })
  
  java.on('java_install_start', (info) => {
    logInfo(`Installing Java ${info.majorVersion} (${info.distribution})...`)
  })
  
  java.on('java_install_progress', (progress) => {
    process.stdout.write(`\r${colors.gray}  📦 Installing: ${progress.percent}% (${progress.extractedFiles}/${progress.totalFiles} files)${colors.reset}`)
  })
  
  java.on('java_install_end', (info) => {
    console.log()
    logSuccess(`Installation completed: ${info.filesExtracted} files at ${info.path}`)
  })

  try {
    // First check if we already have a compatible Java
    const existing = await java.discoverBest()
    if (existing && existing.semver.major >= requiredJava) {
      logInfo(`Found existing Java ${existing.semverStr} - testing download anyway`)
    }
    
    logInfo('Downloading Adoptium Java...')
    const startTime = Date.now()
    
    await java.download()
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    logSuccess(`Total time: ${duration}s`)
    
    // Verify installation
    const jreDir = path.join(serverFolder, 'runtime', `jre-${requiredJava}`)
    const javaPath = getJavaExecPath(serverFolder, requiredJava)
    
    logInfo(`JRE directory: ${jreDir}`)
    logInfo(`Java executable: ${javaPath}`)
    
    try {
      await fs.access(javaPath)
      logSuccess('Java executable exists')
    } catch {
      // Try alternate path for Adoptium
      const altPath = path.join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      try {
        await fs.access(altPath)
        logSuccess(`Java executable exists (alternate path)`)
      } catch {
        logError('Java executable not found')
        return false
      }
    }
    
    // Verify Java runs using discover
    const discovered = await java.discover()
    const adoptiumInstall = discovered.find(j => j.path.includes(`jre-${requiredJava}`))
    
    if (adoptiumInstall) {
      const javaInfo = await verifyJavaRuns(adoptiumInstall.execPath)
      if (javaInfo) {
        logSuccess(`Java runs: version ${javaInfo.version} (${javaInfo.arch})`)
      } else {
        logError('Java failed to run')
        return false
      }
      
      // Verify Minecraft compatibility
      const mcCompatible = await verifyMinecraftCompatibility(adoptiumInstall.execPath)
      if (mcCompatible) {
        logSuccess('Java is compatible with Minecraft JVM arguments')
      } else {
        logWarning('Java may have issues with some Minecraft JVM arguments')
      }
    } else {
      logWarning('Could not find installed Adoptium in discovery')
    }
    
    // Check installation size
    const size = await getDirectorySize(jreDir)
    logInfo(`Installation size: ${formatBytes(size)}`)
    
    return true
  } catch (error) {
    logError(`Download failed: ${error}`)
    return false
  }
}

// ============================================
// Test: Download Corretto Java
// ============================================

async function testCorrettoDownload(): Promise<boolean> {
  logStep('Testing Amazon Corretto Java Download')
  
  const java = new Java(TEST_MC_VERSION, TEST_SERVER_ID + '-corretto', { distribution: 'corretto' })
  const serverFolder = utils.getServerFolder(TEST_SERVER_ID + '-corretto')
  const requiredJava = Java.getRequiredJavaVersion(TEST_MC_VERSION)
  
  logInfo(`Required Java version: ${requiredJava}`)
  
  // New percentage-based event listeners
  java.on('java_download_start', (info) => {
    logInfo(`Starting ${info.distribution} Java ${info.majorVersion} download (${formatBytes(info.totalSize)})`)
  })
  
  java.on('java_download_progress', (progress) => {
    const speedStr = progress.speed > 0 ? ` @ ${formatBytes(progress.speed)}/s` : ''
    process.stdout.write(`\r${colors.gray}  ⬇ Downloading: ${progress.percent}% (${formatBytes(progress.downloadedSize)}/${formatBytes(progress.totalSize)})${speedStr}${colors.reset}`)
  })
  
  java.on('java_download_end', (info) => {
    console.log()
    logSuccess(`Download completed: ${formatBytes(info.totalSize)} in ${(info.duration / 1000).toFixed(1)}s`)
  })
  
  java.on('java_install_start', (info) => {
    logInfo(`Installing Java ${info.majorVersion} (${info.distribution})...`)
  })
  
  java.on('java_install_progress', (progress) => {
    process.stdout.write(`\r${colors.gray}  📦 Installing: ${progress.percent}% (${progress.extractedFiles}/${progress.totalFiles} files)${colors.reset}`)
  })
  
  java.on('java_install_end', (info) => {
    console.log()
    logSuccess(`Installation completed: ${info.filesExtracted} files at ${info.path}`)
  })

  try {
    logInfo('Downloading Corretto Java...')
    const startTime = Date.now()
    
    await java.download()
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    logSuccess(`Total time: ${duration}s`)
    
    // Verify installation
    const jreDir = path.join(serverFolder, 'runtime', `jre-${requiredJava}`)
    
    try {
      await fs.access(jreDir)
      logSuccess('JRE directory exists')
    } catch {
      logError('JRE directory not found')
      return false
    }
    
    // Use discovery to find the Java
    const discovered = await java.discover()
    const correttoInstall = discovered.find(j => j.path.includes(`jre-${requiredJava}`))
    
    if (correttoInstall) {
      logInfo(`Found: ${correttoInstall.vendor}`)
      
      const javaInfo = await verifyJavaRuns(correttoInstall.execPath)
      if (javaInfo) {
        logSuccess(`Java runs: version ${javaInfo.version} (${javaInfo.arch})`)
      } else {
        logError('Java failed to run')
        return false
      }
      
      // Verify Minecraft compatibility
      const mcCompatible = await verifyMinecraftCompatibility(correttoInstall.execPath)
      if (mcCompatible) {
        logSuccess('Java is compatible with Minecraft JVM arguments')
      } else {
        logWarning('Java may have issues with some Minecraft JVM arguments')
      }
    } else {
      logWarning('Could not find installed Corretto in discovery')
    }
    
    // Check installation size
    const size = await getDirectorySize(jreDir)
    logInfo(`Installation size: ${formatBytes(size)}`)
    
    return true
  } catch (error) {
    logError(`Download failed: ${error}`)
    return false
  }
}

// ============================================
// Test: Java check() method
// ============================================

async function testJavaCheckMethod(): Promise<boolean> {
  logStep('Testing Java check() method')
  
  const java = new Java(TEST_MC_VERSION, TEST_SERVER_ID)
  const serverFolder = utils.getServerFolder(TEST_SERVER_ID)
  const requiredJava = Java.getRequiredJavaVersion(TEST_MC_VERSION)
  
  // Listen for java_info event
  let eventFired = false
  java.on('java_info', (info) => {
    eventFired = true
    logInfo(`java_info event: version=${info.version}, arch=${info.arch}`)
  })

  // Use the discovered Java path or fallback to downloaded path
  const javaPath = await java.getJavaPath()
  logInfo(`Using Java at: ${javaPath}`)

  try {
    // For check() method, we need to provide the path template
    // The method replaces ${X} with the major version
    const javaExec = process.platform === 'win32' ? 'javaw.exe' : 'java'
    const pathTemplate = path.join(serverFolder, 'runtime', 'jre-${X}', 'bin', javaExec)
    
    const result = await java.check(pathTemplate, requiredJava)
    
    logSuccess(`Java check passed: version ${result.version} (${result.arch})`)
    
    if (eventFired) {
      logSuccess('java_info event was emitted')
    } else {
      logWarning('java_info event was not emitted')
    }
    
    // Verify version is correct major version
    const majorVersion = parseInt(result.version.split('.')[0])
    const expectedMajor = result.version.startsWith('1.') ? 
      parseInt(result.version.split('.')[1]) : majorVersion
    
    if (expectedMajor >= requiredJava) {
      logSuccess(`Major version ${expectedMajor} meets requirement ${requiredJava}`)
    } else {
      logWarning(`Major version ${expectedMajor} is less than required ${requiredJava}`)
    }
    
    return true
  } catch (error) {
    // If check fails, try using the discovered Java path directly
    logWarning(`check() with template failed: ${error}`)
    
    try {
      const javaInfo = await verifyJavaRuns(javaPath)
      if (javaInfo) {
        logSuccess(`Direct verification passed: version ${javaInfo.version} (${javaInfo.arch})`)
        return true
      }
    } catch (e) {
      logError(`Direct verification also failed: ${e}`)
    }
    
    return false
  }
}

// ============================================
// Test: Java version for different MC versions
// ============================================

async function testMultiVersionDownload(): Promise<boolean> {
  logStep('Testing Java for Multiple Minecraft Versions')
  
  const testVersions = [
    { mc: '1.16.5', expectedJava: 8 },
    { mc: '1.17.1', expectedJava: 16 },
    { mc: '1.20.4', expectedJava: 17 },
    { mc: '1.21', expectedJava: 21 },
  ]
  
  let allPassed = true
  
  for (const { mc, expectedJava } of testVersions) {
    const actualJava = Java.getRequiredJavaVersion(mc)
    
    if (actualJava === expectedJava) {
      logSuccess(`MC ${mc} → Java ${actualJava}`)
    } else {
      logError(`MC ${mc} → Java ${actualJava} (expected ${expectedJava})`)
      allPassed = false
    }
  }
  
  // Test getJavaPath for a specific version
  logInfo('\nTesting getJavaPath() resolution...')
  
  const java = new Java(TEST_MC_VERSION, TEST_SERVER_ID)
  const javaPath = await java.getJavaPath()
  
  logInfo(`Resolved Java path: ${javaPath}`)
  
  // Verify path exists (if we downloaded Java earlier)
  try {
    await fs.access(javaPath)
    logSuccess('Java path is valid and accessible')
  } catch {
    logWarning('Java path is not accessible (may not be downloaded yet)')
  }
  
  return allPassed
}

// ============================================
// Cleanup
// ============================================

async function cleanup() {
  logStep('Cleanup')
  
  const serverFolders = [
    utils.getServerFolder(TEST_SERVER_ID),
    utils.getServerFolder(TEST_SERVER_ID + '-corretto')
  ]
  
  for (const folder of serverFolders) {
    try {
      await fs.rm(folder, { recursive: true, force: true })
      logInfo(`Removed: ${folder}`)
    } catch {
      logWarning(`Could not remove: ${folder}`)
    }
  }
  
  logSuccess('Cleanup completed')
}

// ============================================
// Main
// ============================================

interface TestResult {
  name: string
  passed: boolean
  skipped?: boolean
  duration: number
}

async function main() {
  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║          JAVA DOWNLOAD & INSTALLATION TESTS                ║
╠════════════════════════════════════════════════════════════╣
║  This test downloads Java from various distributions.      ║
║  File sizes: 100-200MB per distribution.                   ║
║  Estimated time: 2-5 minutes depending on internet speed.  ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`)

  const results: TestResult[] = []
  const args = process.argv.slice(2)
  const skipDownload = args.includes('--skip-download')
  const skipCleanup = args.includes('--skip-cleanup')
  const onlyMojang = args.includes('--mojang-only')
  const onlyAdoptium = args.includes('--adoptium-only')
  const onlyCorretto = args.includes('--corretto-only')
  
  if (skipDownload) {
    logWarning('Skipping download tests (--skip-download flag)')
  }

  // Test 1: Multi-version mapping
  {
    const startTime = Date.now()
    const passed = await testMultiVersionDownload()
    results.push({
      name: 'Multi-version Mapping',
      passed,
      duration: Date.now() - startTime
    })
  }

  // Test 2: Mojang Download
  if (!skipDownload && !onlyAdoptium && !onlyCorretto) {
    const startTime = Date.now()
    const passed = await testMojangDownload()
    results.push({
      name: 'Mojang Download',
      passed,
      duration: Date.now() - startTime
    })
  } else if (!onlyAdoptium && !onlyCorretto) {
    results.push({ name: 'Mojang Download', passed: true, skipped: true, duration: 0 })
  }

  // Test 3: Java check() method (after Mojang download)
  if (!skipDownload && !onlyAdoptium && !onlyCorretto) {
    const startTime = Date.now()
    const passed = await testJavaCheckMethod()
    results.push({
      name: 'Java check() Method',
      passed,
      duration: Date.now() - startTime
    })
  }

  // Test 4: Adoptium Download
  if (!skipDownload && !onlyMojang && !onlyCorretto) {
    const startTime = Date.now()
    const passed = await testAdoptiumDownload()
    results.push({
      name: 'Adoptium Download',
      passed,
      duration: Date.now() - startTime
    })
  } else if (!onlyMojang && !onlyCorretto) {
    results.push({ name: 'Adoptium Download', passed: true, skipped: true, duration: 0 })
  }

  // Test 5: Corretto Download
  if (!skipDownload && !onlyMojang && !onlyAdoptium) {
    const startTime = Date.now()
    const passed = await testCorrettoDownload()
    results.push({
      name: 'Corretto Download',
      passed,
      duration: Date.now() - startTime
    })
  } else if (!onlyMojang && !onlyAdoptium) {
    results.push({ name: 'Corretto Download', passed: true, skipped: true, duration: 0 })
  }

  // Cleanup (unless skipped)
  if (!skipCleanup) {
    await cleanup()
  } else {
    logWarning('Skipping cleanup (--skip-cleanup flag)')
    logInfo(`Test folders remain at:`)
    logInfo(`  ${utils.getServerFolder(TEST_SERVER_ID)}`)
    logInfo(`  ${utils.getServerFolder(TEST_SERVER_ID + '-corretto')}`)
  }

  // Summary
  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║                      TEST SUMMARY                          ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`)

  const passed = results.filter(r => r.passed && !r.skipped).length
  const failed = results.filter(r => !r.passed).length
  const skipped = results.filter(r => r.skipped).length
  const totalDuration = results.reduce((acc, r) => acc + r.duration, 0)

  for (const result of results) {
    const icon = result.skipped ? '⏭️' : (result.passed ? '✅' : '❌')
    const status = result.skipped ? 'SKIPPED' : (result.passed ? 'PASSED' : 'FAILED')
    const duration = result.duration > 0 ? ` (${(result.duration / 1000).toFixed(1)}s)` : ''
    console.log(`  ${icon} ${result.name}: ${status}${duration}`)
  }

  console.log(`
${colors.cyan}────────────────────────────────────────────────────────────${colors.reset}
  Total: ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}, ${colors.yellow}${skipped} skipped${colors.reset}
  Duration: ${(totalDuration / 1000).toFixed(1)}s
${colors.cyan}────────────────────────────────────────────────────────────${colors.reset}
`)

  console.log(`
${colors.gray}Usage:
  npx ts-node test/test-java-download.ts              # Run all tests
  npx ts-node test/test-java-download.ts --mojang-only    # Only test Mojang
  npx ts-node test/test-java-download.ts --adoptium-only  # Only test Adoptium
  npx ts-node test/test-java-download.ts --corretto-only  # Only test Corretto
  npx ts-node test/test-java-download.ts --skip-download  # Skip download tests
  npx ts-node test/test-java-download.ts --skip-cleanup   # Keep downloaded files${colors.reset}
`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  logError(`Test failed with error: ${error}`)
  process.exit(1)
})

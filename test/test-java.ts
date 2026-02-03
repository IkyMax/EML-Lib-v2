/**
 * Java Class Tests
 * Tests for Java version detection, Minecraft version mapping, and discovery
 */

import EMLLib from '../index'
import Java from '../lib/java/java'

// ============================================
// Test: Minecraft Version to Java Mapping
// ============================================

function testJavaVersionMapping() {
  console.log('\n=== TEST: Minecraft Version to Java Mapping ===')
  
  const testCases: { mcVersion: string; expectedJava: number }[] = [
    // === Java 25: Since 26.1 (26.1 Snapshot 1) ===
    { mcVersion: '26.1', expectedJava: 25 },
    { mcVersion: '26.2', expectedJava: 25 },
    { mcVersion: '27.1', expectedJava: 25 },
    { mcVersion: '30.5', expectedJava: 25 },
    { mcVersion: '26w01a', expectedJava: 25 },  // 2026 snapshot
    { mcVersion: '26w15b', expectedJava: 25 },
    
    // === Java 21: 1.20.5 (24w14a) to 1.21.11 ===
    { mcVersion: '1.21.11', expectedJava: 21 },
    { mcVersion: '1.21.10', expectedJava: 21 },
    { mcVersion: '1.21', expectedJava: 21 },
    { mcVersion: '1.21.1', expectedJava: 21 },
    { mcVersion: '1.20.5', expectedJava: 21 },
    { mcVersion: '1.20.6', expectedJava: 21 },
    { mcVersion: '1.22', expectedJava: 21 },    // Future
    { mcVersion: '25w03a', expectedJava: 21 },  // 2025 snapshot
    // 24w14a = first snapshot requiring Java 21 (1.20.5 development)
    { mcVersion: '24w14a', expectedJava: 21 },
    { mcVersion: '24w20a', expectedJava: 21 },
    { mcVersion: '24w33a', expectedJava: 21 },
    { mcVersion: '24w50a', expectedJava: 21 },
    // Pre-releases for 1.20.5+
    { mcVersion: '1.20.5-pre1', expectedJava: 21 },
    { mcVersion: '1.20.5-rc1', expectedJava: 21 },
    { mcVersion: '1.21-pre1', expectedJava: 21 },
    
    // === Java 17: 1.18 (1.18-pre2) to 1.20.4 (24w13a) ===
    { mcVersion: '1.20.4', expectedJava: 17 },
    { mcVersion: '1.20.3', expectedJava: 17 },
    { mcVersion: '1.20.1', expectedJava: 17 },
    { mcVersion: '1.20', expectedJava: 17 },
    { mcVersion: '1.20-pre1', expectedJava: 17 },
    { mcVersion: '1.19.4', expectedJava: 17 },
    { mcVersion: '1.19', expectedJava: 17 },
    { mcVersion: '1.19.4-pre1', expectedJava: 17 },
    { mcVersion: '1.18', expectedJava: 17 },
    { mcVersion: '1.18.1', expectedJava: 17 },
    { mcVersion: '1.18.2', expectedJava: 17 },
    { mcVersion: '1.18-pre2', expectedJava: 17 }, // First pre-release requiring Java 17
    { mcVersion: '1.18-pre3', expectedJava: 17 },
    { mcVersion: '1.18-rc1', expectedJava: 17 },
    // 24w13a = last snapshot with Java 17
    { mcVersion: '24w13a', expectedJava: 17 },
    { mcVersion: '24w06a', expectedJava: 17 },
    { mcVersion: '24w01a', expectedJava: 17 },
    { mcVersion: '23w51b', expectedJava: 17 },
    { mcVersion: '23w01a', expectedJava: 17 },
    { mcVersion: '22w45a', expectedJava: 17 },
    { mcVersion: '22w19a', expectedJava: 17 },
    { mcVersion: '22w03a', expectedJava: 17 },
    
    // === Java 16: 1.17 (21w19a) to 1.17.1 (1.18-pre1) ===
    { mcVersion: '1.17', expectedJava: 16 },
    { mcVersion: '1.17.1', expectedJava: 16 },
    { mcVersion: '1.17.1-pre1', expectedJava: 16 },
    { mcVersion: '1.18-pre1', expectedJava: 16 }, // Last pre-release with Java 16
    // 21w19a = first snapshot requiring Java 16 (1.17 development)
    { mcVersion: '21w19a', expectedJava: 16 },
    { mcVersion: '21w20a', expectedJava: 16 },
    { mcVersion: '21w37a', expectedJava: 16 },
    { mcVersion: '21w44a', expectedJava: 16 }, // 1.18 development (still Java 16 until 1.18-pre2)
    
    // === Java 8: 1.12 (17w13a) to 1.16.5 (21w18a) ===
    // (Adoptium/Corretto don't have Java 5/6, so we use Java 8 for all older versions)
    { mcVersion: '1.16.5', expectedJava: 8 },
    { mcVersion: '1.16', expectedJava: 8 },
    { mcVersion: '1.15.2', expectedJava: 8 },
    { mcVersion: '1.14', expectedJava: 8 },
    { mcVersion: '1.13', expectedJava: 8 },
    { mcVersion: '1.12', expectedJava: 8 },
    { mcVersion: '1.12.2', expectedJava: 8 },
    // 21w18a = last snapshot with Java 8
    { mcVersion: '21w18a', expectedJava: 8 },
    { mcVersion: '21w03a', expectedJava: 8 },
    { mcVersion: '21w01a', expectedJava: 8 },
    // Earlier snapshot years
    { mcVersion: '20w51a', expectedJava: 8 },
    { mcVersion: '20w01a', expectedJava: 8 },
    { mcVersion: '19w14a', expectedJava: 8 },
    { mcVersion: '19w02a', expectedJava: 8 },
    { mcVersion: '18w50a', expectedJava: 8 },
    { mcVersion: '18w01a', expectedJava: 8 },
    { mcVersion: '17w50a', expectedJava: 8 },
    { mcVersion: '17w13a', expectedJava: 8 }, // 1.12 development start
    { mcVersion: '16w01a', expectedJava: 8 },
    { mcVersion: '15w01a', expectedJava: 8 },
    { mcVersion: '14w01a', expectedJava: 8 },
    { mcVersion: '13w16a', expectedJava: 8 }, // 1.6 development
    
    // Very old versions (originally Java 5/6, using Java 8 as minimum)
    { mcVersion: '1.11.2', expectedJava: 8 }, // Originally Java 6
    { mcVersion: '1.10', expectedJava: 8 },
    { mcVersion: '1.8.9', expectedJava: 8 },
    { mcVersion: '1.7.10', expectedJava: 8 },
    { mcVersion: '1.6.4', expectedJava: 8 },
    { mcVersion: '1.6.1', expectedJava: 8 },  // Originally Java 6
    { mcVersion: '1.5.2', expectedJava: 8 },  // Originally Java 5
    { mcVersion: '1.0', expectedJava: 8 },
  ]

  let passed = 0
  let failed = 0

  for (const { mcVersion, expectedJava } of testCases) {
    const result = Java.getRequiredJavaVersion(mcVersion)
    if (result === expectedJava) {
      console.log(`✅ MC ${mcVersion} → Java ${result}`)
      passed++
    } else {
      console.error(`❌ MC ${mcVersion} → Java ${result} (expected ${expectedJava})`)
      failed++
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`)
  return failed === 0
}

// ============================================
// Test: Java Discovery
// ============================================

async function testJavaDiscovery() {
  console.log('\n=== TEST: Java Discovery ===')
  
  const java = new Java('1.20.4', 'test-server')
  
  // Listen for discovery event
  java.on('java_discovered', (data) => {
    console.log(`📢 Event: Found ${data.count} Java installations`)
    if (data.best) {
      console.log(`   Best: ${data.best.version} at ${data.best.path}`)
    }
  })

  try {
    const discovered = await java.discover()
    
    if (discovered.length === 0) {
      console.log('⚠️  No Java installations found on this system')
      console.log('   (This is expected if Java is not installed)')
      return true
    }

    console.log(`✅ Found ${discovered.length} Java installation(s):`)
    for (const jvm of discovered) {
      console.log(`   - Java ${jvm.semverStr} (${jvm.arch})`)
      console.log(`     Vendor: ${jvm.vendor}`)
      console.log(`     Path: ${jvm.path}`)
      console.log(`     Exec: ${jvm.execPath}`)
    }

    return true
  } catch (error) {
    console.error('❌ Discovery failed:', error)
    return false
  }
}

// ============================================
// Test: Best Java Match
// ============================================

async function testDiscoverBest() {
  console.log('\n=== TEST: Discover Best Java Match ===')
  
  const testVersions = ['1.20.4', '1.21', '26.1']
  
  for (const mcVersion of testVersions) {
    const java = new Java(mcVersion, 'test-server')
    const required = Java.getRequiredJavaVersion(mcVersion)
    
    console.log(`\nMC ${mcVersion} requires Java ${required}:`)
    
    try {
      const best = await java.discoverBest()
      
      if (best) {
        const compatible = best.semver.major >= required
        const icon = compatible ? '✅' : '⚠️'
        console.log(`${icon} Best match: Java ${best.semverStr}`)
        console.log(`   Path: ${best.execPath}`)
        if (!compatible) {
          console.log(`   Warning: Version ${best.semver.major} < required ${required}`)
        }
      } else {
        console.log(`⚠️  No compatible Java found`)
      }
    } catch (error) {
      console.error(`❌ Error:`, error)
    }
  }

  return true
}

// ============================================
// Test: Java Constructor Options
// ============================================

function testJavaConstructorOptions() {
  console.log('\n=== TEST: Java Constructor Options ===')
  
  // Test default distribution (mojang)
  const java1 = new Java('1.20.4', 'test-server')
  console.log('✅ Default constructor (mojang distribution)')

  // Test with adoptium distribution
  const java2 = new Java('1.20.4', 'test-server', { distribution: 'adoptium' })
  console.log('✅ Adoptium distribution')

  // Test with corretto distribution
  const java3 = new Java('1.20.4', 'test-server', { distribution: 'corretto' })
  console.log('✅ Corretto distribution')

  // Test with url
  const java4 = new Java(null, 'test-server', { 
    distribution: 'adoptium',
    url: 'https://example.com/admintool'
  })
  console.log('✅ With url')

  return true
}

// ============================================
// Test: Static getRequiredJavaVersion
// ============================================

function testStaticMethod() {
  console.log('\n=== TEST: Static Method Access ===')
  
  // Test that static method is accessible
  const result = Java.getRequiredJavaVersion('1.20.4')
  
  if (typeof result === 'number' && result === 17) {
    console.log('✅ Static method Java.getRequiredJavaVersion() works')
    return true
  } else {
    console.error('❌ Static method failed')
    return false
  }
}

// ============================================
// Test: Major Version Override
// ============================================

function testMajorVersionOverride() {
  console.log('\n=== TEST: Major Version Override ===')
  
  let passed = 0
  let failed = 0

  // Test 1: Without override, static method should return correct version
  const result1 = Java.getRequiredJavaVersion('1.16.5')
  if (result1 === 8) {
    console.log(`✅ Static: MC 1.16.5 → Java ${result1}`)
    passed++
  } else {
    console.error(`❌ Static: MC 1.16.5 → Java ${result1} (expected 8)`)
    failed++
  }

  // Test 2: Verify constructor accepts majorVersionOverride option
  try {
    const java2 = new Java('1.16.5', 'test-server', { majorVersionOverride: 21 })
    console.log(`✅ Constructor accepts majorVersionOverride: 21`)
    passed++
  } catch (e) {
    console.error(`❌ Constructor rejected majorVersionOverride option`)
    failed++
  }

  // Test 3: Override with different distributions
  try {
    const java3 = new Java('1.16.5', 'test-server', { 
      distribution: 'adoptium', 
      majorVersionOverride: 17 
    })
    console.log(`✅ Constructor accepts distribution + majorVersionOverride`)
    passed++
  } catch (e) {
    console.error(`❌ Constructor rejected combined options`)
    failed++
  }

  // Test 4: Override with null MC version
  try {
    const java4 = new Java(null, 'test-server', { majorVersionOverride: 21 })
    console.log(`✅ Constructor accepts null mcVersion + majorVersionOverride`)
    passed++
  } catch (e) {
    console.error(`❌ Constructor rejected null mcVersion with override`)
    failed++
  }

  // Test 5: Override with corretto distribution
  try {
    const java5 = new Java('1.20.4', 'test-server', { 
      distribution: 'corretto', 
      majorVersionOverride: 25 
    })
    console.log(`✅ Constructor accepts corretto + majorVersionOverride: 25`)
    passed++
  } catch (e) {
    console.error(`❌ Constructor rejected corretto with override`)
    failed++
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`)
  return failed === 0
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('====================================')
  console.log('  JAVA CLASS TESTS')
  console.log('====================================')

  const results: { name: string; passed: boolean }[] = []

  // Synchronous tests
  results.push({ name: 'Version Mapping', passed: testJavaVersionMapping() })
  results.push({ name: 'Constructor Options', passed: testJavaConstructorOptions() })
  results.push({ name: 'Static Method', passed: testStaticMethod() })
  results.push({ name: 'Major Version Override', passed: testMajorVersionOverride() })

  // Async tests
  results.push({ name: 'Java Discovery', passed: await testJavaDiscovery() })
  results.push({ name: 'Best Match', passed: await testDiscoverBest() })

  // Summary
  console.log('\n====================================')
  console.log('  TEST SUMMARY')
  console.log('====================================')
  
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  
  for (const result of results) {
    console.log(`${result.passed ? '✅' : '❌'} ${result.name}`)
  }
  
  console.log(`\nTotal: ${passed} passed, ${failed} failed`)
  
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(console.error)

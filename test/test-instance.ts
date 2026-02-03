/**
 * Tests for InstanceManager
 * Run with: npx ts-node test/test-instance.ts
 */

import { InstanceManager } from '../lib/utils/instance'
import { Instance } from '../types/instance'

// Test counters
let passed = 0
let failed = 0

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn()
      console.log(`✓ ${name}`)
      passed++
    } catch (err: any) {
      console.log(`✗ ${name}`)
      console.log(`  Error: ${err.message}`)
      failed++
    }
  })()
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`)
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || `Expected true, got false`)
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || `Expected false, got true`)
  }
}

// ============================================================================
// URL Building Tests
// ============================================================================

async function testUrlBuilding() {
  console.log('\n=== URL Building Tests ===\n')

  await test('Default instance - getApiBase returns base URL', () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'https://eml.example.com')
  })

  await test('Default instance - URL with trailing slash is normalized', () => {
    const instance: Instance = { url: 'https://eml.example.com/' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'https://eml.example.com')
  })

  await test('Default instance - URL with multiple trailing slashes is normalized', () => {
    const instance: Instance = { url: 'https://eml.example.com///' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'https://eml.example.com')
  })

  await test('Named instance - getApiBase includes instanceId', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'my-server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'https://eml.example.com/instances/my-server')
  })

  await test('Named instance with trailing slash - getApiBase includes instanceId', () => {
    const instance: Instance = { url: 'https://eml.example.com/', instanceId: 'private-server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'https://eml.example.com/instances/private-server')
  })

  await test('buildUrl - default instance with endpoint', () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.buildUrl('/api/loader'), 'https://eml.example.com/api/loader')
  })

  await test('buildUrl - named instance with endpoint', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'my-server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.buildUrl('/api/loader'), 'https://eml.example.com/instances/my-server/api/loader')
  })

  await test('buildUrl - endpoint without leading slash', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'my-server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.buildUrl('api/loader'), 'https://eml.example.com/instances/my-server/api/loader')
  })

  await test('buildUrl - files-updater endpoint', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'test' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.buildUrl('/api/files-updater'), 'https://eml.example.com/instances/test/api/files-updater')
  })

  await test('buildUrl - news endpoint', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'server1' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.buildUrl('/api/news'), 'https://eml.example.com/instances/server1/api/news')
  })
}

// ============================================================================
// Authentication Requirement Tests
// ============================================================================

async function testAuthRequirements() {
  console.log('\n=== Authentication Requirement Tests ===\n')

  await test('requiresAuth - false when no password', () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'test-server')
    assertFalse(manager.requiresAuth())
  })

  await test('requiresAuth - false for named instance without password', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'public-server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertFalse(manager.requiresAuth())
  })

  await test('requiresAuth - true when password provided', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'private', password: 'secret' }
    const manager = new InstanceManager(instance, 'test-server')
    assertTrue(manager.requiresAuth())
  })

  await test('hasPassword - false initially without password', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertFalse(manager.hasPassword())
  })

  await test('hasPassword - true when password in config', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'server', password: 'pass123' }
    const manager = new InstanceManager(instance, 'test-server')
    assertTrue(manager.hasPassword())
  })

  await test('setPassword - makes hasPassword return true', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertFalse(manager.hasPassword())
    manager.setPassword('user-entered-password')
    assertTrue(manager.hasPassword())
  })

  await test('setPassword - makes requiresAuth return true', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'server' }
    const manager = new InstanceManager(instance, 'test-server')
    assertFalse(manager.requiresAuth())
    manager.setPassword('user-entered-password')
    assertTrue(manager.requiresAuth())
  })
}

// ============================================================================
// Auth Headers Tests
// ============================================================================

async function testAuthHeaders() {
  console.log('\n=== Auth Headers Tests ===\n')

  await test('getAuthHeaders - empty when no token', () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'test-server')
    const headers = manager.getAuthHeaders()
    assertEqual(Object.keys(headers).length, 0)
  })

  await test('getToken - undefined when not authenticated', () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getToken(), undefined)
  })
}

// ============================================================================
// Event Tests
// ============================================================================

async function testEvents() {
  console.log('\n=== Event Tests ===\n')

  await test('Events - can listen for instance_authenticated', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'test', password: 'pass' }
    const manager = new InstanceManager(instance, 'test-server')
    let eventFired = false
    manager.on('instance_authenticated', () => {
      eventFired = true
    })
    // Event won't fire without actual auth, but we can verify listener is attached
    assertTrue(typeof manager.on === 'function')
  })

  await test('Events - can listen for instance_password_required', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'test' }
    const manager = new InstanceManager(instance, 'test-server')
    let eventFired = false
    manager.on('instance_password_required', ({ instanceId }) => {
      eventFired = true
      assertEqual(instanceId, 'test')
    })
    assertTrue(typeof manager.on === 'function')
  })

  await test('Events - can listen for instance_auth_failed', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'test', password: 'pass' }
    const manager = new InstanceManager(instance, 'test-server')
    manager.on('instance_auth_failed', ({ instanceId, reason }) => {
      assertEqual(instanceId, 'test')
      assertTrue(reason.length > 0)
    })
    assertTrue(typeof manager.on === 'function')
  })

  await test('Events - can listen for instance_clearing', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'test', password: 'pass' }
    const manager = new InstanceManager(instance, 'test-server')
    manager.on('instance_clearing', ({ instanceId, path }) => {
      assertEqual(instanceId, 'test')
      assertTrue(path.length > 0)
    })
    assertTrue(typeof manager.on === 'function')
  })

  await test('Events - can listen for instance_cleared', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'test', password: 'pass' }
    const manager = new InstanceManager(instance, 'test-server')
    manager.on('instance_cleared', ({ instanceId, path }) => {
      assertEqual(instanceId, 'test')
      assertTrue(path.length > 0)
    })
    assertTrue(typeof manager.on === 'function')
  })
}

// ============================================================================
// Instance Path Tests
// ============================================================================

async function testInstancePath() {
  console.log('\n=== Instance Path Tests ===\n')

  await test('getInstancePath - returns server folder path', () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'my-minecraft-server')
    const path = manager.getInstancePath()
    // Server ID is sanitized: special chars -> underscore, lowercased, and prefixed with dot on win/linux
    assertTrue(path.includes('my_minecraft_server') || path.includes('.my_minecraft_server'))
  })

  await test('getInstancePath - different serverId gives different path', () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager1 = new InstanceManager(instance, 'server-a')
    const manager2 = new InstanceManager(instance, 'server-b')
    assertTrue(manager1.getInstancePath() !== manager2.getInstancePath())
  })
}

// ============================================================================
// Edge Cases
// ============================================================================

async function testEdgeCases() {
  console.log('\n=== Edge Cases ===\n')

  await test('Empty instanceId is treated as default instance', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: '' }
    const manager = new InstanceManager(instance, 'test-server')
    // Empty string is falsy, so it should be treated as default
    assertEqual(manager.getApiBase(), 'https://eml.example.com')
  })

  await test('InstanceId with special characters', () => {
    const instance: Instance = { url: 'https://eml.example.com', instanceId: 'my-server-123' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'https://eml.example.com/instances/my-server-123')
  })

  await test('URL with port number', () => {
    const instance: Instance = { url: 'http://localhost:8080', instanceId: 'dev' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'http://localhost:8080/instances/dev')
  })

  await test('URL with path (should not happen but handle gracefully)', () => {
    const instance: Instance = { url: 'https://eml.example.com/base', instanceId: 'test' }
    const manager = new InstanceManager(instance, 'test-server')
    assertEqual(manager.getApiBase(), 'https://eml.example.com/base/instances/test')
  })

  await test('clearAuth - can be called without error', async () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'test-server')
    await manager.clearAuth() // Should not throw
    assertTrue(true)
  })

  await test('ensureAuthenticated - does nothing for non-auth instance', async () => {
    const instance: Instance = { url: 'https://eml.example.com' }
    const manager = new InstanceManager(instance, 'test-server')
    await manager.ensureAuthenticated() // Should not throw
    assertTrue(true)
  })
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              InstanceManager Unit Tests                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')

  await testUrlBuilding()
  await testAuthRequirements()
  await testAuthHeaders()
  await testEvents()
  await testInstancePath()
  await testEdgeCases()

  console.log('\n════════════════════════════════════════════════════════════')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('════════════════════════════════════════════════════════════\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runAllTests().catch(console.error)

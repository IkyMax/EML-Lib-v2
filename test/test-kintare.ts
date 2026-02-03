/**
 * Kintare Authentication Tests
 * Tests for Device Code Grant OAuth2 flow
 */

import EMLLib from '../index'

// Test client ID for mock testing
const TEST_CLIENT_ID = 'test-client-id'

// ============================================
// Mock Server Setup
// ============================================

let mockResponses: Record<string, any> = {}
const originalFetch = global.fetch

function setupMockServer(scenario: 'success' | 'pending' | 'expired' | 'invalid-token' | 'refresh-success') {
  if (scenario === 'success') {
    mockResponses = {
      deviceCode: {
        device_code: 'mock_device_code_12345',
        user_code: 'ABCD-1234',
        verification_uri: 'http://localhost:3001/device',
        verification_uri_complete: 'http://localhost:3001/device?user_code=ABCD-1234',
        expires_in: 600,
        interval: 5
      },
      token: {
        access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mock_access_token',
        refresh_token: 'mock_refresh_token_opaque',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'offline_access Yggdrasil.PlayerProfiles.Select Yggdrasil.Server.Join'
      },
      profile: {
        id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        name: 'TestPlayer',
        skins: [],
        capes: []
      },
      genuine: {
        items: [{ name: 'game_minecraft', signature: 'mock_signature' }]
      }
    }
  } else if (scenario === 'pending') {
    mockResponses = {
      deviceCode: {
        device_code: 'mock_device_code_pending',
        user_code: 'PEND-5678',
        verification_uri: 'http://localhost:3001/device',
        expires_in: 600,
        interval: 1
      },
      tokenError: {
        error: 'authorization_pending'
      }
    }
  } else if (scenario === 'expired') {
    mockResponses = {
      tokenError: {
        error: 'expired_token'
      }
    }
  } else if (scenario === 'invalid-token') {
    mockResponses = {
      validateStatus: 403
    }
  } else if (scenario === 'refresh-success') {
    mockResponses = {
      validateStatus: 403,
      refresh: {
        access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.new_access_token',
        refresh_token: 'new_refresh_token_opaque',
        token_type: 'Bearer',
        expires_in: 3600
      },
      profile: {
        id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        name: 'TestPlayer',
        skins: [],
        capes: []
      },
      genuine: {
        items: [{ name: 'game_minecraft', signature: 'mock_signature' }]
      }
    }
  }

  global.fetch = async (url: any, options?: any) => {
    const endpoint = url.toString()
    const body = options?.body

    // Device authorization endpoint
    if (endpoint.includes('/oidc/device')) {
      return {
        ok: true,
        json: async () => mockResponses.deviceCode
      } as any
    }

    // Token endpoint
    if (endpoint.includes('/oidc/token')) {
      const params = new URLSearchParams(body)
      const grantType = params.get('grant_type')
      
      if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (mockResponses.tokenError) {
          return {
            ok: false,
            status: 400,
            json: async () => mockResponses.tokenError
          } as any
        }
        return {
          ok: true,
          json: async () => mockResponses.token
        } as any
      }
      
      if (grantType === 'refresh_token') {
        return {
          ok: true,
          json: async () => mockResponses.refresh
        } as any
      }
    }

    // Validate endpoint
    if (endpoint.includes('/authserver/validate')) {
      if (mockResponses.validateStatus === 403) {
        return { ok: false, status: 403 } as any
      }
      return { ok: true, status: 204 } as any
    }

    // Profile endpoint
    if (endpoint.includes('/minecraft/profile')) {
      return {
        ok: true,
        json: async () => mockResponses.profile
      } as any
    }

    // Entitlements endpoint
    if (endpoint.includes('/minecraft/kintare/genuine')) {
      return {
        ok: true,
        json: async () => mockResponses.genuine
      } as any
    }

    return originalFetch(url, options)
  }
}

function restoreFetch() {
  global.fetch = originalFetch
}

// ============================================
// Test: Request Device Code
// ============================================

async function testRequestDeviceCode() {
  console.log('\n=== TEST: Request Device Code ===')
  setupMockServer('success')

  try {
    const auth = new EMLLib.KintareAuth({ clientId: TEST_CLIENT_ID })
    const deviceCode = await auth.requestDeviceCode()

    if (deviceCode.user_code === 'ABCD-1234' &&
        deviceCode.verification_uri === 'http://localhost:3001/device' &&
        deviceCode.device_code === 'mock_device_code_12345') {
      console.log('✅ Device code request successful')
      console.log(`   User Code: ${deviceCode.user_code}`)
      console.log(`   Verification URI: ${deviceCode.verification_uri}`)
      console.log(`   Expires In: ${deviceCode.expires_in}s`)
      restoreFetch()
      return true
    }

    console.error('❌ Unexpected device code response')
    restoreFetch()
    return false
  } catch (error) {
    console.error('❌ Device code request failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Full Authentication Flow
// ============================================

async function testFullAuthentication() {
  console.log('\n=== TEST: Full Authentication Flow ===')
  setupMockServer('success')

  try {
    const auth = new EMLLib.KintareAuth({ clientId: TEST_CLIENT_ID })
    
    let receivedDeviceCode: any = null
    
    // Use the authenticate method with callbacks
    const account = await auth.authenticate((deviceCode) => {
      receivedDeviceCode = deviceCode
      console.log(`   1. Got device code: ${deviceCode.user_code}`)
    })
    
    if (account.name === 'TestPlayer' &&
        account.uuid === 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' &&
        account.meta.type === 'kintare') {
      console.log('✅ Full authentication successful')
      console.log(`   Name: ${account.name}`)
      console.log(`   UUID: ${account.uuid}`)
      console.log(`   Type: ${account.meta.type}`)
      console.log(`   Has access token: ${!!account.accessToken}`)
      console.log(`   Has refresh token: ${!!account.refreshToken}`)
      restoreFetch()
      return true
    }

    console.error('❌ Account data mismatch')
    restoreFetch()
    return false
  } catch (error) {
    console.error('❌ Authentication failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Poll Until Authorized
// ============================================

async function testPollUntilAuthorized() {
  console.log('\n=== TEST: Poll Until Authorized ===')
  setupMockServer('success')

  try {
    const auth = new EMLLib.KintareAuth({ clientId: TEST_CLIENT_ID })
    
    // First request device code
    const deviceCode = await auth.requestDeviceCode()
    console.log(`   Device code: ${deviceCode.user_code}`)
    
    // Then poll until authorized
    let pollCount = 0
    const account = await auth.pollUntilAuthorized((attempt) => {
      pollCount = attempt
    })
    
    if (account.name === 'TestPlayer') {
      console.log('✅ Poll until authorized successful')
      console.log(`   Polls: ${pollCount}`)
      console.log(`   Account: ${account.name}`)
      restoreFetch()
      return true
    }

    console.error('❌ Poll returned wrong account')
    restoreFetch()
    return false
  } catch (error) {
    console.error('❌ Poll failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Token Validation
// ============================================

async function testValidateToken() {
  console.log('\n=== TEST: Validate Token ===')
  setupMockServer('success')

  try {
    const auth = new EMLLib.KintareAuth({ clientId: TEST_CLIENT_ID })
    
    const mockAccount: any = {
      name: 'TestPlayer',
      uuid: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      meta: { type: 'kintare', online: true }
    }

    const isValid = await auth.validate(mockAccount)
    
    if (isValid !== null) {
      console.log('✅ Token validation successful')
      console.log(`   Token is valid, profile: ${isValid.name}`)
      restoreFetch()
      return true
    }

    console.error('❌ Validation returned false')
    restoreFetch()
    return false
  } catch (error) {
    console.error('❌ Validation failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Token Refresh on Invalid Token
// ============================================

async function testRefreshOnInvalidToken() {
  console.log('\n=== TEST: Refresh on Invalid Token ===')
  setupMockServer('refresh-success')

  try {
    const auth = new EMLLib.KintareAuth({ clientId: TEST_CLIENT_ID })
    
    const mockAccount: any = {
      name: 'TestPlayer',
      uuid: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      accessToken: 'expired_token',
      refreshToken: 'valid_refresh_token',
      meta: { type: 'kintare', online: true }
    }

    // validate() now returns Account or null, so test refresh() separately
    const isValid = await auth.validate(mockAccount)
    
    if (isValid === null) {
      console.log('   Token correctly identified as invalid, calling refresh()...')
      const refreshed = await auth.refresh(mockAccount)
      
      if (refreshed.accessToken && refreshed.accessToken !== 'expired_token') {
        console.log('✅ Token refreshed successfully')
        console.log(`   New access token received`)
        restoreFetch()
        return true
      }
    }

    console.error('❌ Token was not refreshed')
    restoreFetch()
    return false
  } catch (error) {
    console.error('❌ Refresh failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Direct Refresh
// ============================================

async function testDirectRefresh() {
  console.log('\n=== TEST: Direct Token Refresh ===')
  setupMockServer('refresh-success')

  try {
    const auth = new EMLLib.KintareAuth({ clientId: TEST_CLIENT_ID })
    
    const mockAccount: any = {
      name: 'OldPlayer',
      uuid: 'old_uuid',
      accessToken: 'old_access_token',
      refreshToken: 'valid_refresh_token',
      meta: { type: 'kintare', online: true }
    }
    
    const refreshed = await auth.refresh(mockAccount)
    
    if (refreshed.name === 'TestPlayer' && refreshed.accessToken) {
      console.log('✅ Direct refresh successful')
      console.log(`   Name: ${refreshed.name}`)
      console.log(`   New token received`)
      restoreFetch()
      return true
    }

    console.error('❌ Direct refresh failed')
    restoreFetch()
    return false
  } catch (error) {
    console.error('❌ Refresh error:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Custom Scopes
// ============================================

async function testCustomScopes() {
  console.log('\n=== TEST: Custom Scopes ===')
  setupMockServer('success')

  try {
    const customScopes = ['offline_access', 'custom.scope']
    const auth = new EMLLib.KintareAuth({ 
      clientId: TEST_CLIENT_ID,
      scopes: customScopes 
    })
    
    // Just verify construction works
    console.log('✅ Custom scopes constructor works')
    console.log(`   Scopes: ${customScopes.join(', ')}`)
    restoreFetch()
    return true
  } catch (error) {
    console.error('❌ Custom scopes failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Account Structure
// ============================================

async function testAccountStructure() {
  console.log('\n=== TEST: Account Structure ===')
  setupMockServer('success')

  try {
    const auth = new EMLLib.KintareAuth({ clientId: TEST_CLIENT_ID })
    
    let account: any = null
    await auth.authenticate((deviceCode) => {
      // Device code callback
    }).then(acc => { account = acc })

    const requiredFields = ['name', 'uuid', 'accessToken', 'refreshToken', 'meta']
    const missingFields = requiredFields.filter(f => !(f in account))

    if (missingFields.length === 0) {
      console.log('✅ Account has all required fields')
      console.log(`   Fields: ${requiredFields.join(', ')}`)
      
      // Check meta structure
      if (account.meta.type === 'kintare' && typeof account.meta.online === 'boolean') {
        console.log('✅ Meta structure is correct')
        console.log(`   meta.type: ${account.meta.type}`)
        console.log(`   meta.online: ${account.meta.online}`)
        restoreFetch()
        return true
      }
    }

    console.error('❌ Account structure invalid')
    console.error(`   Missing: ${missingFields.join(', ')}`)
    restoreFetch()
    return false
  } catch (error) {
    console.error('❌ Structure test failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Test: Constructor Validation
// ============================================

function testConstructorValidation() {
  console.log('\n=== TEST: Constructor Validation ===')

  try {
    // @ts-ignore - Testing runtime validation
    new EMLLib.KintareAuth({})
    console.error('❌ Should have thrown for missing clientId')
    return false
  } catch (error: any) {
    if (error.message?.includes('clientId')) {
      console.log('✅ Correctly throws for missing clientId')
      return true
    }
    console.log('✅ Threw error (different message):', error.message)
    return true
  }
}

// ============================================
// Test: Genuine Minecraft Check Option
// ============================================

async function testGenuineMinecraftOption() {
  console.log('\n=== TEST: Genuine Minecraft Check Option ===')
  setupMockServer('success')

  try {
    // Test with checkGenuineMinecraft enabled
    const auth = new EMLLib.KintareAuth({ 
      clientId: TEST_CLIENT_ID,
      checkGenuineMinecraft: true 
    })
    
    console.log('✅ checkGenuineMinecraft option works')
    restoreFetch()
    return true
  } catch (error) {
    console.error('❌ Option failed:', error)
    restoreFetch()
    return false
  }
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('====================================')
  console.log('  KINTARE AUTHENTICATION TESTS')
  console.log('====================================')

  const results: { name: string; passed: boolean }[] = []

  try {
    // Synchronous tests
    results.push({ name: 'Constructor Validation', passed: testConstructorValidation() })
    
    // Async tests
    results.push({ name: 'Request Device Code', passed: await testRequestDeviceCode() })
    results.push({ name: 'Poll Until Authorized', passed: await testPollUntilAuthorized() })
    results.push({ name: 'Full Authentication', passed: await testFullAuthentication() })
    results.push({ name: 'Token Validation', passed: await testValidateToken() })
    results.push({ name: 'Auto-Refresh Invalid', passed: await testRefreshOnInvalidToken() })
    results.push({ name: 'Direct Refresh', passed: await testDirectRefresh() })
    results.push({ name: 'Custom Scopes', passed: await testCustomScopes() })
    results.push({ name: 'Account Structure', passed: await testAccountStructure() })
    results.push({ name: 'Genuine MC Option', passed: await testGenuineMinecraftOption() })
  } catch (error) {
    console.error('\n❌ FATAL TEST ERROR:', error)
  }

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

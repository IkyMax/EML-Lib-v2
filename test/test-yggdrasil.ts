import EMLLib from '../index'

let mockServerResponses: any = {}

function setupMockServer(scenario: 'single-profile' | 'multi-profile' | 'validate-expired') {
  const originalFetch = global.fetch

  if (scenario === 'single-profile') {
    mockServerResponses = {
      authenticate: {
        accessToken: 'mock_access_token_single',
        clientToken: 'mock_client_token',
        selectedProfile: {
          id: 'e0aeed8fcf394b19973c67aade59973a',
          name: 'Foo'
        },
        availableProfiles: [
          { id: 'e0aeed8fcf394b19973c67aade59973a', name: 'Foo' }
        ],
        user: {
          id: '07b333d4fb0d55a68ce2320f7d8ad20b',
          properties: []
        }
      }
    }
  } else if (scenario === 'multi-profile') {
    mockServerResponses = {
      authenticate: {
        accessToken: 'mock_access_token_multi',
        clientToken: 'mock_client_token_multi',
        availableProfiles: [
          { id: 'e0aeed8fcf394b19973c67aade59973a', name: 'Foo' },
          { id: '61eac6414f9d4bebabc9c423e5fbda2d', name: 'Bar' }
        ],
        user: {
          id: '07b333d4fb0d55a68ce2320f7d8ad20b',
          properties: []
        }
      },
      refresh: {
        accessToken: 'mock_access_token_refreshed',
        clientToken: 'mock_client_token_multi',
        selectedProfile: {
          id: '61eac6414f9d4bebabc9c423e5fbda2d',
          name: 'Bar'
        },
        availableProfiles: [
          { id: 'e0aeed8fcf394b19973c67aade59973a', name: 'Foo' },
          { id: '61eac6414f9d4bebabc9c423e5fbda2d', name: 'Bar' }
        ],
        user: {
          id: '07b333d4fb0d55a68ce2320f7d8ad20b',
          properties: []
        }
      }
    }
  } else if (scenario === 'validate-expired') {
    mockServerResponses = {
      validate: { status: 403 },
      refresh: {
        accessToken: 'mock_access_token_renewed',
        clientToken: 'mock_client_token',
        selectedProfile: {
          id: 'e0aeed8fcf394b19973c67aade59973a',
          name: 'Foo'
        },
        availableProfiles: [
          { id: 'e0aeed8fcf394b19973c67aade59973a', name: 'Foo' }
        ],
        user: {
          id: '07b333d4fb0d55a68ce2320f7d8ad20b',
          properties: []
        }
      }
    }
  }

  global.fetch = async (url: any, options?: any) => {
    const endpoint = url.toString()

    if (endpoint.includes('/authenticate')) {
      return {
        json: async () => mockServerResponses.authenticate,
        status: 200
      } as any
    }

    if (endpoint.includes('/validate')) {
      if (mockServerResponses.validate?.status === 403) {
        return { status: 403 } as any
      }
      return { status: 204 } as any
    }

    if (endpoint.includes('/refresh')) {
      return {
        json: async () => mockServerResponses.refresh,
        status: 200
      } as any
    }

    return originalFetch(url, options)
  }
}

function restoreFetch() {
  delete (global as any).fetch
}

async function testSingleProfile() {
  console.log('\n=== TEST: Single Profile Authentication ===')
  setupMockServer('single-profile')

  const auth = new EMLLib.YggdrasilAuth()
  const result = await auth.authenticate('user@example.com', 'password123')

  if ('needsProfileSelection' in result) {
    console.error('❌ FAILED: Should have returned Account directly')
  } else {
    console.log('✅ PASSED: Single profile authentication')
    console.log(`   Name: ${result.name}`)
    console.log(`   UUID: ${result.uuid}`)
    console.log(`   Type: ${result.meta.type}`)
  }

  restoreFetch()
}

async function testMultiProfile() {
  console.log('\n=== TEST: Multi Profile Authentication ===')
  setupMockServer('multi-profile')

  const auth = new EMLLib.YggdrasilAuth()
  const result = await auth.authenticate('user@example.com', 'password123')

  if ('needsProfileSelection' in result) {
    console.log('✅ PASSED: Multi profile requires selection')
    console.log(`   Available profiles: ${result.availableProfiles.length}`)
    result.availableProfiles.forEach((profile: any, index: number) => {
      console.log(`   ${index}: ${profile.name} (${profile.id})`)
    })

    console.log('\n   Selecting profile: Bar')
    const selectedProfile = result.availableProfiles[1]
    
    const account = await auth.refresh(
      {
        accessToken: result.accessToken,
        clientToken: result.clientToken
      },
      {
        id: selectedProfile.id,
        name: selectedProfile.name
      }
    )

    if (account.name === 'Bar' && account.uuid === '61eac6414f9d4bebabc9c423e5fbda2d') {
      console.log('✅ PASSED: Profile selection and refresh')
      console.log(`   Name: ${account.name}`)
      console.log(`   UUID: ${account.uuid}`)
    } else {
      console.error('❌ FAILED: Wrong profile selected')
    }
  } else {
    console.error('❌ FAILED: Should have required profile selection')
  }

  restoreFetch()
}

async function testValidateRefresh() {
  console.log('\n=== TEST: Validate with Expired Token ===')
  setupMockServer('validate-expired')

  const auth = new EMLLib.YggdrasilAuth()
  
  const expiredAccount: any = {
    name: 'Foo',
    uuid: 'e0aeed8fcf394b19973c67aade59973a',
    accessToken: 'expired_token',
    clientToken: 'mock_client_token',
    availableProfiles: [],
    userProperties: [],
    meta: {
      online: false,
      type: 'yggdrasil'
    }
  }

  console.log('   Validating expired token...')
  const isValid = await auth.validate(expiredAccount)

  if (isValid === false) {
    console.log('   Token correctly identified as invalid, calling refresh()...')
    const renewed = await auth.refresh(expiredAccount)
    
    if (renewed.accessToken === 'mock_access_token_renewed') {
      console.log('✅ PASSED: Token refreshed manually')
      console.log(`   New access token: ${renewed.accessToken}`)
      console.log(`   Name: ${renewed.name}`)
    } else {
      console.error('❌ FAILED: Token was not refreshed')
    }
  } else {
    console.error('❌ FAILED: Expired token was not detected as invalid')
  }

  restoreFetch()
}

async function testDirectRefresh() {
  console.log('\n=== TEST: Direct Refresh Call ===')
  setupMockServer('validate-expired')

  const auth = new EMLLib.YggdrasilAuth()
  
  const account = await auth.refresh({
    accessToken: 'some_access_token',
    clientToken: 'some_client_token'
  })

  if (account.name === 'Foo' && account.accessToken === 'mock_access_token_renewed') {
    console.log('✅ PASSED: Direct refresh call')
    console.log(`   Name: ${account.name}`)
    console.log(`   UUID: ${account.uuid}`)
    console.log(`   New token: ${account.accessToken}`)
  } else {
    console.error('❌ FAILED: Direct refresh failed')
  }

  restoreFetch()
}

async function main() {
  console.log('====================================')
  console.log('  YGGDRASIL AUTHENTICATION TESTS')
  console.log('====================================')

  try {
    await testSingleProfile()
    await testMultiProfile()
    await testValidateRefresh()
    await testDirectRefresh()

    console.log('\n====================================')
    console.log('  ALL TESTS COMPLETED')
    console.log('====================================\n')
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error)
  }
}

main()

# Authentication Guide

This document covers the authentication systems available in the Kintare EML-Lib fork, focusing on **Kintare** and **Yggdrasil** implementations for custom Minecraft servers.

---

## Table of Contents

- [Overview](#overview)
- [Account Types](#account-types)
- [Kintare Authentication](#kintare-authentication)
  - [Setup](#kintare-setup)
  - [Device Code Flow](#device-code-flow)
  - [Validation & Refresh](#kintare-validation--refresh)
  - [Genuine Minecraft Check](#genuine-minecraft-check)
  - [Full Example](#kintare-full-example)
- [Yggdrasil Authentication](#yggdrasil-authentication)
  - [Setup](#yggdrasil-setup)
  - [Username/Password Authentication](#usernamepassword-authentication)
  - [Profile Selection](#profile-selection)
  - [Validation & Refresh](#yggdrasil-validation--refresh)
  - [Full Example](#yggdrasil-full-example)
- [Launcher Integration](#launcher-integration)
  - [Account Storage](#account-storage)
  - [Session Management](#session-management)
  - [Error Handling](#error-handling)

---

## Overview

EML-Lib supports multiple authentication providers:

| Provider | Account Type | Use Case |
|----------|--------------|----------|
| **Kintare** | `kintare` | OAuth2 Device Code flow for Kintare services |
| **Yggdrasil** | `yggdrasil` | Legacy username/password for custom auth servers |
| **Microsoft** | `msa` | Official Minecraft accounts |
| **Azuriom** | `azuriom` | Azuriom CMS integration |
| **Crack** | `crack` | Offline/demo mode (no authentication) |

This guide focuses on **Kintare** and **Yggdrasil** which are designed for custom Minecraft server networks.

---

## Account Types

All authentication methods return an `Account` object:

```typescript
interface Account {
  name: string              // Player display name
  uuid: string              // Player UUID (no dashes)
  accessToken: string       // Token for Minecraft session
  clientToken: string       // Client identifier
  refreshToken?: string     // For token renewal (Kintare only)
  availableProfiles?: YggdrasilProfile[]  // Multi-profile accounts
  userProperties: object    // Additional user data
  meta: {
    online: boolean         // true for authenticated accounts
    type: 'kintare' | 'yggdrasil' | 'msa' | 'azuriom' | 'crack'
  }
}
```

---

## Kintare Authentication

Kintare uses **OAuth2 Device Code Grant** flow, ideal for desktop applications where the user authenticates in their browser.

### Kintare Setup

```typescript
import { Kintare } from 'eml-lib'

const kintare = new Kintare({
  clientId: 'your-oauth2-client-id',
  
  // Optional: Custom scopes (defaults shown)
  scopes: [
    'offline_access',
    'Yggdrasil.PlayerProfiles.Select',
    'Yggdrasil.Server.Join',
  ],
  
  // Optional: Verify user owns genuine Minecraft
  checkGenuineMinecraft: false,
})
```

### Device Code Flow

The Device Code flow works in two steps:

1. **Request a code** - Display it to the user
2. **Poll for authorization** - Wait for user to complete login in browser

#### Method 1: Manual Control

```typescript
// Step 1: Request device code
const deviceCode = await kintare.requestDeviceCode()

// Display to user
console.log(`Go to: ${deviceCode.verification_uri}`)
console.log(`Enter code: ${deviceCode.user_code}`)

// Or use the pre-filled URL if available
if (deviceCode.verification_uri_complete) {
  console.log(`Or visit: ${deviceCode.verification_uri_complete}`)
}

// Step 2: Poll until user authorizes
const account = await kintare.pollUntilAuthorized((attempt) => {
  console.log(`Waiting for authorization... (attempt ${attempt})`)
})

console.log(`Welcome, ${account.name}!`)
```

#### Method 2: Combined (Recommended)

```typescript
const account = await kintare.authenticate(
  // Called when device code is ready
  (deviceCode) => {
    showLoginDialog({
      url: deviceCode.verification_uri,
      code: deviceCode.user_code,
      expiresIn: deviceCode.expires_in,
    })
  },
  // Called on each poll attempt (optional)
  (attempt) => {
    updateUI(`Waiting... (${attempt})`)
  }
)

hideLoginDialog()
console.log(`Logged in as ${account.name}`)
```

#### DeviceCodeResponse Structure

```typescript
interface DeviceCodeResponse {
  device_code: string           // Internal code (don't show to user)
  user_code: string             // Code to display (e.g., "ABCD-1234")
  verification_uri: string      // URL for user to visit
  verification_uri_complete?: string  // URL with code pre-filled
  expires_in: number            // Seconds until code expires
  interval: number              // Seconds between poll attempts
}
```

### Kintare Validation & Refresh

Always validate tokens on app startup and before launching Minecraft:

```typescript
async function ensureValidSession(account: Account): Promise<Account> {
  try {
    // Validate token and get fresh profile data
    // (username may have changed since last login)
    return await kintare.validate(account)
  } catch (err) {
    // Token expired or invalid - try to refresh
    console.log('Token expired, refreshing...')
    
    try {
      return await kintare.refresh(account)
    } catch (refreshErr) {
      // Refresh failed - need full re-authentication
      console.log('Refresh failed, re-authenticating...')
      throw new Error('SESSION_EXPIRED')
    }
  }
}

// Usage
try {
  account = await ensureValidSession(account)
  saveAccount(account)  // Save updated account (tokens and/or name changed)
} catch (err) {
  if (err.message === 'SESSION_EXPIRED') {
    // Show login UI
    account = await kintare.authenticate(showDeviceCode)
    saveAccount(account)
  }
}
```

#### Validation Behavior

| Scenario | Result |
|----------|--------|
| Token valid | Returns account with **fresh profile data** (name/uuid updated) |
| Token expired | **Throws error** - launcher should call `refresh()` |
| Refresh succeeds | Returns new account with fresh tokens and profile |
| Refresh fails | **Throws error** - launcher should trigger re-authentication |

### Genuine Minecraft Check

Optionally verify the user owns a legitimate Minecraft Java license:

```typescript
// Enable during setup
const kintare = new Kintare({
  clientId: 'your-client-id',
  checkGenuineMinecraft: true,  // Will throw if user doesn't own MC
})

// Or check manually
const genuine = await kintare.checkGenuine(account.accessToken)
if (genuine.verified) {
  console.log(`Verified Minecraft owner: ${genuine.uuid}`)
} else {
  console.log('User does not own Minecraft')
}
```

### Kintare Full Example

```typescript
import { Kintare, Launcher } from 'eml-lib'

// Storage helpers
const ACCOUNT_KEY = 'kintare_account'

function saveAccount(account: Account) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
}

function loadAccount(): Account | null {
  const data = localStorage.getItem(ACCOUNT_KEY)
  return data ? JSON.parse(data) : null
}

// Auth instance
const kintare = new Kintare({
  clientId: 'my-launcher-client-id',
})

// Main flow
async function getValidAccount(): Promise<Account> {
  let account = loadAccount()
  
  if (account) {
    try {
      // Validate existing session
      account = await kintare.validate(account)
      saveAccount(account)
      return account
    } catch (err) {
      // Try refresh
      try {
        account = await kintare.refresh(account)
        saveAccount(account)
        return account
      } catch {
        // Fall through to new login
      }
    }
  }
  
  // New login required
  account = await kintare.authenticate((deviceCode) => {
    // Show UI with login instructions
    document.getElementById('login-url').textContent = deviceCode.verification_uri
    document.getElementById('login-code').textContent = deviceCode.user_code
    document.getElementById('login-dialog').style.display = 'block'
  })
  
  document.getElementById('login-dialog').style.display = 'none'
  saveAccount(account)
  return account
}

// Launch game
async function launchGame() {
  const account = await getValidAccount()
  
  const launcher = new Launcher({
    serverId: 'my-server',
    url: 'https://eml.myserver.com',
    account: account,
    root: 'C:/Games/MyServer',
    memory: { min: '2G', max: '4G' },
  })
  
  await launcher.launch()
}
```

---

## Yggdrasil Authentication

Yggdrasil is the legacy Minecraft authentication protocol, used by custom auth servers like those based on [authlib-injector](https://github.com/yushijinhun/authlib-injector), in this fork, it's preconfigured with Kintare endpoints and uses Loki for services.

### Yggdrasil Setup

```typescript
import { Yggdrasil } from 'eml-lib'

const yggdrasil = new Yggdrasil()
```

> **Note:** The server URL is configured internally. For custom Yggdrasil servers, the library needs to be configured at build time.

### Username/Password Authentication

```typescript
const result = await yggdrasil.authenticate(username, password)

// Check if profile selection is needed
if ('needsProfileSelection' in result) {
  // User has multiple profiles - see Profile Selection section
  console.log('Select a profile:', result.availableProfiles)
} else {
  // Single profile - ready to use
  const account = result
  console.log(`Logged in as ${account.name}`)
}
```

### Profile Selection

Some accounts may have multiple player profiles. When `needsProfileSelection` is true, let the user choose:

```typescript
const result = await yggdrasil.authenticate(username, password)

if ('needsProfileSelection' in result) {
  // Display profile selection UI
  const profiles = result.availableProfiles
  // profiles = [{ id: 'uuid1', name: 'Player1' }, { id: 'uuid2', name: 'Player2' }]
  
  // User selects a profile...
  const selectedProfile = profiles[0]
  
  // Complete authentication with selected profile
  const account = await yggdrasil.refresh(
    { accessToken: result.accessToken, clientToken: result.clientToken },
    selectedProfile
  )
  
  console.log(`Logged in as ${account.name}`)
}
```

### Yggdrasil Validation & Refresh

```typescript
async function ensureValidSession(account: Account): Promise<Account> {
  try {
    // Validate returns same account if valid, or auto-refreshes if expired
    return await yggdrasil.validate(account)
  } catch (err) {
    // Both validate and refresh failed - need re-authentication
    throw new Error('SESSION_EXPIRED')
  }
}
```

> **Note:** Unlike Kintare, Yggdrasil's `validate()` **automatically calls refresh()** when the token is expired. This is legacy behavior for backward compatibility.

#### Logout

To invalidate the current session (recommended when user logs out):

```typescript
await yggdrasil.logout(account)
```

### Yggdrasil Full Example

```typescript
import { Yggdrasil, Launcher } from 'eml-lib'

const yggdrasil = new Yggdrasil()

// Login form handler
async function handleLogin(username: string, password: string): Promise<Account> {
  const result = await yggdrasil.authenticate(username, password)
  
  if ('needsProfileSelection' in result) {
    // Show profile picker UI
    const selectedProfile = await showProfilePicker(result.availableProfiles)
    
    return await yggdrasil.refresh(
      { accessToken: result.accessToken, clientToken: result.clientToken },
      selectedProfile
    )
  }
  
  return result
}

// Session management
async function getValidAccount(): Promise<Account> {
  let account = loadAccount()
  
  if (account) {
    try {
      // Validate (auto-refreshes if needed)
      account = await yggdrasil.validate(account)
      saveAccount(account)
      return account
    } catch {
      // Session completely invalid
    }
  }
  
  // Show login form
  const { username, password } = await showLoginForm()
  account = await handleLogin(username, password)
  saveAccount(account)
  return account
}

// Launch
async function launchGame() {
  const account = await getValidAccount()
  
  const launcher = new Launcher({
    serverId: 'my-server',
    url: 'https://eml.myserver.com',
    account: account,
    root: 'C:/Games/MyServer',
    memory: { min: '2G', max: '4G' },
  })
  
  await launcher.launch()
}
```

---

## Launcher Integration

### Account Storage

Store accounts securely. For Electron apps, consider using `electron-store` or similar:

```typescript
import Store from 'electron-store'

const store = new Store({
  encryptionKey: 'your-encryption-key',  // Encrypts sensitive data
})

function saveAccount(account: Account) {
  store.set('account', account)
}

function loadAccount(): Account | null {
  return store.get('account') as Account | null
}

function clearAccount() {
  store.delete('account')
}
```

### Session Management

Recommended flow for launcher startup:

```typescript
async function initSession(): Promise<Account | null> {
  const account = loadAccount()
  if (!account) return null
  
  const authProvider = account.meta.type === 'kintare' 
    ? new Kintare({ clientId: '...' })
    : new Yggdrasil()
  
  try {
    const validAccount = await authProvider.validate(account)
    
    // Check if profile data changed
    if (validAccount.name !== account.name || validAccount.uuid !== account.uuid) {
      console.log(`Profile updated: ${account.name} → ${validAccount.name}`)
    }
    
    saveAccount(validAccount)
    return validAccount
  } catch (err) {
    // For Kintare, try refresh explicitly
    if (account.meta.type === 'kintare' && account.refreshToken) {
      try {
        const refreshed = await (authProvider as Kintare).refresh(account)
        saveAccount(refreshed)
        return refreshed
      } catch {
        // Refresh failed
      }
    }
    
    // Session invalid - clear and return null
    clearAccount()
    return null
  }
}
```

### Error Handling

Common errors and how to handle them:

```typescript
import { EMLLibError, ErrorType } from 'eml-lib'

try {
  const account = await kintare.authenticate(showDeviceCode)
} catch (err) {
  if (err instanceof EMLLibError) {
    switch (err.code) {
      case ErrorType.AUTH_ERROR:
        // Authentication failed
        showError('Login failed. Please try again.')
        break
      case ErrorType.AUTH_CANCELLED:
        // User cancelled (closed window, etc.)
        showMessage('Login cancelled.')
        break
      default:
        showError(`Error: ${err.message}`)
    }
  } else {
    // Network or other error
    showError('Connection error. Check your internet.')
  }
}
```

---

## Comparison: Kintare vs Yggdrasil

| Feature | Kintare | Yggdrasil |
|---------|---------|-----------|
| Auth Method | OAuth2 Device Code | Username/Password |
| Password Handling | Never touches password | Sends to server |
| Refresh Tokens | ✅ Yes | ❌ No |
| Token Renewal | Manual (`refresh()`) | Auto in `validate()` |
| Profile Updates | Always fresh on validate | Only on refresh |
| Multi-Profile | Via JWT claims | Native support |
| Genuine MC Check | ✅ Optional | ❌ No |
| Browser Required | ✅ Yes (for login) | ❌ No |

---

## Security Notes

1. **Never store passwords** - Kintare never sees the password; Yggdrasil sends it to the auth server
2. **Encrypt account storage** - Access tokens are sensitive
3. **Validate on startup** - Always check token validity before using
4. **Handle session expiry gracefully** - Don't crash, prompt for re-login
5. **Use HTTPS** - All auth server URLs should use HTTPS in production

# Multi-Instance Support

EML-Lib supports multiple EML AdminTool instances from a single base URL. This allows server administrators to host multiple Minecraft server configurations on the same domain.

## URL Structure

- **Default Instance**: `https://eml.mydomain.com/` (backward compatible)
- **Named Instances**: `https://eml.mydomain.com/instances/{instanceId}/`

## Instance Types

There are two ways instances can be configured:

### 1. Config-Defined Instances (Encoded URL)

Instances defined in the launcher config with an optional password. The password is embedded in the code/config, typically used for:
- Launchers distributed with pre-configured server access
- Encoded/obfuscated launcher builds

### 2. User-Added Instances

Instances added manually by the user at runtime. The password is **not stored** in the config to prevent leaks. Used for:
- Multi-server launchers where users add their own servers
- Launchers that let users input instance credentials

## Usage

### Default Instance (Backward Compatible)

For existing configurations, simply use a string URL:

```typescript
import { Launcher } from 'eml-lib'

const launcher = new Launcher({
  url: 'https://eml.mydomain.com',
  serverId: 'minecraft',
  account: myAccount,
  // ... other options
})
```

### Named Instance (No Password Required)

For public named instances that don't require authentication:

```typescript
import { Launcher } from 'eml-lib'

const launcher = new Launcher({
  url: {
    url: 'https://eml.mydomain.com',
    instanceId: 'my-server'
  },
  serverId: 'minecraft',
  account: myAccount,
  // ... other options
})

// API calls will use: https://eml.mydomain.com/instances/my-server/api/...
```

### Config-Defined Instance with Password (Encoded)

For password-protected instances where the password is embedded in the config:

```typescript
import { Launcher } from 'eml-lib'

const launcher = new Launcher({
  url: {
    url: 'https://eml.mydomain.com',
    instanceId: 'private-server',
    password: 'secret123'  // Embedded password (for distributed launchers)
  },
  serverId: 'minecraft',
  account: myAccount,
  // ... other options
})

// The library will:
// 1. Authenticate with POST https://eml.mydomain.com/api/instances/authentication
// 2. Store the JWT token locally
// 3. Use the token for all subsequent API calls
// 4. If token expires, re-authenticate automatically using stored password
// 5. If re-auth fails, clear all instance data
```

### User-Added Instance (No Stored Password)

For instances where the user provides credentials at runtime:

```typescript
import { Launcher } from 'eml-lib'

// User adds an instance without password in config
const launcher = new Launcher({
  url: {
    url: 'https://eml.mydomain.com',
    instanceId: 'user-server'
    // NO password - user will be prompted when needed
  },
  serverId: 'minecraft',
  account: myAccount,
})

// Listen for password requests
launcher.on('instance_password_required', async ({ instanceId }) => {
  // Prompt user for password (your UI)
  const password = await showPasswordDialog(`Enter password for ${instanceId}:`)
  
  // Provide the password
  launcher.getInstanceManager()?.setPassword(password)
  
  // Retry the operation
  await launcher.launch()
})

// First launch will work if user has a valid stored token
// If token is invalid/missing, instance_password_required will fire
try {
  await launcher.launch()
} catch (error) {
  // AUTH_ERROR thrown after instance_password_required event
  // The event handler above will prompt user and retry
}
```

## Other Modules

All EML AdminTool-dependent modules support the same Instance object:

### News

```typescript
import { News } from 'eml-lib'

// Default instance
const news = new News('https://eml.mydomain.com')

// Named instance
const news = new News({
  url: 'https://eml.mydomain.com',
  instanceId: 'my-server',
  password: 'optional-password'
}, 'my-server-id')

const articles = await news.getNews()
```

### Background

```typescript
import { Background } from 'eml-lib'

// Default instance
const bg = new Background('https://eml.mydomain.com')

// Named instance
const bg = new Background({
  url: 'https://eml.mydomain.com',
  instanceId: 'my-server'
}, 'my-server-id')

const background = await bg.getBackground()
```

### Maintenance

```typescript
import { Maintenance } from 'eml-lib'

// Default instance
const maintenance = new Maintenance('https://eml.mydomain.com')

// Named instance  
const maintenance = new Maintenance({
  url: 'https://eml.mydomain.com',
  instanceId: 'my-server'
}, 'my-server-id')

const status = await maintenance.getMaintenance()
```

### Bootstraps

```typescript
import { Bootstraps } from 'eml-lib'

// Default instance
const bootstraps = new Bootstraps('https://eml.mydomain.com')

// Named instance
const bootstraps = new Bootstraps({
  url: 'https://eml.mydomain.com',
  instanceId: 'my-server'
}, 'my-server-id')

const update = await bootstraps.checkForUpdate()
```

## Authentication Flow

When using a password-protected named instance:

1. **Token Check**: The library first checks for a stored token at `.eml/instance-{instanceId}.token`
2. **Authentication**: If no token exists and password is available, sends a POST request to `/api/instances/authentication`:
   ```json
   {
     "instanceId": "my-server",
     "password": "secret123"
   }
   ```
3. **Token Storage**: The returned JWT token is stored locally for future use
4. **API Calls**: All subsequent requests include the `Authorization: Bearer <token>` header

### Token Validation & Re-authentication

If a stored token becomes invalid (401/403 response), behavior depends on password availability:

#### Config-Defined Instance (Password Available)

1. The library clears the invalid token
2. Re-authenticates using the stored password
3. If re-authentication succeeds, retries the original request
4. If re-authentication fails, **all instance data is cleared** (token + downloaded files)

#### User-Added Instance (No Password Stored)

1. The library clears the invalid token  
2. Emits `instance_password_required` event
3. Throws `AUTH_ERROR` (operation fails)
4. **Does NOT clear instance data** - waits for user to provide password
5. After user calls `setPassword()`, they can retry the operation

### Handling User-Added Instances

For launchers that allow users to add their own instances:

```typescript
const launcher = new Launcher({
  url: {
    url: userProvidedUrl,
    instanceId: userProvidedInstanceId
    // No password - will prompt user when needed
  },
  serverId: 'user-server',
  account: myAccount,
})

// Handle password prompts
launcher.on('instance_password_required', async ({ instanceId }) => {
  console.log(`Password required for instance: ${instanceId}`)
  
  // Show your password dialog
  const password = await showPasswordPrompt(instanceId)
  
  if (password) {
    // Set password and retry
    launcher.getInstanceManager()?.setPassword(password)
    await launcher.launch()
  } else {
    // User cancelled - show error
    showError('Authentication required to access this instance')
  }
})

// Handle auth failures (wrong password with retries exhausted)
launcher.on('instance_auth_failed', ({ instanceId, reason }) => {
  showError(`Authentication failed for ${instanceId}: ${reason}`)
})
```

### Auth Failure Handling (Config-Defined with Password)

When authentication fails persistently, the library:
1. Emits `instance_auth_failed` event with the reason
2. Emits `instance_clearing` event before cleanup
3. Removes the token file
4. Removes the entire server folder (all downloaded files)
5. Emits `instance_cleared` event after cleanup
6. Throws an `AUTH_ERROR`

```typescript
launcher.on('instance_auth_failed', ({ instanceId, reason }) => {
  console.error(`Auth failed for instance ${instanceId}: ${reason}`)
})

launcher.on('instance_clearing', ({ instanceId, path }) => {
  console.log(`Clearing instance data at ${path}...`)
})

launcher.on('instance_cleared', ({ instanceId, path }) => {
  console.log(`Instance data cleared. User must re-authenticate.`)
  // Show login prompt to user
})
```

## Switching Instances

The library supports hot-swapping instances using the `switchInstance()` method. This allows switching without recreating the `Launcher` instance.

### Using switchInstance() (Recommended)

```typescript
import { Launcher } from 'eml-lib'

const launcher = new Launcher({
  url: { url: 'https://eml.example.com', instanceId: 'server-1' },
  serverId: 'server-1',
  account: myAccount,
})

// Listen for instance switch events
launcher.on('instance_switched', async ({ previousInstanceId, newInstanceId, newUrl }) => {
  console.log(`Switched from ${previousInstanceId} to ${newInstanceId}`)
  
  // Reload UI data for new instance
  const news = new News({ url: newUrl, instanceId: newInstanceId }, newServerId)
  const background = new Background({ url: newUrl, instanceId: newInstanceId }, newServerId)
  
  // Update your UI
  updateNewsPanel(await news.getNews())
  updateBackground(await background.getBackground())
})

// Handle password prompts (for user-added instances)
launcher.on('instance_password_required', async ({ instanceId }) => {
  const password = await showPasswordDialog(instanceId)
  launcher.getInstanceManager()?.setPassword(password)
})

// Switch to a different instance
await launcher.switchInstance(
  { url: 'https://eml.example.com', instanceId: 'server-2' },
  'server-2'
)

// Now launch() will use the new instance
await launcher.launch()
```

### What switchInstance() Does

1. Updates internal config with new instance settings
2. Creates a new `InstanceManager` for the new instance
3. Resets Loki agent state (will be re-checked on launch)
4. Emits `instance_switched` event for your app to reload UI

### What Your App Should Do

When `instance_switched` fires, reload these components:

| Component | How to Reload |
|-----------|---------------|
| News | `new News(newInstance, serverId).getNews()` |
| Background | `new Background(newInstance, serverId).getBackground()` |
| Maintenance | `new Maintenance(newInstance, serverId).getMaintenance()` |
| Bootstraps | `new Bootstraps(newInstance, serverId)` |
| UI State | Clear previous instance data, update labels |

### Getting Current Instance

```typescript
const current = launcher.getCurrentInstance()
console.log(current.url)        // 'https://eml.example.com'
console.log(current.instanceId) // 'server-2'
console.log(current.serverId)   // 'server-2'
```

### Alternative: Creating New Launcher

If you prefer, you can still create a new `Launcher` instance:

```typescript
import { Launcher, InstanceManager } from 'eml-lib'

class MyLauncher {
  private launcher: Launcher | null = null
  private currentInstance: Instance | null = null

  async switchInstance(newInstance: Instance, serverId: string, account: Account) {
    // 1. Clean up old launcher (optional - stop any running processes)
    if (this.launcher) {
      // Remove event listeners if needed
      this.launcher = null
    }

    // 2. Create new launcher with new instance
    this.currentInstance = newInstance
    this.launcher = new Launcher({
      url: newInstance,
      serverId: serverId,
      account: account,
      // ... other options
    })

    // 3. Re-attach event listeners
    this.setupEventListeners()

    // 4. Reload UI data (news, background, maintenance, etc.)
    await this.reloadInstanceData()
  }

  private setupEventListeners() {
    this.launcher?.on('instance_password_required', ({ instanceId }) => {
      // Handle password prompt
    })
    
    this.launcher?.on('instance_auth_failed', ({ instanceId, reason }) => {
      // Handle auth failure
    })
    
    // ... other event listeners
  }

  private async reloadInstanceData() {
    if (!this.currentInstance) return

    // Reload news, background, maintenance for new instance
    const news = new News(this.currentInstance, this.serverId)
    const background = new Background(this.currentInstance, this.serverId)
    const maintenance = new Maintenance(this.currentInstance, this.serverId)

    // Update your UI with new data
    this.newsData = await news.getNews()
    this.backgroundData = await background.getBackground()
    this.maintenanceData = await maintenance.getMaintenance()
  }
}
```

### What Needs to Reload

When switching instances, your launcher should:

| Component | Action | Reason |
|-----------|--------|--------|
| `Launcher` | Create new instance | Different config, auth token |
| `News` | Reload | Instance-specific news |
| `Background` | Reload | Instance-specific background |
| `Maintenance` | Reload | Instance-specific maintenance status |
| `Bootstraps` | Reload | Instance-specific launcher updates |
| UI State | Reset | Clear previous instance data |
| Game Process | Stop (if running) | Can't hot-switch while playing |

### Multi-Instance Launcher Example

```typescript
interface ServerConfig {
  name: string
  instance: Instance
  serverId: string
}

class MultiServerLauncher {
  private servers: ServerConfig[] = []
  private activeServer: ServerConfig | null = null
  private launcher: Launcher | null = null
  private account: Account

  constructor(account: Account) {
    this.account = account
  }

  // Add a new server (user-added instance)
  addServer(name: string, url: string, instanceId: string) {
    this.servers.push({
      name,
      instance: { url, instanceId }, // No password - will prompt when needed
      serverId: instanceId
    })
  }

  // Switch to a different server
  async selectServer(serverName: string) {
    const server = this.servers.find(s => s.name === serverName)
    if (!server) throw new Error(`Server ${serverName} not found`)

    this.activeServer = server
    
    // Create new launcher for this server
    this.launcher = new Launcher({
      url: server.instance,
      serverId: server.serverId,
      account: this.account
    })

    // Setup event handlers
    this.launcher.on('instance_password_required', ({ instanceId }) => {
      this.promptForPassword(instanceId)
    })

    // Load server-specific data
    await this.loadServerData()
  }

  private async promptForPassword(instanceId: string) {
    const password = await showPasswordDialog(`Enter password for ${instanceId}`)
    if (password) {
      this.launcher?.getInstanceManager()?.setPassword(password)
    }
  }

  private async loadServerData() {
    if (!this.activeServer) return

    const news = new News(this.activeServer.instance, this.activeServer.serverId)
    const bg = new Background(this.activeServer.instance, this.activeServer.serverId)
    
    // Update UI...
  }

  async launch() {
    if (!this.launcher) throw new Error('No server selected')
    await this.launcher.launch()
  }
}

// Usage
const launcher = new MultiServerLauncher(myAccount)

// User adds servers
launcher.addServer('Public Server', 'https://eml.example.com', 'public')
launcher.addServer('Private Server', 'https://eml.example.com', 'private')

// User selects a server
await launcher.selectServer('Private Server')

// User clicks play
await launcher.launch()
```

### Important Notes

1. **Each instance has its own data folder**: Switching instances doesn't affect other instances' files
2. **Tokens are per-instance**: Each instance has its own stored JWT token
3. **Game must be stopped**: Don't switch instances while Minecraft is running
4. **Account is shared**: The Minecraft account (Microsoft/Azuriom/etc.) is typically shared across instances

## InstanceManager Class

For advanced use cases, you can use the `InstanceManager` class directly:

```typescript
import { InstanceManager, Instance } from 'eml-lib'

const instance: Instance = {
  url: 'https://eml.mydomain.com',
  instanceId: 'my-server',
  password: 'secret123'
}

const manager = new InstanceManager(instance, 'my-server-id')

// Ensure authentication
await manager.ensureAuthenticated()

// Make authenticated API calls
const loader = await manager.fetch<ILoader>('/api/loader')
const files = await manager.fetch<{ files: File[] }>('/api/files-updater')

// Build URLs for the instance
const apiUrl = manager.buildUrl('/api/news') // https://eml.mydomain.com/instances/my-server/api/news
```

## API Reference

### Instance Interface

```typescript
interface Instance {
  /**
   * The base URL of the EML AdminTool (e.g., 'https://eml.mydomain.com')
   */
  url: string
  
  /**
   * Optional instance ID for named instances.
   * When provided, URLs become: {url}/instances/{instanceId}/...
   * When omitted, uses default instance: {url}/...
   */
  instanceId?: string
  
  /**
   * Optional password for protected instances.
   * Required if the instance is password-protected.
   */
  password?: string
}
```

### Config.url Property

The `url` property in Config now accepts either:
- `string` - Simple URL for default instance (backward compatible)
- `Instance` - Object for named instances with optional authentication

## Token Management

- Tokens are stored in the EML data directory at `.eml/instance-{instanceId}.token`
- Tokens are lifetime-valid JWTs (no refresh needed)
- If a token becomes invalid:
  - **With password**: Re-authenticates automatically, clears data on failure
  - **Without password**: Emits `instance_password_required`, waits for user input
- For default instances (no instanceId), no token management is needed

### Behavior Summary

| Scenario | Token Invalid | Password Available | Result |
|----------|---------------|-------------------|--------|
| Config-defined | Yes | Yes | Re-auth → Retry or Clear all data |
| User-added | Yes | No | Emit event → Wait for `setPassword()` |
| Public instance | N/A | N/A | No auth needed |

## Instance Events

The launcher emits these events for instance authentication:

| Event | Payload | Description |
|-------|---------|-------------|
| `instance_authenticated` | `{ instanceId }` | Authentication succeeded |
| `instance_password_required` | `{ instanceId }` | Password needed (no stored password) |
| `instance_auth_failed` | `{ instanceId, reason }` | Authentication failed (about to clear data) |
| `instance_clearing` | `{ instanceId, path }` | Clearing instance data |
| `instance_cleared` | `{ instanceId, path }` | Instance data cleared |
| `instance_switched` | `{ previousInstanceId, newInstanceId, newUrl }` | Instance switched via `switchInstance()` |

## Error Handling

Authentication errors throw `EMLLibError` with type `AUTH_ERROR`:

```typescript
try {
  await launcher.launch()
} catch (error) {
  if (error instanceof EMLLibError && error.type === ErrorType.AUTH_ERROR) {
    console.error('Instance authentication failed:', error.message)
    // Handle: wrong password, instance not found, etc.
  }
}
```

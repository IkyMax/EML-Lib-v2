# EML AdminTool Required Changes

This document outlines all the features that need to be implemented in a EML AdminTool instance to be compatible with EML-Lib v2 for Kintare Services.

---

## Table of Contents

- [1. Multi-Instance Support](#1-multi-instance-support)
  - [1.1 URL Routing](#11-url-routing)
  - [1.2 Instance Authentication Endpoint](#12-instance-authentication-endpoint)
  - [1.3 Protected API Endpoints](#13-protected-api-endpoints)
- [2. Loader Endpoint Enhancements](#2-loader-endpoint-enhancements)
  - [2.1 Java Configuration](#21-java-configuration)
  - [2.2 Loki Agent Configuration](#22-loki-agent-configuration)
- [3. API Response Formats](#3-api-response-formats)
  - [3.1 Instance Manifest Endpoint](#31-instance-manifest-endpoint)
  - [3.2 Existing Endpoints](#32-existing-endpoints-no-changes)
  - [3.3 Bootstraps Files](#33-bootstraps-files)
- [4. Hytale Support](#4-hytale-support)
  - [4.1 Hytale Loader Endpoint](#41-hytale-loader-endpoint)
  - [4.2 How It Works](#42-how-it-works)
  - [4.3 Key Differences from Minecraft](#43-key-differences-from-minecraft)
  - [4.4 Hytale Files Endpoint](#44-hytale-files-endpoint)
  - [4.5 Hytale Instance Storage](#45-hytale-instance-storage)
  - [4.6 Authentication](#46-authentication)
  - [4.7 AdminTool Requirements](#47-admintool-requirements-for-hytale)

---

## 1. Multi-Instance Support

### 1.1 URL Routing

AdminTool must serve instances at different URL patterns:

| Instance Type | URL Pattern | Description |
|---------------|-------------|-------------|
| Default | `https://eml.domain.com/` | Backward compatible, single-instance |
| Named | `https://eml.domain.com/instances/{instanceId}/` | Multi-instance setup |

**Example:**
```
Default Instance:
  https://eml.domain.com/api/loader
  https://eml.domain.com/api/files
  https://eml.domain.com/api/news
  https://eml.domain.com/files/...

Named Instance (instanceId: "skyblock"):
  https://eml.domain.com/instances/skyblock/api/loader
  https://eml.domain.com/instances/skyblock/api/files
  https://eml.domain.com/instances/skyblock/api/news
  https://eml.domain.com/instances/skyblock/files/...
```

### 1.2 Instance Authentication Endpoint

**Endpoint:** `POST /api/instances/`

This endpoint authenticates users for protected instances and returns a JWT token.

**Request:**
```json
{
  "instanceId": "skyblock",
  "password": "secret-password"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Response (401/403):**
```json
{
  "success": false,
  "error": "Invalid password"
}
```

**JWT Token Requirements:**
- Token should be **lifetime valid** (no expiration) OR very long-lived
- Token payload should include `instanceId`
- Token is stored locally and reused for all subsequent requests

### 1.3 Protected API Endpoints

All API endpoints under a protected instance must:
1. Accept `Authorization: Bearer <token>` header
2. Return `401 Unauthorized` or `403 Forbidden` if token is missing/invalid
3. Include error message in response body: `"Access forbidden"` or `"Unauthorized"`

**Protected Endpoints:**
- `GET /instances/{id}/api/loader`
- `GET /instances/{id}/api/files`
- `GET /instances/{id}/api/news`
- `GET /instances/{id}/api/news/categories`
- `GET /instances/{id}/api/background`
- `GET /instances/{id}/api/maintenance`
- All file downloads under `/instances/{id}/files/...`

---

## 2. Loader Endpoint Enhancements

### 2.1 Java Configuration

**Endpoint:** `GET /api/loader` (or `/instances/{id}/api/loader`)

Add `java` field to loader response with per-OS configuration:

```json
{
  "type": "FORGE",
  "minecraftVersion": "1.20.1",
  "loaderVersion": "47.2.0",
  "format": "INSTALLER",
  "file": { ... },
  "java": {
    "windows": {
      "distribution": "adoptium",
      "majorVersion": 21,
      "args": ["-XX:+UseG1GC"]
    },
    "darwin": {
      "distribution": "corretto",
      "majorVersion": 17,
      "args": ["-XstartOnFirstThread"]
    },
    "linux": {
      "distribution": "adoptium",
      "majorVersion": 17
    }
  }
}
```

**Java Configuration Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `java.{os}` | `object` | OS-specific config (`windows`, `darwin`, `linux`) |
| `java.{os}.distribution` | `string` | Java distribution: `"mojang"`, `"adoptium"`, `"corretto"` |
| `java.{os}.majorVersion` | `number` | Force specific Java version (e.g., `17`, `21`) |
| `java.{os}.args` | `string[]` | Additional JVM arguments |

**Notes:**
- If `java` is not provided, library defaults to `"mojang"` distribution
- Each OS config is independent (no fallback between OS)
- `majorVersion` overrides the version required by Minecraft

### 2.2 Loki Agent Configuration

Kintare EML-lib fork provides a slightly modified version of [Loki](https://github.com/unmojang/Loki) to serve kintare custom services automatically without any further modification, while every server admin can enable or disable enforceSecureProfile and AccountTypes, loki gets managed direcly by kintare administrators:

```json
{
  "type": "FORGE",
  "minecraftVersion": "1.20.1",
  "loaderVersion": "47.2.0",
  "format": "INSTALLER",
  "file": { ... },
  "loki": {
    "version": "1.0.0",
    "url": "https://my-admintool.com/files/kintare-loki.jar",
    "sha1": "abc123def456...",
    "size": 12345,
    "enforceSecureProfile": true,
    "accountTypes": "default"
  }
}
```

**Loki Configuration Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `string` | ✅ | Version string for update checking |
| `url` | `string` | ✅ | Download URL for the jar file |
| `sha1` | `string` | ❌ | SHA1 hash for verification |
| `size` | `number` | ❌ | File size in bytes |
| `enforceSecureProfile` | `boolean` | ❌ | Default: `true` |
| `accountTypes` | `string` | ❌ | `"default"` or `"all"`. Default: `"default"` |

**Account Types:**
- `"default"` - Loki only applies to `kintare` and `yggdrasil` account types (skipped for `msa`, `azuriom`, `crack`)
- `"all"` - Loki applies to all account types

**Behavior:**
- Library downloads the jar and saves it as `runtime/loki/kintare-loki.jar` (filename is fixed internally)
- Library stores version in `runtime/loki/version.txt`
- If version changes, library deletes old jar and re-downloads
- Library adds JVM args: `-javaagent:path/to/kintare-loki.jar` and `-DLoki.enforce_secure_profile={value}`

---

## 3. API Response Formats

### 3.1 Instance Manifest Endpoint

**Endpoint:** `GET /api/manifest` (or `/instances/{id}/api/manifest`)

Returns instance metadata including the **game type** (Minecraft or Hytale).

**Response (Minecraft instance):**
```json
{
  "serverId": "survival",
  "name": "Survival Server",
  "gameType": "minecraft",
  "minecraftVersion": "1.20.1",
  "loaderType": "fabric",
  "loaderVersion": "0.14.21",
  "serverIp": "play.example.com:25565",
  "isProtected": false,
  "requiresAuth": true,
  "authenticated": true,
  "maintenance": false
}
```

**Response (Hytale instance):**
```json
{
  "serverId": "hytale-main",
  "name": "Hytale Server",
  "gameType": "hytale",
  "buildIndex": 5,
  "serverIp": "hytale.example.com",
  "isProtected": false,
  "requiresAuth": true,
  "authenticated": true,
  "maintenance": false
}
```

**Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `serverId` | `string` | ✅ | Unique server/instance identifier |
| `name` | `string` | ✅ | Display name |
| `gameType` | `string` | ❌ | `"minecraft"` (default) or `"hytale"` |
| `minecraftVersion` | `string` | ❌ | Minecraft version (only for Minecraft) |
| `loaderType` | `string` | ❌ | `"fabric"`, `"forge"`, `"neoforge"`, `"quilt"`, `"vanilla"` |
| `loaderVersion` | `string` | ❌ | Loader version |
| `buildIndex` | `number` | ❌ | Hytale build index (only for Hytale) |
| `serverIp` | `string` | ❌ | Server IP for status display |
| `isProtected` | `boolean` | ✅ | Password-protected instance |
| `requiresAuth` | `boolean` | ✅ | Requires game account auth |
| `authenticated` | `boolean` | ✅ | Current request is authenticated |
| `maintenance` | `boolean` | ✅ | Maintenance mode enabled |

**Notes:**
- `gameType` defaults to `"minecraft"` if not provided (backward compatible)
- Launcher uses `gameType` to determine which loader endpoint to fetch (`/api/loader` or `/api/hytale/loader`)
- For Hytale instances, `minecraftVersion` and `loaderType` are omitted
- For Minecraft instances, `buildIndex` is omitted

### 3.2 Existing Endpoints (No Changes)

These endpoints should continue to work as before:

| Endpoint | Response |
|----------|----------|
| `GET /api/news` | `{ "news": INews[] }` |
| `GET /api/news/categories` | `INewsCategory[]` |
| `GET /api/background` | `IBackground \| null` |
| `GET /api/maintenance` | `IMaintenance \| { startTime: null }` |
| `GET /api/files` | `File[]` |

### 3.3 Bootstraps Files

Bootstrap files should be served at:
```
/files/bootstraps/{os}/
  ├── latest.yml (or latest-mac.yml, latest-linux.yml)
  └── MyLauncher-Setup-1.0.0.exe (or .dmg, .AppImage)
```

Where `{os}` is `windows`, `darwin`, or `linux`.

---

## 4. Hytale Support

EML-Lib v2 supports Hytale game launching alongside Minecraft. The game is downloaded from **official Hytale CDN** using PWR patches and Butler. AdminTool provides version index information and **optional** online patches for client and server executables.

### 4.1 Hytale Loader Endpoint

**Endpoint:** `GET /api/hytale/loader` (or `/instances/{id}/api/hytale/loader`)

Returns the pinned Hytale version and **optional** patch configuration for client (per-OS) and server.

**Response (minimal - no patches):**
```json
{
  "build_index": 42
}
```

**Response (with optional patches):**
```json
{
  "build_index": 42,
  "version_type": "release",
  "windows": {
    "patch_url": "https://my-admintool.com/files/hytale/client/windows/HytaleClient-patched.exe",
    "patch_hash": "abc123def456...",
    "original_url": "https://my-admintool.com/files/hytale/client/windows/HytaleClient-original.exe",
    "original_hash": "def456abc123..."
  },
  "darwin": {
    "patch_url": "https://my-admintool.com/files/hytale/client/darwin/HytaleClient-patched",
    "patch_hash": "def789abc123...",
    "original_url": "https://my-admintool.com/files/hytale/client/darwin/HytaleClient-original",
    "original_hash": "abc789def456..."
  },
  "linux": {
    "patch_url": "https://my-admintool.com/files/hytale/client/linux/HytaleClient-patched",
    "patch_hash": "789abc123def...",
    "original_url": "https://my-admintool.com/files/hytale/client/linux/HytaleClient-original",
    "original_hash": "123def789abc..."
  },
  "server": {
    "patch_url": "https://my-admintool.com/files/hytale/server/HytaleServer-patched.jar",
    "patch_hash": "serverpatched123...",
    "original_url": "https://my-admintool.com/files/hytale/server/HytaleServer-original.jar",
    "original_hash": "serveroriginal456..."
  }
}
```

**Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `build_index` | `number` | ✅ | Hytale build version to install (pinned by admin) |
| `version_type` | `string` | ❌ | `"release"` (default) or `"pre-release"` |
| `windows` | `object` | ❌ | Windows client patch config |
| `windows.patch_url` | `string` | ✅* | URL to patched Windows client executable |
| `windows.patch_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |
| `windows.original_url` | `string` | ✅* | URL to original executable (required for updates) |
| `windows.original_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |
| `darwin` | `object` | ❌ | macOS client patch config |
| `darwin.patch_url` | `string` | ✅* | URL to patched macOS client executable |
| `darwin.patch_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |
| `darwin.original_url` | `string` | ✅* | URL to original executable (required for updates) |
| `darwin.original_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |
| `linux` | `object` | ❌ | Linux client patch config |
| `linux.patch_url` | `string` | ✅* | URL to patched Linux client executable |
| `linux.patch_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |
| `linux.original_url` | `string` | ✅* | URL to original executable (required for updates) |
| `linux.original_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |
| `server` | `object` | ❌ | Server patch config (platform-agnostic) |
| `server.patch_url` | `string` | ✅* | URL to patched server JAR |
| `server.patch_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |
| `server.original_url` | `string` | ✅* | URL to original server JAR (required for updates) |
| `server.original_hash` | `string` | ❌ | SHA256 hash (lowercase hex) for verification |

*\*Required if parent object exists*

**Why Original Files Are Required:**

When AdminTool provides patches, it must also provide the original (unpatched) executables. This ensures:
1. **Update validity**: Before applying incremental PWR updates, originals must be restored
2. **Integrity verification**: EML-Lib can verify the original matches what Hytale CDN would provide
3. **Rollback capability**: Users can restore originals if patches cause issues

### 4.2 How It Works

**Game Installation Flow:**

1. **PWR Download**: EML-Lib downloads from official Hytale CDN. Both `.pwr` and `.pwr.sig` (signature) files are downloaded:
   ```
   Fresh install: https://game-patches.hytale.com/patches/{os}/{arch}/{version_type}/0/{build_index}.pwr
   Upgrade:       https://game-patches.hytale.com/patches/{os}/{arch}/{version_type}/{current}/{next}.pwr
   Signature:     {same_url}.sig
   ```
   
   **URL Parameters:**
   - `{os}`: `windows`, `darwin`, or `linux`
   - `{arch}`: `amd64` or `arm64`
   - `{version_type}`: `release` or `pre-release`
   - `{current}`: Current installed build (or `0` for fresh install)
   - `{next}`: Next build number (updates are LINEAR: 5→6, then 6→7)

2. **PWR Application**: Uses [Butler](https://itchio.itch.io/butler) with staging and signature validation:
   - `butler apply --staging-dir staging/ --signature pwr.sig pwr game/`
   - PWR is applied to `game/` subfolder (separate from instance root)
   - Signature validation ensures patch integrity
   - PWR contains:
   ```
   game/
     Client/
       HytaleClient.exe    # Windows
       HytaleClient        # macOS/Linux
     Server/
       HytaleServer.jar    # Cross-platform
   ```

3. **JRE Installation**: Downloaded from official Hytale servers:
   ```
   https://launcher.hytale.com/version/release/jre.json
   ```

4. **Online Patches (Optional)**: If AdminTool provides patch config for current OS:
   - Downloads patched executables from AdminTool
   - Backs up original executables to `instance/.eml-online-patch/` (outside game folder)
   - Swaps executables

**Update Flows:**

| Scenario | Action |
|----------|--------|
| **Upgrade** (target > current) | Restore originals → Apply LINEAR updates (5→6→7, not 5→7) with signature validation → Re-apply patches |
| **Downgrade** (target < current) | Delete `game/` folder → Fresh install from `/0/{target}.pwr` → Apply patches |
| **Same version** | No PWR download → Ensure online patches are applied |

**Linear Updates:**
Updates must be applied sequentially. To update from build 5 to build 8:
1. Download & apply `5/6.pwr` (with `5/6.pwr.sig`)
2. Download & apply `6/7.pwr` (with `6/7.pwr.sig`)
3. Download & apply `7/8.pwr` (with `7/8.pwr.sig`)

### 4.3 Key Differences from Minecraft

| Aspect | Minecraft | Hytale |
|--------|-----------|--------|
| Game Source | Mojang/Microsoft servers | Hytale CDN (PWR format via Butler) |
| Update Method | Download specific version JARs | LINEAR incremental PWR (`/{n}/{n+1}.pwr`) with signature validation |
| Java | Custom JRE per version | Bundled Hytale JRE (shared across instances) |
| Online Patches | Not needed | **Optional** client + server swap |
| Server | Separate JAR download | Included in same PWR as `Server/` folder |
| Executable | `java -jar minecraft.jar` | Native `game/Client/HytaleClient.exe` (Windows) |
| Instance Files | Root folder (mods/, config/, etc.) | `UserData/Mods/` |
| File Types | Any (mods, configs, resources, etc.) | Any (same as Minecraft) |

### 4.4 Hytale Files Endpoint

Hytale uses the **same `/api/files` endpoint** as Minecraft - no separate endpoint needed.

Files are downloaded to `UserData/Mods/` folder instead of the instance root.

**Notes:**
- Same endpoint, same response format as Minecraft
- `path` is relative to `UserData/Mods/` (empty string = root of Mods folder)
- Any file type is supported (same as Minecraft)
- Folder name is case-sensitive: `Mods` (capital M)
- **Uses the shared `Downloader` class** - same download logic as Minecraft files

### 4.5 Hytale Instance Storage

Hytale instances are stored alongside Minecraft instances in the same server folder:

```
{serverFolder}/
  instances/
    {instanceId}/                  # Same folder for all game types
      game/                        # Game files (PWR applied here)
        Client/                    # Client files from PWR
          HytaleClient.exe         # Client executable (Windows)
          HytaleClient             # Client executable (macOS/Linux)
        Server/                    # Server files from PWR
          HytaleServer.jar
      .eml-online-patch/           # Patch state (at instance level, NOT inside game/)
        original_HytaleClient.exe  # Original backup
        patched_HytaleClient.exe   # Patched backup
        original_HytaleServer.jar
        patched_HytaleServer.jar
        state.json                 # Patch state
      staging/                     # Butler staging directory
      UserData/                    # User data directory
        Mods/                      # Downloaded files from AdminTool
          example-mod.jar
          configs/
            config.json
      install.json                 # Installation manifest
  runtime/
    butler/                        # Butler tool (shared)
      butler.exe
    hytale-jre/                    # Hytale JRE (shared across all instances)
      bin/
        java.exe
    jre-{version}/                 # Minecraft JREs (shared)
```

**install.json Schema:**
```json
{
  "build_index": 42,
  "version_type": "release",
  "installedAt": "2026-01-24T10:30:00Z",
  "jreVersion": "25.0.1_8",
  "serverInstalled": true,
  "clientPatch": {
    "url": "https://eml.example.com/files/HytaleClient.exe",
    "hash": "abc123...",
    "appliedAt": "2026-01-24T10:31:00Z"
  },
  "serverPatch": {
    "url": "https://eml.example.com/files/HytaleServer.jar",
    "hash": "def456...",
    "appliedAt": "2026-01-24T10:31:00Z"
  }
}
```

The manifest tracks patch state to avoid re-applying patches on launcher restart.

### 4.6 Authentication

- Hytale uses **Kintare accounts** with `auth:launcher` scope
- Session tokens fetched from `https://sesh.kintare.studio/game-session/new` at launch
- Non-Kintare accounts play in offline mode

### 4.7 AdminTool Requirements for Hytale

1. **Track Build Index**: Admin UI to pin specific Hytale build versions

2. **Host Executables (Required if patches are used)**:
   - **Original files** (from Hytale CDN for current build_index):
     - Windows client: `HytaleClient.exe` (~50MB)
     - macOS client: `HytaleClient` (~50MB)
     - Linux client: `HytaleClient` (~50MB)
     - Server JAR: `HytaleServer.jar` (~50MB)
   - **Patched files** (modified by admin):
     - Patched versions of the above files

3. **Generate Hashes (Recommended)**: Compute SHA256 for both patched AND original files (client and server)

4. **Keep Files In Sync**: When changing `build_index`, update both original and patched files to match the new version. Original files must match what Hytale CDN provides for that build.

5. **Files Endpoint**: Use existing `/api/files` endpoint (same as Minecraft) - files are placed in `UserData/Mods/`

---

## Summary Checklist

### High Priority (Required for v2)

- [ ] **Multi-Instance URL Routing** - Serve named instances at `/instances/{id}/`
- [ ] **Instance Auth Endpoint** - `POST /api/instances/` with JWT response
- [ ] **Protected Endpoints** - Accept Bearer token, return 401/403 on failure

### Medium Priority (Enhanced Features)

- [ ] **Java Config in Loader** - Per-OS Java distribution, version, args
- [ ] **Loki Config in Loader** - Version, URL, SHA1, enforceSecureProfile

### Hytale Support (New)

- [ ] **Hytale Loader Endpoint** - `GET /api/hytale/loader` with build_index (required) and optional patches
- [ ] **Hytale Files** - Uses existing `/api/files` endpoint (files go to `UserData/Mods/`)
- [ ] **Build Index Management** - Admin UI to pin specific Hytale build versions
- [ ] **Original Files (Required if patches used)** - Host unpatched client/server executables from Hytale CDN
- [ ] **Patched Files (Optional)** - Host patched client/server executables
- [ ] **Hash Generation (Recommended)** - Compute SHA256 for patched AND original files

---

## Migration Notes

### Backward Compatibility

- Default instances (no `instanceId`) work exactly as before
- All existing endpoints remain unchanged
- New fields (`java`, `loki`) in loader response are optional

### Security Considerations

1. **Instance Passwords** - Should be hashed in database (bcrypt recommended)
2. **JWT Tokens** - Use strong secret key, consider `HS256` or `RS256`
3. **Protected Files** - Ensure file downloads also require authentication
4. **Rate Limiting** - Consider rate limiting `/api/instances/` endpoint

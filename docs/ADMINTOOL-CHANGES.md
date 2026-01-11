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

### 3.1 Existing Endpoints (No Changes)

These endpoints should continue to work as before:

| Endpoint | Response |
|----------|----------|
| `GET /api/news` | `{ "news": INews[] }` |
| `GET /api/news/categories` | `INewsCategory[]` |
| `GET /api/background` | `IBackground \| null` |
| `GET /api/maintenance` | `IMaintenance \| { startTime: null }` |
| `GET /api/files` | `File[]` |

### 3.2 Bootstraps Files

Bootstrap files should be served at:
```
/files/bootstraps/{os}/
  ├── latest.yml (or latest-mac.yml, latest-linux.yml)
  └── MyLauncher-Setup-1.0.0.exe (or .dmg, .AppImage)
```

Where `{os}` is `windows`, `darwin`, or `linux`.

---

## Summary Checklist

### High Priority (Required for v2)

- [ ] **Multi-Instance URL Routing** - Serve named instances at `/instances/{id}/`
- [ ] **Instance Auth Endpoint** - `POST /api/instances/` with JWT response
- [ ] **Protected Endpoints** - Accept Bearer token, return 401/403 on failure

### Medium Priority (Enhanced Features)

- [ ] **Java Config in Loader** - Per-OS Java distribution, version, args
- [ ] **Loki Config in Loader** - Version, URL, SHA1, enforceSecureProfile

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

# Java Implementation Guide

This document explains how Java management works in EML-Lib v2 and how launcher developers should implement Java-related features.

## Table of Contents

- [Overview](#overview)
- [Auto-Managed Java (Recommended)](#auto-managed-java-recommended)
- [Java Distributions](#java-distributions)
- [AdminTool Configuration](#admintool-configuration)
  - [Per-OS Settings](#per-os-settings)
  - [Major Version Override](#major-version-override)
  - [Kintare Loki Java Agent](#kintare-loki-java-agent)
- [Custom Java Installation](#custom-java-installation)
- [Events](#events)
- [Priority Order](#priority-order)
- [Example Implementations](#example-implementations)
- [Java Version Mapping](#java-version-mapping)
- [Backward Compatibility](#backward-compatibility)

---

## Overview

EML-Lib v2 provides automatic Java management with support for multiple distributions. The library can:

- Automatically determine the correct Java version for each Minecraft version
- Download and install Java from multiple sources (Mojang, Adoptium, Corretto)
- Discover existing Java installations on the system
- Support server-side configuration via AdminTool
- Allow users to override with custom Java installations

## Auto-Managed Java (Recommended)

By default, the library handles everything automatically:

```typescript
import { Launcher } from 'eml-lib'

const launcher = new Launcher({
  serverId: 'my-server',
  account: playerAccount,
  url: 'https://my-admintool.com'
  // java config is optional - defaults to auto + mojang
})

await launcher.launch()
// Java is automatically downloaded if needed
```

### Default Behavior

| Setting | Default Value |
|---------|---------------|
| `java.install` | `'auto'` |
| `java.distribution` | `'mojang'` |

## Java Distributions

Three distributions are supported:

| Distribution | Description | Best For |
|--------------|-------------|----------|
| `'mojang'` | Official Mojang runtime | Vanilla Minecraft, guaranteed compatibility |
| `'adoptium'` | Eclipse Temurin (Adoptium) | Community standard, good performance |
| `'corretto'` | Amazon Corretto | Enterprise stability, long-term support |

### Mojang (Default)

- Downloads from Mojang's official servers
- Trusted source, no hash verification needed
- Recommended for vanilla/official experience

### Adoptium & Corretto

- First attempts to discover existing Java installations on the system
- Only downloads if no compatible version is found
- Does not provide Java 5/6, uses Java 8 as minimum

## AdminTool Configuration

Server administrators can configure Java settings per-OS via AdminTool's `/api/loader` endpoint:

```json
{
  "java": {
    "windows": {
      "distribution": "adoptium",
      "args": ["-XX:+UseG1GC"],
      "majorVersion": 21
    },
    "darwin": {
      "distribution": "corretto",
      "args": ["-XX:+UseZGC"]
    },
    "linux": {
      "distribution": "adoptium"
    }
  },
  "loki": {
    "version": "1.0.0",
    "url": "https://my-admintool.com/files/kintare-loki.jar",
    "sha1": "abc123def456...",
    "size": 12345
  }
}
```

### Per-OS Settings

| Field | Type | Description |
|-------|------|-------------|
| `distribution` | `'mojang' \| 'adoptium' \| 'corretto'` | Java distribution to use |
| `args` | `string[]` | Additional JVM arguments |
| `majorVersion` | `number` | Override Java version (ignores MC requirements) |

### Major Version Override

The `majorVersion` field forces a specific Java version regardless of Minecraft's requirements:

```json
{
  "java": {
    "windows": {
      "distribution": "adoptium",
      "majorVersion": 21
    }
  }
}
```

This is useful when:
- Testing newer Java versions with older Minecraft
- Forcing a specific version for mod compatibility
- Standardizing Java across all Minecraft versions

**Without override:** MC 1.16.5 → Java 8, MC 1.21 → Java 21  
**With `majorVersion: 21`:** All versions → Java 21

### Kintare Loki Java Agent

The `loki` configuration enables the Kintare Loki Java agent for secure profile enforcement.

**Important:** Loki only applies to **Kintare** or **Yggdrasil** account types. It is automatically skipped for Microsoft (`msa`), Azuriom (`azuriom`), or Crack (`crack`) accounts.

When configured:

1. **Account Check**: Verifies account type is `kintare` or `yggdrasil`
2. **Download**: Downloads `kintare-loki.jar` to `runtime/loki/`
3. **Versioning**: If version changes, old jar is deleted and new one downloaded
4. **JVM Args**: Automatically adds:
   - `-javaagent:path/to/kintare-loki.jar`
   - `-DLoki.enforce_secure_profile=true` (or `false` based on config)

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Version string (e.g., "1.0.0"). Change triggers update. |
| `url` | `string` | URL to download kintare-loki.jar |
| `sha1` | `string?` | Optional SHA1 hash for verification |
| `size` | `number?` | Optional file size in bytes |
| `enforceSecureProfile` | `boolean?` | Whether to enforce secure profile (default: `true`) |

**Example:**

```json
{
  "loki": {
    "version": "1.0.0",
    "url": "https://my-admintool.com/files/kintare-loki.jar",
    "enforceSecureProfile": true
  }
}
```

The version is stored in `runtime/loki/version.txt`. When AdminTool serves a new version, the launcher:
1. Detects version mismatch
2. Deletes existing `kintare-loki.jar`
3. Downloads new version
4. Updates `version.txt`

## Custom Java Installation

Users can bypass all automatic management by providing a custom Java path.

### Launcher Config

```typescript
const launcher = new Launcher({
  serverId: 'my-server',
  account: playerAccount,
  java: {
    install: 'manual',  // Skip auto-download
    absolutePath: 'C:/Users/Player/custom-java/bin/java.exe'
  }
})
```

### What Gets Bypassed

When `absolutePath` is set:
- ✅ AdminTool distribution settings
- ✅ Mojang/Adoptium/Corretto downloads
- ✅ Java version checks
- ✅ Java discovery

The launcher uses whatever executable is at that path directly.

### Platform-Specific Paths

The `absolutePath` is **not translated** across platforms. Each OS needs its own path:

| OS | Example Path |
|----|--------------|
| Windows | `C:\Program Files\Java\jdk-21\bin\java.exe` |
| macOS | `/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java` |
| Linux | `/usr/lib/jvm/java-21-openjdk/bin/java` |

## Events

The library emits progress events during Java download and installation:

### Download Events

```typescript
launcher.on('java_download_start', (data) => {
  console.log(`Downloading Java: ${data.totalFiles} files, ${data.totalSize} bytes`)
})

launcher.on('java_download_progress', (data) => {
  console.log(`Download progress: ${data.percentage}%`)
  // data: { downloadedFiles, totalFiles, downloadedSize, totalSize, percentage }
})

launcher.on('java_download_end', () => {
  console.log('Download complete')
})
```

### Installation Events

```typescript
launcher.on('java_install_start', (data) => {
  console.log(`Installing Java: ${data.totalFiles} files`)
})

launcher.on('java_install_progress', (data) => {
  console.log(`Install progress: ${data.percentage}%`)
  // data: { installedFiles, totalFiles, percentage }
})

launcher.on('java_install_end', () => {
  console.log('Installation complete')
})
```

### Discovery Events

```typescript
launcher.on('java_discovered', (data) => {
  console.log(`Found ${data.count} Java installations`)
  if (data.best) {
    console.log(`Best match: ${data.best.version} at ${data.best.path}`)
  }
})
```

### Loki Agent Events

```typescript
// Check started
launcher.on('loki_check', (data) => {
  console.log(`Checking Loki agent: v${data.version}`)
})

// Version change detected
launcher.on('loki_update', (data) => {
  console.log(`Updating Loki: ${data.oldVersion} -> ${data.newVersion}`)
})

// Download started
launcher.on('loki_download_start', (data) => {
  console.log(`Downloading Loki v${data.version}`)
})

// Download complete
launcher.on('loki_download_end', (data) => {
  console.log(`Loki downloaded: ${data.path}`)
})

// Agent ready (up-to-date or just downloaded)
launcher.on('loki_ready', (data) => {
  console.log(`Loki ready: v${data.version} at ${data.path}`)
})
```

## Priority Order

### Distribution Priority

1. **Local config** (`config.java.distribution`) - User preference in launcher
2. **AdminTool per-OS** (`loader.java.windows.distribution`) - Server admin setting
3. **Default** (`'mojang'`) - Fallback

### Java Version Priority

1. **AdminTool `majorVersion`** - Forced override from server
2. **Minecraft manifest** - Required version from game

### Path Priority

1. **`absolutePath`** - Complete override, skips everything
2. **`relativePath`** - Custom path relative to game folder
3. **Default** - `runtime/jre-{version}/bin/java`

## Example Implementations

### Basic Launcher (Auto Everything)

```typescript
const launcher = new Launcher({
  serverId: 'my-server',
  account: playerAccount,
  url: 'https://my-admintool.com'
})

launcher.on('java_download_progress', ({ percentage }) => {
  updateProgressBar(percentage)
})

await launcher.launch()
```

### Launcher with Distribution Choice

```typescript
// User selects distribution in settings
const userDistribution = settings.get('javaDistribution') // 'mojang' | 'adoptium' | 'corretto'

const launcher = new Launcher({
  serverId: 'my-server',
  account: playerAccount,
  url: 'https://my-admintool.com',
  java: {
    distribution: userDistribution
  }
})
```

### Launcher with Custom Java Toggle

```typescript
// UI has checkbox: "Use custom Java installation"
const useCustomJava = settings.get('useCustomJava')
const customJavaPath = settings.get('customJavaPath')

const launcher = new Launcher({
  serverId: 'my-server',
  account: playerAccount,
  url: 'https://my-admintool.com',
  java: useCustomJava 
    ? { install: 'manual', absolutePath: customJavaPath }
    : { install: 'auto' }  // Let library handle it
})
```

### Full-Featured Settings UI

```typescript
interface JavaSettings {
  mode: 'auto' | 'custom'
  distribution: 'mojang' | 'adoptium' | 'corretto'
  customPath: string
}

function buildJavaConfig(settings: JavaSettings) {
  if (settings.mode === 'custom') {
    return {
      install: 'manual' as const,
      absolutePath: settings.customPath
    }
  }
  
  return {
    install: 'auto' as const,
    distribution: settings.distribution
  }
}

// In your launcher
const launcher = new Launcher({
  serverId: 'my-server',
  account: playerAccount,
  url: 'https://my-admintool.com',
  java: buildJavaConfig(userJavaSettings)
})
```

### Displaying Current Java Path

```typescript
// Show user what Java will be used (for settings UI)
function getJavaDisplayPath(config: Config): string {
  if (config.java?.absolutePath) {
    return config.java.absolutePath  // Custom path
  }
  
  if (config.java?.relativePath) {
    return path.join(getServerFolder(config.serverId), config.java.relativePath)
  }
  
  // Default auto-managed path
  const javaVersion = Java.getRequiredJavaVersion(config.minecraft?.version || 'latest')
  return path.join(
    getServerFolder(config.serverId),
    'runtime',
    `jre-${javaVersion}`,
    'bin',
    process.platform === 'win32' ? 'javaw.exe' : 'java'
  )
}
```

---

## Java Version Mapping

The library automatically determines Java version based on Minecraft version:

| Minecraft Version | Java Version |
|-------------------|--------------|
| 26.1+ (since 26.1 Snapshot 1) | Java 25 |
| 1.20.5 - 1.21.x (24w14a - 25w52a) | Java 21 |
| 1.18 - 1.20.4 (1.18-pre2 - 24w13a) | Java 17 |
| 1.17 - 1.17.1 (21w19a - 1.18-pre1) | Java 16 |
| 1.0 - 1.16.5 (older) | Java 8 |

Use `Java.getRequiredJavaVersion(mcVersion)` to get the required version programmatically:

```typescript
import Java from 'eml-lib/lib/java/java'

Java.getRequiredJavaVersion('1.21')    // 21
Java.getRequiredJavaVersion('1.20.4')  // 17
Java.getRequiredJavaVersion('1.16.5')  // 8
Java.getRequiredJavaVersion('26.1')    // 25
```

---

## Backward Compatibility

### Original EMLAdminTool

Kintare has a custom backend compatible with the EML AdminTool specs, so you might have to modify your EML AdminTool instance to support these features

If your AdminTool doesn't serve Java configuration, the library defaults to:
- Distribution: `'mojang'`
- Args: `[]`
- Major Version: From Minecraft manifest

No changes required - it just works.


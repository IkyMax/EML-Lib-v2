export interface MinecraftManifest {
  arguments?: {
    game: (string | Argument)[]
    jvm: (string | Argument)[]
  }
  assetIndex: {
    id: string
    sha1: string
    size: number
    totalSize: number
    url: string
  }
  assets: string
  complianceLevel: number
  downloads: {
    client: {
      sha1: string
      size: number
      url: string
    }
    client_mappings?: {
      sha1: string
      size: number
      url: string
    }
    server: {
      sha1: string
      size: number
      url: string
    }
    server_mappings?: {
      sha1: string
      size: number
      url: string
    }
  }
  id: string
  javaVersion?: {
    component: string
    majorVersion: number
  }
  libraries: {
    downloads: {
      artifact?: Artifact
      classifiers?: {
        'natives-linux'?: Artifact
        'natives-osx'?: Artifact
        'natives-windows'?: Artifact
        'natives-windows-32'?: Artifact
        'native-windows-64'?: Artifact
      }
    }
    extract?: { exclude: string[] }
    name?: string
    natives?: { windows?: string; osx?: string; linux?: string }
    rules: { action: 'allow' | 'disallow'; os?: { name: 'windows' | 'osx' | 'linux' } }[]
    /**
     * Old Forge only.
     */
    url?: string
    /**
     * Old Forge only.
     */
    clientreq?: boolean
    serverreq?: boolean
  }[]
  logging: {
    client: {
      argument: string
      file: {
        id: string
        sha1: string
        size: number
        url: string
      }
      type: string
    }
  }
  mainClass: string
  minecraftArguments?: string
  minimumLauncherVersion: number
  releaseTime: string
  time: string
  type: string
  processArguments?: string
}

export interface Artifact {
  path?: string
  sha1: string
  size: number
  url: string
}

export interface Assets {
  objects: {
    [key: string]: {
      hash: string
      size: number
    }
  }
}

export interface Argument {
  rules: { action: 'allow' | 'disallow'; features: { [key: string]: boolean } }[]
  value: string | string[]
}

/**
 * Instance manifest containing server metadata.
 * Returned by GET /api/manifest
 */
export interface IInstanceManifest {
  /** Server/instance ID */
  serverId: string
  
  /** Display name of the server/instance */
  name: string
  
  /** Game type - defaults to 'minecraft' for backward compatibility */
  gameType?: 'minecraft' | 'hytale'
  
  /** Minecraft version (e.g., "1.20.1") - only for Minecraft instances */
  minecraftVersion?: string
  
  /** Mod loader type (e.g., "fabric", "forge", "vanilla") - only for Minecraft instances */
  loaderType?: 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'vanilla'
  
  /** Loader version (e.g., "0.14.21") - null for vanilla */
  loaderVersion?: string | null
  
  /** Hytale build index - only for Hytale instances */
  buildIndex?: number
  
  /** Server IP for status display (e.g., "play.example.com:25565") - null if not public */
  serverIp?: string | null
  
  /** Whether the instance is password-protected */
  isProtected: boolean
  
  /** Whether the instance requires Minecraft account authentication */
  requiresAuth: boolean
  
  /** Whether the current request is authenticated (has valid token) */
  authenticated: boolean
  
  /** Whether maintenance mode is enabled */
  maintenance: boolean
}

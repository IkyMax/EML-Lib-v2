export interface LauncherEvents {
  launch_compute_download: []
  launch_download: [
    {
      /**
       * The total size/amount of files to download.
       *
       * `total` parameter of `download_progress` event will be specific for each "type" of files:
       * Java, modpack, libraries and natives, and finally assets.
       */
      total: { amount: number; size: number }
    }
  ]
  launch_install_loader: [
    {
      type: 'VANILLA' | 'FORGE'
      minecraftVersion: string
      loaderVersion: string | null
      format: 'INSTALLER' | 'UNIVERSAL' | 'CLIENT'
    }
  ]
  launch_copy_assets: []
  launch_extract_natives: []
  launch_patch_loader: []
  launch_check_java: []
  launch_check_loki: []
  launch_clean: []
  launch_launch: [{ version: string; type: 'VANILLA' | 'FORGE'; loaderVersion: string | null }]
  launch_data: [string]
  launch_close: [number]
  launch_debug: [string]
}

export interface LokiEvents {
  /**
   * Emitted when Loki agent check starts.
   */
  loki_check: [{ version: string }]
  /**
   * Emitted when Loki agent needs to be updated (version changed).
   */
  loki_update: [{ oldVersion: string | null; newVersion: string }]
  /**
   * Emitted when Loki agent download starts.
   */
  loki_download_start: [{ version: string; size?: number }]
  /**
   * Emitted when Loki agent download completes.
   */
  loki_download_end: [{ version: string; path: string }]
  /**
   * Emitted when Loki agent is ready (already up-to-date or just downloaded).
   */
  loki_ready: [{ version: string; path: string }]
}

export interface FilesManagerEvents {
  extract_progress: [{ filename: string }]
  extract_end: [{ amount: number }]
  copy_progress: [{ filename: string; dest: string }]
  copy_end: [{ amount: number }]
  copy_debug: [string]
}

export interface JavaEvents {
  java_info: [{ version: string; arch: '32-bit' | '64-bit' }]
  java_discovered: [{ count: number; best: { version: string; path: string } | null }]
  /**
   * Emitted when Java download starts.
   */
  java_download_start: [{ distribution: 'mojang' | 'adoptium' | 'corretto'; totalSize: number; majorVersion: number }]
  /**
   * Emitted during Java download with percentage progress.
   */
  java_download_progress: [{
    /** Download percentage (0-100) */
    percent: number
    /** Downloaded size in bytes */
    downloadedSize: number
    /** Total size in bytes */
    totalSize: number
    /** Download speed in bytes per second */
    speed: number
  }]
  /**
   * Emitted when Java download completes.
   */
  java_download_end: [{ totalSize: number; duration: number }]
  /**
   * Emitted when Java installation (extraction) starts.
   */
  java_install_start: [{ majorVersion: number; distribution: 'mojang' | 'adoptium' | 'corretto' }]
  /**
   * Emitted during Java installation with percentage progress.
   */
  java_install_progress: [{
    /** Installation percentage (0-100) */
    percent: number
    /** Current file being extracted */
    currentFile: string
    /** Number of files extracted */
    extractedFiles: number
    /** Total number of files to extract */
    totalFiles: number
  }]
  /**
   * Emitted when Java installation completes.
   */
  java_install_end: [{ majorVersion: number; path: string; filesExtracted: number }]
}

export interface CleanerEvents {
  clean_progress: [{ filename: string }]
  clean_error: [{ filename: string; message: Error | string }]
  clean_end: [{ amount: number }]
}

export interface PatcherEvents {
  patch_progress: [{ filename: string }]
  patch_error: [{ filename: string; message: Error | string }]
  patch_end: [{ amount: number }]
  patch_debug: [string]
}

export interface BootstrapsEvents {
  bootstraps_error: [{ message: string | Error }]
}

export interface DownloaderEvents {
  download_progress: [
    {
      total: { amount: number; size: number }
      downloaded: { amount: number; size: number }
      speed: number
      /**
       * @workInProgress Currently not working well.
       */
      type: string
    }
  ]
  download_error: [{ filename: string; type: string; message: Error | string }]
  download_end: [{ downloaded: { amount: number; size: number } }]
}

export interface InstanceEvents {
  /**
   * Emitted when instance authentication fails after retry.
   * The instance data (token, files) will be cleared.
   */
  instance_auth_failed: [{ instanceId: string | null; reason: string }]
  /**
   * Emitted when instance data is being cleared due to auth failure.
   */
  instance_clearing: [{ instanceId: string | null; path: string }]
  /**
   * Emitted when instance data has been cleared.
   */
  instance_cleared: [{ instanceId: string | null; path: string }]
  /**
   * Emitted when instance authentication succeeds.
   */
  instance_authenticated: [{ instanceId: string | null }]
  /**
   * Emitted when a password is required for authentication.
   * The launcher should prompt the user for a password and call
   * `instanceManager.setPassword()` then retry the operation.
   */
  instance_password_required: [{ instanceId: string | null }]
  /**
   * Emitted when the launcher switches to a different instance.
   * The launcher app should reload UI data (news, background, maintenance, etc.)
   */
  instance_switched: [{ 
    previousInstanceId: string | null
    newInstanceId: string | null
    newUrl: string
  }]
}


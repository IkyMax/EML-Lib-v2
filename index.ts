/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import MicrosoftAuth from './lib/auth/microsoft'
import AzAuth from './lib/auth/azuriom'
import CrackAuth from './lib/auth/crack'
import YggdrasilAuth from './lib/auth/yggdrasil'
import KintareAuth, { HYTALE_SESSION_URL, DEFAULT_SCOPES } from './lib/auth/kintare'
import type { DeviceCodeResponse } from './lib/auth/kintare'
import Bootstraps from './lib/bootstraps/bootstraps'
import Maintenance from './lib/maintenance/maintenance'
import News from './lib/news/news'
import Background from './lib/background/background'
import ServerStatus from './lib/serverstatus/serverstatus'
import Java from './lib/java/java'
import Launcher from './lib/launcher/launcher'
import Manifest from './lib/manifest/manifest'
import { InstanceManager } from './lib/utils/instance'

// Hytale support
import HytaleLauncher from './lib/launcher/hytale/launcher'
import HytaleInstaller from './lib/launcher/hytale/installer'
import HytalePatcher from './lib/launcher/hytale/patcher'
import Butler from './lib/utils/butler'
import * as HytaleChecker from './lib/launcher/hytale/checker'
import * as HytaleConstants from './lib/launcher/hytale/constants'

export type * from './types/account'
export type * from './types/background'
export type * from './types/bootstraps'
export type * from './types/config'
export type * from './types/errors'
export type * from './types/events'
export type * from './types/file'
export type * from './types/instance'
export type * from './types/java'
export type * from './types/maintenance'
export type * from './types/manifest'
export type * from './types/news'
export type * from './types/status'
export type * from './types/hytale'
export type { DeviceCodeResponse }

/**
 * Authenticate a user with Microsoft.
 *
 * **Attention!** Using this class requires Electron. Use `npm i electron` to install it.
 */
export { MicrosoftAuth }

/**
 * Authenticate a user with [Azuriom](https://azuriom.com/).
 */
export { AzAuth }

/**
 * Authenticate a user with an yggdrasil-compatible server (Based on [Authlib-Injector](https://github-com.translate.goog/yushijinhun/authlib-injector/wiki/Yggdrasil-%E6%9C%8D%E5%8A%A1%E7%AB%AF%E6%8A%80%E6%9C%AF%E8%A7%84%E8%8C%83?_x_tr_sl=zh-CN&_x_tr_tl=en&_x_tr_hl=es&_x_tr_pto=wapp) and [original yggdrasil](https://minecraft.wiki/w/Yggdrasil) specs).
 * **Attention!** While yggdrasil has been depracated by mojang, the API is maintained by a community who wants to keep the protocol alive and a migration to OIDC is on the works.
 * usage of a custom authserver may or may not violate Minecraft's Terms of Service according to this [Mojang email](https://github.com/unmojang/drasl/issues/106#issuecomment-2408930094)
 * make sure to validate your player's minecraft ownership!
 * @workInProgress
 */
export { YggdrasilAuth }

/**
 * Authenticate a user with Kintare Account Services using OAuth2 Device Code Grant.
 * 
 * This is the recommended authentication method for Kintare services. It provides
 * a user-friendly flow where users authenticate via a browser while the application
 * polls for completion.
 * 
 * @example
 * ```typescript
 * const kintare = new KintareAuth()
 * const device = await kintare.requestDeviceCode()
 * console.log(`Visit ${device.verification_uri} and enter code: ${device.user_code}`)
 * const account = await kintare.authenticate(device)
 * ```
 */
export { KintareAuth }

/**
 * Authenticate a user with a crack account.
 * @deprecated This auth method is not secure, use it only for testing purposes or for local servers!
 */
export { CrackAuth }

/**
 * Update your Launcher.
 *
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 * @workInProgress
 */
export { Bootstraps }

/**
 * Manage the Maintenance of the Launcher.
 *
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 */
export { Maintenance }

/**
 * Manage the News of the Launcher.
 *
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 */
export { News }

/**
 * Manage the background of the Launcher.
 *
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 */
export { Background }

/**
 * Get the status of a Minecraft server.
 */
export { ServerStatus }

/**
 * Fetch instance manifest containing server metadata.
 *
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 */
export { Manifest }

/**
 * Download and manage Java for Minecraft.
 * 
 * Supports multiple distributions (Mojang, Adoptium, Corretto), automatic discovery
 * of existing Java installations, and intelligent version selection based on
 * Minecraft requirements.
 * 
 * @example
 * ```typescript
 * const java = new Java('1.20.4', 'minecraft', { distribution: 'adoptium' })
 * 
 * // Discover existing Java installations
 * const existing = await java.discover()
 * 
 * // Get the best match for the Minecraft version
 * const best = await java.discoverBest()
 * 
 * // Download if needed
 * await java.download()
 * ```
 */
export { Java }

/**
 * Launch Minecraft.
 * @workInProgress
 */
export { Launcher }

/**
 * Manage EML AdminTool instances with authentication support.
 * 
 * Handles both default and named instances, with automatic JWT token
 * management for password-protected instances.
 * 
 * @example
 * ```typescript
 * // Default instance (backward compatible)
 * const manager = new InstanceManager({ url: 'https://eml.example.com' }, 'my-server')
 * 
 * // Named instance without password
 * const manager = new InstanceManager({ 
 *   url: 'https://eml.example.com', 
 *   instanceId: 'private-server' 
 * }, 'my-server')
 * 
 * // Named instance with password
 * const manager = new InstanceManager({ 
 *   url: 'https://eml.example.com', 
 *   instanceId: 'private-server',
 *   password: 'secret123'
 * }, 'my-server')
 * 
 * // Authenticate and fetch data
 * await manager.ensureAuthenticated()
 * const loader = await manager.fetch<ILoader>('/api/loader')
 * ```
 */
export { InstanceManager }

/**
 * Launch and manage Hytale game instances.
 * 
 * Orchestrates installation, JRE management, session authentication,
 * and game process lifecycle.
 * 
 * @example
 * ```typescript
 * const launcher = new HytaleLauncher('my-server')
 * 
 * launcher.on('hytale_launch_start', (data) => {
 *   console.log(`Starting Hytale build ${data.buildIndex}`)
 * })
 * 
 * await launcher.launch({
 *   instance: { id: 'main', name: 'Main Instance' },
 *   loader: loaderFromAdminTool,
 *   account: kintareAccount
 * })
 * ```
 */
export { HytaleLauncher }

/**
 * Install Hytale game files and JRE.
 * 
 * Downloads pre-patched game files from AdminTool and JRE from Hytale servers.
 */
export { HytaleInstaller }

/**
 * Manage Hytale online patch state.
 * 
 * Handles switching between patched (online-capable) and unpatched (offline) versions.
 */
export { HytalePatcher }

/**
 * Butler utility for PWR patch operations.
 * 
 * Downloads and manages the Butler tool from itch.io for delta patching.
 * Reserved for future use when delta-patching from Hytale servers is implemented.
 */
export { Butler }

/**
 * Hytale game installation checker utilities.
 */
export { HytaleChecker }

/**
 * Hytale constants and path helpers.
 */
export { HytaleConstants }

/**
 * Hytale session URL for Kintare authentication.
 */
export { HYTALE_SESSION_URL, DEFAULT_SCOPES }

/**
 * ## Electron Minecraft Launcher Lib
 * ### Create your Electron Minecraft Launcher easily.
 *
 * ---
 *
 * **Requirements:**
 * - Node.js 15.14.0 or higher: see [Node.js](https://nodejs.org/);
 * - Electron 15.0.0 or higher: please install it with `npm i electron` _if you use
 * Microsoft Authentication_.
 *
 * **Recommandations:**
 * - To get all the capacities of this Node.js library, you must set up your
 * [EML AdminTool](https://github.com/Electron-Minecraft-Launcher/EML-AdminTool-v2) website!
 * - If you don't want to use the EML AdminTool, you should rather use the
 * [Minecraft Launcher Core](https://npmjs.com/package/minecraft-launcher-core) library.
 *
 * ---
 *
 * [Wiki](https://github.com/Electron-Minecraft-Launcher/EML-Lib/wiki) —
 * [GitHub](https://github.com/Electron-Minecraft-Launcher/EML-Lib-v2) —
 * [NPM](https://www.npmjs.com/package/eml-lib) —
 * [EML Website](https://electron-minecraft-launcher.ml)
 *
 * ---
 *
 * @version 2.0.0-beta.18
 * @license MIT — See the `LICENSE` file for more information
 * @copyright Copyright (c) 2026, GoldFrite
 */
const EMLLib = {
  /**
   * Authenticate a user with Microsoft.
   *
   * **Attention!** Using this class requires Electron. Use `npm i electron` to install it.
   */
  MicrosoftAuth,

  /**
   * Authenticate a user with [Azuriom](https://azuriom.com/).
   */
  AzAuth,

  /**
   * Authenticate a user with an yggdrasil-compatible server (Based on [Authlib-Injector](https://github-com.translate.goog/yushijinhun/authlib-injector/wiki/Yggdrasil-%E6%9C%8D%E5%8A%A1%E7%AB%AF%E6%8A%80%E6%9C%AF%E8%A7%84%E8%8C%83?_x_tr_sl=zh-CN&_x_tr_tl=en&_x_tr_hl=es&_x_tr_pto=wapp) and [original yggdrasil](https://minecraft.wiki/w/Yggdrasil) specs).
   * **Attention!** While yggdrasil has been depracated by mojang, the API is maintained by a community who wants to keep the protocol alive and a migration to OIDC is on the works.
   * usage of a custom authserver may or may not violate Minecraft's Terms of Service according to this [Mojang email](https://github.com/unmojang/drasl/issues/106#issuecomment-2408930094)
   * make sure to validate your player's minecraft ownership!
   * @workInProgress
   */
  YggdrasilAuth,

  /**
   * Authenticate a user with Kintare Account Services using OAuth2 Device Code Grant.
   * This is the recommended authentication method for Kintare services.
   */
  KintareAuth,

  /**
   * Authenticate a user with a crack account.
   * @deprecated This auth method is not secure, use it only for testing purposes or for local servers!
   */
  CrackAuth,

  /**
   * Update your Launcher.
   *
   * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
   * @workInProgress
   */
  Bootstraps,

  /**
   * Manage the Maintenance of the Launcher.
   *
   * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
   */
  Maintenance,

  /**
   * Manage the News of the Launcher.
   *
   * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
   */
  News,

  /**
   * Manage the background of the Launcher.
   *
   * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
   */
  Background,

  /**
   * Get the status of a Minecraft server.
   */
  ServerStatus,

  /**
   * Fetch instance manifest containing server metadata.
   */
  Manifest,

  /**
   * Download and manage Java for Minecraft.
   * Supports multiple distributions (Mojang, Adoptium, Corretto) and automatic
   * discovery of existing Java installations.
   */
  Java,

  /**
   * Launch Minecraft.
   * @workInProgress
   */
  Launcher,

  /**
   * Manage EML AdminTool instances with authentication support.
   * Handles both default and named instances with JWT token management.
   */
  InstanceManager,

  // Hytale Support

  /**
   * Launch and manage Hytale game instances.
   * Orchestrates installation, JRE management, session authentication,
   * and game process lifecycle.
   */
  HytaleLauncher,

  /**
   * Install Hytale game files and JRE.
   * Downloads pre-patched game files from AdminTool and JRE from Hytale servers.
   */
  HytaleInstaller,

  /**
   * Manage Hytale online patch state.
   * Handles switching between patched and unpatched versions.
   */
  HytalePatcher,

  /**
   * Butler utility for PWR patch operations.
   * Reserved for future delta-patching support.
   */
  Butler,

  /**
   * Hytale game installation checker utilities.
   */
  HytaleChecker,

  /**
   * Hytale constants and path helpers.
   */
  HytaleConstants,

  /**
   * Hytale session URL for Kintare authentication.
   */
  HYTALE_SESSION_URL,

  /**
   * Default OAuth2 scopes for unified launcher (Minecraft + Hytale).
   */
  DEFAULT_SCOPES
}

export default EMLLib
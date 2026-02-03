import { Account } from './account'
import { Instance } from './instance'

export interface Config {
  /**
   * [Optional but strongly recommended!] The URL of your EML AdminTool website, where is stored your
   * modpack and loader info. If you don't set this value, the launcher will use the vanilla version
   * of Minecraft (loaders such as Forge are only available through the EML AdminTool).
   * 
   * Can be either:
   * - A string URL for the default instance (e.g., `'https://eml.mydomain.com'`)
   * - An Instance object for named instances with optional authentication
   * 
   * @example
   * // Default instance (backward compatible)
   * url: 'https://eml.mydomain.com'
   * 
   * @example
   * // Named instance without password
   * url: { url: 'https://eml.mydomain.com', instanceId: 'my-server' }
   * 
   * @example
   * // Named instance with password protection
   * url: { url: 'https://eml.mydomain.com', instanceId: 'private-server', password: 'secret123' }
   */
  url?: string | Instance
  /**
   * Your Minecraft server ID (eg. `'minecraft'`). This will be used to create the
   * server folder (eg. `.minecraft`).
   */
  serverId: string
  /**
   * [Optional] Custom root folder for all game data.
   * If set, instances will be created inside this folder.
   * Example: `'KintareLauncher'` creates `AppData/Roaming/KintareLauncher/.instanceId/`
   * If not set, instances are created directly in AppData.
   */
  root?: string
  /**
   * [Optional: default is `['runtime/', 'crash-reports/', 'logs/', 'resourcepacks/', 'resources/',
   * 'saves/', 'shaderpacks/', 'options.txt', 'optionsof.txt']`]
   * The list of paths/files to ignore when checking and cleaning the game folder, before launching
   * the Minecraft game.
   *
   * **Attention!** If you don't include `'runtime/'` in this list, the launcher will delete the
   * Java installation folder when cleaning the game folder.
   */
  cleaning?: {
    /**
     * [Optional: default is `true`]
     * Should the launcher clean the game folder before launching the Minecraft game? In most cases,
     * you should set this value to `true`. Set this value to `false` if you want to keep allow the
     * players to keep their mods, resource packs, etc., or if you want to install multiple
     * instances of Minecraft on the same game folder.
     */
    clean?: boolean
    /**
     * [Optional: default is `['runtime/', 'crash-reports/', 'logs/', 'resourcepacks/', 'resources/',
     * 'saves/', 'shaderpacks/', 'options.txt', 'optionsof.txt']`]
     * The list of paths/files to ignore when checking and cleaning the game folder, before launching
     * the Minecraft game.
     *
     * **Attention!** If you don't include `'runtime/'` in this list, the launcher will delete the
     * Java installation folder when cleaning the game folder.
     */
    ignored?: string[]
  }
  /**
   * The player account (use `MicrosoftAuth`, `AzAuth` or `CrackAuth` to get the account, but you should 
   * **not** authenticate the user directly in the `config`, to be able to handle authentication).
   */
  account: Account
  /**
   * [Optional: default is `{ version: 'latest_release', args: [] }`]
   * Minecraft configuration.
   *
   * **Attention!** Setting `minecraft.version` overrides the Minecraft version from the EML AdminTool.
   * Moreover, if you want to use a loader (like Forge), you **must** use the EML AdminTool.
   */
  minecraft?: {
    /**
     * [Optional: default is `null`]
     * The version of Minecraft you want to install. Set to `'latest_release'` to install the
     * latest release version of Minecraft, or `'latest_snapshot'` to install the latest snapshot.
     * Set to `null` or `undefined` to get the version from the EML AdminTool.
     */
    version?: string | null
    /**
     * [Optional: default is `[]`]
     * **Use this option only if you know what you are doing!** Add custom arguments to launch Minecraft.
     */
    args?: string[]
  }
  /**
   * [Optional: default automatically installs Java when calling `Launcher.launch()`]
   * Java configuration.
   */
  java?: {
    /**
     * [Optional: default is `'auto'`]
     * Should the launcher install Java automatically? `'auto'` automatically installs Java when
     * calling `Launcher.launch()`. `'manual'` does not install Java automatically. You can use
     * `Java.download()` to install Java manually.
     */
    install?: 'auto' | 'manual'
    /**
     * [Optional: default is `'mojang'`]
     * The Java distribution to download. Options:
     * - `'mojang'` - Official Mojang Java runtime (recommended for vanilla)
     * - `'adoptium'` - Eclipse Temurin (Adoptium) - good community option
     * - `'corretto'` - Amazon Corretto - stable, enterprise-grade
     * 
     * Note: Adoptium and Corretto don't provide Java 5/6, so Java 8 is used as minimum.
     */
    distribution?: 'mojang' | 'adoptium' | 'corretto'
    /**
     * [Optional: default is `undefined`]
     * The absolute path to the Java executable.
     * If you use a manual installation of Java with a custom path, you can set it here. Be careful
     * to indicate the correct path depending on the operating system of the user.
     * If you don't install Java (automatically or manually), set this value to `'java'` to use the
     * Java installed on the user's computer.
     *
     * **Attention!** This property overrides the `java.relativePath` property.
     */
    absolutePath?: string
    /**
     * [Optional: default is `'runtime/jre-X/bin/java'` where `X` is the major version of Java]
     * The path (relative to the game folder) to the Java executable.
     * If you use a manual installation of Java with a custom path, or if you don't install Java,
     * (automatically or manually) use `java.absolutePath` property instead.
     *
     * **Attention!** This property is ignored if `java.absolutePath` is set.
     */
    relativePath?: string
    /**
     * [Optional: default is `[]`]
     * **Use this option only if you know what you are doing!** Add custom arguments to Java
     * Virtual Machine (JVM).
     *
     * **Please don't try to patch [Log4j](https://help.minecraft.net/hc/en-us/articles/4416199399693-Security-Vulnerability-in-Minecraft-Java-Edition)
     * with this option!** The launcher will automatically patch Log4j if needed.
     */
    args?: string[]
  }
  /**
   * [Optional: default is a 854x480 window]
   * The Minecraft window configuration.
   */
  window?: {
    /**
     * [Optional: default is `854`]
     * The width of the Minecraft window.
     */
    width?: number
    /**
     * [Optional: default is `480`]
     * The height of the Minecraft window.
     */
    height?: number
    /**
     * [Optional: default is `false`]
     * Should the Minecraft window be fullscreen?
     */
    fullscreen?: boolean
  }
  /**
   * [Optional: default is `{ min: 1024, max: 2048 }`]
   * The memory (RAM) configuration.
   */
  memory?: {
    /**
     * [Optional: default is `512`]
     * The minimum memory (RAM), in **MB**, allocated to Minecraft.
     */
    min: number
    /**
     * [Optional: default is `1023`]
     * The maximum memory (RAM), in **MB**, allocated to Minecraft.
     */
    max: number
  }
}

export interface FullConfig {
  url: string
  instanceId: string | null
  password: string | null
  serverId: string
  root: string
  cleaning: {
    clean: boolean
    ignored: string[]
  }
  account: Account
  minecraft: {
    version: string | null
    args: string[]
  }
  java: {
    install: 'auto' | 'manual'
    distribution: 'mojang' | 'adoptium' | 'corretto'
    absolutePath: string
    args: string[]
  }
  window: {
    width: number
    height: number
    fullscreen: boolean
  }
  memory: {
    min: number
    max: number
  }
}

/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import EventEmitter from '../utils/events'
import { EMLLibError, ErrorType } from '../../types/errors'
import type { BootstrapsEvents, DownloaderEvents } from '../../types/events'
import type { AppUpdater } from 'electron-updater'
import type { IBootstraps } from '../../types/bootstraps'
import utils from '../utils/utils'
import { InstanceManager } from '../utils/instance'
import type { Instance } from '../../types/instance'

/**
 * Update your Launcher.
 *
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 *
 * **Attention!** Using this class requires Electron Updater. Use `npm i electron-updater` to use the Bootstraps feature.
 */
export default class Bootstraps extends EventEmitter<DownloaderEvents & BootstrapsEvents> {
  private readonly url: string
  private readonly instanceManager: InstanceManager | null = null
  private autoUpdater: AppUpdater | undefined

  /**
   * @param url The URL of your EML AdminTool website, or an Instance object for named instances.
   * @param serverId Optional server ID for token storage (required for Instance objects).
   */
  constructor(url: string | Instance, serverId?: string) {
    super()
    if (typeof url === 'string') {
      this.url = `${url}/files/bootstraps/${utils.getOS()}`
    } else {
      // For named instances, use the instance URL pattern
      this.instanceManager = new InstanceManager(url, serverId || 'default')
      this.url = `${this.instanceManager.buildUrl('/files/bootstraps/')}${utils.getOS()}`
    }
  }

  /**
   * Check for updates.
   * @returns The update result object if an update is available, null otherwise.
   */
  async checkForUpdate() {
    try {
      const updater = await this.getUpdater()
      const result = await updater.checkForUpdates()

      if (result && result.updateInfo.version !== updater.currentVersion.version) {
        const update = {
          updateAvailable: true,
          currentVersion: updater.currentVersion,
          latestVersion: result.updateInfo.version,
          updateInfo: {
            releaseName: result.updateInfo.releaseName ?? null,
            releaseNotes: result.updateInfo.releaseNotes ?? null,
            releaseDate: new Date(result.updateInfo.releaseDate)
          }
        } as IBootstraps
        return update
      }
      return {
        updateAvailable: false,
        currentVersion: updater.currentVersion.version,
        latestVersion: updater.currentVersion.version
      } as IBootstraps
    } catch (err: any) {
      if (err instanceof EMLLibError) throw err
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Error while checking for updates: ${err.message ?? err}`)
    }
  }

  /**
   * Download the update found by checkForUpdate.
   * @returns The path to the downloaded update.
   */
  async download() {
    try {
      const updater = await this.getUpdater()
      const downloadedFiles = await updater.downloadUpdate()

      return downloadedFiles[0] ?? ''
    } catch (err: any) {
      if (err instanceof EMLLibError) throw err
      throw new EMLLibError(ErrorType.DOWNLOAD_ERROR, `Error while downloading update: ${err.message ?? err}`)
    }
  }

  /**
   * Quit the application and install the update.
   * @param silent [Optional: default if `false`] (Windows-only) Runs the installer in silent mode.
   */
  async runUpdate(silent = false) {
    try {
      const updater = await this.getUpdater()
      updater.quitAndInstall(silent, true)
    } catch (err: any) {
      if (err instanceof EMLLibError) throw err
      throw new EMLLibError(ErrorType.EXEC_ERROR, `Error while running the installer: ${err.message ?? err}`)
    }
  }

  private async getUpdater() {
    if (this.autoUpdater) return this.autoUpdater

    try {
      const module = await import('electron-updater')
      this.autoUpdater = module.autoUpdater
    } catch {
      throw new EMLLibError(
        ErrorType.MODULE_NOT_FOUND,
        '`electron-updater` module is not installed. Please install it with `npm i electron-updater` to use the Bootstraps feature.'
      )
    }

    this.autoUpdater.autoDownload = false
    this.autoUpdater.autoInstallOnAppQuit = true
    this.autoUpdater.setFeedURL({ provider: 'generic', url: this.url })

    this.autoUpdater.on('error', (err) => {
      this.emit('bootstraps_error', { message: err.message ?? err })
    })

    this.autoUpdater.on('download-progress', (progressObj) => {
      this.emit('download_progress', {
        downloaded: { amount: 0, size: progressObj.transferred },
        total: { amount: 1, size: progressObj.total },
        speed: progressObj.bytesPerSecond,
        type: 'BOOTSTRAP'
      })
    })

    this.autoUpdater.on('update-downloaded', () => {
      this.emit('download_end', { downloaded: { amount: 1, size: -1 } })
    })

    return this.autoUpdater
  }
}


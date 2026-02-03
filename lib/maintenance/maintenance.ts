/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import { EMLLibError, ErrorType } from '../../types/errors'
import type { IMaintenance } from '../../types/maintenance'
import { InstanceManager } from '../utils/instance'
import type { Instance } from '../../types/instance'

/**
 * Manage the Maintenance of the Launcher.
 * 
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 */
export default class Maintenance {
  private readonly url: string
  private readonly instanceManager: InstanceManager | null = null

  /**
   * @param url The URL of your EML AdminTool website, or an Instance object for named instances.
   * @param serverId Optional server ID for token storage (required for Instance objects).
   */
  constructor(url: string | Instance, serverId?: string) {
    if (typeof url === 'string') {
      this.url = `${url}/api`
    } else {
      this.url = '' // Will use InstanceManager
      this.instanceManager = new InstanceManager(url, serverId || 'default')
    }
  }

  /**
   * Get the current Maintenance status from the EML AdminTool.
   * @returns `null` if there is no maintenance, otherwise it will return the maintenance status.
   */
  async getMaintenance() {
    let res: any
    
    if (this.instanceManager) {
      await this.instanceManager.ensureAuthenticated()
      res = await this.instanceManager.fetch<any>('/api/maintenance')
    } else {
      res = await fetch(`${this.url}/maintenance`, { method: 'GET' })
        .then((res) => res.json())
        .catch((err) => {
          throw new EMLLibError(ErrorType.FETCH_ERROR, `Error while fetching Maintenance from the EML AdminTool: ${err}`)
        })
    }

    if (res.startTime) return res as IMaintenance
    else return null
  }
}

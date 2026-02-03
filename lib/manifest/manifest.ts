/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import { EMLLibError, ErrorType } from '../../types/errors'
import type { IInstanceManifest } from '../../types/manifest'
import { InstanceManager } from '../utils/instance'
import type { Instance } from '../../types/instance'

/**
 * Fetch instance manifest containing server metadata.
 * 
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 */
export default class Manifest {
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
   * Get the instance manifest from the EML AdminTool.
   * @returns The instance manifest.
   */
  async getManifest(): Promise<IInstanceManifest> {
    if (this.instanceManager) {
      await this.instanceManager.ensureAuthenticated()
      return await this.instanceManager.fetch<IInstanceManifest>('/api/manifest')
    }

    let res = await fetch(`${this.url}/manifest`, { method: 'GET' })
      .then((res) => res.json())
      .catch((err) => {
        throw new EMLLibError(ErrorType.FETCH_ERROR, `Error while fetching Manifest from the EML AdminTool: ${err}`)
      })

    return res as IInstanceManifest
  }
}

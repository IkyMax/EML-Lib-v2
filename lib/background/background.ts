/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import { EMLLibError, ErrorType } from '../../types/errors'
import type { IBackground } from '../../types/background'
import { InstanceManager } from '../utils/instance'
import type { Instance } from '../../types/instance'

/**
 * Manage the background of the Launcher.
 *
 * **Attention!** This class only works with the EML AdminTool. Please do not use it without the AdminTool.
 */
export default class Background {
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
   * Get the current background from the EML AdminTool.
   * @returns The current Background object, or `null` if no background is set.
   */
  async getBackground() {
    try {
      if (this.instanceManager) {
        await this.instanceManager.ensureAuthenticated()
        const res = await this.instanceManager.fetch<IBackground>('/api/background')
        return res ?? null
      }

      const req = await fetch(`${this.url}/background`)
      
      if (!req.ok) {
        const errorText = await req.text()
        throw new EMLLibError(ErrorType.FETCH_ERROR, `Error while fetching background: HTTP ${req.status} ${errorText}`)
      }
      const data: IBackground | null = await req.json()

      return data ?? null
    } catch (err: unknown) {
      if (err instanceof EMLLibError) throw err
      throw new EMLLibError(ErrorType.FETCH_ERROR, `Error while fetching background: ${err instanceof Error ? err.message : err}`)
    }
  }
}

/**
 * @license MIT
 * @copyright Copyright (c) 2025, IkyMax
 */

import type { Account } from '../../types/account'
import type { YggdrasilProfile } from '../../types/account'
import { EMLLibError, ErrorType } from '../../types/errors'
import { v4 } from 'uuid'

/**
 * Authenticate a user with an yggdrasil-compatible server (Based on [Authlib-Injector](https://github-com.translate.goog/yushijinhun/authlib-injector/wiki/Yggdrasil-%E6%9C%8D%E5%8A%A1%E7%AB%AF%E6%8A%80%E6%9C%AF%E8%A7%84%E8%8C%83?_x_tr_sl=zh-CN&_x_tr_tl=en&_x_tr_hl=es&_x_tr_pto=wapp) and [original yggdrasil](https://minecraft.wiki/w/Yggdrasil) specs).
 * this is a slightly modified version for Kintare compatibility.
 */
export default class Yggdrasil {
  /** Kintare Yggdrasil Server URL */
  private static readonly BASE_URL = 'https://authserver.kintare.studio'

  /**
   * Creates a new Yggdrasil authentication instance.
   */
  constructor() {}


  /**
   * Authenticate a user with Yggdrasil.
   * @param username The username, email or player name of the user.
   * @param password The password of the user.
   * in the future, this method is going to be superseded by an OIDC flow
   * @returns The account information.
   */
  
  async authenticate(username: string, password: string): Promise<Account | { needsProfileSelection: true; availableProfiles: YggdrasilProfile[]; accessToken: string; clientToken: string }> {
    const res = await fetch(`${Yggdrasil.BASE_URL}/authenticate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent: { name: 'Minecraft', version: 1 },
        username: username,
        password: password,
        clientToken: v4(),
        requestUser: true
      })
    }).then((res: any) => res.json())

    if (res.status == 'error') {
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Yggdrasil authentication failed: ${res.reason}`)
    }

    if (!res.selectedProfile) {
      return {
        needsProfileSelection: true,
        availableProfiles: res.availableProfiles,
        accessToken: res.accessToken,
        clientToken: res.clientToken
      }
    }

    return {
      name: res.selectedProfile.name,
      uuid: res.selectedProfile.id,
      clientToken: res.clientToken,
      accessToken: res.accessToken,
      availableProfiles: res.availableProfiles,
      userProperties: res.user?.properties ?? [],
      meta: {
        online: false,
        type: 'yggdrasil'
      }
    } as Account
  }

  /**
   * Validate a user with Yggdrasil.
   * @param user The user account to validate.
   * @returns True if the token is valid, false otherwise (then you should call `refresh()`).
   */
  async validate(user: Account): Promise<boolean> {
    try {
      const res = await fetch(`${Yggdrasil.BASE_URL}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: user.accessToken,
          clientToken: user.clientToken
        })
      })
      
      return res.status === 204
    } catch {
      return false
    }
  }

  /**
   * Refresh the Yggdrasil user.
   * @param user The user account or credentials to refresh.
   * @param selectedProfile Optional profile selection for multi-profile accounts.
   * @returns The renewed account information.
   */
  async refresh(
    user: Account | { accessToken: string; clientToken: string },
    selectedProfile?: YggdrasilProfile
  ): Promise<Account> {
    const payload: any = {
      accessToken: user.accessToken,
      clientToken: user.clientToken,
      requestUser: true
    }

    if (selectedProfile) {
      payload.selectedProfile = selectedProfile
    }

    const res = await fetch(`${Yggdrasil.BASE_URL}/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then((res: any) => res.json())

    if (res.status == 'error') {
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Yggdrasil refresh failed: ${res.reason}`)
    }

    return {
      name: res.selectedProfile.name,
      uuid: res.selectedProfile.id,
      clientToken: res.clientToken,
      accessToken: res.accessToken,
      availableProfiles: res.availableProfiles,
      userProperties: res.user?.properties ?? [],
      meta: {
        online: false,
        type: 'yggdrasil'
      }
    } as Account
  }

  /**
   * Logout a user from Yggdrasil.
   * invalidate is preferred over sign out as sign out invalidates all sessions
   * and invalidate only the current one.
   * @param user The user account to logout.
   */
  async logout(user: Account) {
    await fetch(`${Yggdrasil.BASE_URL}/invalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        accessToken: user.accessToken,
        clientToken: user.clientToken
      })
    })
  }
}

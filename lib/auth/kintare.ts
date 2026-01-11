/**
 * @license MIT
 * @copyright Copyright (c) 2025, IkyMax
 */

import { Account, YggdrasilProfile } from '../../types/account'
import { EMLLibError, ErrorType } from '../../types/errors'
import { v4 } from 'uuid'

/**
 * Device code response from the authorization server.
 */
export interface DeviceCodeResponse {
  /** The device verification code */
  device_code: string
  /** The user code to display */
  user_code: string
  /** The URL where the user should go to enter the code */
  verification_uri: string
  /** Optional direct URL with the code pre-filled */
  verification_uri_complete?: string
  /** Seconds until the code expires */
  expires_in: number
  /** Seconds to wait between polling attempts */
  interval: number
}

/**
 * Options for Kintare authentication.
 */
export interface KintareAuthOptions {
  /** OAuth2 client ID (required) */
  clientId: string
  /** OAuth2 scopes to request */
  scopes?: string[]
  /** If true, verify Minecraft ownership via /minecraft/kintare/genuine */
  checkGenuineMinecraft?: boolean
}

/**
 * Internal state for pending device code authorization.
 */
interface PendingDeviceCode extends DeviceCodeResponse {
  requestedAt: number
}

/**
 * Authenticate a user with Kintare using OAuth2 Device Code Grant.
 * 
 * This is ideal for CLI applications or launchers where opening a browser
 * directly isn't possible or desired.
 * 
 * @example
 * ```typescript
 * const kintare = new Kintare({
 *   clientId: 'your-client-id',
 * })
 * 
 * // Step 1: Request device code
 * const deviceCode = await kintare.requestDeviceCode()
 * console.log(`Go to ${deviceCode.verification_uri} and enter: ${deviceCode.user_code}`)
 * 
 * // Step 2: Poll until user authorizes (or use authenticate() for auto-polling)
 * const account = await kintare.pollUntilAuthorized()
 * ```
 */
export default class Kintare {
  /** Kintare Auth Server URL */
  private static readonly AUTH_SERVER_URL = 'http://localhost:3001'
  /** Kintare Services Server URL */
  private static readonly SERVICES_URL = 'http://localhost:3002'

  private readonly options: Required<Omit<KintareAuthOptions, 'checkGenuineMinecraft'>> & { checkGenuineMinecraft: boolean }
  private pendingDeviceCode: PendingDeviceCode | null = null

  /**
   * @param options Configuration options for Kintare authentication.
   */
  constructor(options: KintareAuthOptions) {
    if (!options.clientId) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Kintare authentication requires a clientId')
    }

    this.options = {
      clientId: options.clientId,
      scopes: options.scopes ?? [
        'offline_access',
        'Yggdrasil.PlayerProfiles.Select',
        'Yggdrasil.Server.Join',
      ],
      checkGenuineMinecraft: options.checkGenuineMinecraft ?? false,
    }
  }

  /**
   * Request a device code to start the authentication flow.
   * 
   * After calling this, display the `user_code` and `verification_uri` to the user,
   * then call `pollUntilAuthorized()` to wait for them to complete login.
   * 
   * @returns Device code information to display to the user.
   */
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const deviceAuthUrl = `${Kintare.AUTH_SERVER_URL}/oidc/device/auth`

    const params = new URLSearchParams({
      client_id: this.options.clientId,
      scope: this.options.scopes.join(' '),
    })

    const response = await fetch(deviceAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Device authorization failed: ${response.status} - ${error}`)
    }

    const data = await response.json() as DeviceCodeResponse

    this.pendingDeviceCode = {
      ...data,
      requestedAt: Date.now(),
    }

    return data
  }

  /**
   * Poll the token endpoint once to check if the user has authorized.
   * 
   * @returns Token response if authorized, or error info if still pending.
   */
  private async pollOnce(): Promise<{ success: true; tokens: TokenResponse } | { success: false; error: string; error_description?: string }> {
    if (!this.pendingDeviceCode) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'No pending device code. Call requestDeviceCode() first.')
    }

const tokenUrl = `${Kintare.AUTH_SERVER_URL}/oidc/token`

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: this.pendingDeviceCode.device_code,
      client_id: this.options.clientId,
    })

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.error, error_description: data.error_description }
    }

    return { success: true, tokens: data as TokenResponse }
  }

  /**
   * Poll the token endpoint until the user authorizes or the code expires.
   * 
   * @param onPoll Optional callback called on each poll attempt.
   * @returns The authenticated account.
   */
  async pollUntilAuthorized(onPoll?: (attempt: number) => void): Promise<Account> {
    if (!this.pendingDeviceCode) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'No pending device code. Call requestDeviceCode() first.')
    }

    const interval = (this.pendingDeviceCode.interval || 5) * 1000
    const expiresAt = this.pendingDeviceCode.requestedAt + (this.pendingDeviceCode.expires_in * 1000)

    let pollCount = 0
    let currentInterval = interval

    while (Date.now() < expiresAt) {
      pollCount++
      onPoll?.(pollCount)

      const result = await this.pollOnce()

      if (result.success) {
        this.pendingDeviceCode = null
        return this.buildAccount(result.tokens)
      }

      // Handle error responses
      switch (result.error) {
        case 'authorization_pending':
          // User hasn't authorized yet, keep waiting
          await this.sleep(currentInterval)
          break

        case 'slow_down':
          // Server asked us to slow down
          currentInterval += 5000
          await this.sleep(currentInterval)
          break

        case 'expired_token':
          this.pendingDeviceCode = null
          throw new EMLLibError(ErrorType.AUTH_ERROR, 'Device code expired. Please request a new one.')

        case 'access_denied':
          this.pendingDeviceCode = null
          throw new EMLLibError(ErrorType.AUTH_ERROR, 'User denied authorization.')

        default:
          this.pendingDeviceCode = null
          throw new EMLLibError(ErrorType.AUTH_ERROR, `Token error: ${result.error} - ${result.error_description}`)
      }
    }

    this.pendingDeviceCode = null
    throw new EMLLibError(ErrorType.AUTH_ERROR, 'Device code expired (timeout)')
  }

  /**
   * Convenience method that combines requestDeviceCode() and pollUntilAuthorized().
   * 
   * @param onDeviceCode Callback with device code info for displaying to user.
   * @param onPoll Optional callback called on each poll attempt.
   * @returns The authenticated account.
   */
  async authenticate(
    onDeviceCode: (deviceCode: DeviceCodeResponse) => void,
    onPoll?: (attempt: number) => void
  ): Promise<Account> {
    const deviceCode = await this.requestDeviceCode()
    onDeviceCode(deviceCode)
    return this.pollUntilAuthorized(onPoll)
  }

  /**
   * Validate an access token and fetch fresh profile data.
   * 
   * @param user The user account to validate.
   * @returns The account with fresh profile data (name, uuid may have changed).
   * @throws {EMLLibError} If token is invalid/expired. Launcher should catch and call `refresh()`.
   */
  async validate(user: Account): Promise<Account> {
    const response = await fetch(`${Kintare.SERVICES_URL}/authserver/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: user.accessToken }),
    })

    if (response.status === 204) {
      // Token valid - fetch fresh profile data (username may have changed)
      const profile = await this.getProfile(user.accessToken)
      return {
        ...user,
        name: profile.name,
        uuid: profile.id,
      }
    }

    if (response.status === 403) {
      // Token invalid - let launcher handle refresh
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Access token is invalid or expired. Call refresh() to renew.')
    }

    throw new EMLLibError(ErrorType.AUTH_ERROR, `Kintare validate failed: unexpected status ${response.status}`)
  }

  /**
   * Refresh the access token using a refresh token.
   * 
   * @param user The user account with a refresh token.
   * @returns The renewed account information.
   */
  async refresh(user: Account): Promise<Account> {
    if (!user.refreshToken) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'No refresh token available')
    }

    const tokenUrl = `${Kintare.AUTH_SERVER_URL}/oidc/token`

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: user.refreshToken,
      client_id: this.options.clientId,
    })

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Token refresh failed: ${response.status} - ${error}`)
    }

    const tokens = await response.json() as TokenResponse
    return this.buildAccount(tokens)
  }

  /**
   * Get the player profile from the services server.
   * 
   * @param accessToken The access token.
   * @returns The player profile.
   */
  private async getProfile(accessToken: string): Promise<YggdrasilProfile> {
    const response = await fetch(`${Kintare.SERVICES_URL}/minecraft/profile`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Profile fetch failed: ${response.status} - ${error}`)
    }

    const profile = await response.json()
    return { id: profile.id, name: profile.name }
  }

  /**
   * Check if the user owns genuine Minecraft.
   * 
   * @param accessToken The access token.
   * @returns True if verified, false otherwise.
   */
  async checkGenuine(accessToken: string): Promise<{ verified: boolean; uuid?: string }> {
    const response = await fetch(`${Kintare.SERVICES_URL}/minecraft/kintare/genuine`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Genuine check failed: ${response.status} - ${error}`)
    }

    const result = await response.json()
    return { verified: result.verified, uuid: result.uuid }
  }

  /**
   * Build an Account object from token response.
   */
  private async buildAccount(tokens: TokenResponse): Promise<Account> {
    // Check genuine Minecraft ownership first if enabled
    if (this.options.checkGenuineMinecraft) {
      const genuine = await this.checkGenuine(tokens.access_token)
      if (!genuine.verified) {
        throw new EMLLibError(ErrorType.AUTH_ERROR, 'Minecraft ownership verification failed. User does not own genuine Minecraft.')
      }
    }

    // Get profile from services server
    const profile = await this.getProfile(tokens.access_token)

    // Try to extract available profiles from JWT claims
    let availableProfiles: YggdrasilProfile[] | undefined
    const claims = this.decodeJwtPayload(tokens.access_token)
    if (claims?.availableProfiles) {
      availableProfiles = claims.availableProfiles
    }

    return {
      name: profile.name,
      uuid: profile.id,
      accessToken: tokens.access_token,
      clientToken: v4(),
      refreshToken: tokens.refresh_token,
      availableProfiles,
      userProperties: {},
      meta: {
        online: true,
        type: 'kintare',
      },
    } as Account
  }

  /**
   * Decode JWT payload without verification.
   */
  private decodeJwtPayload(token: string): any {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
      return JSON.parse(payload)
    } catch {
      return null
    }
  }

  /**
   * Check if there's a pending device code.
   */
  hasPendingDeviceCode(): boolean {
    return this.pendingDeviceCode !== null
  }

  /**
   * Get the pending device code info (if any).
   */
  getPendingDeviceCode(): DeviceCodeResponse | null {
    if (!this.pendingDeviceCode) return null
    const { requestedAt, ...deviceCode } = this.pendingDeviceCode
    return deviceCode
  }

  /**
   * Clear the pending device code.
   */
  clearPendingDeviceCode(): void {
    this.pendingDeviceCode = null
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Token response from the authorization server.
 */
interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  token_type: string
}

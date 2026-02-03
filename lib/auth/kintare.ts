/**
 * @license MIT
 * @copyright Copyright (c) 2025, IkyMax
 */

import type { Account, YggdrasilProfile } from '../../types/account'
import type { HytaleSessionResponse } from '../../types/hytale'
import { EMLLibError, ErrorType } from '../../types/errors'
import { v4 } from 'uuid'

/**
 * Hytale session endpoint URL.
 */
export const HYTALE_SESSION_URL = 'https://sesh.kintare.studio/game-session/new'

/**
 * Default scopes for unified launcher (Minecraft + Hytale).
 */
export const DEFAULT_SCOPES = [
  'offline_access',
  // Minecraft (Yggdrasil)
  'Yggdrasil.PlayerProfiles.Select',
  'Yggdrasil.Server.Join',
  'Yggdrasil.KintareVerification.Genuine',
  'auth:launcher'
] as const

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
  private static readonly AUTH_SERVER_URL = 'https://auth.kintare.studio'
  /** Kintare Services Server URL */
  private static readonly SERVICES_URL = 'https://services.kintare.studio'

  private readonly options: Required<Omit<KintareAuthOptions, 'checkGenuineMinecraft'>> & { checkGenuineMinecraft: boolean }
  private pendingDeviceCode: PendingDeviceCode | null = null
  private cancelled = false
  private currentSleepCancel: (() => void) | null = null

  /**
   * @param options Configuration options for Kintare authentication.
   */
  constructor(options: KintareAuthOptions) {
    if (!options.clientId) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Kintare authentication requires a clientId')
    }

    this.options = {
      clientId: options.clientId,
      scopes: options.scopes ?? [...DEFAULT_SCOPES],
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

    // Reset cancelled state for new polling session
    this.cancelled = false

    const interval = (this.pendingDeviceCode.interval || 5) * 1000
    const expiresAt = this.pendingDeviceCode.requestedAt + (this.pendingDeviceCode.expires_in * 1000)

    let pollCount = 0
    let currentInterval = interval

    while (Date.now() < expiresAt) {
      // Check if cancelled
      if (this.cancelled) {
        this.pendingDeviceCode = null
        throw new EMLLibError(ErrorType.AUTH_ERROR, 'Authorization cancelled by user.')
      }

      pollCount++
      onPoll?.(pollCount)

      const result = await this.pollOnce()

      // Check if cancelled after poll
      if (this.cancelled) {
        this.pendingDeviceCode = null
        throw new EMLLibError(ErrorType.AUTH_ERROR, 'Authorization cancelled by user.')
      }

      if (result.success) {
        this.pendingDeviceCode = null
        return this.buildAccount(result.tokens)
      }

      // Handle error responses
      switch (result.error) {
        case 'authorization_pending':
          // User hasn't authorized yet, keep waiting
          await this.cancellableSleep(currentInterval)
          break

        case 'slow_down':
          // Server asked us to slow down
          currentInterval += 5000
          await this.cancellableSleep(currentInterval)
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
   * Validate an access token by fetching the profile.
   * 
   * If the token is valid, getProfile() succeeds and we return the updated account.
   * If the token is expired/invalid, getProfile() fails and we return null.
   * 
   * @param user The user account to validate.
   * @returns Updated Account with fresh profile if valid, null otherwise (then you should call `refresh()`).
   */
  async validate(user: Account): Promise<Account | null> {
    try {
      // If getProfile succeeds, the token is valid
      const profile = await this.getProfile(user.accessToken)

      // Try to extract available profiles from JWT claims
      let availableProfiles: YggdrasilProfile[] | undefined = user.availableProfiles
      const claims = this.decodeJwtPayload(user.accessToken)
      if (claims?.availableProfiles) {
        availableProfiles = claims.availableProfiles
      }

      return {
        ...user,
        name: profile.name,
        uuid: profile.id,
        availableProfiles,
      }
    } catch {
      return null
    }
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
   * Get a Hytale game session for online play.
   * 
   * This fetches fresh session tokens from the Kintare session server.
   * Session tokens should be fetched immediately before launching Hytale
   * and are short-lived (typically expire after the game session ends).
   * 
   * Requires the account to have been authenticated with the `auth:launcher` scope.
   * 
   * @param account The Kintare account to get a session for.
   * @returns Session tokens for Hytale authentication.
   * @throws Error if the session request fails or account lacks required scope.
   */
  async getHytaleSession(account: Account): Promise<HytaleSessionResponse> {
    if (account.meta?.type !== 'kintare') {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Hytale session requires a Kintare account')
    }

    if (!account.accessToken) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Account has no access token for Hytale session')
    }

    const response = await fetch(HYTALE_SESSION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.accessToken}`
      },
      body: JSON.stringify({
        uuid: account.uuid
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new EMLLibError(
        ErrorType.AUTH_ERROR,
        `Hytale session request failed: ${response.status} - ${error}`
      )
    }

    const session = await response.json() as HytaleSessionResponse
    return session
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
   * Clear the pending device code and cancel any ongoing polling.
   */
  clearPendingDeviceCode(): void {
    this.cancelled = true
    this.pendingDeviceCode = null
    // Cancel current sleep to immediately break out of polling loop
    if (this.currentSleepCancel) {
      this.currentSleepCancel()
      this.currentSleepCancel = null
    }
  }

  /**
   * Cancellable sleep that can be interrupted by clearPendingDeviceCode().
   */
  private cancellableSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.currentSleepCancel = null
        resolve()
      }, ms)

      this.currentSleepCancel = () => {
        clearTimeout(timeoutId)
        resolve()
      }
    })
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

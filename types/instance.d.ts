/**
 * EML Instance configuration.
 * 
 * Instances allow multiple modpacks/servers to be served from a single EML AdminTool.
 * - Default instance: `https://eml.domain.com/` (backward compatible)
 * - Named instance: `https://eml.domain.com/instances/{instanceId}/`
 */
export interface Instance {
  /**
   * The base URL of the EML AdminTool.
   * Example: `https://eml.mydomain.com`
   */
  url: string

  /**
   * Optional instance ID for multi-instance setups.
   * When set, requests go to `{url}/instances/{instanceId}/` instead of `{url}/`.
   * Leave undefined for default/legacy single-instance setup.
   */
  instanceId?: string

  /**
   * Optional password for protected instances.
   * If the instance requires authentication, this password is used to obtain a JWT token.
   * The token is then stored and used for all subsequent requests.
   */
  password?: string
}

/**
 * Response from the instance authentication endpoint.
 * 
 * Endpoint: POST /api/instances/authenticate/
 */
export interface InstanceAuthResponse {
  /**
   * Whether authentication was successful.
   */
  success: boolean

  /**
   * JWT token for authenticated access (lifetime valid).
   * `null` if instance does not require authentication.
   */
  token?: string | null

  /**
   * Optional message (e.g., "This instance does not require authentication").
   */
  message?: string

  /**
   * Optional token expiration timestamp (milliseconds since epoch).
   * If not provided, token is valid until password changes.
   */
  expiresAt?: number

  /**
   * Error message if authentication failed.
   */
  error?: string
}

/**
 * Stored instance authentication data.
 */
export interface InstanceAuth {
  /**
   * The instance ID this auth is for.
   */
  instanceId: string

  /**
   * JWT token for authenticated access.
   */
  token: string

  /**
   * When the token was obtained.
   */
  obtainedAt: number
}

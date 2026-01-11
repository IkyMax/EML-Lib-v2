/**
 * @license MIT
 * @copyright Copyright (c) 2026, GoldFrite
 */

import { Instance, InstanceAuth, InstanceAuthResponse } from '../../types/instance'
import { EMLLibError, ErrorType } from '../../types/errors'
import { InstanceEvents } from '../../types/events'
import fs from 'node:fs/promises'
import path_ from 'node:path'
import { existsSync } from 'node:fs'
import utils from './utils'
import EventEmitter from './events'

/**
 * Manages EML instance authentication and URL building.
 * 
 * Handles:
 * - Building correct URLs for default vs named instances
 * - Password authentication for protected instances
 * - JWT token storage and retrieval
 * - Adding auth headers to fetch requests
 * - Clearing instance data on persistent auth failures
 */
export class InstanceManager extends EventEmitter<InstanceEvents> {
  private readonly baseUrl: string
  private readonly instanceId?: string
  private password?: string
  private readonly serverId: string
  private token?: string

  constructor(instance: Instance, serverId: string) {
    super()
    // Normalize URL (remove trailing slash)
    this.baseUrl = instance.url.replace(/\/+$/, '')
    this.instanceId = instance.instanceId
    this.password = instance.password
    this.serverId = serverId
  }

  /**
   * Get the base URL for API requests.
   * - Default instance: `{baseUrl}`
   * - Named instance: `{baseUrl}/instances/{instanceId}`
   */
  getApiBase(): string {
    if (this.instanceId) {
      return `${this.baseUrl}/instances/${this.instanceId}`
    }
    return this.baseUrl
  }

  /**
   * Build a full URL for an API endpoint.
   * @param endpoint The API endpoint (e.g., '/api/loader')
   */
  buildUrl(endpoint: string): string {
    const base = this.getApiBase()
    // Ensure endpoint starts with /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    return `${base}${normalizedEndpoint}`
  }

  /**
   * Check if this instance requires authentication.
   */
  requiresAuth(): boolean {
    return !!this.password
  }

  /**
   * Get the stored token path.
   */
  private getTokenPath(): string {
    const tokenDir = path_.join(utils.getServerFolder(this.serverId), '.eml')
    const instanceKey = this.instanceId ?? 'default'
    return path_.join(tokenDir, `instance-${instanceKey}.token`)
  }

  /**
   * Load stored authentication token.
   */
  private async loadStoredToken(): Promise<string | null> {
    try {
      const tokenPath = this.getTokenPath()
      const data = await fs.readFile(tokenPath, 'utf-8')
      const auth: InstanceAuth = JSON.parse(data)
      return auth.token
    } catch {
      return null
    }
  }

  /**
   * Store authentication token.
   */
  private async storeToken(token: string): Promise<void> {
    const tokenPath = this.getTokenPath()
    const tokenDir = path_.dirname(tokenPath)
    
    await fs.mkdir(tokenDir, { recursive: true })
    
    const auth: InstanceAuth = {
      instanceId: this.instanceId ?? 'default',
      token,
      obtainedAt: Date.now()
    }
    
    await fs.writeFile(tokenPath, JSON.stringify(auth, null, 2), 'utf-8')
  }

  /**
   * Authenticate with the instance using password.
   * @returns The JWT token.
   * @throws {EMLLibError} If authentication fails.
   */
  private async authenticate(): Promise<string> {
    if (!this.password) {
      throw new EMLLibError(ErrorType.AUTH_ERROR, 'Instance requires authentication but no password provided')
    }

    const authUrl = `${this.baseUrl}/api/instances/authenticate/`
    
    try {
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          instanceId: this.instanceId ?? this.serverId,
          password: this.password
        })
      })

      if (!response.ok) {
        // New endpoint returns { "error": "message" } on failure
        let errorMsg = `${response.status} ${response.statusText}`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMsg = errorData.error
          }
        } catch {
          // Unable to parse error response, use status text
        }
        throw new EMLLibError(ErrorType.AUTH_ERROR, `Instance authentication failed: ${errorMsg}`)
      }

      const data: InstanceAuthResponse = await response.json()

      // New endpoint returns { success: true, token: null } for non-protected instances
      if (data.success && data.token === null) {
        throw new EMLLibError(
          ErrorType.AUTH_ERROR, 
          'Instance does not require authentication'
        )
      }

      if (!data.success || !data.token) {
        throw new EMLLibError(
          ErrorType.AUTH_ERROR, 
          `Instance authentication failed: ${data.error ?? 'Unknown error'}`
        )
      }

      return data.token
    } catch (err) {
      if (err instanceof EMLLibError) throw err
      throw new EMLLibError(ErrorType.AUTH_ERROR, `Instance authentication failed: ${err}`)
    }
  }

  /**
   * Ensure we have a valid token for authenticated requests.
   * Loads from storage or authenticates if needed.
   */
  async ensureAuthenticated(): Promise<void> {
    if (!this.requiresAuth()) return

    // Try to load stored token
    const storedToken = await this.loadStoredToken()
    if (storedToken) {
      this.token = storedToken
      return
    }

    // Authenticate and store token
    this.token = await this.authenticate()
    await this.storeToken(this.token)
    this.emit('instance_authenticated', { instanceId: this.instanceId ?? null })
  }

  /**
   * Set the password for this instance.
   * Use this after receiving `instance_password_required` event to provide
   * the password from user input, then retry the operation.
   * @param password The password for the instance.
   */
  setPassword(password: string): void {
    this.password = password
  }

  /**
   * Check if a password is available (either from config or set manually).
   */
  hasPassword(): boolean {
    return !!this.password
  }

  /**
   * Get headers for authenticated requests.
   */
  getAuthHeaders(): Record<string, string> {
    if (this.token) {
      return { 'Authorization': `Bearer ${this.token}` }
    }
    return {}
  }

  /**
   * Perform an authenticated fetch request.
   * @param endpoint The API endpoint.
   * @param options Fetch options.
   */
  async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    await this.ensureAuthenticated()

    const url = this.buildUrl(endpoint)
    const headers = {
      ...options?.headers,
      ...this.getAuthHeaders()
    }

    const response = await fetch(url, { ...options, headers })

    // Check for auth error
    if (response.status === 403 || response.status === 401) {
      const text = await response.text()
      if (text.includes('Access forbidden') || text.includes('Unauthorized')) {
        // Clear stored token and try to re-authenticate
        this.token = undefined
        
        if (this.password) {
          try {
            // Re-authenticate
            this.token = await this.authenticate()
            await this.storeToken(this.token)
            this.emit('instance_authenticated', { instanceId: this.instanceId ?? null })
            
            // Retry the request
            const retryHeaders = {
              ...options?.headers,
              ...this.getAuthHeaders()
            }
            const retryResponse = await fetch(url, { ...options, headers: retryHeaders })
            
            if (!retryResponse.ok) {
              // Auth succeeded but request still failed - clear everything
              const reason = `Request failed after re-authentication: ${retryResponse.status} ${retryResponse.statusText}`
              await this.handleAuthFailure(reason)
              throw new EMLLibError(ErrorType.AUTH_ERROR, reason)
            }
            
            return retryResponse.json()
          } catch (err) {
            // Re-authentication failed - clear everything
            if (err instanceof EMLLibError && err.code === ErrorType.AUTH_ERROR) {
              const reason = err.message
              await this.handleAuthFailure(reason)
              throw err
            }
            throw err
          }
        }
        
        // No password provided - emit event for launcher to prompt user
        this.emit('instance_password_required', { instanceId: this.instanceId ?? null })
        
        const reason = 'Password required for re-authentication. Listen for instance_password_required event.'
        throw new EMLLibError(ErrorType.AUTH_ERROR, reason)
      }
    }

    if (!response.ok) {
      throw new EMLLibError(
        ErrorType.FETCH_ERROR, 
        `Failed to fetch ${endpoint}: ${response.status} ${response.statusText}`
      )
    }

    return response.json()
  }

  /**
   * Get the token for external use (e.g., for download URLs).
   */
  getToken(): string | undefined {
    return this.token
  }

  /**
   * Clear stored authentication.
   */
  async clearAuth(): Promise<void> {
    this.token = undefined
    try {
      await fs.unlink(this.getTokenPath())
    } catch {
      // File doesn't exist
    }
  }

  /**
   * Handle authentication failure by clearing all instance data.
   * This removes the token, all downloaded files, and notifies the launcher.
   * @param reason The reason for the auth failure.
   */
  private async handleAuthFailure(reason: string): Promise<void> {
    const instancePath = utils.getServerFolder(this.serverId)
    
    // Emit auth failed event
    this.emit('instance_auth_failed', { 
      instanceId: this.instanceId ?? null, 
      reason 
    })

    // Emit clearing event
    this.emit('instance_clearing', { 
      instanceId: this.instanceId ?? null, 
      path: instancePath 
    })

    // Clear token
    this.token = undefined
    try {
      await fs.unlink(this.getTokenPath())
    } catch {
      // Token file doesn't exist
    }

    // Remove all instance files (server folder)
    if (existsSync(instancePath)) {
      await fs.rm(instancePath, { recursive: true, force: true })
    }

    // Emit cleared event
    this.emit('instance_cleared', { 
      instanceId: this.instanceId ?? null, 
      path: instancePath 
    })
  }

  /**
   * Get the server folder path for this instance.
   */
  getInstancePath(): string {
    return utils.getServerFolder(this.serverId)
  }
}

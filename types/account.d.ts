/**
 * Represents a Yggdrasil player profile.
 */
export interface YggdrasilProfile {
  /** Player username */
  name: string
  /** UUID of the account (hexadecimal string without dashes) */
  id: string
}

export interface Account {
  name: string
  uuid: string
  accessToken: string
  clientToken: string
  refreshToken?: string
  userProperties?: any
  availableProfiles?: YggdrasilProfile[]
  meta: { online: boolean; type: 'msa' | 'azuriom' | 'yggdrasil' | 'kintare' | 'crack' }
  xbox?: {
    xuid: string
    gamertag: string
    ageGroup: string
  }
}

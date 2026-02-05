export interface Account {
  name: string
  uuid: string
  accessToken: string
  clientToken: string
  refreshToken?: string
  userProperties?: any
  meta: { online: boolean; type: 'msa' | 'azuriom' | 'yggdrasil' | 'crack' }
  xbox?: {
    xuid: string
    gamertag: string
    ageGroup: string
  }
}

export interface MultipleProfiles {
  needsProfileSelection: true
  accessToken: string
  clientToken: string
  userProperties?: any
  availableProfiles: { id: string; name: string }[]
}
export type LectureCibleeStats = {
  blocked: number
  allowedAgain: number
}

declare module 'claude-code' {
  interface PluginState {
    'lecture-ciblee': {
      enabled: boolean
      stats: LectureCibleeStats
      lastDenied: string
    }
  }
}

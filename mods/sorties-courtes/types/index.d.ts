export type ShortenStats = {
  count: number
  savedChars: number
}

declare module 'claude-code' {
  interface PluginState {
    'sorties-courtes': {
      enabled: boolean
      stats: ShortenStats
    }
  }
}

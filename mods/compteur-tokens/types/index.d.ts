export type ModelTotals = {
  calls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

declare module 'claude-code' {
  interface PluginState {
    'compteur-tokens': {
      totals: Record<string, ModelTotals>
      alertAt: number
      alerted: boolean
      cost: number
    }
  }
}

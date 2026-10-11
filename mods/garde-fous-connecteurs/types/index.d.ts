export type ConnectorGuardStats = {
  asked: number
  refused: number
}

declare module 'claude-code' {
  interface PluginState {
    'garde-fous-connecteurs': {
      alwaysAllowed: string[]
      asked: number
      refused: number
    }
  }
}

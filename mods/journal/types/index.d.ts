export type JournalPending = {
  prompt: string
  files: string[]
  actions: string[]
}

declare module 'claude-code' {
  interface PluginState {
    journal: {
      enabled: boolean
      pending: JournalPending | null
    }
  }
}

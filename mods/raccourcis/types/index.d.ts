export type RaccourciDefinition = {
  description: string
  prompt: string
}

declare module 'claude-code' {
  interface PluginState {
    raccourcis: {
      shortcuts: Record<string, RaccourciDefinition>
      problems: string[]
      registered: string[]
      file: string | null
      isMissing: boolean
    }
  }
}

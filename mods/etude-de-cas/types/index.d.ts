export type CaseFacts = {
  startedAt: number
  firstPrompt: string
  turns: number
  errors: number
  tools: Record<string, number>
  files: string[]
  tasks: string[]
  tasksDone: number
  commits: string[]
  pushes: number
  pullRequests: string[]
  suggested: boolean
}

export type AnonymiseRules = {
  names: string[]
  domains: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'etude-de-cas': {
      facts: CaseFacts | null
    }
  }
}

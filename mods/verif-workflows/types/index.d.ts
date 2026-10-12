export type WorkflowKind = 'n8n' | 'make'

export type WorkflowCheckRecord = {
  at: number
  path: string
  kind: WorkflowKind
  problems: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'verif-workflows': {
      lastChecks: WorkflowCheckRecord[]
    }
  }
}

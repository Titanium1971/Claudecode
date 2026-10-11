export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type DashTask = {
  id: string
  subject: string
  status: TaskStatus
  activeForm?: string
}

export type Activity = {
  id: string
  tool: string
  label: string
  state: 'running' | 'ok' | 'error'
}

export type SessionStats = {
  startedAt: number
  turns: number
  toolCalls: number
  errors: number
  lastTurnSeconds: number
}

export type GitInfo = {
  repo: string
  branch: string
  changed: number
  ahead: number
}

declare module 'claude-code' {
  interface PluginState {
    'tableau-de-bord': {
      tasks: DashTask[]
      todos: DashTask[]
      activity: Activity[]
      files: string[]
      stats: SessionStats
      git: GitInfo | null
      showActivity: boolean
    }
  }
}

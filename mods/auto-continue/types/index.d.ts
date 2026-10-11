export type Timestamp = number | null

declare module 'claude-code' {
  interface PluginState {
    'auto-continue': {
      percent: number | null
      isArmed: boolean
      resumeAt: Timestamp
      resetsAt: Timestamp
    }
  }
}

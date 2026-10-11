export type VerifAvantCommitStats = {
  commitsChecked: number
  commitsBlocked: number
}

declare module 'claude-code' {
  interface PluginState {
    'verif-avant-commit': {
      stats: VerifAvantCommitStats
    }
  }
}

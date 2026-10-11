export type ModelTier = 'haiku' | 'sonnet' | 'opus'

export type Mode = 'auto' | ModelTier

export type Choice = {
  tier: ModelTier
  reason: 'classé' | 'forcé' | 'par défaut'
}

declare module 'claude-code' {
  interface PluginState {
    'choix-modele': {
      mode: Mode
      current: Choice | null
      counts: Record<ModelTier, number>
    }
  }
}

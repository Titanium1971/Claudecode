export type ModelTier = 'haiku' | 'sonnet' | 'opus'

export type Mode = 'auto' | ModelTier

/** Le choix pour les sous-agents : un modèle, ou « defaut » pour ne pas y toucher. */
export type SubagentChoice = ModelTier | 'defaut'

export type Choice = {
  tier: ModelTier
  reason: 'classé' | 'forcé' | 'par défaut'
}

/** Ce que le mod sait du dernier appel du fil principal, pour décider s'il vaut la peine de changer de modèle. */
export type LastStep = {
  tier: ModelTier
  /** Taille de la conversation envoyée au dernier appel (entrée, cache lu et cache écrit). */
  context: number
  /** Dernière utilisation de chaque modèle, en millisecondes : le cache d'un modèle tient environ 5 minutes. */
  usedAt: Partial<Record<ModelTier, number>>
}

export type StepStats = {
  /** Appels du fil principal par modèle réellement utilisé. */
  steps: Record<ModelTier, number>
  /** Demandes où le mod est resté sur le modèle en cours pour ne pas perdre le cache. */
  stayed: number
  /** Appels de sous-agents envoyés sur le modèle des sous-agents. */
  subagentSteps: number
  /** Tokens écrits par le modèle au total, et nombre de demandes : sert à estimer ce qu'une demande écrit. */
  outputTokens: number
  prompts: number
}

declare module 'claude-code' {
  interface PluginState {
    'choix-modele': {
      mode: Mode
      current: Choice | null
      counts: Record<ModelTier, number>
      subagents: SubagentChoice
      last: LastStep | null
      turn: { id: string; tier: ModelTier } | null
      stats: StepStats
    }
  }
}

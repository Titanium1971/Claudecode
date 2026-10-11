import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Choice, Mode, ModelTier } from '../types'

const MODEL_ID: Record<ModelTier, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}

const NAME: Record<ModelTier, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
}

const LABEL_TIER: Record<string, ModelTier> = {
  SIMPLE: 'haiku',
  STANDARD: 'sonnet',
  COMPLEXE: 'opus',
}

// Si le classement échoue, on prend le modèle du milieu plutôt que le plus cher.
const FALLBACK: ModelTier = 'sonnet'

const RUBRIC = `Tu classes la difficulté d'une demande faite à un assistant de code.
Réponds par un seul mot :
SIMPLE : question courte, explication, salutation, oui/non, relire ou résumer, petite modification évidente d'un seul fichier.
STANDARD : écrire ou modifier du code sur quelques fichiers, corriger un bug clair, écrire des tests, ouvrir une pull request.
COMPLEXE : conception ou architecture, bug difficile ou mystérieux, gros refactor sur beaucoup de fichiers, sécurité, raisonnement long.
En cas de doute entre deux niveaux, choisis le plus élevé.`

const mode = atom({ plugin: 'choix-modele', key: 'mode' } as const, 'auto' as Mode)
const current = atom({ plugin: 'choix-modele', key: 'current' } as const, null as Choice | null)
const counts = atom({ plugin: 'choix-modele', key: 'counts' } as const, {
  haiku: 0,
  sonnet: 0,
  opus: 0,
} as Record<ModelTier, number>)

function isTier(value: string): value is ModelTier {
  return value === 'haiku' || value === 'sonnet' || value === 'opus'
}

async function classify($: EngineInterface, text: string): Promise<Choice> {
  const answer = await $.model.complete({
    model: 'haiku',
    system: RUBRIC,
    prompt: text.slice(0, 4000),
    maxTokens: 5,
    effort: 'low',
    timeoutMs: 8000,
  })
  if (answer.isAnswered) {
    const word = answer.text.trim().toUpperCase().replace(/[^A-Z]/g, '')
    const tier = LABEL_TIER[word]
    if (tier !== undefined) {
      return { tier, reason: 'classé' }
    }
  }

  return { tier: FALLBACK, reason: 'par défaut' }
}

async function showStatus($: EngineInterface): Promise<void> {
  const choice = await read($, current)
  if (choice === null) {
    $.ui.status(undefined)

    return
  }
  $.ui.status(`Modèle : ${NAME[choice.tier]} (${choice.reason})`)
}

async function summary($: EngineInterface): Promise<string> {
  const m = await read($, mode)
  const choice = await read($, current)
  const c = await read($, counts)
  const lines = [
    m === 'auto'
      ? 'Mode : automatique (Haiku, Sonnet ou Opus selon la demande)'
      : `Mode : forcé sur ${NAME[m]}`,
  ]
  if (choice !== null) {
    lines.push(`Dernier choix : ${NAME[choice.tier]} (${choice.reason})`)
  }
  lines.push(`Demandes cette session : Haiku ${c.haiku}, Sonnet ${c.sonnet}, Opus ${c.opus}`)
  lines.push('Changer : /modele auto, /modele haiku, /modele sonnet ou /modele opus')

  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'modele',
      description: 'Voir ou forcer le modèle : auto, haiku, sonnet ou opus',
      argumentHint: '[auto|haiku|sonnet|opus]',
    })
    await showStatus($)

    return next(e)
  })

  on('command.run', { command: 'modele' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    if (wanted === 'auto' || isTier(wanted)) {
      await update($, mode, () => wanted)
      await update($, current, () => (isTier(wanted) ? { tier: wanted, reason: 'forcé' } : null))
      await showStatus($)
    } else if (wanted !== '') {
      return { text: `« ${wanted} » n'est pas un choix possible.\n\n${await summary($)}` }
    }

    return { text: await summary($) }
  })

  // Une nouvelle demande (pas un message glissé dans un tour en cours) : on choisit le modèle du tour.
  on('prompt.submit', async ($, e, next) => {
    if (e.turnId === undefined) {
      const m = await read($, mode)
      const choice: Choice = m === 'auto' ? await classify($, e.text) : { tier: m, reason: 'forcé' }
      await update($, current, () => choice)
      await update($, counts, c => ({ ...c, [choice.tier]: c[choice.tier] + 1 }))
      await showStatus($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Chaque appel au modèle du fil principal part vers le modèle choisi. Les sous-agents gardent le leur.
  on('turn.step', async function* ($, e, next) {
    const choice = e.agentId === undefined ? await read($, current) : null
    if (choice === null) {
      return yield* next(e)
    }

    return yield* next({ ...e, model: MODEL_ID[choice.tier] })
  })
}

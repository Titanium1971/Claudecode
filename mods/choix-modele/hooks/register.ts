import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Choice, LastStep, Mode, ModelTier, StepStats, SubagentChoice } from '../types'

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

const RANK: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 }

// Prix en dollars par million de tokens (tarifs publics de l'API, octobre 2026).
// L'écriture en cache coûte 1,25 fois l'entrée ; la lecture du cache est bien moins chère.
const PRICE: Record<ModelTier, { output: number; cacheWrite: number; cacheRead: number }> = {
  haiku: { output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  sonnet: { output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  opus: { output: 20, cacheWrite: 5, cacheRead: 0.2 },
}

// Le cache d'un modèle tient environ 5 minutes ; on compte 4 minutes pour rester prudent.
const CACHE_LIFETIME_MS = 4 * 60 * 1000
// Ce qu'une demande écrit en moyenne tant qu'on n'a pas assez de recul.
const DEFAULT_OUTPUT_PER_PROMPT = 3000
const MIN_PROMPTS_FOR_AVERAGE = 3

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
const subagents = atom({ plugin: 'choix-modele', key: 'subagents' } as const, 'sonnet' as SubagentChoice)
const last = atom({ plugin: 'choix-modele', key: 'last' } as const, null as LastStep | null)
const turn = atom({ plugin: 'choix-modele', key: 'turn' } as const, null as { id: string; tier: ModelTier } | null)
const stats = atom({ plugin: 'choix-modele', key: 'stats' } as const, {
  steps: { haiku: 0, sonnet: 0, opus: 0 },
  stayed: 0,
  subagentSteps: 0,
  outputTokens: 0,
  prompts: 0,
} as StepStats)

function isTier(value: string): value is ModelTier {
  return value === 'haiku' || value === 'sonnet' || value === 'opus'
}

export type RouteInput = {
  /** Le modèle voulu pour cette demande. */
  wanted: ModelTier
  /** Le modèle du dernier appel du fil principal, ou null au début de la session. */
  last: ModelTier | null
  /** Taille de la conversation au dernier appel, en tokens. */
  context: number
  /** Les modèles dont le cache est encore chaud. */
  hot: ReadonlySet<ModelTier>
  /** Ce qu'une demande écrit en moyenne, en tokens. */
  averageOutput: number
}

/**
 * Choisit le modèle d'une nouvelle demande.
 *
 * Changer de modèle oblige le nouveau modèle à relire toute la conversation sans cache :
 * c'est l'écriture du cache (1,25 fois le prix de l'entrée) au lieu de sa lecture. Dans une
 * longue conversation, passer d'Opus à Sonnet coûte donc plus que ce que Sonnet fait gagner
 * sur la réponse. On ne descend d'un cran que si l'économie attendue dépasse cette perte ;
 * on monte toujours quand la demande est difficile.
 */
export function route(input: RouteInput): { tier: ModelTier; isStaying: boolean } {
  const { wanted, last: previous, context, hot, averageOutput } = input
  if (previous === null || wanted === previous || RANK[wanted] > RANK[previous] || hot.has(wanted)) {
    return { tier: wanted, isStaying: false }
  }
  const switchCost = (context * (PRICE[wanted].cacheWrite - PRICE[previous].cacheRead)) / 1_000_000
  const saving = ((PRICE[previous].output - PRICE[wanted].output) * averageOutput) / 1_000_000
  if (saving >= switchCost) {
    return { tier: wanted, isStaying: false }
  }

  return { tier: previous, isStaying: true }
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

function showStatus($: EngineInterface, choice: Choice | null, routed?: ModelTier): void {
  if (choice === null) {
    $.ui.status(undefined)

    return
  }
  if (routed !== undefined && routed !== choice.tier) {
    $.ui.status(`Modèle : ${NAME[routed]} (classé ${NAME[choice.tier]}, gardé pour le cache)`)

    return
  }
  $.ui.status(`Modèle : ${NAME[choice.tier]} (${choice.reason})`)
}

async function summary($: EngineInterface): Promise<string> {
  const m = await read($, mode)
  const choice = await read($, current)
  const c = await read($, counts)
  const s = await read($, stats)
  const previous = await read($, last)
  const sub = await read($, subagents)
  const lines = [
    m === 'auto'
      ? 'Mode : automatique (Haiku, Sonnet ou Opus selon la demande)'
      : `Mode : forcé sur ${NAME[m]}`,
  ]
  if (choice !== null) {
    lines.push(`Dernier classement : ${NAME[choice.tier]} (${choice.reason})`)
  }
  lines.push(`Demandes classées : Haiku ${c.haiku}, Sonnet ${c.sonnet}, Opus ${c.opus}`)
  lines.push(`Appels réellement faits : Haiku ${s.steps.haiku}, Sonnet ${s.steps.sonnet}, Opus ${s.steps.opus}`)
  lines.push(
    `Restés sur le modèle en cours pour ne pas perdre le cache : ${s.stayed} fois (changer de modèle dans une longue conversation coûte plus qu'il ne rapporte)`,
  )
  lines.push(
    sub === 'defaut'
      ? `Sous-agents : modèle de la session (${s.subagentSteps} appels déjà déroutés)`
      : `Sous-agents : ${NAME[sub]} (${s.subagentSteps} appels déroutés)`,
  )
  if (previous !== null) {
    lines.push(`Conversation au dernier appel : environ ${Math.round(previous.context / 1000)} k tokens`)
  }
  lines.push('Changer : /modele auto, haiku, sonnet ou opus ; /modele agents haiku, sonnet, opus ou defaut')

  return lines.join('\n')
}

export const register: Register = on => {
  // Le modèle de la session, tel que le moteur le donne au fil principal : sert à reconnaître les
  // sous-agents qui n'ont pas choisi leur modèle eux-mêmes.
  let sessionModel: string | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'modele',
      description: 'Voir ou forcer le modèle : auto, haiku, sonnet, opus, ou agents <modèle>',
      argumentHint: '[auto|haiku|sonnet|opus|agents <haiku|sonnet|opus|defaut>]',
    })
    showStatus($, await read($, current))

    return next(e)
  })

  on('command.run', { command: 'modele' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const wanted = words[0] ?? ''
    if (wanted === 'agents') {
      const choice = words[1] ?? ''
      if (choice === 'defaut' || isTier(choice)) {
        await update($, subagents, () => choice)
      } else {
        return { text: `« ${choice} » n'est pas un choix pour les sous-agents (haiku, sonnet, opus ou defaut).\n\n${await summary($)}` }
      }
    } else if (wanted === 'auto' || isTier(wanted)) {
      await update($, mode, () => wanted)
      await update($, current, () => (isTier(wanted) ? { tier: wanted, reason: 'forcé' } : null))
      await update($, turn, () => null)
      showStatus($, await read($, current))
    } else if (wanted !== '') {
      return { text: `« ${wanted} » n'est pas un choix possible.\n\n${await summary($)}` }
    }

    return { text: await summary($) }
  })

  // Une nouvelle demande (pas un message glissé dans un tour en cours) : on classe sa difficulté.
  on('prompt.submit', async ($, e, next) => {
    if (e.turnId === undefined) {
      const m = await read($, mode)
      const choice: Choice = m === 'auto' ? await classify($, e.text) : { tier: m, reason: 'forcé' }
      await update($, current, () => choice)
      await update($, counts, c => ({ ...c, [choice.tier]: c[choice.tier] + 1 }))
      await update($, stats, s => ({ ...s, prompts: s.prompts + 1 }))
      showStatus($, choice)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    // Les sous-agents : une conversation neuve et courte, donc pas de cache à perdre. Ils passent sur
    // le modèle choisi pour eux, sauf s'ils ont demandé eux-mêmes un autre modèle que celui de la session.
    if (e.agentId !== undefined) {
      const sub = await read($, subagents)
      if (sub === 'defaut' || sessionModel === undefined || e.model !== sessionModel || e.model === MODEL_ID[sub]) {
        return yield* next(e)
      }
      await update($, stats, s => ({ ...s, subagentSteps: s.subagentSteps + 1 }))

      return yield* next({ ...e, model: MODEL_ID[sub] })
    }

    sessionModel ??= e.model
    const choice = await read($, current)
    if (choice === null) {
      return yield* next(e)
    }

    // On décide une fois par tour : changer de modèle au milieu d'un tour reviendrait à relire toute
    // la conversation sans cache à chaque changement.
    const now = await $.clock.now()
    const previous = await read($, last)
    const decided = await read($, turn)
    let tier: ModelTier
    if (decided !== null && decided.id === e.turnId) {
      tier = decided.tier
    } else if ((await read($, mode)) !== 'auto') {
      tier = choice.tier
    } else {
      const s = await read($, stats)
      const hot = new Set<ModelTier>()
      for (const [name, usedAt] of Object.entries(previous?.usedAt ?? {})) {
        if (isTier(name) && usedAt !== undefined && now - usedAt < CACHE_LIFETIME_MS) {
          hot.add(name)
        }
      }
      const routed = route({
        wanted: choice.tier,
        last: previous?.tier ?? null,
        context: previous?.context ?? 0,
        hot,
        averageOutput: s.prompts >= MIN_PROMPTS_FOR_AVERAGE ? s.outputTokens / s.prompts : DEFAULT_OUTPUT_PER_PROMPT,
      })
      tier = routed.tier
      if (routed.isStaying) {
        await update($, stats, st => ({ ...st, stayed: st.stayed + 1 }))
      }
    }
    if (decided === null || decided.id !== e.turnId) {
      await update($, turn, () => ({ id: e.turnId, tier }))
      showStatus($, choice, tier)
    }

    const response = yield* next({ ...e, model: MODEL_ID[tier] })

    const usage = response.usage
    const context = usage === null ? (previous?.context ?? 0) : usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
    await update($, last, before => ({ tier, context, usedAt: { ...(before?.usedAt ?? {}), [tier]: now } }))
    await update($, stats, s => ({
      ...s,
      steps: { ...s.steps, [tier]: s.steps[tier] + 1 },
      outputTokens: s.outputTokens + (usage?.output_tokens ?? 0),
    }))

    return response
  })
}

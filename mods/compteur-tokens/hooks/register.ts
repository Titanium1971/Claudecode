import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, SessionRateLimit } from 'claude-code'

import type { ModelTotals } from '../types'

// Prix en dollars par million de tokens (tarifs publics de l'API, octobre 2026).
// L'écriture en cache coûte 1,25 fois l'entrée.
type Price = { input: number; output: number; cacheRead: number }

const PRICES: ReadonlyArray<[RegExp, Price]> = [
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet/, { input: 3, output: 15, cacheRead: 0.3 }],
  [/haiku-5/, { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  [/haiku/, { input: 1, output: 5, cacheRead: 0.1 }],
]

// Un modèle inconnu est compté au prix d'Opus 5.5, pour ne pas sous-estimer.
const DEFAULT_PRICE: Price = { input: 4, output: 20, cacheRead: 0.2 }
const REFERENCE = 'claude-opus-5-5'

const ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}

const totals = atom({ plugin: 'compteur-tokens', key: 'totals' } as const, {} as Record<string, ModelTotals>)
const alertAt = atom({ plugin: 'compteur-tokens', key: 'alertAt' } as const, 5)
const alerted = atom({ plugin: 'compteur-tokens', key: 'alerted' } as const, false)
// Le coût total de la session, publié pour les autres mods (etude-de-cas le lit).
const sessionTotal = atom({ plugin: 'compteur-tokens', key: 'cost' } as const, 0)

function priceOf(model: string): Price {
  for (const [pattern, price] of PRICES) {
    if (pattern.test(model)) {
      return price
    }
  }

  return DEFAULT_PRICE
}

function costOf(t: ModelTotals, price: Price): number {
  return (
    (t.input * price.input +
      t.output * price.output +
      t.cacheRead * price.cacheRead +
      t.cacheWrite * price.input * 1.25) /
    1_000_000
  )
}

function dollars(value: number): string {
  return `${value.toFixed(value < 1 ? 3 : 2).replace('.', ',')} $`
}

function thousands(value: number): string {
  if (value < 1000) {
    return String(value)
  }

  return `${String(Math.round(value / 1000)).replace(/\B(?=(\d{3})+$)/g, ' ')} k`
}

function sessionCost(all: Record<string, ModelTotals>): number {
  return Object.entries(all).reduce((sum, [model, t]) => sum + costOf(t, priceOf(model)), 0)
}

async function record($: EngineInterface, rawModel: string, usage: ModelUsage): Promise<void> {
  const model = ALIASES[rawModel] ?? rawModel
  await update($, totals, all => {
    const t = all[model] ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

    return {
      ...all,
      [model]: {
        calls: t.calls + 1,
        input: t.input + usage.input_tokens,
        output: t.output + usage.output_tokens,
        cacheRead: t.cacheRead + usage.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + usage.cache_creation_input_tokens,
      },
    }
  })

  const cost = sessionCost(await read($, totals))
  await update($, sessionTotal, () => cost)
  const limit = await read($, alertAt)
  if (limit > 0 && cost >= limit && !(await read($, alerted))) {
    await update($, alerted, () => true)
    const text = `compteur-tokens : la session a dépassé ${dollars(limit)} (équivalent API). Pense à /compact ou à une nouvelle session.`
    $.ui.toast(text)
    $.ui.log(text)
  }
}

// Limites d'abonnement : la lecture que le moteur fait lui-même des fenêtres 5 h et 7 jours
// (les en-têtes de la dernière réponse de l'API), via $.session.usage().
const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Limite 5 h',
  seven_day: 'Limite 7 jours',
  seven_day_opus: 'Limite 7 jours (Opus)',
  seven_day_sonnet: 'Limite 7 jours (Sonnet)',
  spend_limit: 'Plafond de dépenses',
}
const LIMIT_ORDER = Object.keys(LIMIT_NAMES)

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function clockTime(date: Date): string {
  return `${date.getHours()} h ${pad(date.getMinutes())}`
}

function duration(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) {
    return `${days} j ${hours} h`
  }

  return hours > 0 ? `${hours} h ${pad(minutes % 60)}` : `${minutes} min`
}

function resetText(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) {
    return ''
  }
  const date = new Date(at)
  const isToday = date.toDateString() === new Date(now).toDateString()
  const when = isToday ? `à ${clockTime(date)}` : `le ${pad(date.getDate())}/${pad(date.getMonth() + 1)} à ${clockTime(date)}`

  return at > now ? `, remise à zéro ${when} (dans ${duration(at - now)})` : `, remise à zéro ${when}`
}

// Les lignes des limites d'abonnement, ou undefined quand le moteur n'en a aucune lecture.
async function limitLines($: EngineInterface): Promise<string[] | undefined> {
  let limits: SessionRateLimit[]
  try {
    limits = (await $.session.usage()).rateLimits
  } catch {
    return undefined
  }
  if (limits.length === 0) {
    return undefined
  }
  let now: number
  try {
    now = await $.clock.now()
  } catch {
    now = Date.now()
  }
  const rank = (kind: string): number => (LIMIT_ORDER.includes(kind) ? LIMIT_ORDER.indexOf(kind) : LIMIT_ORDER.length)

  return [...limits]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map(
      l =>
        `  ${LIMIT_NAMES[l.kind] ?? `Limite ${l.kind}`} : ${String(l.percentUsed).replace('.', ',')} % utilisés${l.resetsAt === undefined ? '' : resetText(l.resetsAt, now)}`,
    )
}

async function summary($: EngineInterface): Promise<string> {
  const all = await read($, totals)
  const models = Object.keys(all).sort()
  const limits = await limitLines($)
  if (models.length === 0) {
    const none = "Aucun appel au modèle compté pour l'instant."

    return limits === undefined ? none : [none, "Limites d'abonnement :", ...limits].join('\n')
  }

  const lines = ['Coût de la session (équivalent API, estimation) :']
  for (const model of models) {
    const t = all[model]
    if (t === undefined) {
      continue
    }
    lines.push(
      `  ${model} : ${t.calls} appel${t.calls > 1 ? 's' : ''}, entrée ${thousands(t.input + t.cacheRead + t.cacheWrite)} (dont cache ${thousands(t.cacheRead)}), sortie ${thousands(t.output)} → ${dollars(costOf(t, priceOf(model)))}`,
    )
  }

  const cost = sessionCost(all)
  const allOpus = Object.values(all).reduce((sum, t) => sum + costOf(t, priceOf(REFERENCE)), 0)
  lines.push(`Total : ${dollars(cost)}`)
  if (allOpus > cost) {
    lines.push(`Tout sur Opus 5.5 aurait coûté ${dollars(allOpus)} : économie ${dollars(allOpus - cost)}.`)
  }
  const limit = await read($, alertAt)
  lines.push(limit > 0 ? `Alerte à ${dollars(limit)}.` : 'Alerte désactivée.')
  if (limits === undefined) {
    lines.push("Limites d'abonnement : non disponibles dans cette session.")
  } else {
    lines.push("Limites d'abonnement :", ...limits)
  }
  lines.push('Commandes : /cout, /cout alerte <dollars> (0 pour couper), /cout zero')

  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cout',
      description: "Tokens et coût estimé de la session, par modèle, et limites d'abonnement (5 h, 7 jours)",
      argumentHint: '[alerte <dollars> | zero]',
    })

    return next(e)
  })

  on('command.run', { command: 'cout' }, async ($, e) => {
    const [word, value] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'zero') {
      await update($, totals, () => ({}))
      await update($, sessionTotal, () => 0)
      await update($, alerted, () => false)

      return { text: 'Compteur remis à zéro.' }
    }
    if (word === 'alerte') {
      const limit = Number((value ?? '').replace(',', '.'))
      if (!Number.isFinite(limit) || limit < 0) {
        return { text: 'Donne un montant en dollars, par exemple : /cout alerte 5' }
      }
      await update($, alertAt, () => limit)
      await update($, alerted, () => false)
    }

    return { text: await summary($) }
  })

  // Chaque appel au modèle de la session, fil principal et sous-agents.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (response.usage !== null) {
      await record($, response.usage.model, response.usage)
    }

    return response
  })

  // Les petits appels des mods eux-mêmes (le classement de choix-modele, par exemple).
  on('model.complete', async ($, e, next) => {
    const response = await next(e)
    if (response.value !== undefined) {
      await record($, e.model, response.value.usage)
    }

    return response
  })
}

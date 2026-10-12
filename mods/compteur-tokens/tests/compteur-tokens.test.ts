import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const MILLION_IN: Usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function bottom(on: On, model: string, usage: Usage, toasts: string[] = []): void {
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { ...usage, model },
    } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'SIMPLE', usage } as never }))
  on('ui.toast', ($, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
}

async function step($: Engine): Promise<void> {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1 } as never)
  for await (const _chunk of stream) {
    // on vide le flux
  }
}

async function cout($: Engine, args = ''): Promise<string> {
  return (await $.command.run({ command: 'cout', args } as never)).text ?? ''
}

test('compte les tokens et le coût par modèle', async ($, on) => {
  bottom(on, 'claude-sonnet-5-5', MILLION_IN)
  await step($)

  const text = await cout($)
  expect(text.includes('claude-sonnet-5-5 : 1 appel, entrée 1 000 k (dont cache 0), sortie 0 → 2,00 $')).toBe(true)
  expect(text.includes('Total : 2,00 $')).toBe(true)
  expect(text.includes('Tout sur Opus 5.5 aurait coûté 4,00 $ : économie 2,00 $.')).toBe(true)
})

test('prévient une seule fois quand la session dépasse le seuil', async ($, on) => {
  const toasts: string[] = []
  bottom(on, 'claude-opus-5-5', MILLION_IN, toasts)

  await cout($, 'alerte 6')
  await step($)
  expect(toasts.length).toBe(0)
  await step($)
  await step($)
  expect(toasts.length).toBe(1)
  expect(toasts[0]?.includes('a dépassé 6,00 $')).toBe(true)
})

test('/cout zero remet le compteur à zéro', async ($, on) => {
  bottom(on, 'claude-opus-5-5', MILLION_IN)
  await step($)
  await cout($, 'zero')

  expect(await cout($)).toBe("Aucun appel au modèle compté pour l'instant.")
})

// Midi, heure locale : les heures attendues ne dépendent pas du fuseau de la machine.
const NOON = new Date(2026, 9, 11, 12, 0, 0).getTime()
const MINUTE = 60_000

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

function limits(on: On, rateLimits: Limit[]): void {
  mock.clock(on, { now: NOON })
  on('session.usage', () => ({ value: { startedAt: NOON, context: { window: 200_000 }, rateLimits } as never }))
}

test("/cout montre les limites d'abonnement 5 h et 7 jours", async ($, on) => {
  bottom(on, 'claude-sonnet-5-5', MILLION_IN)
  limits(on, [
    { kind: 'seven_day', percentUsed: 12.5, resetsAt: new Date(NOON + (3 * 24 * 60 + 4 * 60) * MINUTE).toISOString() },
    { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(NOON + 125 * MINUTE).toISOString() },
  ])
  await step($)

  const text = await cout($)
  expect(text.includes('Total : 2,00 $')).toBe(true)
  expect(text.includes("Limites d'abonnement :\n  Limite 5 h : 42 % utilisés, remise à zéro à 14 h 05 (dans 2 h 05)\n  Limite 7 jours : 12,5 % utilisés, remise à zéro le 14/10 à 16 h 00 (dans 3 j 4 h)")).toBe(true)
})

test("/cout montre les limites même avant le premier appel compté", async ($, on) => {
  bottom(on, 'claude-sonnet-5-5', MILLION_IN)
  limits(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(NOON + 30 * MINUTE).toISOString() }])

  expect(await cout($)).toBe(
    "Aucun appel au modèle compté pour l'instant.\nLimites d'abonnement :\n  Limite 5 h : 100 % utilisés, remise à zéro à 12 h 30 (dans 30 min)",
  )
})

test("sans abonnement, /cout dit que les limites ne sont pas disponibles", async ($, on) => {
  bottom(on, 'claude-opus-5-5', MILLION_IN)
  limits(on, [])
  await step($)

  expect((await cout($)).includes("Limites d'abonnement : non disponibles dans cette session.")).toBe(true)
})

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
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

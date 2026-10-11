import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { route } from '../hooks/register'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAISSU = 'claude-haiku-5-5'
const BIG = 190_000
const MINUTE = 60_000

// Ce que le « modèle » de test a reçu, et ce qu'il répond au classement et en taille de conversation.
let asked = ''
let label: string | null = 'SIMPLE'
let reportedContext = 0

type Clock = ReturnType<typeof mock.clock>

function bottom(on: On): Clock {
  const clock = mock.clock(on)
  on('model.complete', () => ({
    value: (label === null
      ? { isAnswered: false, reason: 'aborted', usage: {} }
      : { isAnswered: true, text: label, usage: {} }) as never,
  }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.step', async function* ($, e) {
    asked = e.model

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        input_tokens: reportedContext,
        output_tokens: 1000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        model: e.model,
      },
    } as never
  })

  return clock
}

async function ask($: Engine, text: string, classedAs: string | null): Promise<void> {
  label = classedAs
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

async function step($: Engine, turnId = 't', agentId?: string, model = OPUS): Promise<string> {
  asked = ''
  const stream = $.turn.step({ turnId, index: 0, model, messageCount: 1, agentId } as never)
  for await (const _chunk of stream) {
    // on vide le flux
  }

  return asked
}

async function modele($: Engine, args = ''): Promise<string> {
  return (await $.command.run({ command: 'modele', args } as never)).text ?? ''
}

test('route : on monte toujours, on ne descend que si ça rapporte', () => {
  const none = new Set<'haiku' | 'sonnet' | 'opus'>()
  const base = { averageOutput: 3000, hot: none }
  // Début de session : le modèle voulu.
  expect(route({ ...base, wanted: 'sonnet', last: null, context: 0 }).tier).toBe('sonnet')
  // Monter : toujours.
  expect(route({ ...base, wanted: 'opus', last: 'haiku', context: BIG }).tier).toBe('opus')
  // Descendre avec une petite conversation : ça rapporte.
  expect(route({ ...base, wanted: 'sonnet', last: 'opus', context: 5000 }).tier).toBe('sonnet')
  // Descendre vers Sonnet avec une grosse conversation : ça coûte plus que ça ne rapporte.
  expect(route({ ...base, wanted: 'sonnet', last: 'opus', context: BIG })).toEqual({ tier: 'opus', isStaying: true })
  // Descendre vers Haiku : le cache de Haiku coûte presque rien, on y va même avec une grosse conversation.
  expect(route({ ...base, wanted: 'haiku', last: 'opus', context: BIG }).tier).toBe('haiku')
  // Le cache du modèle voulu est encore chaud : pas de perte.
  expect(route({ ...base, wanted: 'sonnet', last: 'opus', context: BIG, hot: new Set(['sonnet']) }).tier).toBe('sonnet')
})

for (const [classedAs, model] of [
  ['SIMPLE', HAISSU],
  ['STANDARD', SONNET],
  ['COMPLEXE', OPUS],
] as const) {
  test(`début de session : une demande classée ${classedAs} part sur ${model}`, async ($, on) => {
    bottom(on)
    reportedContext = 0
    await ask($, 'une demande', classedAs)

    expect(await step($)).toBe(model)
  })
}

test('si le classement échoue, on prend Sonnet', async ($, on) => {
  bottom(on)
  reportedContext = 0
  await ask($, 'une demande', null)

  expect(await step($)).toBe(SONNET)
})

test('grosse conversation : une demande standard reste sur Opus, une demande simple va sur Haiku', async ($, on) => {
  const clock = bottom(on)
  reportedContext = BIG
  await ask($, 'gros travail', 'COMPLEXE')
  expect(await step($, 't1')).toBe(OPUS)

  await clock.advance(10 * MINUTE)
  await ask($, 'code à écrire', 'STANDARD')
  expect(await step($, 't2')).toBe(OPUS)

  await ask($, 'une question', 'SIMPLE')
  expect(await step($, 't3')).toBe(HAISSU)

  expect((await modele($)).includes('Restés sur le modèle en cours pour ne pas perdre le cache : 1 fois')).toBe(true)
})

test('petite conversation : on descend sur Sonnet', async ($, on) => {
  bottom(on)
  reportedContext = 5000
  await ask($, 'gros travail', 'COMPLEXE')
  expect(await step($, 't1')).toBe(OPUS)

  await ask($, 'code à écrire', 'STANDARD')
  expect(await step($, 't2')).toBe(SONNET)
})

test('après Haiku, une demande complexe repart sur Opus même avec une grosse conversation', async ($, on) => {
  bottom(on)
  reportedContext = BIG
  await ask($, 'question', 'SIMPLE')
  expect(await step($, 't1')).toBe(HAISSU)

  await ask($, 'gros travail', 'COMPLEXE')
  expect(await step($, 't2')).toBe(OPUS)
})

test('le cache chaud de Sonnet permet d’y revenir même avec une grosse conversation', async ($, on) => {
  const clock = bottom(on)
  reportedContext = 5000
  await ask($, 'code', 'STANDARD')
  expect(await step($, 't1')).toBe(SONNET)

  await clock.advance(MINUTE)
  reportedContext = BIG
  await ask($, 'gros travail', 'COMPLEXE')
  expect(await step($, 't2')).toBe(OPUS)

  await clock.advance(MINUTE)
  await ask($, 'code', 'STANDARD')
  expect(await step($, 't3')).toBe(SONNET)
})

test('on ne change pas de modèle au milieu d’un tour', async ($, on) => {
  bottom(on)
  reportedContext = 5000
  await ask($, 'code', 'STANDARD')
  expect(await step($, 't1')).toBe(SONNET)

  // Une autre demande est classée pendant le tour : elle ne change rien avant le tour suivant.
  await ask($, 'gros travail', 'COMPLEXE')
  expect(await step($, 't1')).toBe(SONNET)
  expect(await step($, 't2')).toBe(OPUS)
})

test('les sous-agents passent sur Sonnet, sauf s’ils ont choisi leur modèle', async ($, on) => {
  bottom(on)
  reportedContext = 0
  await ask($, 'gros travail', 'COMPLEXE')
  expect(await step($, 't1')).toBe(OPUS)

  expect(await step($, 'a1', 'agent-1', OPUS)).toBe(SONNET)
  expect(await step($, 'a2', 'agent-2', HAISSU)).toBe(HAISSU)

  expect((await modele($)).includes('Sous-agents : Sonnet (1 appels déroutés)')).toBe(true)
})

test('/modele agents change ou coupe le déroutage des sous-agents', async ($, on) => {
  bottom(on)
  reportedContext = 0
  await ask($, 'gros travail', 'COMPLEXE')
  await step($, 't1')

  await modele($, 'agents defaut')
  expect(await step($, 'a1', 'agent-1', OPUS)).toBe(OPUS)

  await modele($, 'agents haiku')
  expect(await step($, 'a2', 'agent-2', OPUS)).toBe(HAISSU)

  expect((await modele($, 'agents gpt')).startsWith('« gpt » n\'est pas un choix pour les sous-agents')).toBe(true)
})

test('/modele force un modèle même avec une grosse conversation, puis /modele auto revient', async ($, on) => {
  bottom(on)
  reportedContext = BIG
  await ask($, 'gros travail', 'COMPLEXE')
  expect(await step($, 't1')).toBe(OPUS)

  expect((await modele($, 'sonnet')).includes('Mode : forcé sur Sonnet')).toBe(true)
  await ask($, 'une demande', 'COMPLEXE')
  expect(await step($, 't2')).toBe(SONNET)

  await modele($, 'auto')
  await ask($, 'une question', 'SIMPLE')
  expect(await step($, 't3')).toBe(HAISSU)

  const shown = await modele($)
  expect(shown.includes('Demandes classées : Haiku 1, Sonnet 1, Opus 1')).toBe(true)
  expect(shown.includes('Appels réellement faits : Haiku 1, Sonnet 1, Opus 1')).toBe(true)
})

test('/modele refuse un choix inconnu', async ($, on) => {
  bottom(on)

  expect((await modele($, 'gpt')).startsWith('« gpt » n\'est pas un choix possible.')).toBe(true)
})

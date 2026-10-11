import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Le « modèle » de test note le modèle qu'on lui a demandé.
let asked = ''

async function stepModel($: Engine, agentId?: string): Promise<string> {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId } as never)
  for await (const _chunk of stream) {
    // on vide le flux
  }

  return asked
}

function bottom(on: On, label: string | null): void {
  on('model.complete', () => ({
    value: (label === null
      ? { isAnswered: false, reason: 'aborted', usage: {} }
      : { isAnswered: true, text: label, usage: {} }) as never,
  }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.step', async function* ($, e) {
    asked = e.model

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
}

for (const [label, model] of [
  ['SIMPLE', 'claude-haiku-5-5'],
  ['STANDARD', 'claude-sonnet-5-5'],
  ['COMPLEXE', 'claude-opus-5-5'],
] as const) {
  test(`une demande classée ${label} part sur ${model}`, async ($, on) => {
    bottom(on, label)
    await $.prompt.submit({ text: 'une demande', wait: false, origin: { kind: 'composer' } })

    expect(await stepModel($)).toBe(model)
  })
}

test('si le classement échoue, on prend Sonnet', async ($, on) => {
  bottom(on, null)
  await $.prompt.submit({ text: 'une demande', wait: false, origin: { kind: 'composer' } })

  expect(await stepModel($)).toBe('claude-sonnet-5-5')
})

test('les sous-agents gardent leur modèle', async ($, on) => {
  bottom(on, 'SIMPLE')
  await $.prompt.submit({ text: 'une demande', wait: false, origin: { kind: 'composer' } })

  expect(await stepModel($, 'agent-1')).toBe('claude-opus-5-5')
})

test('/modele force un modèle, puis /modele auto revient au choix automatique', async ($, on) => {
  bottom(on, 'SIMPLE')

  const forced = await $.command.run({ command: 'modele', args: 'opus' } as never)
  expect((forced.text ?? '').includes('Mode : forcé sur Opus')).toBe(true)
  await $.prompt.submit({ text: 'une demande', wait: false, origin: { kind: 'composer' } })
  expect(await stepModel($)).toBe('claude-opus-5-5')

  await $.command.run({ command: 'modele', args: 'auto' } as never)
  await $.prompt.submit({ text: 'une demande', wait: false, origin: { kind: 'composer' } })
  expect(await stepModel($)).toBe('claude-haiku-5-5')

  const shown = await $.command.run({ command: 'modele', args: '' } as never)
  expect((shown.text ?? '').includes('Demandes cette session : Haiku 1, Sonnet 0, Opus 1')).toBe(true)
})

test('/modele refuse un choix inconnu', async ($, on) => {
  bottom(on, 'SIMPLE')

  const { text } = await $.command.run({ command: 'modele', args: 'gpt' } as never)
  expect((text ?? '').startsWith('« gpt » n\'est pas un choix possible.')).toBe(true)
})

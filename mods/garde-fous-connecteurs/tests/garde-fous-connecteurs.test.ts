import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// Le « connecteur » de test répond toujours ok ; la question est répondue par `answer`.
function bottom(on: On, answer: string | null, ran: string[], questions: string[] = []): void {
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const q = (e as unknown as { questions: Array<{ question: string }> }).questions[0]?.question ?? ''
      questions.push(q)
      if (answer === null) {
        return { deny: 'fermée' }
      }

      return { result: { questions: [], answers: { [q]: answer } } as never }
    }
    ran.push(e.tool)

    return { result: { content: [{ type: 'text', text: 'ok' }] } as never }
  })
}

test('une lecture passe sans question', async ($, on) => {
  const ran: string[] = []
  const questions: string[] = []
  bottom(on, 'Refuser', ran, questions)

  await $.tool.call({ tool: 'mcp__Gmail__search_threads', query: 'facture' } as never)
  expect(ran).toEqual(['mcp__Gmail__search_threads'])
  expect(questions.length).toBe(0)
})

test('un envoi demande confirmation et passe si Cyril autorise', async ($, on) => {
  const ran: string[] = []
  const questions: string[] = []
  bottom(on, 'Autoriser', ran, questions)

  await $.tool.call({ tool: 'mcp__Gmail__send_message', to: 'client@exemple.fr' } as never)
  expect(ran).toEqual(['mcp__Gmail__send_message'])
  expect(questions[0]?.startsWith('Claude veut utiliser Gmail → send_message avec {"to":"client@exemple.fr"}')).toBe(true)
})

test('un refus bloque l’action', async ($, on) => {
  const ran: string[] = []
  bottom(on, 'Refuser', ran)

  const r = await $.tool.call({ tool: 'mcp__Airtable__delete_records_for_table' } as never)
  expect(ran).toEqual([])
  expect(r.deny?.startsWith('Cyril a refusé cette action')).toBe(true)
})

test('une question fermée sans réponse bloque l’action', async ($, on) => {
  const ran: string[] = []
  bottom(on, null, ran)

  const r = await $.tool.call({ tool: 'mcp__Notion__notion-update-page' } as never)
  expect(ran).toEqual([])
  expect(r.deny !== undefined).toBe(true)
})

test('« Toujours pour cet outil » ne redemande plus', async ($, on) => {
  const ran: string[] = []
  const questions: string[] = []
  bottom(on, 'Toujours pour cet outil', ran, questions)

  await $.tool.call({ tool: 'mcp__Google_Calendar__create_event' } as never)
  await $.tool.call({ tool: 'mcp__Google_Calendar__create_event' } as never)
  expect(ran.length).toBe(2)
  expect(questions.length).toBe(1)

  const { text } = await $.command.run({ command: 'connecteurs', args: '' } as never)
  expect((text ?? '').includes('Toujours autorisés : mcp__Google_Calendar__create_event')).toBe(true)
})

test('GitHub : une PR passe, une fusion demande confirmation', async ($, on) => {
  const ran: string[] = []
  const questions: string[] = []
  bottom(on, 'Refuser', ran, questions)

  await $.tool.call({ tool: 'mcp__github__create_pull_request' } as never)
  await $.tool.call({ tool: 'mcp__github__merge_pull_request' } as never)
  expect(ran).toEqual(['mcp__github__create_pull_request'])
  expect(questions.length).toBe(1)
})

test('les outils qui ne sont pas des connecteurs ne sont pas concernés', async ($, on) => {
  const ran: string[] = []
  bottom(on, 'Refuser', ran)

  await $.tool.call({ tool: 'Write', file_path: '/tmp/a', content: 'x' } as never)
  expect(ran).toEqual(['Write'])
})

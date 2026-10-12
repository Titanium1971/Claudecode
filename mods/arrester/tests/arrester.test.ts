import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const T0 = 1_000_000
const MIN = 60_000
const HOOK_ERROR = 'PreToolUse:Bash hook error: [/projet/.claude/hooks/guard.sh]: lecture des secrets interdite'
const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected."

type Guard = (e: Readonly<Record<string, unknown>>) => { deny: string } | { text: string } | undefined

/** The engine beneath Arrester: a session in /projet, a file system with no file, and tools that run unless `guard` blocks them the way a settings hook, a user or another mod does. */
function world(on: On, guard: Guard) {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { HOME: '/home/cyril' })
  const ran: string[] = []
  const logs: string[] = []
  on('session.start', (_$, e) => e as never)
  on('session.cwd', () => ({ value: '/projet' }))
  on('session.root', () => ({ value: '/projet' }))
  on('session.turns', () => ({ value: 1 }))
  on('settings.read', () => ({ value: {} }) as never)
  on('fs.exists', () => ({ value: false }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    logs.push(String(e.text))
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'arrester' } }) as never)
  on('tool.call', (_$, e) => {
    const blocked = guard(e as never)
    if (blocked !== undefined && 'deny' in blocked) return blocked
    if (blocked !== undefined) return { result: blocked.text, text: blocked.text, isError: true } as never
    ran.push(`${e.tool} ${String((e as { command?: unknown }).command ?? (e as { file_path?: unknown }).file_path)}`)
    return { result: 'ok', text: 'ok' } as never
  })
  return { clock, ran, logs }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/projet', surface: 'terminal', isInteractive: true } as never)
}

test("après un blocage par un hook, la même cible par un autre outil est stoppée", async ($, on) => {
  const { ran } = world(on, e => (e.command === 'cat secrets.txt' ? { text: HOOK_ERROR } : undefined))
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'cat secrets.txt', tool_use_id: 'u1' } as never)
  const detour = await $.tool.call({ tool: 'Read', file_path: '/projet/secrets.txt', tool_use_id: 'u2' } as never)
  expect(detour.deny ?? '').toMatch(/Arrester stopped this call/)
  expect(detour.deny ?? '').toMatch(/tell the user/)

  const other = await $.tool.call({ tool: 'Read', file_path: '/projet/notes.md', tool_use_id: 'u3' } as never)
  expect(other.deny).toBeUndefined()
  expect(ran).toEqual(['Read /projet/notes.md'])
})

test('un refus renvoyé par un autre mod (garde-fous) ouvre aussi un blocage', async ($, on) => {
  const { ran } = world(on, e => (e.tool === 'Read' && e.file_path === '/projet/.env' ? { deny: 'garde-fous: /projet/.env contient probablement des secrets.' } : undefined))
  await start($)

  const first = await $.tool.call({ tool: 'Read', file_path: '/projet/.env', tool_use_id: 'u1' } as never)
  expect(first.deny ?? '').toMatch(/^garde-fous/)
  const detour = await $.tool.call({ tool: 'Bash', command: 'head -n 5 /projet/.env', tool_use_id: 'u2' } as never)
  expect(detour.deny ?? '').toMatch(/Arrester stopped this call/)
  expect(ran).toEqual([])
})

test('un refus de Cyril dans garde-fous-connecteurs ne stoppe que la même action exacte', async ($, on) => {
  const refuse = (e: Readonly<Record<string, unknown>>) => e.tool === 'mcp__Gmail__send_message' && e.tool_use_id === 'u1'
  const { ran } = world(on, e => (refuse(e) ? { deny: 'Cyril a refusé cette action (mcp__Gmail__send_message). Ne la refais pas sans lui demander.' } : undefined))
  await start($)

  await $.tool.call({ tool: 'mcp__Gmail__send_message', to: 'a@b.fr', body: 'salut', tool_use_id: 'u1' } as never)
  const retry = await $.tool.call({ tool: 'mcp__Gmail__send_message', to: 'a@b.fr', body: 'salut', tool_use_id: 'u2' } as never)
  expect(retry.deny ?? '').toMatch(/repeats the call the user rejected/)
  const other = await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 'u3' } as never)
  expect(other.deny).toBeUndefined()
  expect(ran).toEqual(['Bash git status'])
})

test("les refus des autres mods (sortie raccourcie, conseil de lecture) n'ouvrent aucun blocage", async ($, on) => {
  const { ran } = world(on, e => (e.tool_use_id === 'u1' ? { deny: 'Sortie raccourcie (12 000 caractères) : la suite est dans /tmp/sortie.txt' } : undefined))
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'u1' } as never)
  const again = await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'u2' } as never)
  expect(again.deny).toBeUndefined()
  expect(ran).toEqual(['Bash npm test'])
})

test('après un « non » de la personne, seul le même appel exact est stoppé', async ($, on) => {
  const { ran } = world(on, e => (e.command === 'rm -rf build' && e.tool_use_id === 'u1' ? { text: REJECTED } : undefined))
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'u1' } as never)
  const retry = await $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'u2' } as never)
  expect(retry.deny ?? '').toMatch(/repeats the call the user rejected/)
  const other = await $.tool.call({ tool: 'Bash', command: 'ls build', tool_use_id: 'u3' } as never)
  expect(other.deny).toBeUndefined()
  expect(ran).toEqual(['Bash ls build'])
})

test('/arrester montre les blocages, /arrester clear les ferme, et un blocage expire seul', async ($, on) => {
  const { clock, ran } = world(on, e => (e.command === 'cat secrets.txt' ? { text: HOOK_ERROR } : undefined))
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'cat secrets.txt', tool_use_id: 'u1' } as never)
  const status = await $.command.run({ command: 'arrester', args: '', origin: { kind: 'composer' } } as never)
  expect(status.text ?? '').toMatch(/Open blocks \(1\)/)

  const refused = await $.command.run({ command: 'arrester', args: 'clear', origin: { kind: 'plugin' } } as never)
  expect(refused.text ?? '').toMatch(/needs the user at the prompt/)
  const cleared = await $.command.run({ command: 'arrester', args: 'clear', origin: { kind: 'composer' } } as never)
  expect(cleared.text).toBe('Closed 1 block.')
  const after = await $.tool.call({ tool: 'Read', file_path: '/projet/secrets.txt', tool_use_id: 'u2' } as never)
  expect(after.deny).toBeUndefined()

  await $.tool.call({ tool: 'Bash', command: 'cat secrets.txt', tool_use_id: 'u3' } as never)
  await clock.advance(31 * MIN)
  const expired = await $.tool.call({ tool: 'Read', file_path: '/projet/secrets.txt', tool_use_id: 'u4' } as never)
  expect(expired.deny).toBeUndefined()
  expect(ran).toEqual(['Read /projet/secrets.txt', 'Read /projet/secrets.txt'])
})

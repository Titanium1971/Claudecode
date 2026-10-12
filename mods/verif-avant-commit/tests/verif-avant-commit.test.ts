import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type Repo = {
  staged?: string[]
  unstaged?: string[]
  untracked?: string[]
  // Les mods dont « validate » ou « test » échoue.
  failValidate?: string[]
  failTest?: string[]
  // Si vrai, la commande claude ne se lance pas.
  claudeMissing?: boolean
}

const MODS = ['alpha', 'beta', 'nouveau']

type Seen = { runs: string[]; cwds: string[]; logs: string[]; commits: number }

const FAIL_OUTPUT = [
  'tests/alpha.test.ts:',
  '(pass) un test qui passe [10ms]',
  '(fail) le compteur compte [12ms]',
  '  AssertionError: expect(received).toBe()',
  '  Expected: 2',
  '  Received: 1',
  '',
  ' 1 pass',
  ' 1 fail',
].join('\n')

function bottom(on: On, repo: Repo): Seen {
  const seen: Seen = { runs: [], cwds: [], logs: [], commits: 0 }
  const lines = (list: string[] | undefined): string => (list ?? []).map(p => `${p}\n`).join('')

  on('process.run', ($, e) => {
    const cmd = e.argv.join(' ')
    seen.runs.push(cmd)
    seen.cwds.push(e.init?.cwd ?? '')
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = (stdout: string) => ({ value: { exitCode: 1, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

    if (cmd === 'git rev-parse --show-toplevel') return ok('/depot\n')
    if (cmd === 'git diff --name-only --cached') return ok(lines(repo.staged))
    if (cmd === 'git diff --name-only') return ok(lines(repo.unstaged))
    if (cmd === 'git ls-files --others --exclude-standard') return ok(lines(repo.untracked))
    if (repo.claudeMissing === true) return { deny: 'claude introuvable' }
    const mod = (e.argv[3] ?? '').replace('mods/', '')
    if (e.argv[2] === 'validate') {
      return repo.failValidate?.includes(mod) === true ? fail(`× Found 1 error:\n  > name: Invalid input\n× Validation failed`) : ok('√ Validation passed')
    }
    if (e.argv[2] === 'test') {
      return repo.failTest?.includes(mod) === true ? fail(FAIL_OUTPUT) : ok(' 3 pass\n 0 fail')
    }

    return fail('commande inattendue')
  })
  on('fs.exists', ($, e) => ({ value: MODS.some(m => e.path === `/depot/mods/${m}/.claude-plugin/plugin.json`) }))
  on('fs.list', () => ({
    value: [...MODS, 'README.md'].map(name => ({ name, kind: name.endsWith('.md') ? 'file' : 'dir', size: 0, mtimeMs: 0 })) as never,
  }))
  on('ui.log', ($, e) => {
    seen.logs.push(e.text)

    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () => {
    seen.commits += 1

    return { result: { stdout: 'fait', stderr: '', interrupted: false } }
  })

  return seen
}

async function bash($: Engine, command: string): Promise<string | undefined> {
  return (await $.tool.call({ tool: 'Bash', command })).deny
}

async function verif($: Engine, args = ''): Promise<string> {
  return (await $.command.run({ command: 'verif', args } as never)).text ?? ''
}

test('un commit est refusé quand le test d’un mod modifié échoue', async ($, on) => {
  const seen = bottom(on, { staged: ['mods/alpha/hooks/register.ts', 'README.md'], unstaged: ['mods/beta/tests/beta.test.ts'], failTest: ['alpha'] })

  const deny = await bash($, 'git commit -m "maj"')
  expect(deny !== undefined).toBe(true)
  expect((deny ?? '').includes('alpha : « claude plugin test mods/alpha » échoue')).toBe(true)
  expect((deny ?? '').includes('(fail) le compteur compte')).toBe(true)
  expect((deny ?? '').includes('Expected: 2')).toBe(true)
  expect((deny ?? '').includes('(pass)')).toBe(false)
  expect((deny ?? '').includes('beta')).toBe(false)
  expect(seen.commits).toBe(0)
  expect(seen.runs.includes('claude plugin validate mods/alpha')).toBe(true)
  expect(seen.runs.includes('claude plugin test mods/beta')).toBe(true)
  expect(seen.cwds[seen.runs.indexOf('claude plugin test mods/alpha')]).toBe('/depot')
})

test('validate en échec : le test n’est pas lancé et le commit est refusé', async ($, on) => {
  const seen = bottom(on, { staged: ['mods/beta/.claude-plugin/plugin.json'], failValidate: ['beta'] })

  const deny = await bash($, 'git add mods/beta && git commit -m "maj"')
  expect((deny ?? '').includes('beta : « claude plugin validate mods/beta » échoue')).toBe(true)
  expect((deny ?? '').includes('× Found 1 error')).toBe(true)
  expect(seen.runs.includes('claude plugin test mods/beta')).toBe(false)
  expect(seen.commits).toBe(0)
})

test('tout passe : le commit continue et le journal le dit', async ($, on) => {
  const seen = bottom(on, { staged: ['mods/alpha/hooks/register.ts'] })

  expect(await bash($, 'git -C /depot commit -m "maj"')).toBe(undefined)
  expect(seen.commits).toBe(1)
  expect(seen.logs.some(l => l.includes('alpha vérifié(s), validate et test passent'))).toBe(true)
})

test('aucun mod modifié, ou pas un commit : rien n’est lancé', async ($, on) => {
  const seen = bottom(on, { staged: ['README.md'], untracked: ['mods/nouveau/hooks/register.ts'] })

  expect(await bash($, 'git status')).toBe(undefined)
  expect(seen.runs.length).toBe(0)

  expect(await bash($, 'git commit -m "doc"')).toBe(undefined)
  expect(seen.runs.some(r => r.startsWith('claude'))).toBe(false)
  expect(seen.commits).toBe(2)
})

test('un nouveau mod ajouté par « git add -A » est vérifié', async ($, on) => {
  const seen = bottom(on, { untracked: ['mods/nouveau/hooks/register.ts'], failTest: ['nouveau'] })

  const deny = await bash($, 'git add -A && git commit -m "nouveau mod"')
  expect((deny ?? '').includes('nouveau : « claude plugin test mods/nouveau » échoue')).toBe(true)
  expect(seen.commits).toBe(0)
})

test('si la vérification ne peut pas tourner, le commit passe et le journal le dit', async ($, on) => {
  const seen = bottom(on, { staged: ['mods/alpha/hooks/register.ts'], claudeMissing: true })

  expect(await bash($, 'git commit -m "maj"')).toBe(undefined)
  expect(seen.commits).toBe(1)
  expect(seen.logs.some(l => l.includes('le commit passe sans vérification'))).toBe(true)
})

test('/verif vérifie à la demande : mods modifiés, tous, ou un seul', async ($, on) => {
  const seen = bottom(on, { unstaged: ['mods/beta/hooks/register.ts'], untracked: ['mods/nouveau/types/index.d.ts'], failTest: ['nouveau'] })

  const changed = await verif($)
  expect(changed.includes('1 mod(s) sur 2 en échec')).toBe(true)
  expect(changed.includes('OK      beta')).toBe(true)
  expect(changed.includes('ÉCHEC   nouveau')).toBe(true)

  const all = await verif($, 'tout')
  expect(all.includes('OK      alpha')).toBe(true)
  expect(all.includes('README')).toBe(false)

  const one = await verif($, 'alpha')
  expect(one.includes('1 mod(s) vérifié(s), tout passe.')).toBe(true)

  expect(await verif($, 'inconnu')).toBe('Vérif avant commit : pas de mod « inconnu » dans mods/.')
  expect(seen.commits).toBe(0)
})

test('/verif compte les commits vérifiés et bloqués', async ($, on) => {
  bottom(on, { staged: ['mods/alpha/hooks/register.ts'], failTest: ['alpha'] })

  await bash($, 'git commit -m "un"')
  await bash($, 'git commit -m "deux"')
  const text = await verif($, 'beta')
  expect(text.includes('Commits vérifiés dans cette session : 2, dont 2 bloqué(s).')).toBe(true)
})

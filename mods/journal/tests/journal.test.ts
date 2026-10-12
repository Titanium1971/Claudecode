import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { isJournalOnly, lastEntries, mask, parisTime, summarizePrompt } from '../hooks/register'

// 11 octobre 2026, 14 h 32 UTC = 16 h 32 à Paris (heure d'été).
const NOW = Date.UTC(2026, 9, 11, 14, 32)

type World = { files: Map<string, string>; writes: string[] }

function bottom(on: On, files: Record<string, string> = {}): World {
  const world: World = { files: new Map(Object.entries(files)), writes: [] }
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '/repo\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.read', ($, e) => {
    const text = world.files.get(e.path)

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    world.files.set(e.path, e.text)
    world.writes.push(e.path)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') {
      const command = String(e.command)
      if (command.includes('commit')) {
        return { result: { stdout: '[claude/journal 1a2b3c4] Ajoute le mod journal\n 3 files changed', stderr: '' } as never }
      }
      if (command.includes('push')) {
        return { result: { stdout: '', stderr: 'To github.com:cyril/Claudecode.git\n * [new branch]      claude/journal -> claude/journal' } as never }
      }

      return { result: { stdout: 'ok', stderr: '' } as never }
    }
    if (String(e.tool) === 'mcp__github__create_pull_request') {
      return { result: { content: [{ type: 'text', text: '{"html_url":"https://github.com/cyril/Claudecode/pull/7"}' }] } as never, text: '{"html_url":"https://github.com/cyril/Claudecode/pull/7"}' }
    }

    return { result: { type: 'ok' } as never }
  })

  return world
}

async function turn($: Engine, text: string, body: () => Promise<void>, isAborted = false): Promise<void> {
  await $.turn.start({ text, turnId: 't' } as never)
  await body()
  await $.turn.complete({ answer: 'fini', durationMs: 10, isAborted, turnId: 't', reason: isAborted ? 'aborted' : 'answer' } as never)
}

test('une demande qui modifie des fichiers, commite et ouvre une PR est notée', async ($, on) => {
  const world = bottom(on)

  await turn($, 'Crée le mod journal\net ouvre une PR', async () => {
    await $.tool.call({ tool: 'Write', file_path: '/repo/mods/journal/hooks/register.ts', content: 'secret' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'b', new_string: 'c' } as never)
    await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "Ajoute le mod journal"' } as never)
    await $.tool.call({ tool: 'Bash', command: 'git push -u origin claude/journal' } as never)
    await $.tool.call({ tool: 'mcp__github__create_pull_request', title: 'Mod journal', head: 'claude/journal', base: 'main', body: 'long texte' } as never)
  })

  const journal = world.files.get('/repo/JOURNAL.md') ?? ''
  expect(journal.startsWith('# Journal\n')).toBe(true)
  expect(journal.includes('## 2026-10-11 16:32 — Crée le mod journal et ouvre une PR\n')).toBe(true)
  expect(journal.includes('- Fichiers modifiés : `mods/journal/hooks/register.ts`, `README.md`\n')).toBe(true)
  expect(journal.includes('- Commit 1a2b3c4 « Ajoute le mod journal »\n')).toBe(true)
  expect(journal.includes('- Push (branche claude/journal)\n')).toBe(true)
  expect(journal.includes('- PR créée « Mod journal » : https://github.com/cyril/Claudecode/pull/7\n')).toBe(true)
  // Jamais le contenu des outils.
  expect(journal.includes('secret')).toBe(false)
  expect(journal.includes('long texte')).toBe(false)
})

test('une simple question ne laisse pas d’entrée', async ($, on) => {
  const world = bottom(on)

  await turn($, 'Explique-moi ce que fait n8n', async () => {
    await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' } as never)
    await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  })
  expect(world.writes).toEqual([])
})

test('les fichiers hors du dépôt et JOURNAL.md lui-même sont ignorés', async ($, on) => {
  const world = bottom(on)

  await turn($, 'Prépare un brouillon', async () => {
    await $.tool.call({ tool: 'Write', file_path: '/tmp/brouillon.txt', content: 'x' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/JOURNAL.md', old_string: 'a', new_string: 'b' } as never)
  })
  expect(world.writes).toEqual([])
})

test('les entrées s’ajoutent à la suite, et /journal montre les dernières', async ($, on) => {
  const world = bottom(on, { '/repo/JOURNAL.md': '# Journal\n\n## 2026-10-10 09:00 — Ancienne demande\n\n- Fichiers modifiés : `a.txt`\n' })

  await turn($, 'Nouvelle demande', async () => {
    await $.tool.call({ tool: 'Write', file_path: '/repo/b.txt', content: 'x' } as never)
  })
  const journal = world.files.get('/repo/JOURNAL.md') ?? ''
  expect(journal.indexOf('Ancienne demande') < journal.indexOf('Nouvelle demande')).toBe(true)
  expect(journal.includes('`a.txt`\n\n## 2026-10-11 16:32 — Nouvelle demande\n')).toBe(true)

  const { text } = await $.command.run({ command: 'journal', args: '' } as never)
  expect((text ?? '').startsWith('Les 2 dernières entrées de JOURNAL.md :')).toBe(true)
  const one = (await $.command.run({ command: 'journal', args: '1' } as never)).text ?? ''
  expect(one.includes('Ancienne demande')).toBe(false)
  expect(one.includes('Nouvelle demande')).toBe(true)
})

test('/journal off met en pause, /journal on relance', async ($, on) => {
  const world = bottom(on)

  await $.command.run({ command: 'journal', args: 'off' } as never)
  await turn($, 'Demande en pause', async () => {
    await $.tool.call({ tool: 'Write', file_path: '/repo/c.txt', content: 'x' } as never)
  })
  expect(world.writes).toEqual([])
  expect(((await $.command.run({ command: 'journal', args: '' } as never)).text ?? '').includes('en pause')).toBe(true)

  await $.command.run({ command: 'journal', args: 'on' } as never)
  await turn($, 'Demande relancée', async () => {
    await $.tool.call({ tool: 'Write', file_path: '/repo/c.txt', content: 'x' } as never)
  })
  expect(world.writes).toEqual(['/repo/JOURNAL.md'])
})

test('une demande interrompue est notée comme telle', async ($, on) => {
  const world = bottom(on)

  await turn(
    $,
    'Refais tout',
    async () => {
      await $.tool.call({ tool: 'Write', file_path: '/repo/d.txt', content: 'x' } as never)
    },
    true,
  )
  expect((world.files.get('/repo/JOURNAL.md') ?? '').includes('- Demande interrompue avant la fin.\n')).toBe(true)
})

test('la demande est résumée sur une ligne, coupée et sans secret', async () => {
  const long = `Branche mon webhook avec la clé sk-abcdefghijklmnop1234 et token: abc123 ${'puis '.repeat(40)}`
  const line = summarizePrompt(long)
  expect(line.length <= 120).toBe(true)
  expect(line.endsWith('…')).toBe(true)
  expect(line.includes('sk-abcdefghijklmnop1234')).toBe(false)
  expect(line.includes('abc123')).toBe(false)
  expect(line.includes('[masqué]')).toBe(true)
  expect(summarizePrompt('  ')).toBe('(suite du travail)')
  expect(mask('clé ghp_ABCDEFGHIJKLMNOPQRSTUV123 ici')).toBe('clé [masqué] ici')
})

test('l’heure de Paris suit l’heure d’été et d’hiver', async () => {
  expect(parisTime(Date.UTC(2026, 9, 11, 14, 32))).toBe('2026-10-11 16:32')
  expect(parisTime(Date.UTC(2026, 11, 24, 23, 5))).toBe('2026-12-25 00:05')
  // Le 25 octobre 2026, on passe à l'heure d'hiver à 1 h UTC.
  expect(parisTime(Date.UTC(2026, 9, 25, 0, 30))).toBe('2026-10-25 02:30')
  expect(parisTime(Date.UTC(2026, 9, 25, 1, 30))).toBe('2026-10-25 02:30')
})

test('lastEntries découpe le fichier par entrée', async () => {
  const content = '# Journal\n\nintro\n\n## A\n\n- x\n\n## B\n\n- y\n\n## C\n'
  expect(lastEntries(content, 2)).toEqual(['## B\n\n- y', '## C'])
})

test('un commit qui n’enregistre que JOURNAL.md n’ajoute pas d’entrée', async ($, on) => {
  const world = bottom(on)

  await turn($, 'Commite le journal', async () => {
    await $.tool.call({ tool: 'Bash', command: 'git add JOURNAL.md && git commit -q -m "Journal : entrée" && git push -q origin claude/journal' } as never)
  })

  expect(world.writes.length).toBe(0)
})

test('isJournalOnly : seul JOURNAL.md, oui ; avec d’autres fichiers, non', async () => {
  expect(isJournalOnly('git add JOURNAL.md && git commit -m "Journal"')).toBe(true)
  expect(isJournalOnly('git add ./JOURNAL.md; git commit -m "Journal"')).toBe(true)
  expect(isJournalOnly('git add -A mods/x JOURNAL.md && git commit -m "Mod x"')).toBe(false)
  expect(isJournalOnly('git add JOURNAL.md && git add README.md && git commit -m "Doc"')).toBe(false)
  expect(isJournalOnly('git commit -am "Tout"')).toBe(false)
})

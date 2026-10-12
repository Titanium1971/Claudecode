import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type FakeFile = { size: number; text?: string }

const LINES_3000 = Array.from({ length: 3000 }, (_, i) => `ligne ${i}`).join('\n')
const LINES_500 = Array.from({ length: 500 }, (_, i) => `ligne ${i} ${'x'.repeat(180)}`).join('\n')

const FILES: Record<string, FakeFile> = {
  '/projet/long.log': { size: 45_000, text: LINES_3000 },
  '/projet/moyen.ts': { size: 95_000, text: LINES_500 },
  '/projet/enorme.json': { size: 5_000_000 },
  '/projet/petit.md': { size: 1_200, text: 'bonjour\n' },
  '/projet/photo.png': { size: 9_000_000 },
  '/projet/rapport.pdf': { size: 9_000_000 },
}

type Seen = { reads: string[]; stats: string[]; contents: string[] }

function bottom(on: On): Seen {
  const seen: Seen = { reads: [], stats: [], contents: [] }
  on('tool.call', { tool: 'Read' }, ($, e) => {
    seen.reads.push(e.file_path)

    return { result: { type: 'text', file: { filePath: e.file_path, content: 'ok' } } as never }
  })
  on('fs.stat', ($, e) => {
    seen.stats.push(e.path)
    const file = FILES[e.path]
    if (file === undefined) {
      return { deny: 'introuvable' }
    }

    return { value: { kind: 'file', size: file.size, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    seen.contents.push(e.path)

    return { value: FILES[e.path]?.text ?? '' }
  })

  return seen
}

async function lecture($: Engine, args = ''): Promise<string> {
  return (await $.command.run({ command: 'lecture', args } as never)).text ?? ''
}

test('un fichier de plus de 2000 lignes lu en entier est refusé, avec la marche à suivre', async ($, on) => {
  const seen = bottom(on)

  const r = await $.tool.call({ tool: 'Read', file_path: '/projet/long.log' })
  expect(r.deny !== undefined).toBe(true)
  expect((r.deny ?? '').includes('3 000 lignes, 45 Ko')).toBe(true)
  expect((r.deny ?? '').includes('Grep')).toBe(true)
  expect((r.deny ?? '').includes('offset')).toBe(true)
  expect(seen.reads.length).toBe(0)
})

test('le même fichier redemandé juste après passe (échappatoire)', async ($, on) => {
  const seen = bottom(on)

  await $.tool.call({ tool: 'Read', file_path: '/projet/long.log' })
  const again = await $.tool.call({ tool: 'Read', file_path: '/projet/long.log' })
  expect(again.deny).toBe(undefined)
  expect(seen.reads).toEqual(['/projet/long.log'])

  const text = await lecture($)
  expect(text.includes('1 lecture(s) de gros fichier évitée(s), 1 laissée(s) passer')).toBe(true)
})

test("l'échappatoire ne vaut que juste après le refus", async ($, on) => {
  const seen = bottom(on)

  await $.tool.call({ tool: 'Read', file_path: '/projet/long.log' })
  await $.tool.call({ tool: 'Read', file_path: '/projet/long.log', offset: 100, limit: 50 })
  const later = await $.tool.call({ tool: 'Read', file_path: '/projet/long.log' })
  expect(later.deny !== undefined).toBe(true)
  expect(seen.reads).toEqual(['/projet/long.log'])
})

test('une lecture avec offset/limit passe sans même regarder le fichier', async ($, on) => {
  const seen = bottom(on)

  const r = await $.tool.call({ tool: 'Read', file_path: '/projet/enorme.json', offset: 10, limit: 100 })
  expect(r.deny).toBe(undefined)
  expect(seen.stats.length).toBe(0)
})

test('un fichier de plus de 200 Ko est refusé sans être lu par le mod', async ($, on) => {
  const seen = bottom(on)

  const r = await $.tool.call({ tool: 'Read', file_path: '/projet/enorme.json' })
  expect(r.deny !== undefined).toBe(true)
  expect((r.deny ?? '').includes('(5 000 Ko)')).toBe(true)
  expect(seen.contents.length).toBe(0)
})

test('petits fichiers, fichiers moyens peu longs, images et PDF passent', async ($, on) => {
  const seen = bottom(on)

  for (const path of ['/projet/petit.md', '/projet/moyen.ts', '/projet/photo.png', '/projet/rapport.pdf', '/projet/absent.txt']) {
    const r = await $.tool.call({ tool: 'Read', file_path: path })
    expect(r.deny).toBe(undefined)
  }
  expect(seen.reads.length).toBe(5)
  expect(seen.stats.includes('/projet/photo.png')).toBe(false)
  // petit.md est sous 40 Ko : ses lignes ne sont pas comptées.
  expect(seen.contents).toEqual(['/projet/moyen.ts'])
})

test('allow_large passe, et /lecture off désactive le mod', async ($, on) => {
  const seen = bottom(on)

  const large = await $.tool.call({ tool: 'Read', file_path: '/projet/enorme.json', allow_large: true })
  expect(large.deny).toBe(undefined)

  expect((await lecture($, 'off')).includes('Lecture ciblée : désactivée.')).toBe(true)
  const r = await $.tool.call({ tool: 'Read', file_path: '/projet/long.log' })
  expect(r.deny).toBe(undefined)
  expect(seen.reads.length).toBe(2)

  expect((await lecture($, 'on')).includes('Lecture ciblée : activée.')).toBe(true)
  const back = await $.tool.call({ tool: 'Read', file_path: '/projet/long.log' })
  expect(back.deny !== undefined).toBe(true)
})

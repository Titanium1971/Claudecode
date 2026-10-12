import { expect, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const OK = { exitCode: 0, stderr: '', signal: null, timedOut: false, isStdoutTruncated: false, isStderrTruncated: false }
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

// Stands for sips and the Read tool: the [width, height] by path, what ran, and which path the tool was given.
const host = (on: On, sizes: Record<string, [number, number]>, resizeFails = false, noSips = false, decision: 'allow' | 'ask' | 'deny' = 'allow', copyDecision: 'allow' | 'ask' | 'deny' = 'allow') => {
  const ran: string[][] = []
  const read: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.check', { tool: 'Read' }, (_, e) => ({ decision: (e.input as { file_path: string }).file_path.startsWith('/tmp/claude-shrunk/') ? copyDecision : decision }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    if (noSips && e.argv[0] === 'sips') throw new Error('sips: command not found')
    if (e.argv[0] === 'sips' && e.argv[1] === '-g') {
      const path = e.argv[5]!
      const s = sizes[path]
      return { value: s === undefined ? { ...OK, exitCode: 1, stdout: '' } : { ...OK, stdout: `${path}\n  pixelWidth: ${s[0]}\n  pixelHeight: ${s[1]}\n` } }
    }
    if (e.argv[0] === 'sips') return { value: { ...OK, exitCode: resizeFails ? 1 : 0, stdout: '' } }

    return { value: { ...OK, stdout: '' } }
  })
  on('tool.call', { tool: 'Read' }, (_, e) => {
    read.push(e.file_path)
    return { result: {} } as never
  })

  return { ran, read }
}

const readImage = ($: Engine, file_path: string, extra = {}) => $.tool.call({ tool: 'Read', file_path, ...extra } as never) as Promise<any>
// Drops the random part that starts every copy name.
const unique = (p: string) => p.replace(/(claude-shrunk\/)[0-9a-z]+(?=_)/, '$1')
// The -z height width arguments of the resize, if one ran.
const resized = (ran: string[][]) => ran.find(a => a[1] === '-z')?.slice(2, 4)

test('reads a copy of a wide image and tells the model the scale', async ($, on) => {
  const seen = host(on, { '/p/s.png': [2400, 1500] })
  await $.session.start(START)

  const out = await readImage($, '/p/s.png')
  expect(seen.read.map(unique)).toEqual(['/tmp/claude-shrunk/_p_s.png.png'])
  expect(resized(seen.ran)).toEqual(['750', '1200'])
  expect(out.context.join(' ')).toContain('2.00')
  expect(out.context.join(' ')).toContain('offset: 1')
  expect(out.context.join(' ')).toContain('original image pixels')
})

test('an image within both caps, a non-image and an unreadable file are read as they are', async ($, on) => {
  const seen = host(on, { '/p/small.png': [1000, 1000] })
  await $.session.start(START)

  await readImage($, '/p/small.png')
  await readImage($, '/p/notes.md')
  await readImage($, '/p/missing.png')
  expect(seen.read).toEqual(['/p/small.png', '/p/notes.md', '/p/missing.png'])
})

test('when the resize fails the original is read', async ($, on) => {
  const seen = host(on, { '/p/s.png': [2400, 1500] }, true)
  await $.session.start(START)

  await readImage($, '/p/s.png')
  expect(seen.read).toEqual(['/p/s.png'])
})

test('a tall image is capped by height, keeping its shape', async ($, on) => {
  const seen = host(on, { '/p/page.png': [1000, 6272] })
  await $.session.start(START)

  const out = await readImage($, '/p/page.png')
  expect(resized(seen.ran)).toEqual(['1568', '250'])
  expect(out.context.join(' ')).toContain('4.00')
})

test('an offset reads the original, however large', async ($, on) => {
  const seen = host(on, { '/p/s.png': [2400, 1500] })
  await $.session.start(START)

  await readImage($, '/p/s.png', { offset: 1 })
  expect(seen.read).toEqual(['/p/s.png'])
  expect(seen.ran).toEqual([])
})

test('webp is shrunk and heic is converted to png even when small', async ($, on) => {
  const seen = host(on, { '/p/w.webp': [2400, 1500], '/p/h.heic': [600, 400] })
  await $.session.start(START)

  await readImage($, '/p/w.webp')
  const out = await readImage($, '/p/h.heic')
  expect(seen.read.map(unique)).toEqual(['/tmp/claude-shrunk/_p_w.webp.png', '/tmp/claude-shrunk/_p_h.heic.png'])
  expect(seen.ran.filter(a => a[1] === '-z').map(a => a.slice(2, 4))).toEqual([['750', '1200'], ['400', '600']])
  expect(out.context ?? []).toEqual([])
})

test('without sips (Linux, Windows) every image is read as it is', async ($, on) => {
  const seen = host(on, { '/p/s.png': [2400, 1500] }, false, true)
  await $.session.start(START)

  await readImage($, '/p/s.png')
  expect(seen.read).toEqual(['/p/s.png'])
})

test('the shrunk copy stays under about 1.15 megapixels, so the API does not resize it again', async ($, on) => {
  const seen = host(on, { '/p/s.png': [1200, 1568] })
  await $.session.start(START)

  const out = await readImage($, '/p/s.png')
  const [h, w] = resized(seen.ran)!.map(Number)
  expect(w! * h!).toBeLessThanOrEqual(1_150_000)
  expect(out.context.join(' ')).toContain('1.28')
})

for (const decision of ['deny', 'ask'] as const) {
  test(`a ${decision} on the original path means no copy is made`, async ($, on) => {
    const seen = host(on, { '/p/s.png': [2400, 1500] }, false, false, decision)
    await $.session.start(START)

    await readImage($, '/p/s.png')
    expect(seen.read).toEqual(['/p/s.png'])
    expect(seen.ran).toEqual([])
  })
}

test('the folder is private, the copy is private, and each read gets its own copy that is removed afterwards', async ($, on) => {
  const seen = host(on, { '/a/b.png': [2400, 1500] })
  await $.session.start(START)

  await Promise.all([readImage($, '/a/b.png'), readImage($, '/a/b.png')])
  expect(seen.read.length).toBe(2)
  expect(new Set(seen.read).size).toBe(2)
  expect(seen.ran).toContainEqual(['mkdir', '-p', '-m', '700', '/tmp/claude-shrunk'])
  expect(seen.ran).toContainEqual(['chmod', '700', '/tmp/claude-shrunk'])
  for (const copy of seen.read) {
    expect(seen.ran).toContainEqual(['chmod', '600', copy])
    expect(seen.ran).toContainEqual(['rm', '-f', copy])
  }
})

test('when the copy path would ask for permission, the original is read and nothing is resized', async ($, on) => {
  const seen = host(on, { '/p/s.png': [2400, 1500] }, false, false, 'allow', 'ask')
  await $.session.start(START)

  await readImage($, '/p/s.png')
  expect(seen.read).toEqual(['/p/s.png'])
  expect(resized(seen.ran)).toBeUndefined()
  expect(seen.ran.some(a => a[0] === 'mkdir')).toBe(false)
})

test('a jpeg stays a jpeg', async ($, on) => {
  const seen = host(on, { '/p/photo.JPG': [2400, 1500] })
  await $.session.start(START)

  await readImage($, '/p/photo.JPG')
  expect(seen.read[0]).toMatch(/\.jpg$/)
  const made = seen.ran.find(a => a[1] === '-z')!
  expect(made[made.indexOf('format') + 1]).toBe('jpeg')
})

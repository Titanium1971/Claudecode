import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BIG = Array.from({ length: 500 }, (_, i) => (i === 250 ? 'npm ERR! la ligne qui compte' : `ligne ${i} ${'x'.repeat(40)}`)).join('\n')

function bottom(on: On, stdout: string, written: string[] = []): void {
  mock.clock(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout, stderr: '', interrupted: false } }))
  on('fs.write', ($, e) => {
    written.push(e.path)

    return { value: undefined }
  })
}

test('une longue sortie est raccourcie, les erreurs et la fin sont gardées', async ($, on) => {
  const written: string[] = []
  bottom(on, BIG, written)

  const r = await $.tool.call({ tool: 'Bash', command: 'npm install' })
  const out = (r.result as { stdout: string }).stdout
  expect(out.length < BIG.length / 3).toBe(true)
  expect(out.includes('ligne 0 ')).toBe(true)
  expect(out.includes('ligne 499 ')).toBe(true)
  expect(out.includes('npm ERR! la ligne qui compte')).toBe(true)
  expect(out.includes('ligne 200 ')).toBe(false)
  expect(out.includes(`Sortie complète : ${written[0]}`)).toBe(true)

  const { text } = await $.command.run({ command: 'sorties', args: '' } as never)
  expect((text ?? '').includes('1 sortie(s) raccourcie(s)')).toBe(true)
})

test('une sortie courte ne change pas', async ($, on) => {
  bottom(on, 'bonjour')

  const r = await $.tool.call({ tool: 'Bash', command: 'echo bonjour' })
  expect((r.result as { stdout: string }).stdout).toBe('bonjour')
})

test('« # complet » garde la sortie entière', async ($, on) => {
  bottom(on, BIG)

  const r = await $.tool.call({ tool: 'Bash', command: 'npm install # complet' })
  expect((r.result as { stdout: string }).stdout).toBe(BIG)
})

test('/sorties off désactive le mod', async ($, on) => {
  bottom(on, BIG)
  await $.command.run({ command: 'sorties', args: 'off' } as never)

  const r = await $.tool.call({ tool: 'Bash', command: 'npm install' })
  expect((r.result as { stdout: string }).stdout).toBe(BIG)
})

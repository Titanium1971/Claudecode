import { expect, test } from 'claude-code/testing'

test('bloque les fichiers secrets et laisse passer le reste', async ($, on) => {
  on('tool.call', () => ({ result: { ok: true } }))

  const secret = await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })
  expect(secret.deny).toBeDefined()

  const example = await $.tool.call({ tool: 'Read', file_path: '/repo/.env.example' })
  expect(example.deny).toBeUndefined()

  const normal = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' })
  expect(normal.deny).toBeUndefined()
})

test('bloque les commandes dangereuses', async ($, on) => {
  on('tool.call', () => ({ result: { ok: true } }))

  for (const command of [
    'git push --force origin main',
    'git push origin main',
    'git reset --hard HEAD~3',
    'rm -rf ~',
    'cat .env',
  ]) {
    const ran = await $.tool.call({ tool: 'Bash', command })
    expect(ran.deny).toBeDefined()
  }

  for (const command of ['git push -u origin claude/dashboard', 'git status', 'rm -rf build']) {
    const ran = await $.tool.call({ tool: 'Bash', command })
    expect(ran.deny).toBeUndefined()
  }
})

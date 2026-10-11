import { expect, mock, test } from 'claude-code/testing'

test('suit la création et l’avancement des tâches dans le panneau', async ($, on) => {
  mock.clock(on)
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '1', subject: 'Créer le dépôt' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, () => ({
    result: { success: true, taskId: '1', updatedFields: ['status'] },
  }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create', filePath: '/r/a.ts', content: '' } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.tool.call({ tool: 'TaskCreate', subject: 'Créer le dépôt', description: 'GitHub' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'Write', file_path: '/r/a.ts', content: 'x' })

    const ui = await $.ui.mount({
      plugin: 'tableau-de-bord',
      surface,
      component: 'Pane',
      requestId: 'tableau-de-bord',
      props: { title: 'Tableau de bord', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    })
    const texts = async () => (await ui.findAll({ type: 'Text' })).map(found => found.text)

    expect((await texts()).some(t => t.includes('100% (1/1)'))).toBe(true)
    expect((await texts()).includes('✔ Créer le dépôt')).toBe(true)
    expect((await texts()).includes('📁 Fichiers modifiés (1)')).toBe(true)

    await ui.press({ key: 'clean' })
    expect((await texts()).includes("Aucune tâche suivie pour l'instant.")).toBe(true)
    await ui.unmount()
  }
})

test('/dashboard dit si le panneau est affiché', async ($, on) => {
  mock.clock(on)
  on('ui.open', { id: 'tableau-de-bord' }, () => ({ value: { isPlaced: true } }))

  const { text } = await $.command.run({ command: 'dashboard' })
  expect(text).toBe('Tableau de bord affiché.')
})

test('/dashboard dit pourquoi le panneau n’est pas visible', async ($, on) => {
  mock.clock(on)
  on('ui.open', { id: 'tableau-de-bord' }, () => ({
    value: { isPlaced: false, reason: 'cette app ne place pas les panneaux' },
  }))

  const { text } = await $.command.run({ command: 'dashboard' })
  expect(text).toBe(
    'Tableau de bord ouvert mais pas visible ici (cette app ne place pas les panneaux). Tape /taches pour le résumé en texte.',
  )
})

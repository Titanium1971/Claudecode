import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { expand, parseShortcuts } from '../hooks/register'

const PATH = '/repo/raccourcis.json'

const GOOD = JSON.stringify({
  _aide: 'ignoré',
  'workflow-n8n': { description: 'Crée un workflow n8n', prompt: 'Crée un workflow n8n qui {args}. Explique chaque nœud.' },
  'base-airtable': { description: 'Conçoit une base Airtable', prompt: 'Conçois une base Airtable pour {args}.' },
  relance: 'Relis le dernier workflow et propose des améliorations.',
})

type World = {
  files: Map<string, string>
  registered: string[]
  submitted: Array<{ text: string; origin: unknown }>
  toasts: string[]
}

function bottom(on: On, content: string | undefined, builtins: string[] = ['help', 'compact']): { world: World; settle: () => Promise<void> } {
  const world: World = { files: new Map(), registered: [], submitted: [], toasts: [] }
  if (content !== undefined) {
    world.files.set(PATH, content)
  }
  const clock = mock.clock(on)
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '/repo\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.read', ($, e) => {
    const text = world.files.get(e.path)
    if (text !== undefined) {
      return { value: text }
    }
    if (e.path.endsWith('/raccourcis.exemple.json')) {
      return { value: '{ "workflow-n8n": { "prompt": "…" } }' }
    }

    return { deny: `ENOENT: ${e.path}` }
  })
  on('command.list', () => ({
    value: [
      ...builtins.map(name => ({ name, description: '', source: 'builtin' as const })),
      ...world.registered.map(name => ({ name, description: '', source: 'plugin' as const, plugin: 'raccourcis' })),
    ],
  }))
  on('command.register', ($, e) => {
    world.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('prompt.submit', ($, e) => {
    world.submitted.push({ text: e.text, origin: e.origin })

    return { text: e.text }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  return { world, settle: () => clock.settle() }
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
}

async function run($: Engine, command: string, args = ''): Promise<string> {
  return (await $.command.run({ command, args } as never)).text ?? ''
}

test('au démarrage, chaque raccourci devient une commande', async ($, on) => {
  const { world } = bottom(on, GOOD)
  await start($)

  expect(world.registered).toEqual(['raccourcis', 'workflow-n8n', 'base-airtable', 'relance'])
  expect(world.toasts).toEqual([])
  const text = await run($, 'raccourcis')
  expect(text.includes('Tes raccourcis (/repo/raccourcis.json) :')).toBe(true)
  expect(text.includes('  /workflow-n8n [précisions] : Crée un workflow n8n')).toBe(true)
  expect(text.includes('  /relance : Raccourci : Relis le dernier workflow')).toBe(true)
})

test('un raccourci envoie à Claude la demande complète, {args} remplacé, comme si Cyril l’avait tapée', async ($, on) => {
  const { world, settle } = bottom(on, GOOD)
  await start($)

  const text = await run($, 'workflow-n8n', 'envoie un mail Gmail à chaque nouvelle ligne Airtable')
  expect(text.startsWith('/workflow-n8n : demande envoyée à Claude')).toBe(true)
  // Envoyée juste après la commande, pas pendant (le moteur le refuserait).
  expect(world.submitted.length).toBe(0)
  await settle()
  expect(world.submitted.length).toBe(1)
  expect(world.submitted[0]?.text).toBe('Crée un workflow n8n qui envoie un mail Gmail à chaque nouvelle ligne Airtable. Explique chaque nœud.')
  expect(world.submitted[0]?.origin).toEqual({ kind: 'plugin', name: 'raccourcis', asUser: true })
})

test('les autres commandes ne sont pas touchées', async ($, on) => {
  const { world, settle } = bottom(on, GOOD)
  let compacted = 0
  on('command.run', { command: 'compact' }, () => {
    compacted += 1

    return { text: 'compacté' }
  })
  await start($)

  expect(await run($, 'compact')).toBe('compacté')
  await settle()
  expect(compacted).toBe(1)
  expect(world.submitted).toEqual([])
})

test('les entrées invalides sont signalées en français sans bloquer les bonnes', async ($, on) => {
  const content = JSON.stringify({
    'Workflow N8N': { prompt: 'x' },
    help: { prompt: 'x' },
    raccourcis: { prompt: 'x' },
    vide: { description: 'rien' },
    liste: [1, 2],
    ok: { prompt: 'Fais-le.' },
  })
  const { world } = bottom(on, content)
  await start($)

  expect(world.registered).toEqual(['raccourcis', 'ok'])
  expect(world.toasts).toEqual(['raccourcis : 5 entrées de raccourcis.json ignorées, tape /raccourcis'])
  const text = await run($, 'raccourcis')
  expect(text.includes('5 entrées ignorées :')).toBe(true)
  expect(text.includes('« Workflow N8N » : le nom ne peut contenir que des minuscules')).toBe(true)
  expect(text.includes('« help » : la commande /help existe déjà')).toBe(true)
  expect(text.includes('« raccourcis » : la commande /raccourcis existe déjà')).toBe(true)
  expect(text.includes('« vide » : il manque le texte de la demande')).toBe(true)
  expect(text.includes('« liste » : la valeur doit être un objet')).toBe(true)
})

test('un fichier qui n’est pas du JSON est expliqué, sans planter', async ($, on) => {
  const { world } = bottom(on, '{ "a": { "prompt": "x" }, }')
  await start($)

  expect(world.registered).toEqual(['raccourcis'])
  const text = await run($, 'raccourcis')
  expect(text.includes('raccourcis.json n’est pas du JSON valide')).toBe(true)
})

test('sans raccourcis.json, /raccourcis explique comment le créer à partir du modèle', async ($, on) => {
  bottom(on, undefined)
  await start($)

  const text = await run($, 'raccourcis')
  expect(text.startsWith('Pas encore de raccourcis.json à la racine du dépôt (/repo/raccourcis.json).')).toBe(true)
  expect(text.includes('mods/raccourcis/raccourcis.exemple.json')).toBe(true)
  expect((await run($, 'raccourcis', 'exemple')).startsWith('Modèle de raccourcis.json')).toBe(true)
})

test('/raccourcis recharger prend en compte les changements du fichier', async ($, on) => {
  const { world, settle } = bottom(on, GOOD)
  await start($)

  world.files.set(PATH, JSON.stringify({ 'scenario-make': { description: 'Scénario Make', prompt: 'Conçois un scénario Make qui {args}.' } }))
  const text = await run($, 'raccourcis', 'recharger')
  expect(text.startsWith('Rechargé : 1 raccourci prêt.')).toBe(true)
  expect(world.registered.includes('scenario-make')).toBe(true)

  // Un raccourci retiré du fichier ne part plus.
  expect((await run($, 'relance')).startsWith('Le raccourci /relance n’est plus dans raccourcis.json')).toBe(true)
  await run($, 'scenario-make')
  await settle()
  expect(world.submitted.map(s => s.text)).toEqual(['Conçois un scénario Make qui (non précisé : pose-moi la question avant de commencer).'])
})

test('expand remplace {args}, ou ajoute les précisions à la fin', async () => {
  expect(expand('A {args} B {args}', ' x ')).toBe('A x B x')
  expect(expand('Fais-le.', '')).toBe('Fais-le.')
  expect(expand('Fais-le.', 'vite')).toBe('Fais-le.\n\nPrécisions : vite')
})

test('parseShortcuts : chaîne seule acceptée, description par défaut, mauvais type refusé', async () => {
  const parsed = parseShortcuts(JSON.stringify({ court: 'Résume.', mauvais: { prompt: 'x', description: 3 } }), new Set())
  expect(parsed.shortcuts).toEqual({ court: { description: 'Raccourci : Résume.', prompt: 'Résume.' } })
  expect(parsed.problems).toEqual(['« mauvais » : "description" doit être un texte entre guillemets.'])
  expect(parseShortcuts('[]', new Set()).problems.length).toBe(1)
})

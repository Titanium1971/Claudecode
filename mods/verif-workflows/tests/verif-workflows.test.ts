import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { checkWorkflow } from '../hooks/register'

// ---------- Des exemples ----------

const N8N_OK = {
  name: 'Relance clients',
  nodes: [
    { id: 'a1', name: 'Chaque matin', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'a2', name: 'Lire Airtable', type: 'n8n-nodes-base.airtable', typeVersion: 2, position: [220, 0], parameters: { operation: 'search' } },
    { id: 'a3', name: 'Envoyer Gmail', type: 'n8n-nodes-base.gmail', typeVersion: 2, position: [440, 0], parameters: {} },
  ],
  connections: {
    'Chaque matin': { main: [[{ node: 'Lire Airtable', type: 'main', index: 0 }]] },
    'Lire Airtable': { main: [[{ node: 'Envoyer Gmail', type: 'main', index: 0 }]] },
  },
}

const N8N_BAD = {
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
    { name: 'Webhook', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
    { name: 'Slack', type: 'slack', parameters: {} },
    { type: 'n8n-nodes-base.noOp', position: [1, 2], parameters: {} },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Notion', type: 'main', index: 0 }]] },
    Fantome: { main: [[{ node: 'Slack', type: 'main', index: 0 }]] },
  },
}

const MAKE_OK = {
  name: 'Formulaire vers Sheets',
  flow: [
    { id: 1, module: 'gateway:CustomWebHook', version: 1, parameters: { hook: 123 }, mapper: {}, metadata: { designer: { x: 0, y: 0 } } },
    {
      id: 2,
      module: 'builtin:BasicRouter',
      version: 1,
      routes: [
        { flow: [{ id: 3, module: 'google-sheets:addRow', version: 2, mapper: {} }] },
        { flow: [{ id: 4, module: 'slack:CreateMessage', version: 4, mapper: {}, onerror: [{ id: 5, module: 'builtin:Ignore', version: 1 }] }] },
      ],
    },
  ],
  metadata: { instant: true, version: 1, scenario: { roundtrips: 1 } },
}

const MAKE_BAD = {
  flow: [
    { id: 1, module: 'gateway:CustomWebHook', version: 1 },
    { id: 1, module: 'http:ActionSendData', version: 3 },
    { module: 'json:ParseJSON', version: 1 },
    { id: 4, module: 'airtable', version: 3 },
    { id: 5, mapper: {} },
    { id: 6, module: 'builtin:BasicRouter', version: 1, routes: [{ filter: {} }] },
  ],
}

// ---------- La fonction de vérification ----------

test('un workflow n8n correct ne remonte aucun problème', async () => {
  expect(checkWorkflow(JSON.stringify(N8N_OK))).toEqual({ kind: 'n8n', problems: [] })
})

test('n8n : noms en double, position, type et connexions vers des nœuds absents sont signalés', async () => {
  const { kind, problems } = checkWorkflow(JSON.stringify(N8N_BAD))
  expect(kind).toBe('n8n')
  expect(problems).toEqual([
    'Le nœud « Slack » : le type « slack » n’a pas la forme « paquet.nœud » (par exemple "n8n-nodes-base.set").',
    'Le nœud « Slack » n’a pas de « position » valide : il faut deux nombres, par exemple [250, 300].',
    'Le nœud n°4 n’a pas de « name » (chaque nœud a un nom, les connexions passent par lui).',
    'Le nom « Webhook » est porté par 2 nœuds : chaque nœud doit avoir un nom unique.',
    'La connexion « Webhook » → « Notion » vise un nœud qui n’existe pas.',
    'Une connexion part de « Fantome », mais aucun nœud ne porte ce nom.',
  ])
})

test('n8n : des nœuds sans « connections » sont repérés', async () => {
  const { kind, problems } = checkWorkflow(JSON.stringify({ nodes: N8N_OK.nodes }))
  expect(kind).toBe('n8n')
  expect(problems[0]?.startsWith('Il manque « connections »')).toBe(true)
})

test('n8n : un export de plusieurs workflows est vérifié workflow par workflow', async () => {
  const { kind, problems } = checkWorkflow(JSON.stringify([N8N_OK, { ...N8N_OK, name: 'Copie', connections: { X: { main: [[]] } } }]))
  expect(kind).toBe('n8n')
  expect(problems).toEqual(['Workflow n°2 « Copie » : Une connexion part de « X », mais aucun nœud ne porte ce nom.'])
})

test('un blueprint Make correct (routeur, routes, gestion d’erreur) ne remonte aucun problème', async () => {
  expect(checkWorkflow(JSON.stringify(MAKE_OK))).toEqual({ kind: 'make', problems: [] })
})

test('Make : ids en double ou absents, module absent ou mal écrit, route sans flow sont signalés', async () => {
  const { kind, problems } = checkWorkflow(JSON.stringify(MAKE_BAD))
  expect(kind).toBe('make')
  expect(problems).toEqual([
    'Le module « json:ParseJSON » n’a pas d’« id » (un nombre entier, unique dans le scénario).',
    'Le module « airtable » (id 4) : « module » doit avoir la forme « app:Action » (par exemple "google-sheets:addRow").',
    'Le module n°5 n’a pas de « module » (par exemple "http:ActionSendData").',
    'La route n°1 du module « builtin:BasicRouter » (id 6) n’a pas de « flow ».',
    'L’id 1 est porté par 2 modules : chaque module doit avoir un id unique.',
  ])
})

test('Make : un blueprint enveloppé (objet ou texte) est reconnu', async () => {
  expect(checkWorkflow(JSON.stringify({ blueprint: MAKE_OK })).kind).toBe('make')
  expect(checkWorkflow(JSON.stringify({ name: 'x', blueprint: JSON.stringify(MAKE_BAD) })).problems.length).toBe(5)
})

test('un JSON qui n’est pas un workflow passe sans rien dire', async () => {
  expect(checkWorkflow('{ "name": "mon-projet", "version": "1.0.0", "dependencies": {} }')).toEqual({ kind: null, problems: [] })
  expect(checkWorkflow('{ "flow": [ { "step": 1 } ] }')).toEqual({ kind: null, problems: [] })
  expect(checkWorkflow('{ "a": 1, }')).toEqual({ kind: null, problems: [] })
})

test('un workflow au JSON cassé est signalé comme tel', async () => {
  const { kind, problems } = checkWorkflow('{ "nodes": [ { "name": "A" } ], "connections": { }, }')
  expect(kind).toBe('n8n')
  expect(problems.length).toBe(1)
  expect(problems[0]?.startsWith('Le fichier n’est pas du JSON valide')).toBe(true)
})

// ---------- Le crochet sur Write et Edit ----------

type World = { files: Map<string, string>; written: string[]; toasts: string[]; reads: string[] }

function bottom(on: On, isDenied = false): World {
  const world: World = { files: new Map(), written: [], toasts: [], reads: [] }
  mock.clock(on, { now: Date.UTC(2026, 9, 11, 14, 32) })
  on('session.root', () => ({ value: '/repo' }))
  on('fs.read', ($, e) => {
    world.reads.push(e.path)
    const text = world.files.get(e.path)

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('tool.call', ($, e) => {
    if (isDenied) {
      return { deny: 'refusé' }
    }
    if (e.tool === 'Write') {
      world.files.set(e.file_path, e.content)
      world.written.push(e.file_path)

      return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [] } as never }
    }
    if (e.tool === 'Edit') {
      const before = world.files.get(e.file_path) ?? ''
      world.files.set(e.file_path, before.replace(e.old_string, e.new_string))
      world.written.push(e.file_path)

      return { result: { filePath: e.file_path } as never }
    }

    return { result: {} as never }
  })

  return world
}

test('un workflow n8n avec des problèmes : l’écriture passe, Claude reçoit la liste à corriger', async ($, on) => {
  const world = bottom(on)

  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/workflows/relance.json', content: JSON.stringify(N8N_BAD) })
  expect(world.written).toEqual(['/repo/workflows/relance.json'])
  expect(r.deny).toBe(undefined)
  const note = r.context?.[0] ?? ''
  expect(note.startsWith('verif-workflows : workflows/relance.json est un workflow n8n, mais 6 problèmes empêcheront probablement son import :')).toBe(true)
  expect(note.includes('- La connexion « Webhook » → « Notion » vise un nœud qui n’existe pas.')).toBe(true)
  expect(note.endsWith('Corrige-les dans le fichier, puis dis à Cyril en une phrase ce que tu as corrigé.')).toBe(true)
  expect(world.toasts).toEqual(['verif-workflows : 6 problèmes dans relance.json, Claude va corriger'])
})

test('une modification qui répare le workflow ne laisse plus de note', async ($, on) => {
  const world = bottom(on)
  const broken = JSON.stringify({ ...N8N_OK, connections: { 'Chaque matin': { main: [[{ node: 'Lire Airtabel', type: 'main', index: 0 }]] } } })
  world.files.set('/repo/relance.json', broken)

  const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/relance.json', old_string: 'Lire Airtabel', new_string: 'Lire Airtable' })
  expect(r.context).toBe(undefined)
  expect(world.toasts).toEqual(['verif-workflows : relance.json (workflow n8n) vérifié, rien à signaler'])
})

test('les autres fichiers ne sont pas touchés', async ($, on) => {
  const world = bottom(on)

  const md = await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: '{ "nodes": [] }' })
  const json = await $.tool.call({ tool: 'Write', file_path: '/repo/package.json', content: '{ "name": "x" }' })
  expect(md.context).toBe(undefined)
  expect(json.context).toBe(undefined)
  expect(world.reads).toEqual(['/repo/package.json'])
  expect(world.toasts).toEqual([])
})

test('une écriture refusée n’est pas vérifiée', async ($, on) => {
  const world = bottom(on, true)

  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/a.json', content: JSON.stringify(N8N_BAD) })
  expect(r.deny).toBe('refusé')
  expect(world.reads).toEqual([])
})

test('/verif-workflows montre les derniers résultats et vérifie un fichier à la demande', async ($, on) => {
  const world = bottom(on)
  expect(((await $.command.run({ command: 'verif-workflows', args: '' } as never)).text ?? '').startsWith('Aucun workflow vérifié')).toBe(true)

  await $.tool.call({ tool: 'Write', file_path: '/repo/scenario.json', content: JSON.stringify(MAKE_OK) })
  await $.tool.call({ tool: 'Write', file_path: '/repo/relance.json', content: JSON.stringify(N8N_BAD) })
  const text = (await $.command.run({ command: 'verif-workflows', args: '' } as never)).text ?? ''
  expect(text.startsWith('Dernières vérifications (la plus récente en haut) :\n16:32  relance.json (workflow n8n) : 6 problèmes\n')).toBe(true)
  expect(text.includes('16:32  scenario.json (scénario Make) : rien à signaler')).toBe(true)

  world.files.set('/repo/bp.json', JSON.stringify(MAKE_BAD))
  const one = (await $.command.run({ command: 'verif-workflows', args: '/repo/bp.json' } as never)).text ?? ''
  expect(one.startsWith('16:32  /repo/bp.json (scénario Make) : 5 problèmes')).toBe(true)
  expect(((await $.command.run({ command: 'verif-workflows', args: 'absent.json' } as never)).text ?? '')).toBe('Fichier introuvable : absent.json')
})

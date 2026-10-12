import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { annex, anonymise, commitTitle, emptyFacts, fileName, isRealPrompt, money, parseRules, recordCall, slugify } from '../hooks/register'

// 11 octobre 2026, 14 h 32 UTC.
const NOW = Date.UTC(2026, 9, 11, 14, 32)
const RULES = JSON.stringify({ names: ['Dupont SA'], domains: ['dupont.fr'] })

type World = { files: Map<string, string>; models: number }

// Le moteur résout les chemins relatifs dans le dossier du mod : on range les fichiers à partir de etudes-de-cas/.
const inRepo = (path: string): string => path.slice(path.indexOf('etudes-de-cas/'))

function bottom(on: On, files: Record<string, string> = {}, answer: Record<string, unknown> = { isAnswered: true, text: 'Le récit de [client].' }): World {
  const world: World = { files: new Map(Object.entries(files)), models: 0 }
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('fs.read', ($, e) => {
    const text = world.files.get(inRepo(e.path))

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    world.files.set(inRepo(e.path), e.text)

    return { value: undefined }
  })
  on('model.complete', () => {
    world.models += 1

    return { value: { ...answer, usage: { input: 10, output: 10 } } as never }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} as never }))

  return world
}

async function turn($: Engine, text: string, body: () => Promise<void>): Promise<void> {
  await $.turn.start({ text, turnId: 't' } as never)
  await body()
  await $.turn.complete({ answer: 'fini', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' } as never)
}

// ---------- Faits ----------

test('recordCall compte les outils, fichiers, tâches, commits, envois et PR', async () => {
  let f = emptyFacts(NOW)
  f = recordCall(f, { tool: 'TaskCreate', subject: 'Écrire le mod' }, false)
  f = recordCall(f, { tool: 'Write', file_path: 'mods/x/register.ts' }, false)
  f = recordCall(f, { tool: 'Edit', file_path: 'mods/x/register.ts' }, false)
  f = recordCall(f, { tool: 'TaskUpdate', status: 'completed' }, false)
  f = recordCall(f, { tool: 'Bash', command: 'git commit -m "Ajoute le mod"' }, false)
  f = recordCall(f, { tool: 'Bash', command: 'git push -u origin claude/x' }, false)
  f = recordCall(f, { tool: 'mcp__github__create_pull_request', title: 'Mod etude-de-cas' }, false)
  f = recordCall(f, { tool: 'Bash', command: 'npm test' }, true)

  expect(f.tools.Write).toBe(1)
  expect(f.tools.Edit).toBe(1)
  expect(f.files).toEqual(['mods/x/register.ts'])
  expect(f.tasks).toEqual(['Écrire le mod'])
  expect(f.tasksDone).toBe(1)
  expect(f.commits).toEqual(['Ajoute le mod'])
  expect(f.pushes).toBe(1)
  expect(f.pullRequests).toEqual(['Mod etude-de-cas'])
  expect(f.errors).toBe(1)
})

test('un appel en erreur ne compte ni comme commit, ni comme PR, ni comme tâche finie', async () => {
  let f = emptyFacts(NOW)
  f = recordCall(f, { tool: 'TaskCreate', subject: 'Tâche' }, false)
  f = recordCall(f, { tool: 'TaskUpdate', status: 'completed' }, true)
  f = recordCall(f, { tool: 'Bash', command: 'git commit -m "raté"' }, true)
  f = recordCall(f, { tool: 'mcp__github__create_pull_request', title: 'raté' }, true)

  expect(f.tasksDone).toBe(0)
  expect(f.commits).toEqual([])
  expect(f.pullRequests).toEqual([])
})

test('annexe chiffrée : durée, actions, outils et tâches', async () => {
  const f = {
    ...emptyFacts(NOW),
    tools: { Bash: 3, Write: 1 },
    tasks: ['A', 'B'],
    tasksDone: 1,
  }
  const text = annex(f, NOW + 12 * 60_000)

  expect(text.includes('- Durée : 12 min')).toBe(true)
  expect(text.includes('actions : 4')).toBe(true)
  expect(text.includes('Bash (3), Write (1)')).toBe(true)
  expect(text.includes('Tâches : 1/2 terminées')).toBe(true)
})

// ---------- Anonymisation ----------

test('anonymise e-mails, clés, noms, domaines, IP et chemins personnels', async () => {
  const rules = parseRules(RULES)
  const out = anonymise(
    'Mail jean@dupont.fr, client Dupont SA, clé sk-abcdefgh1234, token: abc123 ; IP 10.0.0.12 ; dossier /home/cyril/projet',
    rules,
  )

  expect(out).toBe('Mail [e-mail], client [client], clé [clé], token: [clé] ; IP [ip] ; dossier ~/projet')
})

test('parseRules ignore un fichier illisible ou mal formé', async () => {
  expect(parseRules('pas du json')).toEqual({ names: [], domains: [] })
  expect(parseRules(JSON.stringify({ names: ['A', 3, 'Dupont SA'] }))).toEqual({ names: ['Dupont SA'], domains: [] })
})

test('slugify retire les accents et la ponctuation', async () => {
  expect(slugify('Étude de cas : Dupont!')).toBe('etude-de-cas-dupont')
  expect(slugify('!!!')).toBe('etude')
})

test('fileName range la fiche dans etudes-de-cas/ avec la date', async () => {
  expect(fileName('Mon projet', NOW)).toBe('etudes-de-cas/2026-10-11-mon-projet.md')
})

// ---------- La commande, de bout en bout ----------

test('/etude-de-cas écrit une fiche anonymisée, rédigée par Haiku', async ($, on) => {
  const world = bottom(on, { 'etudes-de-cas/anonymiser.json': RULES })

  await turn($, 'Crée la fiche pour Dupont SA', async () => {
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "Ajoute la fiche"' } as never)
  })

  const { text } = await $.command.run({ command: 'etude-de-cas', args: '' } as never)
  const path = 'etudes-de-cas/2026-10-11-cree-la-fiche-pour-client.md'

  expect(text).toBe(`Étude de cas écrite : ${path}`)
  expect(world.models).toBe(1)
  const body = world.files.get(path) ?? ''
  expect(body.startsWith('# Crée la fiche pour [client]\n')).toBe(true)
  expect(body.includes('Le récit de [client].')).toBe(true)
  expect(body.includes('## Annexe chiffrée')).toBe(true)
  expect(body.includes('- Commits : 1')).toBe(true)
  expect(body.includes('Dupont')).toBe(false)
})

test('si Haiku ne répond pas, la fiche ne contient que l’annexe', async ($, on) => {
  const world = bottom(on, { 'etudes-de-cas/anonymiser.json': RULES }, { isAnswered: false, reason: 'error' })

  await turn($, 'Une session simple', async () => {})
  await $.command.run({ command: 'etude-de-cas', args: 'Titre test' } as never)

  const body = world.files.get('etudes-de-cas/2026-10-11-titre-test.md') ?? ''
  expect(body.includes('seule l’annexe chiffrée est écrite')).toBe(true)
  expect(body.includes('## Annexe chiffrée')).toBe(true)
})

test('/etude-de-cas apercu montre les faits sans appeler le modèle ni écrire', async ($, on) => {
  const world = bottom(on, { 'etudes-de-cas/anonymiser.json': RULES })

  await turn($, 'Session de test', async () => {})
  const { text } = await $.command.run({ command: 'etude-de-cas', args: 'apercu' } as never)

  expect((text ?? '').includes('- Tours : 1')).toBe(true)
  expect(world.models).toBe(0)
  expect(world.files.size).toBe(1)
})

// ---------- Le coût, publié par compteur-tokens ----------

test('money met en forme le coût et les tokens, ou dit qu’il manque compteur-tokens', async () => {
  expect(money({ cost: 0.4123, tokens: 1_234_000 })).toBe('- Coût estimé (équivalent API) : 0,412 $ pour 1 234 k tokens')
  expect(money({ cost: 12.5, tokens: 40_000 })).toBe('- Coût estimé (équivalent API) : 12,50 $ pour 40 k tokens')
  expect(money(undefined)).toBe('- Coût estimé : non disponible (il faut le mod compteur-tokens)')
})

test('sans compteur-tokens, l’annexe dit que le coût n’est pas disponible', async ($, on) => {
  bottom(on)

  await turn($, 'Session de test', async () => {})
  const { text } = await $.command.run({ command: 'etude-de-cas', args: 'apercu' } as never)

  expect((text ?? '').includes('- Coût estimé : non disponible')).toBe(true)
})

test('avec compteur-tokens, l’annexe reprend son coût et ses tokens', async ($, on) => {
  const world = bottom(on)
  const counter: Record<string, unknown> = {
    cost: 0.4123,
    totals: {
      'claude-sonnet-5-5': { calls: 3, input: 1_000_000, output: 200_000, cacheRead: 30_000, cacheWrite: 4_000 },
    },
  }
  on('state.get', ($, e, next) => {
    const ref = e as unknown as { plugin: string; key: string }

    return ref.plugin === 'compteur-tokens' ? ({ value: { value: counter[ref.key], version: 1 } } as never) : next(e)
  })

  await turn($, 'Session de test', async () => {})
  await $.command.run({ command: 'etude-de-cas', args: 'Avec coût' } as never)

  const body = world.files.get('etudes-de-cas/2026-10-11-avec-cout.md') ?? ''
  expect(body.includes('- Coût estimé (équivalent API) : 0,412 $ pour 1 234 k tokens')).toBe(true)
})

// ---------- Titres de commit ----------

test('commitTitle prend la première ligne, avec -m ou avec un here-doc', async () => {
  expect(commitTitle('git commit -q -m "Ajoute le mod\n\nDétail long"')).toBe('Ajoute le mod')
  expect(commitTitle("git commit -m 'un titre'")).toBe('un titre')
  expect(commitTitle(`git commit -q -m "$(cat <<'EOF'\nJournal : entrée\n\nSession : https://x\nEOF\n)"`)).toBe('Journal : entrée')
  expect(commitTitle('git commit --amend --no-edit')).toBe('commit')
})

// ---------- Ce qui ne doit pas compter ----------

test('un « git commit » cité dans un script ne compte pas ; une vraie commande compte', async () => {
  let f = emptyFacts(NOW)
  f = recordCall(f, { tool: 'Bash', command: `python3 - <<'EOF'\nexpect(commitTitle('git commit -m "a"'))\nEOF` }, false)
  expect(f.commits).toEqual([])

  f = recordCall(f, { tool: 'Bash', command: `cd /repo && git add -A && git commit -q -F - <<'EOF'\nTitre du commit\n\nCorps\nEOF\ngit push -q origin x` }, false)
  expect(f.commits).toEqual(['Titre du commit'])
  expect(f.pushes).toBe(1)
})

test('isRealPrompt écarte les commandes et les sorties de mods', async () => {
  expect(isRealPrompt('Crée un workflow n8n')).toBe(true)
  expect(isRealPrompt('/etude-de-cas apercu')).toBe(false)
  expect(isRealPrompt('etude-de-cas+raccourcis: Étude de cas écrite : x.md')).toBe(false)
  expect(isRealPrompt('journal: entrée ajoutée')).toBe(false)
  expect(isRealPrompt('   ')).toBe(false)
})

test('le titre par défaut vient du premier vrai message, pas d’une sortie de commande', async ($, on) => {
  const world = bottom(on)

  await turn($, 'etude-de-cas+raccourcis: - Durée : 1 min', async () => {})
  await turn($, 'Automatise mes relances clients', async () => {})
  const { text } = await $.command.run({ command: 'etude-de-cas', args: '' } as never)

  expect(text).toBe('Étude de cas écrite : etudes-de-cas/2026-10-11-automatise-mes-relances-clients.md')
  expect(world.files.size).toBe(1)
})

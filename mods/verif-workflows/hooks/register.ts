import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WorkflowCheckRecord, WorkflowKind } from '../types'

const KEPT = 10
const LISTED = 15

const lastChecks = atom({ plugin: 'verif-workflows', key: 'lastChecks' } as const, [] as WorkflowCheckRecord[])

export type WorkflowCheck = {
  /** null : ce n'est pas un workflow, le fichier n'est pas concerné. */
  kind: WorkflowKind | null
  problems: string[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

// ---------- Reconnaître un workflow ----------

function looksN8n(value: unknown): value is Json {
  if (!isObject(value) || !Array.isArray(value.nodes)) {
    return false
  }
  if (isObject(value.connections)) {
    return true
  }

  // Des nœuds n8n sans « connections » : c'est bien un workflow, auquel il manque quelque chose.
  return value.nodes.some(node => isObject(node) && typeof node.type === 'string' && /n8n/i.test(node.type))
}

function makeBlueprint(value: unknown): Json | undefined {
  if (!isObject(value)) {
    return undefined
  }
  if (Array.isArray(value.flow)) {
    // Un « flow » de modules Make, ou un blueprint vide avec ses métadonnées.
    const hasModules = value.flow.some(m => isObject(m) && ('module' in m || 'mapper' in m))

    return hasModules || (value.flow.length === 0 && isObject(value.metadata)) ? value : undefined
  }
  let inner: unknown = value.blueprint ?? (isObject(value.response) ? value.response.blueprint : undefined)
  if (typeof inner === 'string') {
    try {
      inner = JSON.parse(inner)
    } catch {
      return undefined
    }
  }

  return isObject(inner) && Array.isArray(inner.flow) ? inner : undefined
}

// Un JSON cassé : on devine quand même s'il voulait être un workflow.
function guessKind(text: string): WorkflowKind | null {
  if (/"nodes"\s*:/.test(text) && /"connections"\s*:/.test(text)) {
    return 'n8n'
  }
  if (/"flow"\s*:/.test(text) && /"module"\s*:/.test(text)) {
    return 'make'
  }

  return null
}

// ---------- n8n ----------

function checkN8n(workflow: Json): string[] {
  const problems: string[] = []
  const nodes = workflow.nodes as unknown[]
  if (nodes.length === 0) {
    problems.push('Le workflow ne contient aucun nœud (« nodes » est vide).')
  }
  const names = new Map<string, number>()
  const ids = new Map<string, number>()
  nodes.forEach((node, i) => {
    if (!isObject(node)) {
      problems.push(`Le nœud n°${i + 1} n’est pas un objet { "name": …, "type": …, "position": … }.`)

      return
    }
    const hasName = typeof node.name === 'string' && node.name.trim() !== ''
    const where = hasName ? `Le nœud « ${String(node.name)} »` : `Le nœud n°${i + 1}`
    if (hasName) {
      names.set(String(node.name), (names.get(String(node.name)) ?? 0) + 1)
    } else {
      problems.push(`Le nœud n°${i + 1} n’a pas de « name » (chaque nœud a un nom, les connexions passent par lui).`)
    }
    if (typeof node.type !== 'string' || node.type.trim() === '') {
      problems.push(`${where} n’a pas de « type » (par exemple "n8n-nodes-base.httpRequest").`)
    } else if (!node.type.includes('.')) {
      problems.push(`${where} : le type « ${node.type} » n’a pas la forme « paquet.nœud » (par exemple "n8n-nodes-base.set").`)
    }
    const position = node.position
    if (!Array.isArray(position) || position.length !== 2 || !position.every(n => typeof n === 'number' && Number.isFinite(n))) {
      problems.push(`${where} n’a pas de « position » valide : il faut deux nombres, par exemple [250, 300].`)
    }
    if (node.parameters === undefined) {
      problems.push(`${where} n’a pas de « parameters » (mets au moins {}).`)
    } else if (!isObject(node.parameters)) {
      problems.push(`${where} : « parameters » doit être un objet.`)
    }
    if (typeof node.id === 'string' && node.id !== '') {
      ids.set(node.id, (ids.get(node.id) ?? 0) + 1)
    }
  })
  for (const [name, count] of names) {
    if (count > 1) {
      problems.push(`Le nom « ${name} » est porté par ${count} nœuds : chaque nœud doit avoir un nom unique.`)
    }
  }
  for (const [id, count] of ids) {
    if (count > 1) {
      problems.push(`L’id « ${id} » est porté par ${count} nœuds : chaque nœud doit avoir un id unique.`)
    }
  }

  const connections = workflow.connections
  if (connections === undefined) {
    problems.push('Il manque « connections » : mets au moins {} (et une entrée par nœud qui en relie un autre).')

    return problems
  }
  if (!isObject(connections)) {
    problems.push('« connections » doit être un objet { "Nom du nœud": { "main": [[ { "node": "Nœud suivant", "type": "main", "index": 0 } ]] } }.')

    return problems
  }
  for (const [source, outputs] of Object.entries(connections)) {
    if (!names.has(source)) {
      problems.push(`Une connexion part de « ${source} », mais aucun nœud ne porte ce nom.`)
    }
    if (!isObject(outputs)) {
      problems.push(`Les connexions de « ${source} » sont mal formées : il faut un objet comme { "main": [[ … ]] }.`)
      continue
    }
    for (const [type, branches] of Object.entries(outputs)) {
      if (!Array.isArray(branches)) {
        problems.push(`Les connexions « ${type} » de « ${source} » doivent être une liste de listes : [[ … ]].`)
        continue
      }
      branches.forEach((branch, b) => {
        if (branch === null) {
          return
        }
        if (!Array.isArray(branch)) {
          problems.push(`La sortie ${b + 1} de « ${source} » doit être une liste de cibles : [ { "node": … } ].`)

          return
        }
        for (const target of branch) {
          if (!isObject(target) || typeof target.node !== 'string') {
            problems.push(`Une connexion de « ${source} » (sortie ${b + 1}) n’indique pas de nœud cible (« node »).`)
          } else if (!names.has(target.node)) {
            problems.push(`La connexion « ${source} » → « ${target.node} » vise un nœud qui n’existe pas.`)
          }
        }
      })
    }
  }

  return problems
}

// ---------- Make ----------

function checkMake(blueprint: Json): string[] {
  const problems: string[] = []
  const ids = new Map<number, number>()
  const walk = (flow: unknown[], place: string): void => {
    flow.forEach((module, i) => {
      if (!isObject(module)) {
        problems.push(`Le module n°${i + 1}${place} n’est pas un objet { "id": …, "module": … }.`)

        return
      }
      const hasId = typeof module.id === 'number' && Number.isInteger(module.id) && module.id > 0
      const name = typeof module.module === 'string' && module.module.trim() !== '' ? module.module : undefined
      const where = name === undefined ? `Le module n°${i + 1}${place}` : `Le module « ${name} »${hasId ? ` (id ${String(module.id)})` : place}`
      if (hasId) {
        const id = module.id as number
        ids.set(id, (ids.get(id) ?? 0) + 1)
      } else if (module.id === undefined) {
        problems.push(`${where} n’a pas d’« id » (un nombre entier, unique dans le scénario).`)
      } else {
        problems.push(`${where} : « id » doit être un nombre entier positif, pas ${JSON.stringify(module.id)}.`)
      }
      if (name === undefined) {
        problems.push(`${where} n’a pas de « module » (par exemple "http:ActionSendData").`)
      } else if (!name.includes(':')) {
        problems.push(`${where} : « module » doit avoir la forme « app:Action » (par exemple "google-sheets:addRow").`)
      }
      if (module.routes !== undefined) {
        if (!Array.isArray(module.routes)) {
          problems.push(`${where} : « routes » doit être une liste de routes [ { "flow": [ … ] } ].`)
        } else {
          module.routes.forEach((route, r) => {
            if (!isObject(route) || !Array.isArray(route.flow)) {
              problems.push(`La route n°${r + 1} ${where.replace(/^Le /, 'du ')} n’a pas de « flow ».`)
            } else {
              walk(route.flow, ` (route n°${r + 1})`)
            }
          })
        }
      }
      if (Array.isArray(module.onerror)) {
        walk(module.onerror, ' (gestion d’erreur)')
      }
    })
  }
  const flow = blueprint.flow as unknown[]
  if (flow.length === 0) {
    problems.push('Le scénario ne contient aucun module (« flow » est vide).')
  }
  walk(flow, '')
  for (const [id, count] of ids) {
    if (count > 1) {
      problems.push(`L’id ${id} est porté par ${count} modules : chaque module doit avoir un id unique.`)
    }
  }

  return problems
}

// ---------- La vérification, sans effet de bord ----------

export function checkWorkflow(text: string): WorkflowCheck {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    const kind = guessKind(text)
    const why = error instanceof Error ? error.message : String(error)

    return kind === null
      ? { kind: null, problems: [] }
      : { kind, problems: [`Le fichier n’est pas du JSON valide (${why}) : vérifie les virgules, les guillemets et les accolades.`] }
  }

  if (Array.isArray(data) && data.length > 0 && data.every(looksN8n)) {
    const problems = data.flatMap((w, i) => {
      const name = typeof w.name === 'string' && w.name !== '' ? ` « ${w.name} »` : ''

      return checkN8n(w).map(p => `Workflow n°${i + 1}${name} : ${p}`)
    })

    return { kind: 'n8n', problems }
  }
  if (looksN8n(data)) {
    return { kind: 'n8n', problems: checkN8n(data) }
  }
  const blueprint = makeBlueprint(data)
  if (blueprint !== undefined) {
    return { kind: 'make', problems: checkMake(blueprint) }
  }

  return { kind: null, problems: [] }
}

export function kindName(kind: WorkflowKind): string {
  return kind === 'n8n' ? 'workflow n8n' : 'scénario Make'
}

export function noteFor(path: string, check: WorkflowCheck): string | undefined {
  if (check.kind === null || check.problems.length === 0) {
    return undefined
  }
  const shown = check.problems.slice(0, LISTED).map(p => `- ${p}`)
  if (check.problems.length > LISTED) {
    shown.push(`- … et ${plural(check.problems.length - LISTED, 'autre problème')}.`)
  }

  return [
    `verif-workflows : ${path} est un ${kindName(check.kind)}, mais ${check.problems.length > 1 ? `${check.problems.length} problèmes empêcheront` : 'un problème empêchera'} probablement son import :`,
    ...shown,
    'Corrige-les dans le fichier, puis dis à Cyril en une phrase ce que tu as corrigé.',
  ].join('\n')
}

// ---------- Affichage ----------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function lastSundayUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0))

  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1)
}

// Heure de Paris (HH:MM), écrite à la main.
export function parisClock(ms: number): string {
  const year = new Date(ms).getUTCFullYear()
  const isSummer = ms >= lastSundayUtc(year, 2) && ms < lastSundayUtc(year, 9)
  const d = new Date(ms + (isSummer ? 2 : 1) * 3_600_000)

  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

async function shortPath($: EngineInterface, path: string): Promise<string> {
  try {
    const root = (await $.session.root()).replace(/\/+$/, '')

    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  } catch {
    return path
  }
}

function describe(record: WorkflowCheckRecord): string[] {
  const head = `${parisClock(record.at)}  ${record.path} (${kindName(record.kind)}) : `
  if (record.problems.length === 0) {
    return [`${head}rien à signaler`]
  }

  return [`${head}${plural(record.problems.length, 'problème')}`, ...record.problems.slice(0, LISTED).map(p => `    - ${p}`)]
}

// Relit un fichier JSON après écriture ; rend la note pour Claude s'il y a des problèmes.
async function inspect($: EngineInterface, path: string): Promise<string | undefined> {
  if (!/\.json$/i.test(path)) {
    return undefined
  }
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return undefined
  }
  const check = checkWorkflow(text)
  if (check.kind === null) {
    return undefined
  }
  const shown = await shortPath($, path)
  const at = await $.clock.now()
  await update($, lastChecks, list => [{ at, path: shown, kind: check.kind as WorkflowKind, problems: check.problems }, ...list].slice(0, KEPT))
  const name = shown.split('/').pop() ?? shown
  if (check.problems.length === 0) {
    $.ui.toast(`verif-workflows : ${name} (${kindName(check.kind)}) vérifié, rien à signaler`)

    return undefined
  }
  $.ui.toast(`verif-workflows : ${plural(check.problems.length, 'problème')} dans ${name}, Claude va corriger`)

  return noteFor(shown, check)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'verif-workflows',
      description: 'Vérification des workflows n8n et Make : les derniers résultats, ou vérifier un fichier',
      argumentHint: '[chemin/du/fichier.json]',
    })

    return next(e)
  })

  on('command.run', { command: 'verif-workflows' }, async ($, e) => {
    const path = e.args.trim()
    if (path !== '') {
      let text: string
      try {
        text = await $.fs.read(path)
      } catch {
        return { text: `Fichier introuvable : ${path}` }
      }
      const check = checkWorkflow(text)
      if (check.kind === null) {
        return { text: `${path} ne ressemble ni à un workflow n8n (« nodes » et « connections ») ni à un blueprint Make (« flow »).` }
      }
      const at = await $.clock.now()

      return { text: describe({ at, path, kind: check.kind, problems: check.problems }).join('\n') }
    }
    const list = await read($, lastChecks)
    if (list.length === 0) {
      return {
        text: 'Aucun workflow vérifié pour l’instant. Dès que Claude écrit un workflow n8n ou un blueprint Make en .json, il est relu automatiquement.\n/verif-workflows chemin/du/fichier.json vérifie un fichier tout de suite.',
      }
    }

    return { text: ['Dernières vérifications (la plus récente en haut) :', ...list.flatMap(describe)].join('\n') }
  })

  // Après chaque écriture ou modification réussie d'un .json : on relit, on vérifie, on ne bloque jamais.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true) {
      return r
    }
    const note = await inspect($, e.file_path)

    return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true) {
      return r
    }
    const note = await inspect($, e.file_path)

    return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }
  }).catch(($, e, next) => next(e))
}

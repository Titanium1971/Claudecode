import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RaccourciDefinition } from '../types'

const FILE = 'raccourcis.json'
const EXAMPLE = 'raccourcis.exemple.json'
const OWN = 'raccourcis'
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const NAME_MAX = 64
const DESCRIPTION_MAX = 100
const NOT_SAID = '(non précisé : pose-moi la question avant de commencer)'

const shortcuts = atom({ plugin: 'raccourcis', key: 'shortcuts' } as const, {} as Record<string, RaccourciDefinition>)
const problems = atom({ plugin: 'raccourcis', key: 'problems' } as const, [] as string[])
const registered = atom({ plugin: 'raccourcis', key: 'registered' } as const, [] as string[])
const file = atom({ plugin: 'raccourcis', key: 'file' } as const, null as string | null)
const isMissing = atom({ plugin: 'raccourcis', key: 'isMissing' } as const, false)

export type Parsed = {
  shortcuts: Record<string, RaccourciDefinition>
  problems: string[]
}

function cut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

// Lit le contenu de raccourcis.json. Ne lance jamais d'erreur : chaque entrée refusée devient une phrase.
export function parseShortcuts(text: string, taken: ReadonlySet<string>): Parsed {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)

    return {
      shortcuts: {},
      problems: [`${FILE} n’est pas du JSON valide (vérifie les virgules, les guillemets et les accolades) : ${why}`],
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      shortcuts: {},
      problems: [`${FILE} doit contenir un objet { "nom": { "description": "…", "prompt": "…" } }.`],
    }
  }

  const found: Record<string, RaccourciDefinition> = {}
  const issues: string[] = []
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    if (name.startsWith('_') || name.startsWith('$')) {
      continue
    }
    if (!NAME.test(name) || name.length > NAME_MAX) {
      issues.push(`« ${name} » : le nom ne peut contenir que des minuscules sans accent, des chiffres et des tirets (par exemple workflow-n8n).`)
      continue
    }
    if (name === OWN || taken.has(name)) {
      issues.push(`« ${name} » : la commande /${name} existe déjà dans Claude Code, choisis un autre nom.`)
      continue
    }
    let prompt: unknown
    let description: unknown
    if (typeof value === 'string') {
      prompt = value
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      prompt = (value as Record<string, unknown>).prompt
      description = (value as Record<string, unknown>).description
    } else {
      issues.push(`« ${name} » : la valeur doit être un objet { "description": "…", "prompt": "…" }.`)
      continue
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      issues.push(`« ${name} » : il manque le texte de la demande ("prompt").`)
      continue
    }
    if (description !== undefined && typeof description !== 'string') {
      issues.push(`« ${name} » : "description" doit être un texte entre guillemets.`)
      continue
    }
    const said = typeof description === 'string' && description.trim() !== '' ? description : `Raccourci : ${prompt}`
    found[name] = { description: cut(said, DESCRIPTION_MAX), prompt }
  }

  return { shortcuts: found, problems: issues }
}

// Remplace {args} par ce qui a été tapé après la commande.
export function expand(prompt: string, args: string): string {
  const given = args.trim()
  if (prompt.includes('{args}')) {
    return prompt.replaceAll('{args}', given === '' ? NOT_SAID : given)
  }

  return given === '' ? prompt : `${prompt}\n\nPrécisions : ${given}`
}

async function repoRoot($: EngineInterface): Promise<string> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
    const root = stdout.trim()
    if (exitCode === 0 && root !== '') {
      return root
    }
  } catch {
    // pas de git : on prend la racine de la session
  }

  return $.session.root()
}

// Relit raccourcis.json et déclare chaque raccourci comme commande. Rend le nombre de raccourcis prêts.
async function load($: EngineInterface): Promise<number> {
  const path = `${(await repoRoot($)).replace(/\/+$/, '')}/${FILE}`
  await update($, file, () => path)
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    await update($, isMissing, () => true)
    await update($, shortcuts, () => ({}))
    await update($, problems, () => [])

    return 0
  }
  await update($, isMissing, () => false)

  const before = new Set(await read($, registered))
  const taken = new Set<string>()
  try {
    for (const c of await $.command.list()) {
      const isOurs = c.plugin === $.plugin.name || (c.plugin === undefined && c.source === 'plugin' && before.has(c.name))
      if (!isOurs) {
        taken.add(c.name)
      }
    }
  } catch {
    // liste indisponible : la déclaration refusera elle-même un nom déjà pris
  }

  const parsed = parseShortcuts(text, taken)
  const ready: Record<string, RaccourciDefinition> = {}
  for (const [name, def] of Object.entries(parsed.shortcuts)) {
    try {
      await $.command.register({
        name,
        description: def.description,
        argumentHint: def.prompt.includes('{args}') ? '[précisions]' : undefined,
      })
      ready[name] = def
    } catch (error) {
      parsed.problems.push(`« ${name} » n’a pas pu devenir une commande : ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await update($, shortcuts, () => ready)
  await update($, problems, () => parsed.problems)
  await update($, registered, list => [...new Set([...list, ...Object.keys(ready)])])

  return Object.keys(ready).length
}

function submit($: EngineInterface, command: string, text: string): void {
  void $.prompt.submit({ text, asUser: true }).then(
    r => {
      if (r.drop !== undefined) {
        $.ui.log(`raccourcis : la demande de /${command} n’a pas été envoyée (${r.drop}).`)
      }
    },
    (error: unknown) => {
      $.ui.log(`raccourcis : la demande de /${command} n’a pas pu être envoyée (${error instanceof Error ? error.message : String(error)}). Retape /${command}.`)
    },
  )
}

async function listing($: EngineInterface): Promise<string> {
  const path = (await read($, file)) ?? FILE
  if (await read($, isMissing)) {
    return [
      `Pas encore de ${FILE} à la racine du dépôt (${path}).`,
      `Pour le créer, demande à Claude : « Copie mods/raccourcis/${EXAMPLE} vers ${FILE} à la racine du dépôt », puis tape /raccourcis recharger.`,
      'Format : { "nom-du-raccourci": { "description": "…", "prompt": "… {args} …" } }. {args} est remplacé par ce que tu tapes après la commande.',
      '/raccourcis exemple affiche le modèle fourni avec le mod.',
    ].join('\n')
  }
  const all = await read($, shortcuts)
  const issues = await read($, problems)
  const names = Object.keys(all).sort()
  const lines = [names.length === 0 ? `Aucun raccourci utilisable dans ${path}.` : `Tes raccourcis (${path}) :`]
  for (const name of names) {
    const def = all[name]
    if (def !== undefined) {
      lines.push(`  /${name}${def.prompt.includes('{args}') ? ' [précisions]' : ''} : ${def.description}`)
    }
  }
  if (issues.length > 0) {
    lines.push('', `${issues.length} entrée${issues.length > 1 ? 's' : ''} ignorée${issues.length > 1 ? 's' : ''} :`)
    for (const issue of issues) {
      lines.push(`  - ${issue}`)
    }
  }
  lines.push('', '/raccourcis recharger : relire le fichier après une modification. /raccourcis exemple : voir le modèle.')

  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'raccourcis',
      description: 'Raccourcis : la liste de tes commandes perso (raccourcis.json), ou les recharger',
      argumentHint: '[recharger | exemple]',
    })
    try {
      await load($)
      const issues = await read($, problems)
      if (issues.length > 0) {
        $.ui.toast(`raccourcis : ${issues.length} entrée${issues.length > 1 ? 's' : ''} de ${FILE} ignorée${issues.length > 1 ? 's' : ''}, tape /raccourcis`)
      }
    } catch (error) {
      $.ui.log(`raccourcis : ${FILE} n’a pas pu être lu (${error instanceof Error ? error.message : String(error)}).`)
    }

    return next(e)
  })

  on('command.run', { command: 'raccourcis' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'recharger' || word === 'reload') {
      const count = await load($)
      const issues = await read($, problems)
      const head = (await read($, isMissing))
        ? ''
        : `Rechargé : ${count} raccourci${count > 1 ? 's' : ''} prêt${count > 1 ? 's' : ''}${issues.length > 0 ? `, ${issues.length} ignoré${issues.length > 1 ? 's' : ''}` : ''}.\n\n`

      return { text: `${head}${await listing($)}` }
    }
    if (word === 'exemple') {
      try {
        const example = await $.fs.read(`${$.plugin.root}/${EXAMPLE}`)

        return { text: `Modèle de ${FILE} (à copier à la racine du dépôt) :\n\n${example.trimEnd()}` }
      } catch {
        return { text: `Le modèle ${EXAMPLE} est introuvable dans le dossier du mod (${$.plugin.root}).` }
      }
    }
    if (word !== '') {
      return { text: 'Utilisation : /raccourcis (la liste), /raccourcis recharger, /raccourcis exemple' }
    }

    return { text: await listing($) }
  })

  // Les raccourcis eux-mêmes : leurs noms viennent du fichier, donc pas de filtre fixe.
  on('command.run', async ($, e, next) => {
    if (e.command === OWN) {
      return next(e)
    }
    const def = (await read($, shortcuts))[e.command]
    if (def === undefined) {
      if ((await read($, registered)).includes(e.command)) {
        return { text: `Le raccourci /${e.command} n’est plus dans ${FILE}. Tape /raccourcis pour voir ceux qui restent.` }
      }

      return next(e)
    }
    const text = expand(def.prompt, e.args)
    // La demande part comme si Cyril l'avait tapée : Claude démarre un tour dessus dès que la session est libre.
    // Le moteur refuse un $.prompt.submit fait pendant la commande elle-même (la session attendrait la commande) :
    // on l'envoie donc juste après, depuis une minuterie à 0 ms.
    $.clock.after(0, () => submit($, e.command, text))

    return { text: `/${e.command} : demande envoyée à Claude, « ${cut(text, 140)} »` }
  }).catch(($, e, next) => next(e))
}

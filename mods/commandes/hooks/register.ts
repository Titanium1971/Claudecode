import type { CommandInfo, Register } from 'claude-code'

const COMMAND = 'commandes'
const COLLAPSE_AT = 8
// Ce qui n'est pas un mod : les connecteurs (serveurs MCP) et les commandes perso de l'utilisateur.
const NOT_MODS = new Set(['connecteurs', 'perso'])
const DESCRIPTION_MAX = 160

// Sans accents ni majuscules : « coût » trouve « cout ».
export function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export type Group = { owner: string; commands: CommandInfo[] }

// Les commandes ajoutées par des mods, regroupées par mod. Les commandes intégrées de Claude Code
// ont leur propre liste (/help) : elles ne sont pas reprises ici.
export function groups(list: readonly CommandInfo[]): Group[] {
  const byOwner = new Map<string, CommandInfo[]>()
  for (const command of list) {
    if (command.source === 'builtin') {
      continue
    }
    const owner = command.plugin ?? (command.source === 'mcp' ? 'connecteurs' : 'perso')
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), command])
  }

  return [...byOwner.entries()]
    .map(([owner, commands]) => ({ owner, commands: [...commands].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.owner.localeCompare(b.owner))
}

const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > DESCRIPTION_MAX ? `${flat.slice(0, DESCRIPTION_MAX - 1)}…` : flat
}

const commandLine = (command: CommandInfo): string => `- /${command.name} : ${oneLine(command.description) || 'pas de description'}`

function overview(all: readonly Group[], hasPluginCommand: boolean): string {
  const mods = all.filter(group => !NOT_MODS.has(group.owner))
  const total = mods.reduce((sum, group) => sum + group.commands.length, 0)
  const lines = [`Commandes de tes mods : ${total} commandes, ${mods.length} mods.`, '']
  for (const group of all) {
    lines.push(
      group.commands.length <= COLLAPSE_AT
        ? `- ${group.owner} : ${group.commands.map(command => `/${command.name}`).join(', ')}`
        : `- ${group.owner} (${group.commands.length} commandes) : /commandes ${group.owner} pour le détail`,
    )
  }
  lines.push(
    '',
    'Le détail d’un mod : /commandes <mod>. Chercher une commande : /commandes <mot>. Les commandes intégrées de Claude Code : /help.',
  )
  if (!hasPluginCommand) {
    lines.push('La commande /plugin n’est pas disponible dans cet environnement : on ne peut pas y installer de mod à la main.')
  }

  return lines.join('\n')
}

export function render(list: readonly CommandInfo[], arg: string): string {
  const all = groups(list)
  const asked = arg.trim()
  const word = plain(asked)
  if (word === '') {
    return overview(all, list.some(command => command.name === 'plugin'))
  }

  const owner = all.find(group => plain(group.owner) === word)
  if (owner !== undefined) {
    const n = owner.commands.length

    return [`${owner.owner} : ${n} commande${n > 1 ? 's' : ''}`, ...owner.commands.map(commandLine)].join('\n')
  }

  const hits = all.flatMap(group => group.commands.filter(command => plain(`${command.name} ${command.description} ${group.owner}`).includes(word)))
  if (hits.length === 0) {
    return `Aucune commande ne correspond à « ${asked} ». Tape /commandes pour la liste.`
  }

  return [`${hits.length} commande${hits.length > 1 ? 's' : ''} pour « ${asked} » :`, ...hits.map(commandLine)].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Liste les commandes de tes mods. /commandes <mod> pour le détail, /commandes <mot> pour chercher.',
      argumentHint: '[mod | mot]',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: render(await $.command.list(), e.args) })).catch(() => ({
    text: 'Commandes : impossible de lire la liste des commandes pour le moment.',
  }))
}

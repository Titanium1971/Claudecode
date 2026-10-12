import type { CommandInfo } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { groups, plain, render } from '../hooks/register'

const command = (name: string, description: string, plugin?: string, source: CommandInfo['source'] = 'plugin'): CommandInfo => ({
  name,
  description,
  source,
  ...(plugin === undefined ? {} : { plugin }),
})

const BIG = Array.from({ length: 10 }, (_, n) => command(`skill${n}`, `Compétence ${n}`, 'anthropic-skills'))

const LIST: CommandInfo[] = [
  command('help', 'Aide de Claude Code', undefined, 'builtin'),
  command('dashboard', 'Ouvre le tableau de bord', 'tableau-de-bord'),
  command('taches', 'Résumé des tâches', 'tableau-de-bord'),
  command('cout', 'Tokens et coût estimé de la session', 'compteur-tokens'),
  command('mon-prompt', 'Un prompt de serveur MCP', undefined, 'mcp'),
  ...BIG,
]

test('plain retire les accents et les majuscules', async () => {
  expect(plain('Coût Éstimé')).toBe('cout estime')
})

test('groups range par mod, trie, et laisse de côté les commandes intégrées', async () => {
  const all = groups(LIST)

  expect(all.map(group => group.owner)).toEqual(['anthropic-skills', 'compteur-tokens', 'connecteurs', 'tableau-de-bord'])
  expect(all.find(group => group.owner === 'tableau-de-bord')?.commands.map(c => c.name)).toEqual(['dashboard', 'taches'])
  expect(all.some(group => group.commands.some(c => c.name === 'help'))).toBe(false)
})

test('la vue d’ensemble liste les mods, et replie les gros groupes', async () => {
  const text = render(LIST, '')

  expect(text.startsWith('Commandes ajoutées par les mods : 14 commandes, 4 mods.')).toBe(true)
  expect(text.includes('- tableau-de-bord : /dashboard, /taches')).toBe(true)
  expect(text.includes('- anthropic-skills (10 commandes) : /commandes anthropic-skills pour le détail')).toBe(true)
  expect(text.includes('/help')).toBe(true)
  expect(text.includes('- /help')).toBe(false)
})

test('le nom d’un mod donne le détail, avec les descriptions', async () => {
  const text = render(LIST, 'Tableau-de-bord')

  expect(text).toBe('tableau-de-bord : 2 commandes\n- /dashboard : Ouvre le tableau de bord\n- /taches : Résumé des tâches')
})

test('un mot cherche dans le nom, la description et le mod, sans tenir compte des accents', async () => {
  expect(render(LIST, 'coût')).toBe('1 commande pour « coût » :\n- /cout : Tokens et coût estimé de la session')
  expect(render(LIST, 'COUT')).toBe(render(LIST, 'coût').replace('« coût »', '« COUT »'))
  expect(render(LIST, 'tâche').includes('- /taches')).toBe(true)
})

test('un mot sans résultat le dit', async () => {
  expect(render(LIST, 'zzz')).toBe('Aucune commande ne correspond à « zzz ». Tape /commandes pour la liste.')
})

test('la note sur /plugin n’apparaît que si la commande manque', async () => {
  expect(render(LIST, '').includes('/plugin n’est pas disponible')).toBe(true)
  expect(render([...LIST, command('plugin', 'Gère les plugins', undefined, 'builtin')], '').includes('/plugin n’est pas disponible')).toBe(false)
})

test('/commandes de bout en bout : lit la liste du moteur', async ($, on) => {
  on('command.list', () => ({ value: LIST }) as never)

  const { text } = await $.command.run({ command: 'commandes', args: 'cout' } as never)

  expect(text).toBe('1 commande pour « cout » :\n- /cout : Tokens et coût estimé de la session')
})

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { JournalPending } from '../types'

const FILE = 'JOURNAL.md'
const HEADER = [
  '# Journal',
  '',
  'Tenu automatiquement par le mod `journal` : après chaque demande qui a changé quelque chose,',
  'une entrée avec la date (heure de Paris), la demande, les fichiers modifiés, les commits et les PR.',
  'Les entrées les plus récentes sont en bas. `/journal` affiche les dernières.',
  '',
].join('\n')
const PROMPT_MAX = 120
const LABEL_MAX = 80
const FILES_MAX = 8
const SHOWN_DEFAULT = 10

const enabled = atom({ plugin: 'journal', key: 'enabled' } as const, true)
const pending = atom({ plugin: 'journal', key: 'pending' } as const, null as JournalPending | null)

// ---------- Texte : couper, masquer ce qui ressemble à un secret ----------

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{10,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?/g,
]
const SECRET_ASSIGN = /\b(api[_ -]?key|apikey|token|secret|password|passwd|mot de passe|mdp|bearer)(\s*[:=]\s*|(?<=bearer)\s+)("[^"]*"|'[^']*'|\S+)/gi
// Une longue suite de lettres ET de chiffres, sans espace : probablement une clé.
const LONG_TOKEN = /\b(?=[A-Za-z0-9_\-+/=]*\d)(?=[A-Za-z0-9_\-+/=]*[A-Za-z])[A-Za-z0-9_\-+/=]{28,}\b/g

export function mask(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[masqué]')
  }
  out = out.replace(SECRET_ASSIGN, (_all, key: string, sep: string) => `${key}${sep}[masqué]`)

  return out.replace(LONG_TOKEN, '[masqué]')
}

export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export function summarizePrompt(text: string): string {
  const flat = text
    .replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return flat === '' ? '(suite du travail)' : cut(mask(flat), PROMPT_MAX)
}

// ---------- Date et heure de Paris, écrites à la main ----------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Dernier dimanche du mois, à 1 h UTC (changement d'heure européen).
function lastSundayUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0))

  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1)
}

export function parisTime(ms: number): string {
  const year = new Date(ms).getUTCFullYear()
  const isSummer = ms >= lastSundayUtc(year, 2) && ms < lastSundayUtc(year, 9)
  const d = new Date(ms + (isSummer ? 2 : 1) * 3_600_000)

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

// ---------- Ce que fait un appel d'outil ----------

export type Seen = { files: string[]; actions: string[] }

function outputOf(r: ToolCallResult): string {
  if (typeof r.text === 'string') {
    return r.text
  }
  const result = r.result as { stdout?: unknown; stderr?: unknown } | undefined
  const parts = [result?.stdout, result?.stderr].filter((p): p is string => typeof p === 'string')

  return parts.join('\n')
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function prUrl(text: string): string | undefined {
  return /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0]
}

function label(text: string): string {
  return cut(mask(text.replace(/\s+/g, ' ').trim()), LABEL_MAX)
}

function fromBash(command: string, output: string): string[] {
  const actions: string[] = []
  if (/\bgit\b[^;&|\n]*\bcommit\b/.test(command)) {
    const m = /\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)/.exec(output)
    actions.push(m?.[1] !== undefined && m[2] !== undefined ? `Commit ${m[1]} « ${label(m[2])} »` : 'Commit')
  }
  if (/\bgit\b[^;&|\n]*\bpush\b/.test(command)) {
    const branch = /->\s+([^\s]+)/.exec(output)?.[1]
    actions.push(branch === undefined ? 'Push' : `Push (branche ${label(branch)})`)
  }
  if (/\bgh\s+pr\s+create\b/.test(command)) {
    const url = prUrl(output)
    actions.push(url === undefined ? 'PR créée' : `PR créée : ${url}`)
  }
  if (/\bgh\s+pr\s+merge\b/.test(command)) {
    actions.push('PR fusionnée')
  }

  return actions
}

function fromGithub(verb: string, e: Record<string, unknown>, output: string): Seen {
  const files: string[] = []
  const actions: string[] = []
  const branch = str(e.branch)
  switch (verb) {
    case 'create_pull_request': {
      const title = str(e.title)
      const url = prUrl(output)
      actions.push(['PR créée', title === undefined ? '' : ` « ${label(title)} »`, url === undefined ? '' : ` : ${url}`].join(''))
      break
    }
    case 'merge_pull_request':
      actions.push(typeof e.pullNumber === 'number' ? `PR n°${e.pullNumber} fusionnée` : 'PR fusionnée')
      break
    case 'create_branch':
      actions.push(branch === undefined ? 'Branche créée' : `Branche créée : ${label(branch)}`)
      break
    case 'push_files':
    case 'create_or_update_file':
    case 'delete_file': {
      const list = Array.isArray(e.files) ? e.files : [e]
      for (const f of list) {
        const path = str((f as { path?: unknown } | null)?.path)
        if (path !== undefined) {
          files.push(path)
        }
      }
      const what = verb === 'delete_file' ? 'Fichier supprimé sur GitHub' : 'Fichiers envoyés sur GitHub'
      actions.push(branch === undefined ? what : `${what} (branche ${label(branch)})`)
      break
    }
    default:
      break
  }

  return { files, actions }
}

// Ce qu'un appel d'outil réussi a changé : des chemins de fichiers et de courtes étiquettes, jamais le contenu.
export function seenIn(e: Record<string, unknown>, r: ToolCallResult): Seen {
  const tool = String(e.tool)
  if (tool === 'Write' || tool === 'Edit') {
    const path = str(e.file_path)

    return { files: path === undefined ? [] : [path], actions: [] }
  }
  if (tool === 'NotebookEdit') {
    const path = str(e.notebook_path)

    return { files: path === undefined ? [] : [path], actions: [] }
  }
  if (tool === 'Bash') {
    return { files: [], actions: fromBash(String(e.command ?? ''), outputOf(r)) }
  }
  const [prefix, server, ...rest] = tool.split('__')
  if (prefix === 'mcp' && server?.toLowerCase() === 'github') {
    return fromGithub(rest.join('__'), e, outputOf(r))
  }

  return { files: [], actions: [] }
}

// ---------- L'entrée du journal ----------

export function relativeTo(root: string, path: string): string | undefined {
  const base = root.replace(/\/+$/, '')
  if (path.startsWith(`${base}/`)) {
    return path.slice(base.length + 1)
  }
  if (!path.startsWith('/')) {
    return path.replace(/^\.\//, '')
  }

  return undefined
}

export function entryText(when: string, p: JournalPending, root: string, ending: string | undefined): string | undefined {
  const files = [
    ...new Set(p.files.map(f => relativeTo(root, f)).filter((f): f is string => f !== undefined && f !== FILE && f !== '')),
  ]
  if (files.length === 0 && p.actions.length === 0) {
    return undefined
  }
  const lines = [`## ${when} — ${p.prompt === '' ? '(demande non notée)' : p.prompt}`, '']
  if (files.length > 0) {
    const shown = files.slice(0, FILES_MAX).map(f => `\`${f}\``)
    const more = files.length > FILES_MAX ? ` et ${files.length - FILES_MAX} autre${files.length - FILES_MAX > 1 ? 's' : ''}` : ''
    lines.push(`- Fichiers modifiés : ${shown.join(', ')}${more}`)
  }
  for (const action of [...new Set(p.actions)]) {
    lines.push(`- ${action}`)
  }
  if (ending !== undefined) {
    lines.push(`- ${ending}`)
  }

  return `${lines.join('\n')}\n`
}

export function lastEntries(content: string, count: number): string[] {
  const parts = content.split(/^(?=## )/m).filter(part => part.startsWith('## '))

  return parts.slice(-count).map(part => part.trimEnd())
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

async function append($: EngineInterface, p: JournalPending, ending: string | undefined): Promise<void> {
  const root = await repoRoot($)
  const entry = entryText(parisTime(await $.clock.now()), p, root, ending)
  if (entry === undefined) {
    return
  }
  const path = `${root.replace(/\/+$/, '')}/${FILE}`
  let content = HEADER
  try {
    content = await $.fs.read(path)
  } catch {
    // le fichier n'existe pas encore : on part de l'en-tête
  }
  const separator = content === '' || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
  await $.fs.write(path, `${content}${separator}${entry}`)
}

async function show($: EngineInterface, count: number): Promise<string> {
  const isOn = await read($, enabled)
  const state = isOn ? '' : '\n(Le journal est en pause : /journal on pour le relancer.)'
  const path = `${(await repoRoot($)).replace(/\/+$/, '')}/${FILE}`
  let content: string
  try {
    content = await $.fs.read(path)
  } catch {
    return `Pas encore de ${FILE} dans ce dépôt : il se remplira après la prochaine demande qui modifie des fichiers.${state}`
  }
  const entries = lastEntries(content, count)
  if (entries.length === 0) {
    return `${FILE} ne contient encore aucune entrée.${state}`
  }

  return [`Les ${entries.length} dernières entrées de ${FILE} :`, '', entries.join('\n\n'), state].join('\n').trimEnd()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'journal',
      description: 'Journal de bord : les dernières entrées de JOURNAL.md, ou le mettre en pause',
      argumentHint: '[off | on | nombre]',
    })
    try {
      if ((await $.store.get('enabled')) === false) {
        await update($, enabled, () => false)
      }
    } catch {
      // réglage illisible : le journal reste actif
    }

    return next(e)
  })

  on('command.run', { command: 'journal' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'off' || word === 'on') {
      const isOn = word === 'on'
      await update($, enabled, () => isOn)
      await $.store.set('enabled', isOn)

      return {
        text: isOn
          ? 'Journal relancé : chaque demande qui modifie des fichiers sera notée dans JOURNAL.md.'
          : 'Journal en pause : plus rien n’est noté dans JOURNAL.md (/journal on pour le relancer).',
      }
    }
    if (word !== '' && !/^\d+$/.test(word)) {
      return { text: 'Utilisation : /journal (10 dernières entrées), /journal 20, /journal off, /journal on' }
    }
    const count = word === '' ? SHOWN_DEFAULT : Math.min(Math.max(Number(word), 1), 50)

    return { text: await show($, count) }
  })

  // Une nouvelle demande : on repart d'une page blanche.
  on('turn.start', async ($, e, next) => {
    await update($, pending, () => ({ prompt: summarizePrompt(e.text), files: [], actions: [] }))

    return next(e)
  })

  // Chaque outil qui a réussi : on note les fichiers touchés et les commits, push et PR.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true) {
      return r
    }
    const seen = seenIn(e as unknown as Record<string, unknown>, r)
    if (seen.files.length > 0 || seen.actions.length > 0) {
      await update($, pending, p => {
        const base = p ?? { prompt: '', files: [], actions: [] }

        return { ...base, files: [...base.files, ...seen.files], actions: [...base.actions, ...seen.actions] }
      })
    }

    return r
  }).catch(($, e, next) => next(e))

  // Fin de la demande (fil principal seulement) : une entrée si quelque chose a changé.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }
    const p = await read($, pending)
    await update($, pending, () => null)
    if (p === null || !(await read($, enabled))) {
      return result
    }
    const ending = e.isAborted ? 'Demande interrompue avant la fin.' : e.reason === 'error' ? 'Tour arrêté par une erreur.' : undefined
    try {
      await append($, p, ending)
    } catch (error) {
      $.ui.log(`journal : impossible d’écrire dans ${FILE} (${error instanceof Error ? error.message : String(error)}).`)
    }

    return result
  })
}

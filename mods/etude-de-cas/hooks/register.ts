import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AnonymiseRules, CaseFacts } from '../types'

const DIR = 'etudes-de-cas'
const RULES_FILE = `${DIR}/anonymiser.json`
const COMMAND = 'etude-de-cas'
const FILES_MAX = 40
const TOOLS_SHOWN = 10
const TITLE_MAX = 80

const facts = atom({ plugin: 'etude-de-cas', key: 'facts' } as const, null as CaseFacts | null)

// ---------- Faits : ce que la session a fait, sans rien recopier du contenu ----------

export function emptyFacts(now: number): CaseFacts {
  return {
    startedAt: now,
    firstPrompt: '',
    turns: 0,
    errors: 0,
    tools: {},
    files: [],
    tasks: [],
    tasksDone: 0,
    commits: [],
    pushes: 0,
    pullRequests: [],
    suggested: false,
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function recordCall(f: CaseFacts, e: Record<string, unknown>, isError: boolean): CaseFacts {
  const tool = text(e.tool)
  const next: CaseFacts = {
    ...f,
    tools: { ...f.tools, [tool]: (f.tools[tool] ?? 0) + 1 },
    errors: f.errors + (isError ? 1 : 0),
  }

  if ((tool === 'Write' || tool === 'Edit') && text(e.file_path) !== '' && !f.files.includes(text(e.file_path))) {
    next.files = [...f.files, text(e.file_path)].slice(-FILES_MAX)
  }
  if (tool === 'TaskCreate' && text(e.subject) !== '') {
    next.tasks = [...f.tasks, text(e.subject)]
  }
  if (tool === 'TaskUpdate' && e.status === 'completed' && !isError) {
    next.tasksDone = Math.min(f.tasksDone + 1, next.tasks.length)
  }
  if (tool === 'Bash' && !isError) {
    const command = text(e.command)
    if (/\bgit commit\b/.test(command)) {
      const message = /-m\s+["']([^"']+)["']/.exec(command)?.[1] ?? 'commit'
      next.commits = [...f.commits, message.slice(0, TITLE_MAX)]
    }
    if (/\bgit push\b/.test(command)) {
      next.pushes = f.pushes + 1
    }
  }
  if (/create_pull_request$/.test(tool) && !isError && text(e.title) !== '') {
    next.pullRequests = [...f.pullRequests, text(e.title).slice(0, TITLE_MAX)]
  }

  return next
}

export function minutesSince(startedAt: number, now: number): number {
  return Math.max(1, Math.round((now - startedAt) / 60_000))
}

// ---------- Anonymisation : tout passe par là avant d'écrire ou d'envoyer ----------

const SECRETS: readonly RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{10,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?/g,
]
const ASSIGNED = /\b(api[_ -]?key|token|secret|password|mot de passe|mdp)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/g
const HOME = /\/(home|Users)\/[^/\s]+|\/root\b/g

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parseRules(raw: string): AnonymiseRules {
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof AnonymiseRules, unknown>>
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length >= 2) : []

    return { names: list(data.names), domains: list(data.domains) }
  } catch {
    return { names: [], domains: [] }
  }
}

export function anonymise(input: string, rules: AnonymiseRules): string {
  let out = input
  for (const pattern of SECRETS) {
    out = out.replace(pattern, '[clé]')
  }
  out = out.replace(ASSIGNED, (_, label: string, sep: string) => `${label}${sep}[clé]`)
  out = out.replace(EMAIL, '[e-mail]').replace(IPV4, '[ip]').replace(HOME, '~')
  for (const domain of rules.domains) {
    out = out.replace(new RegExp(escape(domain), 'gi'), '[domaine]')
  }
  for (const name of rules.names) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu'), '[client]')
  }

  return out
}

// ---------- Mise en forme ----------

export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.slice(0, 50) || 'etude'
}

export function annex(f: CaseFacts, now: number): string {
  const actions = Object.values(f.tools).reduce((sum, count) => sum + count, 0)
  const tools = Object.entries(f.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOOLS_SHOWN)
    .map(([name, count]) => `${name} (${count})`)
  const lines = [
    `- Durée : ${minutesSince(f.startedAt, now)} min`,
    `- Tours : ${f.turns} · actions : ${actions} · erreurs : ${f.errors}`,
    `- Outils les plus utilisés : ${tools.join(', ') || 'aucun'}`,
    `- Tâches : ${f.tasksDone}/${f.tasks.length} terminées`,
    ...f.tasks.map(task => `  - ${task}`),
    `- Fichiers modifiés (${f.files.length}) : ${f.files.map(file => `\`${file}\``).join(', ') || 'aucun'}`,
    `- Commits : ${f.commits.length}`,
    ...f.commits.map(commit => `  - ${commit}`),
    `- Envois sur GitHub (push) : ${f.pushes}`,
    `- Pull requests : ${f.pullRequests.length ? f.pullRequests.join(' ; ') : 'aucune'}`,
  ]

  return lines.join('\n')
}

const RUBRIC = [
  'Tu rédiges une étude de cas portfolio en français, à partir des faits fournis seulement.',
  'Structure : Contexte, Problème, Solution, Outils, Résultat, Ce que j’en retiens.',
  'Ne rien inventer : si un fait manque, ne pas le combler. Pas de nom de personne, client ou entreprise',
  '(écris [client]). Environ 250 mots. Ton clair, sans jargon inutile, phrases courtes.',
].join(' ')

export function brief(f: CaseFacts, factsText: string): string {
  return [
    f.firstPrompt ? `Demande de départ : ${f.firstPrompt}` : 'Demande de départ : non précisée',
    '',
    'Faits de la session :',
    factsText,
  ].join('\n')
}

export function fileName(title: string, now: number): string {
  return `${DIR}/${new Date(now).toISOString().slice(0, 10)}-${slugify(title)}.md`
}

// ---------- Le module ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, facts, f => f ?? emptyFacts(now))
    await $.command.register({
      name: COMMAND,
      description: 'Écrit une étude de cas anonymisée de la session (etudes-de-cas/). /etude-de-cas apercu montre les faits sans écrire.',
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, facts, f => {
      const base = f ?? emptyFacts(now)

      return base.firstPrompt === '' ? { ...base, firstPrompt: e.text.slice(0, 200) } : base
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, facts, f => ({ ...(f ?? emptyFacts(now)), turns: (f?.turns ?? 0) + 1 }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const isError = r.deny !== undefined || r.isError === true
    const now = await $.clock.now()
    await update($, facts, f => recordCall(f ?? emptyFacts(now), e as unknown as Record<string, unknown>, isError))

    const current = await read($, facts)
    const finished = current !== null && current.tasks.length > 0 && current.tasksDone >= current.tasks.length
    const opened = current !== null && current.pullRequests.length > 0
    if (current !== null && !current.suggested && (finished || opened)) {
      await update($, facts, f => (f ? { ...f, suggested: true } : f))
      $.ui.toast(`Cette session peut devenir une étude de cas : tape /${COMMAND}`)
    }

    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const now = await $.clock.now()
    const current = (await read($, facts)) ?? emptyFacts(now)
    const rules = await readRules($)
    const title = e.args.trim()

    if (title === 'apercu') {
      return { text: anonymise(annex(current, now), rules) }
    }

    const factsText = anonymise(annex(current, now), rules)
    const story = await tell($, current, factsText, rules)
    const heading = title || anonymise(current.firstPrompt, rules).slice(0, TITLE_MAX) || 'Étude de cas'
    const body = [
      `# ${heading}`,
      '',
      `_Écrit le ${new Date(now).toISOString().slice(0, 10)} à partir d’une session, anonymisé._`,
      '',
      story,
      '',
      '---',
      '',
      '## Annexe chiffrée',
      '',
      factsText,
      '',
    ].join('\n')

    const path = fileName(heading, now)
    try {
      await $.fs.write(path, body)
    } catch (error) {
      return { text: `Étude de cas non écrite : ${error instanceof Error ? error.message : String(error)}` }
    }

    return { text: `Étude de cas écrite : ${path}` }
  }).catch(() => ({ text: 'Étude de cas : erreur pendant la rédaction, rien n’a été écrit.' }))
}

async function readRules($: EngineInterface): Promise<AnonymiseRules> {
  try {
    return parseRules(await $.fs.read(RULES_FILE))
  } catch {
    return { names: [], domains: [] }
  }
}

async function tell($: EngineInterface, f: CaseFacts, factsText: string, rules: AnonymiseRules): Promise<string> {
  const answer = await $.model.complete({
    model: 'haiku',
    system: RUBRIC,
    prompt: anonymise(brief(f, factsText), rules),
    maxTokens: 1200,
    effort: 'low',
    timeoutMs: 60_000,
  })
  if (answer.isAnswered && answer.text.trim() !== '') {
    return anonymise(answer.text.trim(), rules)
  }

  return 'Le récit n’a pas pu être rédigé : seule l’annexe chiffrée est écrite.'
}

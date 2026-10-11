import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Les verbes d'un outil de connecteur qui agissent sur le monde extérieur.
const RISKY = new Set([
  'send', 'reply', 'forward', 'post', 'publish', 'share', 'invite',
  'create', 'add', 'write', 'upload', 'import', 'save', 'upsert', 'duplicate', 'copy', 'generate', 'fill',
  'update', 'edit', 'modify', 'change', 'set', 'patch', 'replace', 'move', 'rename', 'label', 'unlabel', 'mark', 'unmark',
  'delete', 'remove', 'trash', 'archive', 'cancel', 'revert', 'restore', 'kill', 'invalidate',
  'run', 'execute', 'trigger', 'fire', 'start', 'stop', 'pause', 'resume', 'spawn', 'deploy', 'promote', 'rollback',
  'enable', 'disable', 'activate', 'approve', 'accept', 'respond', 'complete', 'skip', 'submit', 'assign', 'transfer',
  'buy', 'purchase', 'order', 'merge', 'bulk', 'control', 'record', 'retry', 'rerequest', 'stage', 'apply',
])

// Connecteurs dont Claude se sert pour son propre travail : seuls les verbes listés demandent confirmation.
const TRUSTED: Record<string, ReadonlySet<string>> = {
  github: new Set(['delete', 'merge']),
  GitHub: new Set(['delete', 'merge']),
  'claude-code-remote': new Set(),
  Claude_Docs: new Set(),
}

const ALLOW = 'Autoriser'
const ALWAYS = 'Toujours pour cet outil'
const REFUSE = 'Refuser'

const alwaysAllowed = atom({ plugin: 'garde-fous-connecteurs', key: 'alwaysAllowed' } as const, [] as string[])
const asked = atom({ plugin: 'garde-fous-connecteurs', key: 'asked' } as const, 0)
const refused = atom({ plugin: 'garde-fous-connecteurs', key: 'refused' } as const, 0)

const RESERVED = new Set(['tool', 'tool_use_id', 'consent', 'agentId'])

export function isRisky(tool: string): boolean {
  const [prefix, server, ...rest] = tool.split('__')
  if (prefix !== 'mcp' || server === undefined) {
    return false
  }
  const words = rest.join('_').toLowerCase().split(/[^a-z]+/)
  const risky = TRUSTED[server] ?? RISKY

  return words.some(word => risky.has(word))
}

function describe(e: Record<string, unknown>): string {
  const [, server = '', ...rest] = String(e.tool).split('__')
  const args = Object.fromEntries(Object.entries(e).filter(([key]) => !RESERVED.has(key) && !key.startsWith('_')))
  let detail = JSON.stringify(args)
  if (detail.length > 300) {
    detail = `${detail.slice(0, 300)}…`
  }

  return `Claude veut utiliser ${server} → ${rest.join('__')} avec ${detail}. Autoriser ?`
}

async function confirm($: EngineInterface, tool: string, question: string): Promise<boolean> {
  await update($, asked, n => n + 1)
  // « Refuser » en premier : si la question se ferme toute seule, c'est le choix le plus sûr.
  const answer = await $.ui.ask(question, { options: [REFUSE, ALLOW, ALWAYS], header: 'Connecteur' })
  if (answer === ALWAYS) {
    await update($, alwaysAllowed, list => (list.includes(tool) ? list : [...list, tool]))

    return true
  }

  return answer === ALLOW
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'connecteurs',
      description: 'Garde-fous connecteurs : voir les outils toujours autorisés, ou tout redemander',
      argumentHint: '[reset]',
    })

    return next(e)
  })

  on('command.run', { command: 'connecteurs' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'reset') {
      await update($, alwaysAllowed, () => [])
    }
    const list = await read($, alwaysAllowed)

    return {
      text: [
        `Confirmations demandées : ${await read($, asked)}, refusées : ${await read($, refused)}.`,
        list.length === 0 ? 'Aucun outil toujours autorisé.' : `Toujours autorisés : ${list.join(', ')}`,
        '/connecteurs reset : tout redemander.',
      ].join('\n'),
    }
  })

  on('tool.call', async ($, e, next) => {
    if (!isRisky(e.tool) || (await read($, alwaysAllowed)).includes(e.tool)) {
      return next(e)
    }
    if (await confirm($, e.tool, describe(e as unknown as Record<string, unknown>))) {
      return next(e)
    }
    await update($, refused, n => n + 1)

    return { deny: `Cyril a refusé cette action (${e.tool}). Ne la refais pas sans lui demander.` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `garde-fous-connecteurs n'a pas pu demander confirmation pour ${e.tool} : action bloquée.` },
  )
}

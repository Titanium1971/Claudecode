import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, DashTask, GitInfo, SessionStats, TaskStatus } from '../types'

const PANE = 'tableau-de-bord'
const TITLE = 'Tableau de bord'
const SLOW_TURN_SECONDS = 120
const MAX_ACTIVITY = 30

const tasks = atom({ plugin: 'tableau-de-bord', key: 'tasks' } as const, [] as DashTask[])
const todos = atom({ plugin: 'tableau-de-bord', key: 'todos' } as const, [] as DashTask[])
const activity = atom({ plugin: 'tableau-de-bord', key: 'activity' } as const, [] as Activity[])
const files = atom({ plugin: 'tableau-de-bord', key: 'files' } as const, [] as string[])
const git = atom({ plugin: 'tableau-de-bord', key: 'git' } as const, null as GitInfo | null)
const showActivity = atom({ plugin: 'tableau-de-bord', key: 'showActivity' } as const, true)
const stats = atom({ plugin: 'tableau-de-bord', key: 'stats' } as const, {
  startedAt: 0,
  turns: 0,
  toolCalls: 0,
  errors: 0,
  lastTurnSeconds: 0,
} as SessionStats)

const ICON: Record<TaskStatus, string> = {
  completed: '✔',
  in_progress: '▶',
  pending: '○',
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function labelFor(e: { tool: string } & Record<string, unknown>): string {
  const filePath = e.file_path ?? e.notebook_path
  if (typeof filePath === 'string') {
    return basename(filePath)
  }
  if (typeof e.command === 'string') {
    return e.command.split('\n')[0]!.slice(0, 60)
  }
  if (typeof e.pattern === 'string') {
    return e.pattern.slice(0, 60)
  }
  if (typeof e.subject === 'string') {
    return e.subject.slice(0, 60)
  }
  if (typeof e.description === 'string') {
    return e.description.slice(0, 60)
  }

  return ''
}

function bar(done: number, total: number, width: number): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 60) {
    return `${minutes} min`
  }

  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

async function allTasks($: EngineInterface): Promise<DashTask[]> {
  return [...(await read($, tasks)), ...(await read($, todos))]
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const list = await allTasks($)
  const info = await read($, git)
  const parts: string[] = []
  if (list.length > 0) {
    const done = list.filter(t => t.status === 'completed').length
    parts.push(`📋 ${done}/${list.length} tâches`)
  }
  if (info !== null) {
    parts.push(`🌿 ${info.branch}${info.changed > 0 ? ` (${info.changed} modif.)` : ''}`)
  }
  $.ui.status(parts.length > 0 ? parts.join(' · ') : undefined)
}

async function runGit($: EngineInterface, args: string[]): Promise<string | undefined> {
  try {
    const out = await $.process.run(['git', ...args], { timeoutMs: 5000 })

    return out.exitCode === 0 ? out.stdout.trim() : undefined
  } catch {
    return undefined
  }
}

async function refreshGit($: EngineInterface): Promise<void> {
  const top = await runGit($, ['rev-parse', '--show-toplevel'])
  if (top === undefined) {
    await update($, git, () => null)

    return
  }
  const branch = (await runGit($, ['branch', '--show-current'])) || '(détachée)'
  const porcelain = (await runGit($, ['status', '--porcelain'])) ?? ''
  const ahead = Number((await runGit($, ['rev-list', '--count', '@{u}..HEAD'])) ?? '0')
  const remote = (await runGit($, ['config', '--get', 'remote.origin.url'])) ?? ''
  const repo = remote
    ? remote.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('/')
    : basename(top)
  const info: GitInfo = {
    repo,
    branch,
    changed: porcelain.split('\n').filter(line => line.trim() !== '').length,
    ahead: Number.isFinite(ahead) ? ahead : 0,
  }
  await update($, git, () => info)
}

async function summary($: EngineInterface): Promise<string> {
  const list = await allTasks($)
  const s = await read($, stats)
  const info = await read($, git)
  const now = await $.clock.now()
  const done = list.filter(t => t.status === 'completed').length
  const lines = [`Tâches : ${done}/${list.length} terminées`]
  for (const t of list) {
    lines.push(`  ${ICON[t.status]} ${t.subject}`)
  }
  lines.push(
    `Session : ${s.turns} tours, ${s.toolCalls} actions, ${s.errors} erreurs, ${duration(now - s.startedAt)}`,
  )
  if (info !== null) {
    lines.push(
      `Git : ${info.repo} @ ${info.branch}, ${info.changed} fichier(s) modifié(s), ${info.ahead} commit(s) à pousser`,
    )
  }

  return lines.join('\n')
}

export const register: Register = on => {
  let turnStartedAt = 0

  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, stats, s => (s.startedAt === 0 ? { ...s, startedAt: now } : s))
    await $.command.register({
      name: 'dashboard',
      description: 'Ouvre le tableau de bord (tâches, activité, Git, session)',
    })
    await $.command.register({
      name: 'taches',
      description: "Affiche un résumé texte de l'avancement des tâches",
    })
    void $.ui.open({ id: PANE, title: TITLE })
    await refreshGit($)
    await refreshStatus($)

    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Tableau de bord ouvert.' }
  })

  on('command.run', { command: 'taches' }, async $ => ({ text: await summary($) }))

  on('prompt.submit', async ($, e, next) => {
    turnStartedAt = await $.clock.now()

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const seconds = turnStartedAt === 0 ? 0 : Math.round((now - turnStartedAt) / 1000)
    await update($, stats, s => ({ ...s, turns: s.turns + 1, lastTurnSeconds: seconds }))
    await refreshGit($)
    await refreshStatus($)
    if (seconds > SLOW_TURN_SECONDS) {
      $.ui.toast(`Terminé après ${duration(seconds * 1000)}`)
      void $.ui.notify('Claude a terminé sa tâche.', { title: TITLE }).catch(() => undefined)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? `${e.tool}-${await $.clock.now()}`
    const entry: Activity = {
      id,
      tool: String(e.tool).replace(/^mcp__([^_]+)__/, '$1·'),
      label: labelFor(e as { tool: string } & Record<string, unknown>),
      state: 'running',
    }
    await update($, activity, list => [...list, entry].slice(-MAX_ACTIVITY))
    await update($, stats, s => ({ ...s, toolCalls: s.toolCalls + 1 }))

    const ran = await next(e)

    const isFailed = ran.deny !== undefined || ran.isError === true
    await update($, activity, list =>
      list.map(one => (one.id === id ? { ...one, state: isFailed ? 'error' : 'ok' } : one)),
    )
    if (isFailed) {
      await update($, stats, s => ({ ...s, errors: s.errors + 1 }))

      return ran
    }

    if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') {
      const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
      await update($, files, list => (list.includes(path) ? list : [...list, path]))
    }

    if (e.tool === 'TaskCreate') {
      const result = ran.result as { task?: { id: string; subject: string } } | undefined
      const created = result?.task
      if (created !== undefined) {
        const task: DashTask = {
          id: created.id,
          subject: created.subject || e.subject,
          status: 'pending',
          activeForm: e.activeForm,
        }
        await update($, tasks, list => [...list.filter(t => t.id !== task.id), task])
      }
    }

    if (e.tool === 'TaskUpdate') {
      const before = await allTasks($)
      await update($, tasks, list => {
        if (e.status === 'deleted') {
          return list.filter(t => t.id !== e.taskId)
        }
        const found = list.some(t => t.id === e.taskId)
        const base: DashTask = list.find(t => t.id === e.taskId) ?? {
          id: e.taskId,
          subject: e.subject ?? `Tâche ${e.taskId}`,
          status: 'pending',
        }
        const changed: DashTask = {
          ...base,
          subject: e.subject ?? base.subject,
          activeForm: e.activeForm ?? base.activeForm,
          status: e.status ?? base.status,
        }

        return found ? list.map(t => (t.id === e.taskId ? changed : t)) : [...list, changed]
      })
      const after = await allTasks($)
      const wasOpen = before.some(t => t.status !== 'completed')
      if (wasOpen && after.length > 0 && after.every(t => t.status === 'completed')) {
        $.ui.toast(`🎉 Les ${after.length} tâches sont terminées`)
      }
    }

    if (e.tool === 'TodoWrite') {
      await update($, todos, () =>
        e.todos.map((todo, i) => ({
          id: `todo-${i}`,
          subject: todo.content,
          status: todo.status,
          activeForm: todo.activeForm,
        })),
      )
    }

    await refreshStatus($)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const list = await allTasks($)
    const s = await read($, stats)
    const info = await read($, git)
    const touched = await read($, files)
    const isActivityShown = await read($, showActivity)
    const recent = (await read($, activity)).slice(-8).reverse()
    const now = await $.clock.now()
    const done = list.filter(t => t.status === 'completed').length
    const percent = list.length === 0 ? 0 : Math.round((done / list.length) * 100)
    const barWidth = Math.min(24, Math.max(8, width - 28))

    return (
      <Box flexDirection="column">
        <Text bold color="claude">
          📋 Tâches
        </Text>
        {list.length === 0 ? (
          <Text dimColor>Aucune tâche suivie pour l'instant.</Text>
        ) : (
          <Box flexDirection="column">
            <Text>
              <Text color="success">{bar(done, list.length, barWidth)}</Text>
              {` ${percent}% (${done}/${list.length})`}
            </Text>
            {list.map(t => (
              <Text
                color={t.status === 'in_progress' ? 'warning' : undefined}
                dimColor={t.status === 'completed'}
                strikethrough={t.status === 'completed'}
                wrap="truncate-end"
              >
                {`${ICON[t.status]} ${t.status === 'in_progress' && t.activeForm ? t.activeForm : t.subject}`}
              </Text>
            ))}
          </Box>
        )}

        <Text> </Text>
        <Text bold color="claude">
          ⚙ Session
        </Text>
        <Text>
          {`${s.turns} tours · ${s.toolCalls} actions · `}
          <Text color={s.errors > 0 ? 'error' : undefined}>{`${s.errors} erreurs`}</Text>
          {` · ${duration(now - s.startedAt)}`}
        </Text>
        {s.lastTurnSeconds > 0 && <Text dimColor>{`Dernier tour : ${s.lastTurnSeconds} s`}</Text>}

        <Text> </Text>
        <Text bold color="claude">
          🌿 Git
        </Text>
        {info === null ? (
          <Text dimColor>Pas de dépôt Git ici.</Text>
        ) : (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              {`${info.repo} @ `}
              <Text bold>{info.branch}</Text>
            </Text>
            <Text color={info.changed > 0 ? 'warning' : 'success'}>
              {`${info.changed} fichier(s) non commité(s) · ${info.ahead} commit(s) à pousser`}
            </Text>
          </Box>
        )}

        <Text> </Text>
        <Text bold color="claude">
          {`📁 Fichiers modifiés (${touched.length})`}
        </Text>
        {touched.length === 0 ? (
          <Text dimColor>Aucun pour l'instant.</Text>
        ) : (
          touched.slice(-6).map(path => (
            <Text dimColor wrap="truncate-start">
              {path}
            </Text>
          ))
        )}

        <Text> </Text>
        <Text bold color="claude">
          🕘 Activité récente
        </Text>
        {isActivityShown &&
          (recent.length === 0 ? (
            <Text dimColor>Rien encore.</Text>
          ) : (
            recent.map(a => (
              <Text
                wrap="truncate-end"
                color={a.state === 'error' ? 'error' : a.state === 'running' ? 'warning' : undefined}
                dimColor={a.state === 'ok'}
              >
                {`${a.state === 'running' ? '…' : a.state === 'error' ? '✗' : '✓'} ${a.tool}${a.label ? ` ${a.label}` : ''}`}
              </Text>
            ))
          ))}

        <Text> </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="git" label="Rafraîchir Git" hotkey="g" onPress={() => refreshGit($)} />
          <Button
            key="activity"
            label={isActivityShown ? "Masquer l'activité" : "Afficher l'activité"}
            hotkey="a"
            onPress={() => update($, showActivity, shown => !shown)}
          />
          <Button
            key="clean"
            label="Retirer les terminées"
            hotkey="c"
            onPress={async () => {
              await update($, tasks, l => l.filter(t => t.status !== 'completed'))
              await update($, todos, l => l.filter(t => t.status !== 'completed'))
              await refreshStatus($)
            }}
          />
        </Box>
      </Box>
    )
  })
}

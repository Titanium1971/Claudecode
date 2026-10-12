import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const percent = atom({ plugin: 'auto-continue', key: 'percent' } as const, null)
const isArmed = atom({ plugin: 'auto-continue', key: 'isArmed' } as const, false)
const resumeAt = atom({ plugin: 'auto-continue', key: 'resumeAt' } as const, null)
const resetsAt = atom({ plugin: 'auto-continue', key: 'resetsAt' } as const, null)

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const BAR = 10
const bar = (pct: number) => {
  const filled = Math.min(BAR, Math.max(0, Math.round((pct / 100) * BAR)))
  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
}

export const register: Register = (on, options) => {
  const threshold = Number(options.threshold)
  const graceMs = Number(options.graceMinutes) * 60_000
  const message = String(options.message)
  let timer: { cancel: () => void } | undefined

  const stopTimer = () => {
    timer?.cancel()
    timer = undefined
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'auto-continue',
      description: 'Resume automatically after the 5-hour limit resets',
      argumentHint: '[on|off|status]',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'auto-continue' }, async ($, e) => {
    const arg = e.args.trim()
    const was = await read($, isArmed)
    const now = arg === 'on' ? true : arg === 'off' ? false : arg === '' ? !was : was
    if (!now) {
      stopTimer()
      await update($, resumeAt, () => null)
    }
    await update($, isArmed, () => now)
    const at = await read($, resumeAt)
    const wait = at ? `, resuming ~${clock(at)}` : ''

    return { text: `Auto-continue ${now ? 'ON' : 'OFF'}${wait}.` }
  })

  on('session.measure', async ($, e, next) => {
    const w = e.rateLimits.find(l => l.kind === 'five_hour')
    await update($, percent, () => w?.percentUsed ?? null)
    await update($, resetsAt, () => (w?.resetsAt ? Date.parse(w.resetsAt) : null))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.reason !== 'error' || e.isAborted || !(await read($, isArmed))) {
      return done
    }

    const { rateLimits } = await $.session.usage()
    const w = rateLimits.find(l => l.kind === 'five_hour')
    const reset = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
    const now = await $.clock.now()
    // ponytail: an API error with the window >= 95% counts as the limit hit;
    // if the error response leaves the usage stale, parse the reset time from the message instead
    if (!w || w.percentUsed < 95 || !(reset > now)) {
      return done
    }

    stopTimer()
    const at = reset + graceMs
    await update($, resumeAt, () => at)
    $.ui.toast(`Limit reached. Resuming at ${clock(at)}.`)
    timer = $.clock.after(at - now, () => {
      timer = undefined
      void update($, resumeAt, () => null)
      void $.prompt.submit({ text: message })
    })

    return done
  })

  // the person typing takes over from a pending resume
  on('prompt.submit', async ($, e, next) => {
    if (timer && e.origin.kind !== 'plugin') {
      stopTimer()
      await update($, resumeAt, () => null)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const pct = await read($, percent)
    const armed = await read($, isArmed)
    const at = await read($, resumeAt)
    const reset = await read($, resetsAt)
    const isQuiet = e.props.hasSurvey || (!armed && (pct === null || pct < threshold))
    if (isQuiet) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box>
          <Button
            key="toggle"
            label={`Auto-continue: ${armed ? 'ON' : 'OFF'}`}
            onPress={async () => {
              if (armed) {
                stopTimer()
                await update($, resumeAt, () => null)
              }
              await update($, isArmed, () => !armed)
            }}
          />
          <Text dimColor>
            {` ${bar(pct ?? 0)}`}
            {at ? ` resumes ~${clock(at)}` : reset ? ` resets ${clock(reset)}` : ''}
          </Text>
        </Box>
        {below}
      </Box>
    )
  })
}

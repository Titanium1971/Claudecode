import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShortenStats } from '../types'

// Au-delà de cette taille, une sortie est raccourcie.
const LIMIT = 6000
const HEAD_LINES = 40
const TAIL_LINES = 40
const MAX_MIDDLE_LINES = 30
// Les lignes du milieu qu'on garde quand même : celles qui parlent d'un problème.
const IMPORTANT = /error|\berr\b|erreur|fail|échec|echec|warn|exception|traceback|fatal|denied|refus/i
// À ajouter à une commande pour recevoir sa sortie en entier.
const FULL_MARKER = '# complet'

const enabled = atom({ plugin: 'sorties-courtes', key: 'enabled' } as const, true)
const stats = atom({ plugin: 'sorties-courtes', key: 'stats' } as const, { count: 0, savedChars: 0 } as ShortenStats)

export function shorten(text: string, savedTo: string | undefined): string {
  const lines = text.split('\n')
  if (text.length <= LIMIT || lines.length <= HEAD_LINES + TAIL_LINES) {
    return text.length <= LIMIT ? text : `${text.slice(0, LIMIT / 2)}\n[…]\n${text.slice(-LIMIT / 2)}`
  }

  const middle = lines.slice(HEAD_LINES, lines.length - TAIL_LINES)
  const kept = middle.filter(line => IMPORTANT.test(line)).slice(0, MAX_MIDDLE_LINES)
  const where = savedTo === undefined ? '' : ` Sortie complète : ${savedTo}`
  const note = `[sorties-courtes : ${middle.length} lignes masquées sur ${lines.length}${kept.length > 0 ? `, ${kept.length} lignes d'erreur ou d'alerte gardées ci-dessous` : ''}.${where}]`

  return [...lines.slice(0, HEAD_LINES), note, ...kept, ...(kept.length > 0 ? ['[…]'] : []), ...lines.slice(-TAIL_LINES)]
    .join('\n')
    .slice(0, LIMIT * 2)
}

async function saveFull($: EngineInterface, text: string): Promise<string | undefined> {
  try {
    const path = `/tmp/sorties-courtes-${await $.clock.now()}.txt`
    await $.fs.write(path, text)

    return path
  } catch {
    return undefined
  }
}

async function count($: EngineInterface, before: number, after: number): Promise<void> {
  await update($, stats, s => ({ count: s.count + 1, savedChars: s.savedChars + Math.max(0, before - after) }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sorties',
      description: 'Sorties courtes : voir ce qui a été économisé, ou activer/désactiver',
      argumentHint: '[on|off]',
    })

    return next(e)
  })

  on('command.run', { command: 'sorties' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'on' || word === 'off') {
      await update($, enabled, () => word === 'on')
    }
    const s = await read($, stats)
    const state = (await read($, enabled)) ? 'activé' : 'désactivé'

    return {
      text: [
        `Sorties courtes : ${state}.`,
        `${s.count} sortie(s) raccourcie(s), environ ${String(Math.round(s.savedChars / 4)).replace(/\B(?=(\d{3})+$)/g, ' ')} tokens économisés.`,
        `Pour une sortie complète, ajoute « ${FULL_MARKER} » à la fin de la commande. /sorties on ou /sorties off.`,
      ].join('\n'),
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const response = await next(e)
    if (!(await read($, enabled)) || e.command.includes(FULL_MARKER)) {
      return response
    }

    // Une commande en échec : le modèle lit le texte de l'erreur.
    if (response.isError === true) {
      const text = response.text ?? ''
      if (text.length <= LIMIT) {
        return response
      }
      const short = shorten(text, await saveFull($, text))
      await count($, text.length, short.length)

      return { deny: short }
    }

    if (response.deny !== undefined || response.result.persistedOutputPath !== undefined) {
      return response
    }
    const { stdout, stderr } = response.result
    if (stdout.length <= LIMIT && stderr.length <= LIMIT) {
      return response
    }
    const full = `${stdout}\n${stderr}`
    const path = await saveFull($, full)
    const shortOut = shorten(stdout, path)
    const shortErr = shorten(stderr, path)
    await count($, stdout.length + stderr.length, shortOut.length + shortErr.length)

    return { result: { ...response.result, stdout: shortOut, stderr: shortErr } }
  }).catch(($, e, next) => next(e))
}

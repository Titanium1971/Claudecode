import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LectureCibleeStats } from '../types'

// Un fichier lu en entier est refusé au-delà de l'une de ces deux tailles.
const MAX_LINES = 2000
const MAX_BYTES = 200_000
// En dessous de cette taille, le fichier est petit : on ne compte même pas ses lignes.
const SMALL_BYTES = 40_000
// Au-delà de cette taille, on ne lit pas le fichier pour compter ses lignes (trop long).
const COUNT_MAX_BYTES = 2_000_000
// Read traite ces fichiers à part (images, PDF, notebooks) : jamais bloqués.
const SPECIAL = /\.(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|avif|pdf|ipynb)$/i

const enabled = atom({ plugin: 'lecture-ciblee', key: 'enabled' } as const, true)
const stats = atom({ plugin: 'lecture-ciblee', key: 'stats' } as const, { blocked: 0, allowedAgain: 0 } as LectureCibleeStats)
// Le dernier fichier refusé : s'il est redemandé en entier juste après, il passe.
const lastDenied = atom({ plugin: 'lecture-ciblee', key: 'lastDenied' } as const, '')

type Size = { bytes: number; lines: number | undefined }

function spaced(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+$)/g, ' ')
}

function describe(size: Size): string {
  const kilo = `${spaced(Math.round(size.bytes / 1000))} Ko`

  return size.lines === undefined ? kilo : `${spaced(size.lines)} lignes, ${kilo}`
}

function countLines(text: string): number {
  let count = 0
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    count += 1
  }

  return text.length > 0 && !text.endsWith('\n') ? count + 1 : count
}

// La taille du fichier s'il est trop gros pour être lu en entier, sinon undefined.
async function tooBig($: EngineInterface, path: string): Promise<Size | undefined> {
  let bytes: number
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') {
      return undefined
    }
    bytes = stat.size
  } catch {
    // Fichier introuvable : Read dira lui-même ce qui ne va pas.
    return undefined
  }
  if (bytes <= SMALL_BYTES) {
    return undefined
  }

  let lines: number | undefined
  if (bytes <= COUNT_MAX_BYTES) {
    try {
      lines = countLines(await $.fs.read(path))
    } catch {
      lines = undefined
    }
  }
  const isTooBig = bytes > MAX_BYTES || (lines !== undefined && lines > MAX_LINES)

  return isTooBig ? { bytes, lines } : undefined
}

function denial(path: string, size: Size): string {
  return [
    `lecture-ciblee : ${path} est un gros fichier (${describe(size)}). Pour économiser des tokens, ne le lis pas en entier.`,
    "1. Cherche d'abord la partie utile avec Grep (avec -n pour avoir les numéros de ligne).",
    '2. Puis lis seulement ce passage avec Read, en donnant offset et limit (par exemple offset 1200, limit 150).',
    "Si tu as vraiment besoin du fichier entier, redemande exactement la même lecture tout de suite : la deuxième demande passera.",
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lecture',
      description: 'Lecture ciblée : voir combien de lectures de gros fichiers ont été évitées, ou activer/désactiver',
      argumentHint: '[on|off]',
    })

    return next(e)
  })

  on('command.run', { command: 'lecture' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'on' || word === 'off') {
      await update($, enabled, () => word === 'on')
      await update($, lastDenied, () => '')
    }
    const s = await read($, stats)
    const state = (await read($, enabled)) ? 'activée' : 'désactivée'

    return {
      text: [
        `Lecture ciblée : ${state}.`,
        `${s.blocked} lecture(s) de gros fichier évitée(s), ${s.allowedAgain} laissée(s) passer à la deuxième demande.`,
        `Un fichier de plus de ${spaced(MAX_LINES)} lignes ou ${spaced(MAX_BYTES / 1000)} Ko n'est pas lu en entier : Claude cherche avec Grep puis lit le passage utile.`,
        'Commandes : /lecture, /lecture on, /lecture off',
      ].join('\n'),
    }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const previous = await read($, lastDenied)
    if (previous !== '') {
      await update($, lastDenied, () => '')
    }

    const isPartial = e.offset !== undefined || e.limit !== undefined || e.pages !== undefined
    if (isPartial || e.allow_large === true || SPECIAL.test(e.file_path) || !(await read($, enabled))) {
      return next(e)
    }

    // Échappatoire : le même fichier redemandé en entier juste après un refus passe.
    if (previous === e.file_path) {
      await update($, stats, s => ({ ...s, allowedAgain: s.allowedAgain + 1 }))

      return next(e)
    }

    const size = await tooBig($, e.file_path)
    if (size === undefined) {
      return next(e)
    }
    await update($, lastDenied, () => e.file_path)
    await update($, stats, s => ({ ...s, blocked: s.blocked + 1 }))

    return { deny: denial(e.file_path, size) }
  })
    // Si le mod lui-même plante, la lecture passe : mieux vaut quelques tokens de trop qu'un Claude bloqué.
    .catch(($, e, next) => next(e))
}

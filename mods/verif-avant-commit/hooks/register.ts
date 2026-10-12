import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { VerifAvantCommitStats } from '../types'

// Une commande qui fait un commit : « git commit », « git -C dossier commit »…
const COMMIT = /\bgit(\s+-[cC]\s+\S+)*\s+commit\b/
// Une commande qui ajoute tous les nouveaux fichiers avant le commit : « git add -A », « git add . ».
const ADD_ALL = /\bgit\s+add\s+(.*\s)?(-A|--all|\.)(\s|$)/
// Temps laissé à chaque vérification (validate ou test) d'un mod.
const TIMEOUT_MS = 120_000
// Nombre de lignes d'erreur recopiées dans le message.
const EXCERPT_LINES = 12
const MOD_NAME = /^[\w.-]+$/

const stats = atom(
  { plugin: 'verif-avant-commit', key: 'stats' } as const,
  { commitsChecked: 0, commitsBlocked: 0 } as VerifAvantCommitStats,
)

type Step = 'validate' | 'test'
type ModCheck = { mod: string; failedStep: Step | undefined; excerpt: string }

async function repoRoot($: EngineInterface): Promise<string | undefined> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
  const root = r.stdout.trim()

  return r.exitCode === 0 && root !== '' ? root : undefined
}

async function isMod($: EngineInterface, root: string, name: string): Promise<boolean> {
  return MOD_NAME.test(name) && (await $.fs.exists(`${root}/mods/${name}/.claude-plugin/plugin.json`))
}

function modsIn(paths: string): string[] {
  const names: string[] = []
  for (const line of paths.split('\n')) {
    const name = /^mods\/([^/]+)\//.exec(line.trim())?.[1]
    if (name !== undefined) {
      names.push(name)
    }
  }

  return names
}

// Les mods touchés : modifications enregistrées (staged) ou non, et les nouveaux fichiers
// quand la commande les ajoute (« git add -A », « git add . », ou « git add mods/<nom> »).
async function changedMods($: EngineInterface, root: string, command: string): Promise<string[]> {
  const names = new Set<string>()
  for (const argv of [
    ['git', 'diff', '--name-only', '--cached'],
    ['git', 'diff', '--name-only'],
  ]) {
    const r = await $.process.run(argv, { cwd: root })
    modsIn(r.stdout).forEach(name => names.add(name))
  }

  const addsAll = ADD_ALL.test(command)
  const named = [...command.matchAll(/\bmods\/([\w.-]+)/g)].map(m => m[1] ?? '')
  if (addsAll || named.length > 0) {
    const r = await $.process.run(['git', 'ls-files', '--others', '--exclude-standard'], { cwd: root })
    for (const name of modsIn(r.stdout)) {
      if (addsAll || named.includes(name)) {
        names.add(name)
      }
    }
  }

  const mods: string[] = []
  for (const name of [...names].sort()) {
    if (await isMod($, root, name)) {
      mods.push(name)
    }
  }

  return mods
}

function excerpt(output: string): string {
  const lines = output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '' && !line.startsWith('(pass)'))
  const start = lines.findIndex(line => /^\s*(×|\(fail\)|error|erreur)/i.test(line))

  return lines
    .slice(Math.max(0, start), Math.max(0, start) + EXCERPT_LINES)
    .map(line => `    ${line}`)
    .join('\n')
}

async function checkMod($: EngineInterface, root: string, mod: string): Promise<ModCheck> {
  for (const step of ['validate', 'test'] as const) {
    const r = await $.process.run(['claude', 'plugin', step, `mods/${mod}`], { cwd: root, timeoutMs: TIMEOUT_MS })
    if (r.exitCode !== 0) {
      return { mod, failedStep: step, excerpt: excerpt(`${r.stdout}\n${r.stderr}`) }
    }
  }

  return { mod, failedStep: undefined, excerpt: '' }
}

async function checkAll($: EngineInterface, root: string, mods: string[]): Promise<ModCheck[]> {
  const results: ModCheck[] = []
  for (const mod of mods) {
    results.push(await checkMod($, root, mod))
  }

  return results
}

function failureLines(failed: ModCheck[]): string[] {
  return failed.flatMap(c => [`- ${c.mod} : « claude plugin ${c.failedStep ?? ''} mods/${c.mod} » échoue :`, c.excerpt])
}

function report(results: ModCheck[]): string {
  return results
    .map(c =>
      c.failedStep === undefined
        ? `  OK      ${c.mod} : validate et test passent`
        : `  ÉCHEC   ${c.mod} : « claude plugin ${c.failedStep} mods/${c.mod} » échoue\n${c.excerpt}`,
    )
    .join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'verif',
      description: 'Vérif avant commit : lancer maintenant validate et test sur les mods modifiés (ou tous, ou un seul)',
      argumentHint: '[tout | <nom du mod>]',
    })

    return next(e)
  })

  on('command.run', { command: 'verif' }, async ($, e) => {
    const root = await repoRoot($)
    if (root === undefined) {
      return { text: "Vérif avant commit : le dossier de la session n'est pas un dépôt git, rien à vérifier." }
    }

    const arg = e.args.trim()
    let mods: string[]
    if (arg === '') {
      mods = await changedMods($, root, 'git add -A')
    } else if (arg.toLowerCase() === 'tout') {
      const entries = await $.fs.list(`${root}/mods`)
      mods = []
      for (const entry of entries.map(x => x.name).sort()) {
        if (await isMod($, root, entry)) {
          mods.push(entry)
        }
      }
    } else if (await isMod($, root, arg)) {
      mods = [arg]
    } else {
      return { text: `Vérif avant commit : pas de mod « ${arg} » dans mods/.` }
    }

    const s = await read($, stats)
    const counts = `Commits vérifiés dans cette session : ${s.commitsChecked}, dont ${s.commitsBlocked} bloqué(s).`
    if (mods.length === 0) {
      return {
        text: ['Vérif avant commit : aucun mod modifié, rien à vérifier.', counts, 'Commandes : /verif, /verif tout, /verif <nom du mod>'].join('\n'),
      }
    }

    const results = await checkAll($, root, mods)
    const failed = results.filter(c => c.failedStep !== undefined).length

    return {
      text: [
        failed === 0
          ? `Vérif avant commit : ${mods.length} mod(s) vérifié(s), tout passe.`
          : `Vérif avant commit : ${failed} mod(s) sur ${mods.length} en échec.`,
        report(results),
        counts,
        'Commandes : /verif, /verif tout, /verif <nom du mod>',
      ].join('\n'),
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!COMMIT.test(e.command)) {
      return next(e)
    }

    let results: ModCheck[]
    try {
      const root = await repoRoot($)
      const mods = root === undefined ? [] : await changedMods($, root, e.command)
      if (root === undefined || mods.length === 0) {
        return next(e)
      }
      results = await checkAll($, root, mods)
    } catch (error) {
      // La vérification elle-même n'a pas pu tourner (claude introuvable, délai dépassé…) :
      // le commit passe, et on le dit.
      $.ui.log(`verif-avant-commit : vérification impossible (${String(error).slice(0, 200)}), le commit passe sans vérification. Lance /verif pour vérifier.`)

      return next(e)
    }

    await update($, stats, s => ({ ...s, commitsChecked: s.commitsChecked + 1 }))
    const failed = results.filter(c => c.failedStep !== undefined)
    if (failed.length === 0) {
      $.ui.log(`verif-avant-commit : ${results.map(c => c.mod).join(', ')} vérifié(s), validate et test passent.`)

      return next(e)
    }

    await update($, stats, s => ({ ...s, commitsBlocked: s.commitsBlocked + 1 }))

    return {
      deny: [
        'verif-avant-commit : commit refusé. Règle du dépôt : avant de committer un mod, « claude plugin validate » puis « claude plugin test » doivent passer.',
        ...failureLines(failed),
        'Corrige le problème, relance les deux commandes (ou /verif), puis refais le commit.',
      ].join('\n'),
    }
  }).catch(($, e, next) => {
    // Si le mod plante, on ne bloque pas les commits pour toujours : le commit passe,
    // et un message le signale (un commit se corrige, un mod en panne bloquerait tout).
    if (next.error.kind !== 're-entry' && !next.called) {
      try {
        $.ui.log('verif-avant-commit : le mod a rencontré un problème, ce commit passe sans vérification. Lance /verif pour vérifier.')
      } catch {
        // rien de plus à faire
      }
    }

    return next(e)
  })
}

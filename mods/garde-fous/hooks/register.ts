import type { Register } from 'claude-code'

// Fichiers de secrets : .env, .env.local, clés privées, identifiants.
const SECRET_FILE = /(^|\/)(\.env(\.[^/]*)?|id_rsa[^/]*|id_ed25519[^/]*|[^/]*\.pem|[^/]*\.key|credentials(\.json)?)$/
const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template)$/

type Rule = { pattern: RegExp; why: string }

const DANGEROUS_COMMANDS: Rule[] = [
  {
    pattern: /\bgit\s+push\b[^\n;&|]*(\s--force\b|\s-f\b|\s--force-with-lease\b)[^\n;&|]*\b(main|master)\b/,
    why: 'un push forcé sur main/master réécrirait l’historique partagé',
  },
  {
    pattern: /\bgit\s+push\b[^\n;&|]*\s(origin\s+)?(HEAD:)?(main|master)\s*($|[;&|])/,
    why: 'on ne pousse pas directement sur main/master : passe par une branche et une PR',
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    why: '`git reset --hard` efface le travail non commité',
  },
  {
    pattern: /\bgit\s+clean\s+-[a-z]*f/,
    why: '`git clean -f` supprime définitivement les fichiers non suivis',
  },
  {
    pattern: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME|\*)(\s|$)/,
    why: 'suppression récursive de la racine, du dossier personnel ou de tout le dossier',
  },
  {
    pattern: /\b(cat|less|more|head|tail)\b[^\n;&|]*[\s/]\.env(\s|$)/,
    why: 'afficher un fichier .env exposerait des secrets dans la conversation',
  },
]

function isSecretFile(path: string): boolean {
  return SECRET_FILE.test(path) && !ENV_EXAMPLE.test(path)
}

export const register: Register = on => {
  on('tool.call', { tool: ['Edit', 'Write', 'Read', 'NotebookEdit'] }, ($, e, next) => {
    const path =
      e.tool === 'NotebookEdit'
        ? e.notebook_path
        : e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'Read'
          ? e.file_path
          : ''
    if (isSecretFile(path)) {
      $.ui.toast(`🛡 Garde-fou : accès bloqué à ${path}`)

      return {
        deny: `${$.plugin.name}: ${path} contient probablement des secrets. Demande à Cyril de faire la modification lui-même ou d'utiliser un fichier .env.example.`,
      }
    }

    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: le garde-fou a échoué, action bloquée par prudence.` },
  )

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const rule = DANGEROUS_COMMANDS.find(r => r.pattern.test(e.command))
    if (rule !== undefined) {
      $.ui.toast(`🛡 Garde-fou : commande bloquée`)

      return {
        deny: `${$.plugin.name}: commande bloquée, ${rule.why}. Si c'est vraiment voulu, demande à Cyril de la lancer lui-même.`,
      }
    }

    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: le garde-fou a échoué, commande bloquée par prudence.` },
  )
}

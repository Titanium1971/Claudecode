# Claudecode

L'espace de travail de Cyril avec Claude Code : des **mods** (extensions qui modifient l'interface et le comportement de Claude)
et, plus tard, des projets d'automatisation.

## Les mods

| Mod | Ce qu'il fait | Commandes |
| --- | --- | --- |
| **tableau-de-bord** | Panneau qui affiche l'avancement des tâches (barre de progression, statut de chaque tâche), les statistiques de la session (tours, actions, erreurs, durée), l'état Git (dépôt, branche, fichiers non commités, commits à pousser), les fichiers modifiés et l'activité récente. Il met aussi à jour la barre de statut, affiche une notification quand toutes les tâches sont finies, et une autre quand un tour dure plus de 2 minutes. | `/dashboard` ouvre le panneau, dit sur quel écran il a été dessiné (le web claude.ai ne l'affiche pas) et donne le résumé texte, `/taches` affiche un résumé texte. Dans le panneau : `g` rafraîchit Git, `a` affiche ou masque l'activité, `c` retire les tâches terminées. |
| **garde-fous** | Bloque la lecture et la modification des fichiers secrets (`.env`, clés `.pem`/`.key`, `id_rsa`, `credentials.json`, mais pas `.env.example`). Bloque aussi les commandes dangereuses : push forcé ou direct sur `main`/`master`, `git reset --hard`, `git clean -f`, `rm -rf /` ou `~`, `cat .env`. | Aucune, il agit tout seul. |
| **choix-modele** | Avant chaque demande, Haiku la classe (simple, standard ou complexe) et le tour part sur le modèle adapté : Haiku, Sonnet ou Opus. Si le classement échoue, c'est Sonnet. Les sous-agents gardent leur modèle. Le choix s'affiche dans la barre de statut. | `/modele` montre le mode et le nombre de demandes par modèle ; `/modele haiku`, `/modele sonnet` ou `/modele opus` force un modèle ; `/modele auto` revient au choix automatique. |

## Utiliser les mods

**Dans une session Claude Code sur le web ou mobile (cloud)** : il n'y a rien à faire. Le fichier `CLAUDE.md` demande à Claude
de charger les mods au début de chaque session. Quand la question **« Enable hot reloading for this session? »** apparaît,
réponds **« Enable for this session »**.

**Sur ton ordinateur (Claude Code dans un terminal)**, tape ces lignes une seule fois :

```
/plugin install tableau-de-bord --marketplace Titanium1971/Claudecode
/plugin install garde-fous --marketplace Titanium1971/Claudecode
/plugin install choix-modele --marketplace Titanium1971/Claudecode
```

Réponds `y` pour ajouter le catalogue, puis choisis la portée « user » avec Entrée.

## Changer de dépôt et continuer le travail

Voir [PROCEDURE.md](PROCEDURE.md).

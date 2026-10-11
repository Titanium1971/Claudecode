# Claudecode — consignes pour Claude

Ce dépôt est l'espace de travail de **Cyril** (formation no-code et automatisation).
Réponds en **français**, avec des explications claires et sans jargon inutile.

## Au début de chaque session : charger les mods

Les mods de ce dépôt sont dans `mods/`. Une session cloud ne les charge pas toute seule.
À la première demande de Cyril dans une session, avant le reste :

1. Charge le skill `plugin-authoring` (outil Skill).
2. Copie chaque dossier `mods/<nom>/` dans le dossier de mods de la session indiqué par le skill
   (`/root/.claude/dev-mods/<id-de-session>/<nom>/`), sans `.claude-plugin/types/` ni `tsconfig.json`.
3. Dis à Cyril de répondre **« Enable for this session »** à la question « Enable hot reloading for this session? ».
4. Une fois chargés, le panneau « Tableau de bord » s'ouvre tout seul. `/dashboard` le rouvre et `/taches` donne un résumé.

## Façon de travailler

- Pour tout travail en plusieurs étapes, crée les tâches avec **TaskCreate** et mets-les à jour avec **TaskUpdate**
  (`in_progress` au début, `completed` à la fin) : c'est ce qui alimente le tableau de bord.
- Travaille sur une branche, puis ouvre une pull request en brouillon. Ne pousse jamais directement sur `main`.
- Ne lis et ne modifie jamais les fichiers `.env` ou les clés : demande à Cyril (le mod `garde-fous` les bloque).

## Créer ou modifier un mod

- Un mod = `mods/<nom>/` avec `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts(x)`,
  et `types/index.d.ts` s'il garde un état.
- Avant de committer : `claude plugin validate mods/<nom>` puis `claude plugin test mods/<nom>`, qui doivent passer.
- Ajoute chaque nouveau mod dans `.claude-plugin/marketplace.json` et dans le tableau du `README.md`.

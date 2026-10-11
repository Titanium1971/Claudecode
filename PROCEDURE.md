# Procédure : travailler dans le dépôt « Claudecode »

## 1. Valider la première pull request (une seule fois)

Claude a envoyé les mods sur une branche et ouvert une pull request en brouillon.

1. Ouvre https://github.com/Titanium1971/Claudecode/pulls et clique sur la pull request.
2. Clique sur **Ready for review**, puis sur **Merge pull request** et **Confirm merge**.

Les mods sont alors sur `main`, la branche principale.

## 2. Ouvrir une nouvelle session sur ce dépôt

Une session est liée aux dépôts choisis au moment où elle démarre. Pour changer de dépôt, il faut donc démarrer une nouvelle session :

1. Ouvre https://claude.ai/code (ou l'onglet **Code** de l'app Claude sur mobile ou ordinateur).
2. Clique sur **New session** (nouvelle session).
3. Dans le sélecteur de dépôt, choisis **Titanium1971/Claudecode** à la place de `Agnes`.
4. Garde le même environnement, puis écris ta première demande, par exemple :
   « Charge les mods et ouvre le tableau de bord ».
5. Quand la question **« Enable hot reloading for this session? »** s'affiche, réponds **« Enable for this session »**.

Claude lit `CLAUDE.md` tout seul : il sait qu'il doit charger les mods, travailler en français, suivre les tâches
dans le tableau de bord et passer par des branches et des pull requests.

Si GitHub demande un accès : https://github.com/apps/claude/installations/select_target, puis ajoute `Claudecode`
dans « Repository access ». Si GitHub n'est pas connecté à Claude : https://claude.ai/connect-github

## 3. Créer de nouveaux mods

Dans une session sur `Claudecode`, demande par exemple :

- « Crée un mod qui… » (décris le besoin avec tes mots)
- « Modifie le tableau de bord pour ajouter… »

Claude crée le mod dans `mods/`, le teste, le charge dans la session pour que tu le voies tout de suite,
puis ouvre une pull request. Tu la valides comme à l'étape 1. Idées de mods utiles :

| Idée | Ce qu'il ferait |
| --- | --- |
| **journal** | Garde un journal des sessions (ce qui a été fait, les décisions prises) dans `journal/AAAA-MM-JJ.md`. |
| **webhooks** | Commande `/webhook` pour tester un webhook Make ou n8n et afficher la réponse. |
| **memo-client** | Commande `/client <nom>` qui injecte la fiche d'un client (contexte, outils, accès) avant de travailler. |
| **budget** | Affiche dans la barre de statut la consommation de tokens de la session. |
| **checklist-pr** | Avant chaque pull request, vérifie que les tests passent et que le README est à jour. |

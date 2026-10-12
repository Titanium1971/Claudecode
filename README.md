# Claudecode

L'espace de travail de Cyril avec Claude Code : des **mods** (extensions qui modifient l'interface et le comportement de Claude)
et, plus tard, des projets d'automatisation.

## Les mods

| Mod | Ce qu'il fait | Commandes |
| --- | --- | --- |
| **tableau-de-bord** | Panneau qui affiche l'avancement des tâches (barre de progression, statut de chaque tâche), les statistiques de la session (tours, actions, erreurs, durée), l'état Git (dépôt, branche, fichiers non commités, commits à pousser), les fichiers modifiés et l'activité récente. Il met aussi à jour la barre de statut, affiche une notification quand toutes les tâches sont finies, et une autre quand un tour dure plus de 2 minutes. | `/dashboard` ouvre le panneau, dit sur quel écran il a été dessiné (le web claude.ai ne l'affiche pas) et donne le résumé texte, `/taches` affiche un résumé texte. Dans le panneau : `g` rafraîchit Git, `a` affiche ou masque l'activité, `c` retire les tâches terminées. |
| **garde-fous** | Bloque la lecture et la modification des fichiers secrets (`.env`, clés `.pem`/`.key`, `id_rsa`, `credentials.json`, mais pas `.env.example`). Bloque aussi les commandes dangereuses : push forcé ou direct sur `main`/`master`, `git reset --hard`, `git clean -f`, `rm -rf /` ou `~`, `cat .env`. | Aucune, il agit tout seul. |
| **choix-modele** | Avant chaque nouvelle demande, Haiku la classe (simple, standard ou complexe) et le tour part sur Haiku, Sonnet ou Opus. Il ne change de modèle que si l'économie dépasse la perte de cache (dans une longue conversation, passer d'Opus à Sonnet coûte plus qu'il ne rapporte), jamais au milieu d'un tour, et jamais vers un modèle moins capable pour une demande difficile. Les sous-agents passent sur Sonnet sauf s'ils ont choisi leur modèle. Si le classement échoue, c'est Sonnet. Le choix s'affiche dans la barre de statut. | `/modele` montre le mode, les appels réellement faits par modèle, les fois où il est resté sur le modèle en cours et la taille de la conversation ; `/modele haiku`, `sonnet` ou `opus` force un modèle ; `/modele auto` revient au choix automatique ; `/modele agents sonnet` (ou `haiku`, `opus`, `defaut`) règle les sous-agents. |
| **compteur-tokens** | Compte les tokens de chaque appel au modèle (fil principal, sous-agents et petits appels des mods) et estime le coût de la session au tarif de l'API. Il montre aussi combien la session aurait coûté tout sur Opus, donc ce que fait économiser choix-modele. Il montre aussi tes limites d'abonnement 5 h et 7 jours (pourcentage utilisé, heure de remise à zéro) quand la session les fournit. Il prévient une fois quand la session dépasse un seuil (5 $ par défaut). Il publie le coût de la session pour les autres mods (etude-de-cas le reprend dans ses fiches). | `/cout` affiche le détail par modèle ; `/cout alerte 10` change le seuil (`0` le coupe) ; `/cout zero` remet à zéro. |
| **sorties-courtes** | Quand une commande affiche plus de 6 000 caractères, il ne transmet au modèle que les 40 premières lignes, les 40 dernières et les lignes d'erreur ou d'alerte du milieu. La sortie complète est gardée dans un fichier `/tmp/sorties-courtes-….txt`. | `/sorties` montre ce qui a été économisé ; `/sorties off` ou `/sorties on`. Ajouter `# complet` à la fin d'une commande garde sa sortie entière. |
| **garde-fous-connecteurs** | Avant qu'un connecteur envoie, crée, modifie, supprime ou lance quelque chose (Gmail, Airtable, Notion, Make, n8n, Google Drive, Calendar…), il te pose la question : Refuser, Autoriser, ou Toujours pour cet outil. Les lectures et recherches passent sans question. Pour GitHub, seules les fusions et suppressions demandent confirmation. | `/connecteurs` montre les outils toujours autorisés ; `/connecteurs reset` fait tout redemander. |
| **lecture-ciblee** | Empêche Claude de lire en entier un très gros fichier (plus de 2 000 lignes ou 200 Ko) : il cherche d'abord avec Grep puis ne lit que le passage utile ; redemander la même lecture juste après la laisse passer. | `/lecture` ; `/lecture on` ou `/lecture off`. |
| **verif-avant-commit** | Avant chaque `git commit`, lance `claude plugin validate` puis `claude plugin test` sur chaque mod modifié et refuse le commit si l'un échoue, en montrant l'erreur. | `/verif` ; `/verif tout` ; `/verif <nom du mod>`. |
| **micro-compaction** (Rui He, Unlicense) | Ajoute `/compact micro` : remplace le contenu des fichiers déjà lus par un court repère et retire la réflexion, sans appel au modèle, pour libérer de la place dans la conversation. | `/compact micro`. |
| **secret-redactor** (Ray Amjad, MIT) | Remplace les secrets (clés d'API, mots de passe), les e-mails et les adresses IP par des repères avant que le modèle ne les voie, et remet les vraies valeurs au moment d'exécuter les outils. | Aucune ; options dans les réglages du mod (`allowEmails`, `pii`, `redactPrivateIps`). |
| **image-shrinker** (Varun Moka, MIT) | Réduit automatiquement les grandes images avant que Claude ne les lise et lui indique l'échelle. Mac uniquement (outil `sips`) : ne fait rien dans une session cloud. | Aucune. |
| **arrester** (dot-agi, MIT) | Après un blocage (garde-fous, règle, mode auto ou ton refus), empêche Claude de contourner l'interdiction par un autre outil et lui demande de s'arrêter pour te demander. Copie adaptée pour reconnaître les refus de garde-fous et garde-fous-connecteurs. | `/arrester` ; `/arrester history` ; `/arrester clear`. |
| **smart-compact** (hellosverre, MIT) | Propose de compacter la conversation au bon moment (après un commit, des tests au vert, avant l'expiration du cache) et donne à Claude un outil pour le demander lui-même. La proposition s'affiche au-dessus de la zone de saisie : invisible sur le web et l'iPad (régler `onRequest` sur `auto`). | Aucune. |
| **auto-continue** (icedevil2001, MIT) | Quand la limite des 5 heures est atteinte, attend sa remise à zéro puis envoie « continue » tout seul. Fait pour le terminal ; incertain dans une session cloud. | `/auto-continue on`, `off` ou `status`. |
| **agent-pager** (RadTech, MIT) | T'envoie une alerte sur ton téléphone (ntfy ou Telegram) quand Claude a fini une longue tâche, pose une question ou attend une permission. Pour Telegram, le jeton et l'identifiant de conversation peuvent venir des variables d'environnement `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID`. Répondre depuis le téléphone est désactivé par défaut. | `/pager test`, `status`, `pause`, `resume`. |
| **journal** | Après chaque demande qui a modifié quelque chose, ajoute une entrée courte à `JOURNAL.md` à la racine du dépôt : date et heure, la demande en une ligne, les fichiers modifiés, les commits, push et PR. Les simples questions ne sont pas notées, et rien de secret n'est recopié. Pratique pour reprendre le travail sur un autre appareil. | `/journal` affiche les 10 dernières entrées (`/journal 20` pour plus) ; `/journal off` ou `/journal on`. |
| **etude-de-cas** | Transforme la session en fiche portfolio : durée, outils, tâches, fichiers, commits, pull requests, coût estimé et tokens (repris du mod compteur-tokens, sinon « non disponible »), et un récit en 250 mots rédigé par Haiku (contexte, problème, solution, outils, résultat). Tout est anonymisé avant d'être écrit : e-mails, clés, IP, chemins personnels, et les noms et domaines que tu listes dans `etudes-de-cas/anonymiser.json` (`{ "names": [...], "domains": [...] }`). La fiche est rangée dans `etudes-de-cas/AAAA-MM-JJ-titre.md`. Une notification propose d'en faire une quand une pull request est créée ou que toutes les tâches sont terminées. | `/etude-de-cas` écrit la fiche (`/etude-de-cas Mon titre` pour choisir le titre) ; `/etude-de-cas apercu` montre les faits sans écrire ni appeler le modèle. |
| **reflect-mod** (Bayram Annakov, MIT) | Apprend de tes corrections. Quand tu écris un message court qui fixe une règle durable (« non, utilise pnpm », « réponds toujours en français »), Haiku la repère et la reformule en une ligne. Rien n'est écrit sans toi : tu choisis de l'enregistrer dans le `CLAUDE.md` du dépôt (ou en global), ou de l'ignorer. Les accusés de réception (« ok », « merci ») et les messages qui ressemblent à un secret ne sont jamais envoyés au modèle. Adapté pour ce dépôt : sur le web et l'iPad, où le bandeau ne s'affiche pas, on décide par commande, et en session cloud la règle va par défaut dans le `CLAUDE.md` du dépôt (le global disparaît avec la session). | `/reflect-queue` liste les règles trouvées, numérotées ; `/reflect-save <n> [projet\|global]` en enregistre une ; `/reflect-skip <n>` l'ignore ; `/reflect-pause` met en pause ou relance. `remember: <règle>` propose une règle sans passer par le modèle. Sur ordinateur, un bandeau au-dessus de la saisie propose aussi les boutons. |
| **raccourcis** | Tes propres commandes : chaque entrée de `raccourcis.json` (à la racine du dépôt) devient une commande `/nom` qui envoie à Claude une demande complète, `{args}` étant remplacé par ce que tu tapes après. Un modèle avec trois raccourcis (workflow n8n, scénario Make, base Airtable) est fourni dans `mods/raccourcis/raccourcis.exemple.json`. | `/raccourcis` liste tes raccourcis ; `/raccourcis recharger` relit le fichier ; `/raccourcis exemple` affiche le modèle. |
| **commandes** | Te dit ce que tu peux taper : la liste des commandes ajoutées par tes mods, regroupées par mod, toujours à jour car lue dans Claude Code (pas de tableau écrit à la main). Les gros groupes (par exemple les compétences Anthropic) sont repliés. Si la commande `/plugin` n'existe pas dans l'environnement (web, mobile, iPad), il le dit. | `/commandes` liste tout ; `/commandes <mod>` détaille un mod avec les descriptions ; `/commandes <mot>` cherche dans les noms et les descriptions (sans tenir compte des accents). |
| **verif-workflows** | Quand Claude écrit ou modifie un fichier `.json` qui est un workflow n8n ou un blueprint Make, il le relit tout de suite : JSON valide, nœuds avec nom, type et position, noms uniques et connexions vers des nœuds qui existent (n8n) ; modules avec un id unique et un nom de module (Make). Il signale les problèmes à Claude sans jamais bloquer l'écriture. | `/verif-workflows` montre les dernières vérifications ; `/verif-workflows chemin/du/fichier.json` vérifie un fichier. |

## Utiliser les mods

**Dans une session Claude Code sur le web ou mobile (cloud)** : il n'y a rien à faire. Le fichier `CLAUDE.md` demande à Claude
de charger les mods au début de chaque session. Quand la question **« Enable hot reloading for this session? »** apparaît,
réponds **« Enable for this session »**.

**Sur ton ordinateur (Claude Code dans un terminal)**, tape ces lignes une seule fois :

```
/plugin install tableau-de-bord --marketplace Titanium1971/Claudecode
/plugin install garde-fous --marketplace Titanium1971/Claudecode
/plugin install choix-modele --marketplace Titanium1971/Claudecode
/plugin install compteur-tokens --marketplace Titanium1971/Claudecode
/plugin install sorties-courtes --marketplace Titanium1971/Claudecode
/plugin install garde-fous-connecteurs --marketplace Titanium1971/Claudecode
/plugin install agent-pager --marketplace Titanium1971/Claudecode
/plugin install arrester --marketplace Titanium1971/Claudecode
/plugin install auto-continue --marketplace Titanium1971/Claudecode
/plugin install image-shrinker --marketplace Titanium1971/Claudecode
/plugin install journal --marketplace Titanium1971/Claudecode
/plugin install etude-de-cas --marketplace Titanium1971/Claudecode
/plugin install lecture-ciblee --marketplace Titanium1971/Claudecode
/plugin install micro-compaction --marketplace Titanium1971/Claudecode
/plugin install reflect-mod --marketplace Titanium1971/Claudecode
/plugin install raccourcis --marketplace Titanium1971/Claudecode
/plugin install commandes --marketplace Titanium1971/Claudecode
/plugin install secret-redactor --marketplace Titanium1971/Claudecode
/plugin install smart-compact --marketplace Titanium1971/Claudecode
/plugin install verif-avant-commit --marketplace Titanium1971/Claudecode
/plugin install verif-workflows --marketplace Titanium1971/Claudecode
```

Réponds `y` pour ajouter le catalogue, puis choisis la portée « user » avec Entrée.

## Changer de dépôt et continuer le travail

Voir [PROCEDURE.md](PROCEDURE.md).

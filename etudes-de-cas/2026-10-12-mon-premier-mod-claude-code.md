# Mon premier mod Claude Code

_Écrit le 2026-10-12 à partir d’une session de travail, relu et corrigé à la main._

**Contexte**
Je me forme au no-code et à l’automatisation. J’utilise un dépôt GitHub qui regroupe des « mods » pour Claude Code : de petites extensions qui changent le comportement de l’assistant (tableau de bord, garde-fous, compteur de coût…). Le dépôt en comptait déjà 18. Je voulais un mod qui serve aussi mon portfolio, réalisable en une à deux heures.

**Problème**
Après une session avec un assistant IA, il ne reste qu’une conversation longue et des commits. Pour montrer ce travail à un client ou dans un portfolio, il faut tout reconstituer à la main : ce qui a été fait, avec quels outils, en combien de temps, pour quel coût. Il faut aussi éviter d’y laisser des noms de clients, des e-mails ou des clés.

**Solution**
J’ai commencé par me faire interviewer par l’assistant (domaine, outils, public, temps disponible) pour choisir le projet. J’ai ensuite fixé quatre règles : Haiku rédige le récit, les fiches vont dans `etudes-de-cas/`, tout est anonymisé, et le mod propose une fiche au bon moment.

Le mod `etude-de-cas` observe la session : tâches, fichiers modifiés, commits, envois sur GitHub, pull requests et outils utilisés. La commande `/etude-de-cas` anonymise ces faits, les fait rédiger par Haiku et range la fiche dans le dépôt. Le coût vient du mod `compteur-tokens`, qui publie désormais son total pour les autres mods : le tarif reste ainsi à un seul endroit.

Les essais en conditions réelles ont révélé plusieurs défauts, corrigés un par un, chacun avec un test :
- un titre pris dans la sortie d’une commande au lieu de mon message ;
- des commits comptés à tort parce qu’ils étaient cités dans un script ;
- des titres de commit sur plusieurs lignes ;
- une boucle sans fin entre le mod `journal` et la vérification de fin de tour ;
- le risque d’écraser une fiche déjà retouchée à la main.

**Outils**
Claude Code (session cloud, depuis l’iPad), TypeScript, l’API des mods (hooks, état partagé, appel à Haiku), les tests de `claude plugin test`, Git et GitHub (branche, pull request en brouillon).

**Résultat**
- Un mod complet, `etude-de-cas`, couvert par 21 tests automatiques.
- Deux mods existants améliorés : `compteur-tokens` (publication du coût, 7 tests) et `journal` (fin de la boucle, 11 tests).
- Un troisième mod, `commandes`, qui liste les commandes de mes mods directement dans Claude Code (9 tests).
- Une pull request en brouillon, qui passe la validation et tous les tests.
- Coût estimé de la session : 6,27 $ en équivalent API (dernier `/cout`). Tout sur Opus aurait coûté 13,87 $ : l'économie est de 7,60 $, soit environ 55 %.

**Ce que j’en retiens**
Se faire interviewer avant de construire fait gagner du temps : le projet choisi correspondait à un vrai besoin. Les tests automatiques ne suffisent pas : c’est l’essai réel sur l’iPad qui a montré les défauts de titre et de commits. Enfin, deux automatisations qui se déclenchent l’une l’autre peuvent tourner en boucle : il faut toujours prévoir un cas d’arrêt.

---

## Annexe chiffrée

- Durée de construction : environ 30 minutes, du lancement (vers 03:00 UTC) à la dernière correction (vers 03:35 UTC)
- Coût estimé (équivalent API) : 6,27 $ au dernier `/cout`, pour environ 26 millions de tokens d'entrée (dont environ 95 % en cache) et 137 000 de sortie
- Tests automatiques : 21 (`etude-de-cas`), 9 (`commandes`), 7 (`compteur-tokens`), 11 (`journal`), soit 48
- Commits de travail : 6, plus des entrées de journal
- Pull request : « Nouveau mod etude-de-cas : fiche portfolio anonymisée de la session » (brouillon)

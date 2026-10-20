# User stories

Priorisation MoSCoW. Les critères marqués 🔒 sont aussi des exigences de sécurité couvertes par des
tests automatisés.

## Epic 1 — Recevoir les événements GitHub

**US-01 · Accepter uniquement les webhooks authentiques** — _Must_

> En tant qu'exploitant, je veux que seuls les événements signés par GitHub déclenchent une analyse.

- 🔒 La signature `X-Hub-Signature-256` est vérifiée sur le corps brut, en temps constant.
- 🔒 Une signature absente, mal formée ou fausse donne `401`, sans détail sur la cause.
- 🔒 Deux secrets peuvent être actifs en même temps, pour une rotation sans interruption.
- Un corps de plus de 1 Mo est refusé (`413`) avant le calcul de la signature.

**US-02 · Ne pas analyser deux fois le même événement** — _Must_

> En tant que développeur, je ne veux pas voir deux commentaires pour un même push.

- Une livraison déjà traitée (`X-GitHub-Delivery`) répond `200` sans nouvelle analyse.
- Deux livraisons pour le même commit d'une PR produisent une seule analyse.

**US-03 · Suivre les installations** — _Must_

> En tant qu'administrateur GitHub, je veux que CodeLens suive les dépôts où je l'installe.

- L'installation, la désinstallation, la suspension et l'ajout ou le retrait de dépôts sont pris en
  compte dès réception de l'événement.
- 🔒 Après désinstallation, plus aucune donnée du compte n'est visible dans le tableau de bord.

## Epic 2 — Analyser une pull request

**US-04 · Analyser seulement ce qui change** — _Must_

> En tant que développeur, je veux des remarques sur mes lignes, pas sur la dette historique.

- Seules les lignes ajoutées ou modifiées produisent des constats (sauf règles portant sur la PR).
- Les fichiers supprimés, binaires ou ignorés par la configuration ne sont pas analysés.

**US-05 · Être prévenu d'un secret commité** — _Must_

> En tant que tech lead, je veux bloquer une PR qui ajoute une clé ou un mot de passe.

- Clés AWS, jetons GitHub et Slack, clés privées PEM et affectations de mots de passe sont détectés.
- 🔒 Le constat indique le type et l'emplacement, jamais la valeur, même partiellement.
- Le constat est de sévérité `blocker` : la gate par défaut échoue.

**US-06 · Repérer les oublis de débogage** — _Must_

> En tant que relecteur, je ne veux plus signaler `console.log`, `debugger` ni `it.only`.

- `debugger` : `major` ; `console.log` hors fichier de test : `minor`.
- `describe.only`, `it.only`, `test.only` : `critical`, car ils désactivent silencieusement les
  autres tests en CI.

**US-07 · Limiter la complexité** — _Should_

> En tant que tech lead, je veux être alerté quand une fonction modifiée devient trop complexe.

- La complexité cyclomatique est calculée sur l'arbre syntaxique TypeScript, sans exécuter le code.
- Seules les fonctions qui contiennent une ligne modifiée sont signalées ; le seuil est configurable.

**US-08 · Détecter les injections SQL** — _Should_

> En tant que développeur, je veux être prévenu quand j'interpole une variable dans une requête SQL.

- Une interpolation `${...}` ou une concaténation dans `query`, `execute`, `raw` ou
  `$queryRawUnsafe` est signalée en `critical`, avec la correction attendue (paramètres liés).

**US-09 · Hygiène de la PR** — _Could_

- PR de plus de 400 lignes modifiées : `minor` ; plus de 1 000 : `major`.
- Code source modifié sans aucun fichier de test modifié : `minor`.
- `TODO` ou `FIXME` ajouté sans référence de ticket : `info`.
- Dépendance ajoutée dans `package.json` : `info` ; `package.json` modifié sans lockfile : `major`.

## Epic 3 — Publier le résultat

**US-10 · Voir les remarques dans la PR** — _Must_

> En tant que développeur, je veux lire les remarques au bon endroit, sans quitter GitHub.

- Un check « CodeLens » passe `in_progress` dès le début de l'analyse.
- Chaque constat devient une annotation sur sa ligne (`failure`, `warning` ou `notice`).
- Un seul commentaire de synthèse par PR, mis à jour à chaque push.

**US-11 · Bloquer la fusion selon des règles d'équipe** — _Must_

> En tant que tech lead, je veux définir ce qui bloque une fusion.

- `.codelens.yml` fixe le nombre maximal de constats par sévérité ; par défaut, aucun `blocker`
  ni `critical`.
- 🔒 La configuration est lue sur la **branche de base** : une PR ne peut pas assouplir les règles
  qui la jugent.
- Une configuration invalide donne un check `neutral` qui explique l'erreur, ligne par ligne.

**US-12 · Ne pas être bloqué par une panne** — _Must_

> En tant que développeur, je ne veux pas qu'une panne de CodeLens empêche de livrer.

- Après les tentatives de reprise, une analyse en échec publie un check `neutral` avec un message
  clair, et non `failure`.

## Epic 4 — Tableau de bord

**US-13 · Me connecter avec GitHub** — _Must_

- Connexion OAuth avec `state` et PKCE ; session opaque côté serveur.
- 🔒 Je ne vois que les dépôts auxquels j'ai accès sur GitHub (autres dépôts : `404`).

**US-14 · Suivre les analyses** — _Must_

- Liste des PR d'un dépôt avec l'état de la gate et la dernière analyse.
- Détail d'une analyse : constats par fichier et par sévérité, durée, analyseurs exécutés.

**US-15 · Mesurer les tendances** — _Should_

- Constats par analyseur et par semaine, taux de gates réussies sur 30 jours.

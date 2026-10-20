# Cahier des charges — CodeLens

## 1. Contexte

Dans une équipe de cinq à vingt développeurs, la revue de code bloque souvent : un relecteur passe
plus de temps à signaler un `console.log` oublié, un test marqué `.only` ou une fonction de
200 lignes qu'à discuter de la conception. Les outils du marché (SonarQube, CodeClimate, DeepSource)
répondent au besoin mais sont lourds à héberger ou facturés par développeur. Les règles de l'équipe
restent alors implicites et inégalement appliquées.

CodeLens est une **GitHub App de revue automatisée** : à chaque push sur une pull request, elle
analyse **uniquement les lignes modifiées** et publie un check GitHub avec des annotations sur ces
lignes, plus un commentaire de synthèse. Une _quality gate_ configurable peut bloquer la fusion.

## 2. Objectifs

| Objectif                                        | Indicateur de succès                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Libérer les relecteurs des remarques mécaniques | Chaque règle de `docs/analyzers.md` est signalée automatiquement        |
| Retour rapide                                   | Check publié en moins de 30 s (p95) pour une PR de moins de 50 fichiers |
| Ne jamais bloquer à tort                        | Une panne de CodeLens n'empêche aucune fusion (conclusion `neutral`)    |
| Bloquer ce qui doit l'être                      | Un secret ou un test `.only` fait échouer la gate par défaut            |
| Mesurer la qualité dans le temps                | Tableau de bord : constats par analyseur et taux de gates réussies      |

## 3. Acteurs

| Acteur                    | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| **Développeur**           | Ouvre une PR, lit les annotations, corrige avant la revue humaine            |
| **Relecteur**             | Se concentre sur la conception ; voit l'état de la gate dans la PR           |
| **Tech lead**             | Configure les règles (`.codelens.yml`), suit les tendances                   |
| **Administrateur GitHub** | Installe l'application sur l'organisation ou sur certains dépôts             |
| **GitHub**                | Émet les webhooks, héberge les checks et les commentaires                    |
| _Attaquant_               | Webhook forgé, PR piégée (contenu malveillant), accès aux résultats d'autrui |

## 4. Périmètre

### MVP (v1)

- GitHub App : installation sur une organisation ou un compte, sélection des dépôts.
- Réception des webhooks signés (`X-Hub-Signature-256`), dédoublonnage par identifiant de livraison.
- Analyse asynchrone dans une file BullMQ (Redis), avec reprise sur erreur et respect des limites de
  débit de l'API GitHub.
- Moteur d'analyse extensible (patron Strategy) travaillant sur le diff :
  - secrets (clés AWS, jetons GitHub et Slack, clés privées, mots de passe en dur) ;
  - instructions de débogage et tests focalisés (`.only`) ;
  - complexité cyclomatique des fonctions modifiées (TypeScript et JavaScript) ;
  - injection SQL par interpolation ;
  - taille de la PR, code modifié sans test, TODO sans ticket, dépendances ajoutées.
- Quality gate : seuils par sévérité, configurés dans `.codelens.yml` **lu sur la branche de base**.
- Publication : check run avec annotations sur les lignes, commentaire de synthèse mis à jour en place.
- Historique dans PostgreSQL ; livraisons brutes et rapports complets dans MongoDB.
- Tableau de bord Next.js : connexion GitHub, dépôts accessibles, PR, détail d'une analyse, tendances.

### Hors périmètre v1 (feuille de route)

- Adaptateur GitLab (interface `GitProvider` prévue dès la v1).
- Suggestions de correction (`suggestion` GitHub) et analyse par LLM.
- Analyseurs pour d'autres langages (Python, Go) via un parseur tree-sitter.
- Commande `/codelens recheck` dans un commentaire.

## 5. Exigences non fonctionnelles

| Domaine        | Exigence                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| Sécurité       | Webhook vérifié en temps constant avant tout traitement ; code analysé jamais exécuté      |
| Sécurité       | Un utilisateur du tableau de bord ne voit que les dépôts auxquels il a accès sur GitHub    |
| Sécurité       | Un secret détecté n'est jamais recopié : ni commentaire, ni log, ni base de données        |
| Performance    | Webhook accusé en moins de 200 ms (GitHub abandonne au bout de 10 s)                       |
| Robustesse     | Analyse idempotente : une livraison rejouée ne crée ni doublon ni second commentaire       |
| Robustesse     | PR géante : analyse bornée (fichiers, taille, annotations) et signalée comme partielle     |
| Exploitabilité | Logs JSON corrélés par livraison et par analyse ; sondes `/health/live` et `/health/ready` |
| Qualité        | TypeScript strict, couverture de tests supérieure à 80 %, CI avec scans de sécurité        |

## 6. Contraintes

- Node.js 22 LTS, TypeScript strict, monorepo pnpm.
- API GitHub REST v3 (`2022-11-28`), authentification GitHub App (JWT RS256 puis jeton d'installation).
- Déploiement par conteneurs : API, worker et tableau de bord sont des images distinctes ou des
  commandes distinctes de la même image.

## 7. Livrables

Code source, tests automatisés, pipeline CI/CD, images Docker, manifeste de la GitHub App,
documentation (ce cahier des charges, user stories, C4, ADR, modèle de menaces, catalogue des règles).

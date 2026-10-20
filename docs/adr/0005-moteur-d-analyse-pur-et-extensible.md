# ADR 0005 — Un moteur d'analyse pur, extensible, qui échoue ouvert

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Les règles vont évoluer plus vite que le reste du système, et leur pertinence décide de l'adoption :
un outil qui crie au loup est vite ignoré. Le contenu analysé est non fiable.

## Décision

1. **`packages/review-engine` sans entrée/sortie** : il reçoit les fichiers modifiés, leurs diffs
   et les contenus chargés par le worker, et rend des constats et un verdict. Il se teste sur des
   diffs réels, sans réseau ni base.
2. **Patron Strategy** : chaque règle implémente `Analyzer` (`id`, `analyze(context)`). Le moteur
   les exécute, isole leurs erreurs (un analyseur qui lève une exception produit un constat
   `info` et n'interrompt pas les autres), déduplique, trie et borne les constats.
3. **Analyse du diff, pas du dépôt** : seules les lignes ajoutées ou modifiées produisent des
   constats, sauf règles portant sur la PR elle-même (taille, tests manquants).
4. **Jamais d'exécution** : pas d'installation de dépendances, pas de compilation ; la complexité
   est calculée sur l'arbre syntaxique TypeScript (`createSourceFile`, sans programme ni types).
5. **Configuration lue sur la branche de base** : une PR ne peut pas assouplir les règles qui la
   jugent ; la modification de `.codelens.yml` s'applique aux PR suivantes, après revue.
6. **Échec ouvert sur panne, fermé sur la gate** : une erreur interne termine le check en `neutral`
   (qui ne bloque pas une branche protégée), un constat au-delà des seuils le termine en `failure`.

## Conséquences

- ✅ Ajouter une règle = un fichier et ses tests, sans toucher au worker.
- ✅ Une PR piégée ne peut ni exécuter de code ni désactiver la règle qui la vise.
- ⚠️ Pas d'analyse de flux de données : la détection d'injection SQL reste heuristique
  (interpolation dans un appel de requête), documentée comme telle.
- ⚠️ Une modification de `.codelens.yml` n'est pas testée sur sa propre PR ; le check signale
  quand la configuration de la PR diffère de celle de la base.

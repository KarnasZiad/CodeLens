# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique. Utilisez le formulaire privé de GitHub :
[Security → Report a vulnerability](https://github.com/KarnasZiad/CodeLens/security/advisories/new).

Indiquez la version ou le commit concerné, les étapes pour reproduire et l'impact estimé. L'objectif
est d'accuser réception sous 72 heures et de publier un correctif accompagné d'un avis de sécurité.

## Périmètre

- Webhook accepté sans signature valide, ou rejoué
- Accès aux revues, au code ou aux résultats d'un dépôt sans droit sur son installation GitHub
- Fuite de la clé privée de l'application, d'un jeton d'installation ou d'un secret détecté
- Exécution de code ou déni de service provoqué par le contenu d'une pull request analysée

## Documentation de sécurité

- [Modèle de menaces](docs/security/threat-model.md)
- [Décisions d'architecture](docs/adr/)

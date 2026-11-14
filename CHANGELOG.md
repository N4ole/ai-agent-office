# Changelog

Toutes les évolutions notables d’AI Agent Office sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions : [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

### Sécurité

- Arrêt forcé d’une session externe : le PID lu dans `~/.claude/sessions` est vérifié (processus Claude Code, démarré
  avant la session) avant `taskkill` ; sinon l’arrêt est refusé (R-04).
- `~/.claude/settings.json` est écrit de façon atomique, avec une sauvegarde horodatée avant chaque modification,
  désinstallation des hooks comprise (R-05).
- Variables d’environnement de test (`AAO_*`, serveur de dev) ignorées dans l’application installée ; CSP de
  production sans `localhost` ; sourcemaps retirées du paquet (R-17, R-25).
- Ouverture d’un terminal sûre même si le chemin contient `& ^ | ; %` (R-18).
- Expressions de masquage personnalisées bornées (taille, nombre, motifs à risque de blocage) (R-19).
- Le relais de hooks masque les secrets avant d’écrire `hook-events.jsonl`.
- Les chemins de Claude Code saisis dans les paramètres sont validés.

### Corrigé

- « Tout effacer » vide aussi le bureau et l’interface, et les transcripts déjà lus ne sont plus réimportés au
  redémarrage ; « Purger l’ancien » met aussi l’interface à jour (R-01, R-08).
- Tokens par jour regroupés selon la date locale et non UTC (R-06).
- « Exporter tout » exporte l’historique complet au lieu des 5 000 premiers événements (R-07).
- Un échec d’écriture de la base n’entraîne plus de perte silencieuse des changements (R-14).
- Le délai de la sonde `/usage` arrête tout l’arbre de processus (R-15).
- Consoles libérées quand un agent quitte le bureau, rotation de `hook-events.jsonl`, oubli des positions de lecture
  de fichiers disparus (R-16).
- Démarrage en mode dégradé si `%USERPROFILE%\.ai-agent-office` n’est pas accessible en écriture (R-22).
- Claude Code installé via npm (`claude.cmd`) est pris en charge (R-03, à confirmer sur une vraie installation npm).

### Ajouté

- Intégration continue (lint, formatage, types, tests avec couverture, build), releases construites par GitHub
  Actions avec sommes SHA-256 et attestation de provenance.
- L’installeur s’appelle désormais `AI-Agent-Office-Setup-<version>.exe` (sans espaces, pour que le nom publié sur
  GitHub corresponde à `SHA256SUMS.txt`).

## [1.3.1] - 2026-10-30

> Seule version dont le code source correspond à un commit (`b8130d8`, avec la documentation ajoutée en `07b21a5`).

### Corrigé

- Le graphique « Tokens générés par jour » reprend sa présentation d’origine (d’après le README ; la release ne
  détaille pas son contenu).

## [1.3.0] - 2026-10-30

### Ajouté

- **Quotas restants de l’abonnement Claude** : widget dans la barre du haut (fenêtre de 5 h et semaine, % restant,
  heure de réinitialisation) et carte dans le tableau de bord, via la commande `/usage` de Claude Code exécutée en
  arrière-plan toutes les 5 min (réglable, 0 = manuel). Mise à jour en direct par les sessions pilotées
  (`rate_limit_event`). Alertes à 80 % puis 95 %. Rien n’est affiché avec une clé API.

## [1.2.0] - 2026-10-30

### Ajouté

- **Coût estimé par chat** : tokens de chaque réponse × tarif API public du modèle (entrée, sortie, cache lu, cache
  écrit 5 min / 1 h, palier Haiku 5.5 au-delà de 100K), détail par modèle, total agent + sous-agents, coût par chat et
  par modèle dans le tableau de bord et l’historique, grille de tarifs dans Paramètres → Tarifs.
- **Compatibilité écran** : fenêtre adaptée aux portables à 125–150 %, taille mémorisée, interface compacte sous
  1440 / 1280 / 1100 px, liste des agents masquable (☰ ou Ctrl+B), fiche agent en surimpression sur fenêtre étroite.

## [1.1.0] - 2026-10-30

### Modifié

- Refonte de l’interface : barre latérale avec onglets Tous / Actifs / À voir / Finis et filtres avancés ; bureau
  avec caméra fluide, halo de sélection et éclairage selon l’heure ; fiche agent avec tuiles et sections repliables ;
  tableau de bord (14 jours, coût par session, organigramme) ; journaux colorés ; paramètres en sections ; barre
  d’état ; recherche globale (Ctrl+K).

## Note sur les versions 1.1.0 à 1.3.0 (traçabilité)

Les tags `v1.1.0`, `v1.2.0`, `v1.3.0` et `v1.3.1` pointent **tous sur le même commit** `b8130d8`. Les exécutables des
versions **1.1.0, 1.2.0 et 1.3.0** publiés le 2026-10-30 ont été construits à partir d’états du code qui n’ont pas été
versionnés : **ils n’ont pas de source dédiée** dans l’historique git et ne peuvent pas être reconstruits ni audités.
Seule la 1.3.1 correspond au code du dépôt. Les tags existants n’ont pas été modifiés. À partir de la prochaine
version, chaque release est construite par GitHub Actions à partir du commit taggé (voir
[docs/fr/installation.md](docs/fr/installation.md#vérifier-un-téléchargement)).

[Non publié]: https://github.com/N4ole/ai-agent-office/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/N4ole/ai-agent-office/releases/tag/v1.3.1
[1.3.0]: https://github.com/N4ole/ai-agent-office/releases/tag/v1.3.0
[1.2.0]: https://github.com/N4ole/ai-agent-office/releases/tag/v1.2.0
[1.1.0]: https://github.com/N4ole/ai-agent-office/releases/tag/v1.1.0

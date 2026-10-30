# Utilisation

[![Language English](https://img.shields.io/badge/Language-English-1f6feb?style=for-the-badge)](../en/usage.md) [![Retour Sommaire](https://img.shields.io/badge/Retour-Sommaire-57606a?style=for-the-badge)](README.md)

## Sommaire

- [Découvrir l'interface](#découvrir-linterface)
- [Comprendre ce qui est affiché](#comprendre-ce-qui-est-affiché)
- [Observer vos agents](#observer-vos-agents)
- [Piloter des sessions](#piloter-des-sessions)
- [Notifications](#notifications)
- [Consommation et quotas](#consommation-et-quotas)
- [Paramètres](#paramètres)
- [Hooks optionnels](#hooks-optionnels)
- [Raccourcis clavier](#raccourcis-clavier)
- [Dépannage](#dépannage)

## Découvrir l'interface

```
┌─ ☰ ─ AI AGENT OFFICE ── Bureau · Tableau de bord · Journaux · Historique · Paramètres ── compteurs · 🔔 · + ─┐
│ Liste des agents │            Vue centrale (bureau, tableau de bord…)            │ Fiche de l'agent sélectionné │
│ (onglets, filtres)│                                                                │ (Fiche · Journal · Terminal) │
├───────────────────┴────────────────────────────────────────────────────────────────┴──────────────────────────────┤
│ Barre d'état : connexion à Claude Code · sessions actives · hooks · dernier événement · événements enregistrés     │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Les cinq vues s'ouvrent avec les touches `1` à `5` :

| Touche | Vue | À quoi elle sert |
|---|---|---|
| `1` | **Bureau** | Un bureau en pixel art où chaque agent est un personnage à son poste. Son animation reflète son activité réelle (lecture, programmation, tests, délégation…). |
| `2` | **Tableau de bord** | Indicateurs colorés, activité sur 14 jours, organigramme parent ↔ sous-agents, alertes récentes. Il affiche aussi la consommation et les quotas d'abonnement. |
| `3` | **Journaux** | Flux de tous les événements, colorés par type, avec séparateurs par jour, recherche, filtres et export. |
| `4` | **Historique** | Toutes les sessions enregistrées, y compris terminées, avec recherche par nom, projet, dossier, tâche ou identifiant. |
| `5` | **Paramètres** | Connexion à Claude Code, hooks, notifications, données, apparence. |

La fenêtre s'adapte à l'écran (portables à 125–150 %). En dessous de 1440 / 1280 / 1100 px, l'interface devient plus
compacte, la liste des agents se masque (bouton `☰` ou `Ctrl+B`) et la fiche de l'agent s'affiche en surimpression.
La taille et la position de la fenêtre sont mémorisées.

## Comprendre ce qui est affiché

### Les trois badges de provenance

| Badge | Sens |
|---|---|
| **observé** | Valeur lue telle quelle dans un fichier de Claude Code ou sur le processus. |
| **déduit** | Conclusion de l'application (par exemple « possiblement bloqué »). Toujours signalée. |
| **indispo.** | Claude Code ne fournit pas l'information. L'application n'invente rien. |

### Les statuts d'un agent

| Statut | Signification |
|---|---|
| Au travail (`working`) | Un outil s'exécute ou le modèle génère une réponse. |
| En attente (`waiting`) | L'agent attend votre intervention (autorisation, saisie). Fiable surtout avec les [hooks](#hooks-optionnels). |
| Inactif (`idle`) | Vivant, mais le tour est terminé : il attend une nouvelle demande. |
| Terminé (`done`) | Sous-agent fini ou session close proprement. |
| Erreur (`error`) | Le dernier outil a renvoyé une erreur. |
| Perdu (`lost`) | Le processus a disparu sans fin propre (plantage, arrêt forcé). |
| Inconnu (`unknown`) | Pas assez d'informations. |

L'attitude du personnage (douze activités possibles) découle du dernier outil utilisé : réflexion, programmation
(`Edit`, `Write`…), lecture (`Read`), recherche (`Grep`, `Glob`…), tests (`npm test`, `pytest`, `go test`…), commande,
délégation (`Agent`, `Task`), navigation web, attente, inactivité, erreur, terminé.

## Observer vos agents

Il n'y a **rien à configurer** : lancez Claude Code dans n'importe quel terminal, et la session apparaît au bout de
quelques secondes, avec ses sous-agents rattachés à leur parent.

### La liste des agents (à gauche)

- Onglets rapides avec compteurs : **Tous / Actifs / À voir / Finis**. « À voir » regroupe les agents en attente, en
  erreur ou perdus.
- **Filtres avancés** (bouton à côté du champ de recherche) : projet, type (session / sous-agent), session, activité,
  priorité, et affichage de l'historique. Ils sont mémorisés.
- Groupes repliables par projet, sous-agents en arborescence, avatar, dernière action et ancienneté.
- Les agents terminés ou perdus libèrent leur poste du bureau après 10 minutes ; leur historique reste consultable.

### La fiche d'un agent (à droite)

Cliquez sur un personnage ou une ligne de la liste. Le nom est modifiable (conservé après redémarrage), ainsi que la
couleur de l'agent.

| Onglet | Contenu |
|---|---|
| **Fiche** | « Ce qu'il fait maintenant », tuiles de synthèse (actions, durée, consommation), puis sections repliables : Tâche (avec progression si l'agent tient une liste de tâches), Développement (fichiers modifiés et consultés, commandes, tests, erreurs), Consommation & ressources (consommation, CPU, RAM), Identité (dossier, session, branche git), Relations (parent et sous-agents). |
| **Journal** | Les événements de cet agent uniquement. |
| **Terminal** | La sortie réelle du processus, pour les sessions lancées depuis l'application (« live »). |

Seules les actions réellement possibles sont proposées ; les autres sont listées avec la raison (par exemple « Les
sous-agents sont pilotés par leur agent parent »).

### Recherche globale

`Ctrl+K` ouvre une recherche groupée par vues, agents et événements : agent, projet, tâche, commande, fichier ou erreur.
Naviguez avec `↑` `↓`, validez avec `Entrée`.

### Journaux et export

La vue *Journaux* permet de filtrer par catégorie (*Demandes & messages*, *Outils*, *Erreurs*, *Cycle de vie*), de
masquer les résultats d'outils réussis (très nombreux), de copier les lignes affichées, de charger les événements plus
anciens et d'exporter en JSON. *Paramètres → Données & confidentialité → Exporter tout* exporte l'ensemble.

## Piloter des sessions

### Lancer une session

`Ctrl+N` ou le bouton **+ Nouvelle session**. Renseignez :

| Champ | Détail |
|---|---|
| Dossier de travail | Obligatoire. Bouton « Parcourir… » disponible. Pré-rempli avec le dossier de l'agent sélectionné. |
| Première instruction | Obligatoire : une session pilotée démarre avec une consigne. `Ctrl+Entrée` pour lancer. |
| Nom | Optionnel, pour reconnaître la session. |
| Modèle | Par défaut, Opus, Sonnet ou Haiku. |
| Autorisations | Voir ci-dessous. |

| Mode | Effet |
|---|---|
| **Modifier les fichiers** (recommandé) | Les modifications de fichiers sont acceptées ; les commandes non autorisées sont refusées. |
| **Plan seulement** | L'agent analyse et propose, sans rien modifier. |
| **Lecture seule** | En mode piloté, Claude Code ne peut pas vous demander d'autorisation : tout outil qui en exige une est refusé. |
| **Tout autoriser** | **Dangereux** : n'importe quelle commande s'exécute sans confirmation. Une confirmation supplémentaire est demandée. À réserver à un dossier isolé. |

L'application utilise le mode non interactif documenté de Claude Code (`claude -p` avec entrée/sortie `stream-json`).

### Ce que vous pouvez faire selon l'origine de la session

| Action | Session lancée depuis l'app | Session lancée dans un terminal | Sous-agent |
|---|---|---|---|
| Envoyer une instruction | ✔ | ✖ aucune interface documentée | ✖ piloté par son parent |
| Interrompre le tour en cours | ✔ | ✖ | ✖ |
| Pause | ✖ n'existe pas dans Claude Code (utilisez *Interrompre*) | ✖ | ✖ |
| Arrêter (avec confirmation) | ✔ | ✔ arrêt forcé du processus | ✖ |
| Reprendre dans l'app (`--resume`) | ✔ une fois arrêtée | ✔ une fois fermée | — |
| Reprendre dans un terminal | ✔ | ✔ une fois fermée | — |
| Terminal intégré | ✔ sortie réelle | ✖ (voir l'onglet Journal) | — |
| Ouvrir un terminal / le dossier | ✔ | ✔ | ✔ |

À la fermeture de la fenêtre, si des sessions lancées depuis l'app tournent encore, une confirmation est demandée :
quitter les arrête, mais leur historique reste disponible et elles peuvent être reprises.

## Notifications

Elles s'affichent dans l'application (cloche 🔔 en haut à droite) et, selon vos réglages, comme notifications Windows.
Cliquer sur une notification Windows ouvre l'application et sélectionne l'agent concerné.

| Événement | Quand | Windows par défaut |
|---|---|---|
| Nouvel agent / sous-agent | Une session ou un sous-agent apparaît | Non |
| Début de tâche | Une nouvelle demande est reçue | Non |
| Fin de tâche | Un tour ou un sous-agent se termine | **Oui** |
| Erreur d'exécution | Un outil échoue (au plus une par minute et par agent) | Non |
| Agent bloqué / en attente | Autorisation requise (hooks), ou aucun événement depuis *N* min (déduction) | **Oui** |
| Session interrompue | Le processus a disparu sans fin propre | **Oui** |
| Ressources élevées | CPU ou RAM d'un processus au-dessus du seuil (au plus toutes les 10 min) | Non |

Chaque ligne est réglable séparément pour « Dans l'app » et « Windows » dans *Paramètres → Notifications & seuils*.

## Consommation et quotas

L'application affiche la consommation de vos sessions et les quotas de votre abonnement Claude (tableau de bord, barre
du haut, fiche de l'agent). Ce guide ne détaille pas ces fonctions.

## Paramètres

| Section | Réglages |
|---|---|
| **Connexion à Claude Code** | Vérifications d'environnement ; exécutable `claude` (nom ou chemin complet) ; dossier de données (par défaut `~/.claude`, redémarrage requis après modification) ; nombre de jours de transcripts chargés au démarrage (7 par défaut). |
| **Hooks optionnels** | Installer ou retirer les hooks. |
| **Notifications & seuils** | Interrupteurs par événement ; agent « bloqué » après (10 min) ; seuils de CPU (80 %) et de RAM (2 048 Mo). |
| **Données & confidentialité** | Conservation de l'historique (30 jours par défaut, purge au démarrage) ; masquages supplémentaires par expression régulière (une par ligne) ; exporter, purger l'ancien, tout effacer. |
| **Apparence & démo** | Thème clair (sombre par défaut) ; mode démonstration. L'éclairage du bureau suit l'heure réelle : jour, crépuscule, nuit. |

## Hooks optionnels

Sans hooks, l'application observe déjà tout via les fichiers de Claude Code. Les hooks ajoutent deux signaux :

- un indicateur **fiable** quand un agent *attend votre autorisation* ;
- la raison exacte de fin d'une session.

Installation : *Paramètres → Hooks optionnels → Installer* (Node.js requis).

- Trois entrées (`Notification`, `SessionStart`, `SessionEnd`), marquées « ai-agent-office », sont ajoutées à
  `~/.claude/settings.json` ; une sauvegarde `settings.json.ai-agent-office.bak` est créée juste avant.
- Elles ne concernent que les **nouvelles** sessions Claude Code.
- Le relais ne bloque jamais Claude Code : il s'arrête de lui-même après 2 secondes au maximum et ignore toute erreur.
- *Retirer* supprime uniquement les entrées ajoutées par l'application. Si `settings.json` est illisible, l'opération est
  annulée pour ne rien écraser.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `1` … `5` | Changer de vue |
| `Ctrl+K` | Recherche globale |
| `Ctrl+N` | Nouvelle session |
| `Ctrl+B` | Afficher / masquer la liste des agents |
| `J` / `K` | Agent suivant / précédent |
| `F` | Centrer la caméra sur l'agent sélectionné |
| `+` `−` `0` | Zoom avant / arrière / vue d'ensemble |
| `L` | Afficher / masquer les liens parent ↔ sous-agent |
| `B` | Afficher / masquer les bulles d'action |
| `Échap` | Fermer la fiche ou le panneau |
| Glisser · molette | Déplacer · zoomer le bureau |
| `?` | Aide des raccourcis |

Les raccourcis à une seule touche sont désactivés pendant la saisie dans un champ de texte.

## Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| « Claude Code introuvable » dans la barre d'état | Le dossier `~/.claude/projects` n'existe pas. Lancez Claude Code une fois, ou corrigez le dossier de données dans *Paramètres → Connexion*. Si votre dossier est personnalisé, il est défini par `CLAUDE_CONFIG_DIR`. |
| Le test « Claude Code CLI » échoue | `claude` n'est pas dans le `PATH`. Indiquez le chemin complet de `claude.exe` dans les paramètres. |
| Aucune session n'apparaît | Vérifiez la barre d'état (« N sessions actives · N transcripts suivis »). Les transcripts plus vieux que le nombre de jours configuré ne sont pas chargés au démarrage (*Sessions chargées au démarrage*). |
| Un agent reste « au travail » | Sans hooks, « bloqué » est une déduction (aucun événement depuis *N* minutes). Un agent hors registre (mode `-p`) sans activité depuis 5 minutes est considéré comme terminé. |
| Pas de notification « en attente » | Installez les [hooks](#hooks-optionnels) pour un signal fiable d'attente d'autorisation. |
| Impossible d'envoyer une instruction | La session a été lancée depuis un terminal : Claude Code n'expose pas d'interface pour cela. Arrêtez-la puis reprenez-la depuis l'application, ou utilisez son terminal. |
| Les boutons Terminal ne s'ouvrent pas | Windows Terminal est absent : l'application replie sur `cmd.exe`. Ces boutons ne fonctionnent que sous Windows. |
| Relancer depuis zéro | *Paramètres → Données & confidentialité → Tout effacer* supprime uniquement l'historique de l'application ; les sessions actives réapparaissent à leur prochain événement. |

---

[![Précédent Installation](https://img.shields.io/badge/Pr%C3%A9c%C3%A9dent-Installation-57606a?style=for-the-badge)](installation.md) [![Sommaire ☰](https://img.shields.io/badge/Sommaire-%E2%98%B0-57606a?style=for-the-badge)](README.md) [![Suivant Fonctionnement](https://img.shields.io/badge/Suivant-Fonctionnement-8250df?style=for-the-badge)](fonctionnement.md)

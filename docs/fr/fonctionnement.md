# Fonctionnement

[![Language English](https://img.shields.io/badge/Language-English-1f6feb?style=for-the-badge)](../en/how-it-works.md) [![Retour Sommaire](https://img.shields.io/badge/Retour-Sommaire-57606a?style=for-the-badge)](README.md)

Ce document explique comment AI Agent Office obtient ses informations, les transforme en état d'agents et les affiche.

## Vue d'ensemble

```
        Fichiers écrits par Claude Code                    Processus Claude Code lancés par l'app
  ~/.claude/sessions/<pid>.json   (registre)               claude -p --input-format stream-json …
  ~/.claude/projects/…/<id>.jsonl (transcripts)                          │  stdin / stdout
  …/<id>/subagents/agent-*.jsonl  (sous-agents)                          │
  ~/.ai-agent-office/hook-events.jsonl (hooks, option)                   │
              │ lecture seule                                            │
              ▼                                                          ▼
        ┌──────────────────── ClaudeProvider (connecteur) ────────────────────┐
        │  surveillance + sondage · tailer JSONL · parseur · sessions pilotées │
        └───────────────────────────────┬──────────────────────────────────────┘
                                        │ événements normalisés (AgentEvent)
                                        ▼
                      AgentManager  ── reducer (machine d'états) ── notifications
                                        │                 │
                                  OfficeDB (SQLite)       │ IPC
                                                          ▼
                                   Interface React + bureau en canvas 2D
```

L'application est une application **Electron** à deux processus :

- le **processus principal** (`src/main/`) lit les fichiers, pilote les sessions, calcule l'état des agents, stocke les
  données et envoie des mises à jour à l'interface ;
- le **processus de rendu** (`src/renderer/`) est une interface **React** avec un moteur de rendu pixel art sur un
  `<canvas>` 2D (`office/engine.ts`). Il n'a aucun accès à Node.js : il passe par une API IPC étroite exposée par
  `preload.ts` (`contextIsolation` activé, `sandbox` activé, navigation externe bloquée).

Une seule instance de l'application peut tourner à la fois ; relancer l'application remet la fenêtre existante au
premier plan.

## Les sources de données

Le connecteur Claude Code (`src/main/providers/claude/`) s'appuie sur quatre sources réelles, vérifiées sur Claude Code
2.1.x :

| Source | Ce qu'on en tire |
|---|---|
| `~/.claude/sessions/<pid>.json` | Registre des sessions **actives** : PID, identifiant de session, dossier, statut `busy` / `idle`, nom. Claude Code supprime le fichier à la fermeture de la session. |
| `~/.claude/projects/<dossier>/<session>.jsonl` | Transcript : demandes, messages, appels et résultats d'outils, erreurs, titre. |
| `…/<session>/subagents/agent-<id>.jsonl` + `.meta.json` | Sous-agents : leur type, leur description, leur parent (via l'identifiant d'appel d'outil) et leur fin (`finished`). |
| Processus Windows (toutes les 10 s) | CPU et mémoire des processus Claude Code identifiés, via un seul appel PowerShell. |
| Hooks (optionnels) | Notifications « en attente d'autorisation », début et fin exacte de session. |

Le dossier de données est `~/.claude`, ou celui défini par la variable `CLAUDE_CONFIG_DIR`, ou celui des paramètres.

### Lecture incrémentale

Les transcripts peuvent devenir très gros. Le `JsonlTailer` mémorise un **décalage en octets** par fichier et ne lit que
ce qui a été ajouté, en gérant la dernière ligne incomplète (fichier en cours d'écriture) et la troncature. Ces décalages
sont enregistrés dans la base : au redémarrage, l'application reprend où elle s'était arrêtée au lieu de tout relire.

### Détection des changements

- `fs.watch` récursif sur `projects/` signale les fichiers modifiés.
- Une boucle d'une seconde interroge le registre des sessions et relit les fichiers actifs. Elle sert aussi de **repli**
  quand `fs.watch` rate des événements : les fichiers récents (moins de 15 minutes) sont sondés en continu, les autres
  toutes les 10 secondes.
- Un balayage complet des dossiers de transcripts est refait toutes les 5 secondes pour détecter les nouvelles sessions.
- Au démarrage, seuls les transcripts modifiés dans les *N* derniers jours (7 par défaut) sont chargés. Les événements
  datant de plus de 2 minutes sont traités comme de l'**historique rejoué** : ils alimentent les compteurs mais ne
  changent pas le statut en direct et ne déclenchent pas de notifications.

## Du fichier à l'état : le pipeline

1. **Parseur** (`parser.ts`) : convertit chaque ligne de transcript en `AgentEvent` normalisés (`user_prompt`,
   `tool_use`, `tool_result`, `tool_error`, `subagent_spawn`, `turn_end`, `title`…). Les types
   d'enregistrement inconnus sont **ignorés**, jamais devinés. Chaque résumé est masqué (voir *Confidentialité*) et tronqué.
2. **AgentManager** (`agentManager.ts`) : reçoit les identités et événements des connecteurs, les **déduplique** grâce à
   leur identifiant stable via la base, applique le reducer, attribue un poste de bureau, déclenche les notifications
   et regroupe les mises à jour vers l'interface par lots d'environ 120 ms.
3. **Reducer** (`reducer.ts`) : fonction pure `(état de l'agent, événement) → nouvel état`. Elle met à jour la tâche
   courante, les fichiers lus et modifiés, les commandes, les tests et les erreurs.
4. **Interface** : reçoit les agents modifiés et les événements en direct, et les affiche.

### Statut : observé ou déduit

Le statut vient de plusieurs signaux, par ordre d'autorité :

1. Le **registre des sessions** (`busy` → au travail, `idle` → inactif) fait foi pour *au travail / inactif* tant que la
   session est vivante, car les lignes de transcript peuvent arriver avec un léger retard.
2. Le **transcript** pilote les erreurs : un outil en échec place l'agent en *erreur* jusqu'à ce que le registre ou un
   résultat réussi le fasse repartir.
3. Les **hooks** apportent *en attente* de façon fiable.
4. Des **déductions**, toujours marquées « déduit » :
   - *possiblement bloqué* : agent au travail sans aucun événement depuis *N* minutes (10 par défaut) ;
   - *session terminée* : session absente du registre et transcript inactif depuis plus de 30 s au démarrage, ou
     5 minutes sans activité pour une session hors registre (mode `-p`) ;
   - *sous-agent terminé* : session parente fermée.

Un processus qui disparaît alors que son fichier de registre existe encore est déclaré **perdu** (plantage ou arrêt forcé).
Si l'arrêt a été demandé depuis l'application, il n'est pas signalé comme un plantage.

### Relier les sous-agents à leur parent

Quand un agent appelle l'outil `Agent` ou `Task`, l'identifiant de cet appel est mémorisé. Le fichier `.meta.json` du
sous-agent contient le même identifiant, ce qui permet de le rattacher au bon parent, y compris pour des sous-agents
imbriqués (rattachement corrigé dès que l'appel parent est lu).

### Activité visuelle

`activity.ts` associe chaque outil à une activité (lecture, programmation, recherche, tests, commande, délégation,
navigation web, attente…). Une commande shell est classée « tests » si elle correspond à un lanceur de tests connu
(`npm test`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`, `dotnet test`, `mvn test`…).

### Progression

La progression n'est affichée que si elle est **mesurable** : elle se calcule à partir de la liste de tâches de l'agent
(outil `TodoWrite`), en nombre d'éléments terminés. Sinon, elle est « non mesurable ».

## Piloter des sessions

Les sessions lancées depuis l'application utilisent le mode non interactif documenté de Claude Code :

```
claude -p --input-format stream-json --output-format stream-json --verbose
       [--model <m>] [--permission-mode <mode>] [--resume <id>]
```

- Chaque ligne JSON `{"type":"user",…}` écrite sur l'entrée standard démarre un tour ; le processus reste vivant entre
  deux tours.
- `{"type":"control_request","request":{"subtype":"interrupt"}}` interrompt le tour en cours.
- La sortie standard (`system/init`, `assistant`, `user`, `result`) alimente le **terminal intégré**. L'**activité de l'agent** elle-même est lue dans le transcript, qui reste l'unique source de
  vérité, comme pour une session externe.
- *Arrêter* termine l'arbre de processus (`taskkill /T /F`). *Reprendre* relance `--resume` avec l'identifiant de session.

Pour une session externe, Claude Code n'expose aucune interface documentée permettant d'envoyer une instruction : l'application ne le
prétend pas et propose seulement l'arrêt forcé, l'ouverture d'un terminal et la reprise une fois la session fermée.

## Consommation et quotas

L'application calcule et affiche la consommation de vos sessions ainsi que vos quotas d'abonnement. Ce document ne détaille
pas ces mécanismes.

## Confidentialité et sécurité

- **Tout reste local.** L'application n'envoie aucune donnée à un service externe.
- **Masquage systématique** (`redact.ts`) avant tout affichage, stockage ou export : clés Anthropic (`sk-ant-…`) et de
  type OpenAI, clés AWS, jetons GitHub, Slack et Google, JWT, clés privées PEM, en-têtes `Bearer`, et valeurs de
  `clé=valeur` pour `api_key`, `secret`, `token`, `password`, `authorization`… Vous pouvez ajouter vos propres
  expressions régulières dans les paramètres.
- **Lecture seule** sur les fichiers de Claude Code. La seule écriture est l'installation des hooks, à votre demande,
  avec sauvegarde préalable.
- **Interface isolée** : pas de Node.js dans le processus de rendu, API IPC limitée, ouverture de fenêtres et navigation
  externes refusées.
- Les relais de hooks n'enregistrent qu'un sous-ensemble minimal (identifiants, type d'événement, message tronqué à 500
  caractères).

## Stockage

La base SQLite (`%APPDATA%\AI Agent Office\office.db`) est gérée avec **sql.js** (SQLite compilé en WebAssembly), donc
sans module natif à compiler sous Windows. Elle vit en mémoire et est écrite sur disque de façon **atomique** (fichier
temporaire puis renommage), au plus toutes les 3 secondes, et de façon synchrone à la fermeture. Un fichier corrompu est
renommé `office.db.corrupt-<date>` et l'application repart d'une base neuve plutôt que de planter.

| Table | Contenu |
|---|---|
| `agents` | État de chaque agent (JSON) et colonnes d'index |
| `events` | Événements normalisés (les événements de « réflexion » ne sont pas stockés) |
| `notifications` | Historique des notifications |
| `settings` | Paramètres et géométrie de la fenêtre |
| `offsets` | Position de lecture de chaque transcript |
| `meta` | Métadonnées internes |

La rétention (30 jours par défaut) supprime les anciens événements au démarrage.

## Mode démonstration

`DemoProvider` implémente le même contrat que le connecteur Claude Code (`AgentProvider`) avec des données fictives
clairement marquées. Ces agents ne sont jamais enregistrés et aucune commande réelle n'est exécutée.

---

[![Précédent Utilisation](https://img.shields.io/badge/Pr%C3%A9c%C3%A9dent-Utilisation-57606a?style=for-the-badge)](utilisation.md) [![Sommaire ☰](https://img.shields.io/badge/Sommaire-%E2%98%B0-57606a?style=for-the-badge)](README.md) [![Suivant Développement](https://img.shields.io/badge/Suivant-D%C3%A9veloppement-bf8700?style=for-the-badge)](developpement.md)

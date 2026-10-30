# Développement

[![Language English](https://img.shields.io/badge/Language-English-1f6feb?style=for-the-badge)](../en/development.md) [![Retour Sommaire](https://img.shields.io/badge/Retour-Sommaire-57606a?style=for-the-badge)](README.md)

## Pile technique

Electron · React 19 · TypeScript · Vite (interface) · esbuild (processus principal) · sql.js (SQLite en WebAssembly) ·
Vitest (tests) · electron-builder (installateur NSIS et portable Windows).

## Démarrer

```bash
npm install            # si npm bloque les scripts : node node_modules/electron/install.js
npm run dev            # build du processus principal, serveur Vite (port 5199) et Electron
```

| Commande | Effet |
|---|---|
| `npm run dev` | Mode développement : interface rechargée à chaud par Vite, Electron pointé sur `http://localhost:5199`. Le processus principal est reconstruit au lancement (relancez pour le prendre en compte). |
| `npm run build` | Construit le processus principal (`dist/main/`) et l'interface (`dist/renderer/`). |
| `npm start` | Lance Electron sur le dossier courant (après `npm run build`). |
| `npm run typecheck` | Vérification TypeScript sans émission (`tsc --noEmit`). |
| `npm test` | Exécute la suite Vitest. |
| `npm run icon` | Régénère l'icône (`scripts/make-icon.mjs`). |
| `npm run dist` | Build puis installateur NSIS **et** portable dans `release/`. |
| `npm run dist:portable` | Build puis portable seul. |

## Structure du dépôt

```
src/
├── shared/                 Types et logique partagés entre les deux processus
│   └── types.ts            AgentState, AgentEvent, Settings, canaux IPC…
├── main/                   Processus principal Electron
│   ├── index.ts            Fenêtre, IPC, câblage connecteurs → manager → base / interface
│   ├── preload.ts          API exposée à l'interface (contextBridge)
│   ├── hook-relay.ts       Script appelé par les hooks de Claude Code
│   ├── core/
│   │   ├── agentManager.ts Registre des agents, notifications, tâches périodiques
│   │   ├── reducer.ts      Machine d'états (état, événement) → état
│   │   ├── activity.ts     Outil → activité visuelle, détection des commandes de test
│   │   ├── redact.ts       Masquage des secrets
│   │   ├── hooks.ts        Installation / retrait des hooks dans settings.json
│   │   ├── processMonitor.ts  CPU / RAM par PID
│   │   └── settings.ts     Valeurs par défaut et validation des paramètres
│   ├── db/database.ts      Persistance SQLite (sql.js)
│   └── providers/
│       ├── provider.ts     Contrat AgentProvider / ProviderSink
│       ├── claude/         Connecteur Claude Code (registre, transcripts, sessions pilotées)
│       └── demo/           Connecteur de démonstration
└── renderer/               Interface React
    ├── App.tsx, store.ts   Structure générale, état global
    ├── views/              Bureau, Tableau de bord, Historique, Paramètres
    ├── components/         Sidebar, AgentPanel, EventLog, Dialogs
    └── office/             Moteur canvas 2D et sprites pixel art
scripts/                    build-main.mjs, dev.mjs, make-icon.mjs
tests/                      Tests Vitest
build/                      Icône utilisée par electron-builder
```

Le processus principal est empaqueté en trois fichiers CommonJS par `scripts/build-main.mjs` : `index.js`, `preload.js` et
`hook-relay.js`. `sql.js` reste externe et son fichier `.wasm`, ainsi que `hook-relay.js`, sont décompressés hors de
l'archive `asar` (`asarUnpack`) afin de pouvoir être lus et copiés à l'exécution.

## Tests

```bash
npm test
```

| Fichier | Couvre |
|---|---|
| `parser.test.ts` | Conversion des lignes de transcript en événements, masquage des secrets dans les commandes |
| `reducer.test.ts` | Machine d'états, tokens, provenance des statuts |
| `provider.test.ts` | Connecteur Claude Code sur un faux `~/.claude` : sessions, sous-agents, plantage, fin propre, capacités de pilotage, absence de doublons |
| `tailer-db.test.ts` | Lecture incrémentale (lignes partielles, CRLF, troncature, gros fichiers) ; base : déduplication, recherche, persistance, purge, récupération d'un fichier corrompu |
| `misc.test.ts` | Masquage, installation des hooks, arguments et messages du mode headless, paramètres, détection des commandes de test, échantillons de processus |

`tests/fixtures.ts` fournit des enregistrements de transcript prêts à l'emploi.

## Variables d'environnement de test

Utiles pour vérifier le rendu sans toucher à vos données :

| Variable | Rôle |
|---|---|
| `AAO_USER_DATA` | Dossier de données isolé (remplace `%APPDATA%\AI Agent Office`). |
| `AAO_WINDOW` | Taille intérieure exacte de la fenêtre, par exemple `1280x720`. |
| `AAO_SCREENSHOT` | Chemin d'une capture PNG ; un suffixe `-0`, `-1`… est ajouté. |
| `AAO_SCREENSHOT_AT` | Délais en ms avant chaque capture, séparés par des virgules (défaut `6000`). |
| `AAO_SCRIPT` | Scripts JavaScript exécutés avant chaque capture, séparés par `\|\|\|`. |
| `AAO_EXIT` | Quitte après la dernière capture. |
| `VITE_DEV_SERVER_URL` | URL de l'interface en développement (posée par `npm run dev`). |

## Ajouter un connecteur

Un connecteur est une classe qui implémente `AgentProvider` (`src/main/providers/provider.ts`) :

- `start(sink)` / `stop()` : démarrer et arrêter l'observation ;
- à l'aide du `ProviderSink` : `upsertAgent` pour déclarer une identité, `events` pour envoyer des `AgentEvent`
  normalisés (avec un `id` **stable** pour la déduplication), `patchAgent` pour les valeurs hors événements (PID,
  vivant ou non), `console` pour la sortie d'un processus piloté ;
- `capabilities(agent)` et `control(action, agent)` : indiquer **honnêtement** ce qui est possible (avec la raison
  quand ce ne l'est pas) et l'exécuter ;
- optionnellement `launch(opts)`.

Règles à respecter : marquer chaque valeur *observée*, *déduite* ou *indisponible* (`Tagged<T>`), ne jamais inventer
une information, et faire passer tout texte par `clean()` / `redact()` avant de le placer dans un événement. Branchez
ensuite le connecteur dans `main()` de `src/main/index.ts`.

## Publier une version

1. Incrémentez `version` dans `package.json`.
2. `npm test` puis `npm run dist` : les fichiers `AI Agent Office Setup <version>.exe` et
   `AI-Agent-Office-<version>-portable.exe` sont créés dans `release/`.
3. Créez la Release avec la CLI GitHub :

   ```bash
   gh release create v<version> "release/AI Agent Office Setup <version>.exe" \
     "release/AI-Agent-Office-<version>-portable.exe" --title "AI Agent Office <version>" --notes "…"
   ```

Les dossiers `dist/`, `release/` et `node_modules/` sont ignorés par git : les exécutables ne sont diffusés que via les
Releases.

## Contribuer

Les issues et pull requests sont les bienvenues. Avant d'ouvrir une pull request : `npm run typecheck` et `npm test`
doivent passer. Le projet est distribué sous [licence MIT](../../LICENSE).

---

[![Précédent Fonctionnement](https://img.shields.io/badge/Pr%C3%A9c%C3%A9dent-Fonctionnement-57606a?style=for-the-badge)](fonctionnement.md) [![Sommaire ☰](https://img.shields.io/badge/Sommaire-%E2%98%B0-57606a?style=for-the-badge)](README.md)

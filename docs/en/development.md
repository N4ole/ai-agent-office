# Development

[![Langue Français](https://img.shields.io/badge/Langue-Fran%C3%A7ais-1f6feb?style=for-the-badge)](../fr/developpement.md) [![Back Contents](https://img.shields.io/badge/Back-Contents-57606a?style=for-the-badge)](README.md)

## Tech stack

Electron · React 19 · TypeScript · Vite (UI) · esbuild (main process) · sql.js (SQLite in WebAssembly) · Vitest (tests)
· electron-builder (Windows NSIS installer and portable build).

## Getting started

```bash
npm install            # if npm blocks scripts: node node_modules/electron/install.js
npm run dev            # builds the main process, starts Vite (port 5199) and Electron
```

| Command | Effect |
|---|---|
| `npm run dev` | Development mode: UI hot-reloaded by Vite, Electron pointed at `http://localhost:5199`. The main process is rebuilt at launch (restart to pick up changes). |
| `npm run build` | Builds the main process (`dist/main/`) and the UI (`dist/renderer/`). |
| `npm start` | Runs Electron on the current folder (after `npm run build`). |
| `npm run typecheck` | TypeScript check with no output (`tsc --noEmit`). |
| `npm test` | Runs the Vitest suite. |
| `npm run icon` | Regenerates the icon (`scripts/make-icon.mjs`). |
| `npm run dist` | Build, then NSIS installer **and** portable into `release/`. |
| `npm run dist:portable` | Build, then portable only. |

## Repository layout

```
src/
├── shared/                 Types and logic shared by both processes
│   └── types.ts            AgentState, AgentEvent, Settings, IPC channels…
├── main/                   Electron main process
│   ├── index.ts            Window, IPC, wiring connectors → manager → database / UI
│   ├── preload.ts          API exposed to the UI (contextBridge)
│   ├── hook-relay.ts       Script called by Claude Code's hooks
│   ├── core/
│   │   ├── agentManager.ts Agent registry, notifications, periodic tasks
│   │   ├── reducer.ts      State machine (state, event) → state
│   │   ├── activity.ts     Tool → visual activity, test-command detection
│   │   ├── redact.ts       Secret masking
│   │   ├── hooks.ts        Installing / removing hooks in settings.json
│   │   ├── processMonitor.ts  CPU / RAM per PID
│   │   └── settings.ts     Defaults and settings validation
│   ├── db/database.ts      SQLite persistence (sql.js)
│   └── providers/
│       ├── provider.ts     AgentProvider / ProviderSink contract
│       ├── claude/         Claude Code connector (registry, transcripts, controlled sessions)
│       └── demo/           Demo connector
└── renderer/               React interface
    ├── App.tsx, store.ts   Overall structure, global state
    ├── views/              Office, Dashboard, History, Settings
    ├── components/         Sidebar, AgentPanel, EventLog, Dialogs
    └── office/             2D canvas engine and pixel-art sprites
scripts/                    build-main.mjs, dev.mjs, make-icon.mjs
tests/                      Vitest tests
build/                      Icon used by electron-builder
```

The main process is bundled into three CommonJS files by `scripts/build-main.mjs`: `index.js`, `preload.js` and
`hook-relay.js`. `sql.js` stays external, and its `.wasm` file as well as `hook-relay.js` are unpacked outside the
`asar` archive (`asarUnpack`) so they can be read and copied at runtime.

## Tests

```bash
npm test
```

| File | Covers |
|---|---|
| `parser.test.ts` | Converting transcript lines to events, masking secrets in commands |
| `reducer.test.ts` | State machine, tokens, status provenance |
| `provider.test.ts` | Claude Code connector on a fake `~/.claude`: sessions, sub-agents, crash, clean exit, control capabilities, no duplicates |
| `tailer-db.test.ts` | Incremental reading (partial lines, CRLF, truncation, large files); database: deduplication, search, persistence, purge, recovery from a corrupted file |
| `misc.test.ts` | Masking, hooks installation, headless-mode arguments and messages, settings, test-command detection, process samples |

`tests/fixtures.ts` provides ready-made transcript records.

## Test environment variables

Useful to check rendering without touching your data:

| Variable | Role |
|---|---|
| `AAO_USER_DATA` | Isolated data folder (replaces `%APPDATA%\AI Agent Office`). |
| `AAO_WINDOW` | Exact inner window size, for example `1280x720`. |
| `AAO_SCREENSHOT` | Path of a PNG capture; a `-0`, `-1`… suffix is added. |
| `AAO_SCREENSHOT_AT` | Delays in ms before each capture, comma-separated (default `6000`). |
| `AAO_SCRIPT` | JavaScript run before each capture, separated by `\|\|\|`. |
| `AAO_EXIT` | Quit after the last capture. |
| `VITE_DEV_SERVER_URL` | UI URL during development (set by `npm run dev`). |

## Adding a connector

A connector is a class implementing `AgentProvider` (`src/main/providers/provider.ts`):

- `start(sink)` / `stop()`: start and stop observation;
- using the `ProviderSink`: `upsertAgent` to declare an identity, `events` to send normalized `AgentEvent`s (with a
  **stable** `id` for deduplication), `patchAgent` for values that are not events (PID, alive or not), `console` for
  the output of a controlled process;
- `capabilities(agent)` and `control(action, agent)`: say **honestly** what is possible (with the reason when it is not)
  and perform it;
- optionally `launch(opts)`.

Rules: tag every value *observed*, *inferred* or *unavailable* (`Tagged<T>`), never invent information, and pass any
text through `clean()` / `redact()` before putting it in an event. Then wire the connector in `main()` of
`src/main/index.ts`.

## Publishing a release

1. Bump `version` in `package.json`.
2. `npm test`, then `npm run dist`: `AI Agent Office Setup <version>.exe` and `AI-Agent-Office-<version>-portable.exe`
   are created in `release/`.
3. Create the Release with the GitHub CLI:

   ```bash
   gh release create v<version> "release/AI Agent Office Setup <version>.exe" \
     "release/AI-Agent-Office-<version>-portable.exe" --title "AI Agent Office <version>" --notes "…"
   ```

The `dist/`, `release/` and `node_modules/` folders are ignored by git: executables are distributed only through
Releases.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, `npm run typecheck` and `npm test` must pass. The
project is distributed under the [MIT license](../../LICENSE).

---

[![Previous How it works](https://img.shields.io/badge/Previous-How%20it%20works-57606a?style=for-the-badge)](how-it-works.md) [![Contents ☰](https://img.shields.io/badge/Contents-%E2%98%B0-57606a?style=for-the-badge)](README.md)

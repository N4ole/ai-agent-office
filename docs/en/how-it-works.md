# How it works

[![Langue Français](https://img.shields.io/badge/Langue-Fran%C3%A7ais-1f6feb?style=for-the-badge)](../fr/fonctionnement.md) [![Back Contents](https://img.shields.io/badge/Back-Contents-57606a?style=for-the-badge)](README.md)

This document explains how AI Agent Office gets its information, turns it into agent state and displays it.

## Overview

```
        Files written by Claude Code                       Claude Code processes launched by the app
  ~/.claude/sessions/<pid>.json   (registry)               claude -p --input-format stream-json …
  ~/.claude/projects/…/<id>.jsonl (transcripts)                          │  stdin / stdout
  …/<id>/subagents/agent-*.jsonl  (sub-agents)                           │
  ~/.ai-agent-office/hook-events.jsonl (hooks, optional)                 │
              │ read-only                                                │
              ▼                                                          ▼
        ┌──────────────────── ClaudeProvider (connector) ─────────────────────┐
        │  watching + polling · JSONL tailer · parser · controlled sessions    │
        └───────────────────────────────┬──────────────────────────────────────┘
                                        │ normalized events (AgentEvent)
                                        ▼
                      AgentManager  ── reducer (state machine) ── notifications
                                        │                 │
                                  OfficeDB (SQLite)       │ IPC
                                                          ▼
                                   React UI + 2D canvas office
```

The application is an **Electron** app with two processes:

- the **main process** (`src/main/`) reads files, controls sessions, computes agent state, stores data and pushes
  updates to the interface;
- the **renderer process** (`src/renderer/`) is a **React** interface with a pixel-art renderer on a 2D `<canvas>`
  (`office/engine.ts`). It has no access to Node.js: it goes through a narrow IPC API exposed by `preload.ts`
  (`contextIsolation` on, `sandbox` on, external navigation blocked).

Only one instance of the app can run at a time; launching it again brings the existing window to the front.

## Data sources

The Claude Code connector (`src/main/providers/claude/`) relies on real sources, verified on Claude Code 2.1.x:

| Source | What it provides |
|---|---|
| `~/.claude/sessions/<pid>.json` | Registry of **active** sessions: PID, session id, folder, `busy` / `idle` status, name. Claude Code removes the file when the session closes. |
| `~/.claude/projects/<folder>/<session>.jsonl` | Transcript: requests, messages, tool calls and results, errors, title. |
| `…/<session>/subagents/agent-<id>.jsonl` + `.meta.json` | Sub-agents: their type, description, parent (through the tool-call id) and end (`finished`). |
| Windows processes (every 10 s) | CPU and memory of identified Claude Code processes, through a single PowerShell call. |
| Hooks (optional) | "Waiting for permission" notifications, exact session start and end. |

The data folder is `~/.claude`, or the one set by the `CLAUDE_CONFIG_DIR` variable, or the one in the settings.

### Incremental reading

Transcripts can grow very large. The `JsonlTailer` remembers a **byte offset** per file and reads only what was
appended, handling a trailing partial line (file being written) and truncation. These offsets are saved in the
database: after a restart the app resumes where it stopped instead of re-reading everything.

### Detecting changes

- A recursive `fs.watch` on `projects/` flags modified files.
- A one-second loop polls the sessions registry and re-reads active files. It also acts as a **fallback** when
  `fs.watch` misses events: recent files (under 15 minutes) are polled continuously, the others every 10 seconds.
- A full sweep of the transcript folders is repeated every 5 seconds to detect new sessions.
- At start, only transcripts modified in the last *N* days (7 by default) are loaded. Events older than 2 minutes are
  treated as **replayed history**: they feed counters but do not change live status and trigger no notifications.

## From file to state: the pipeline

1. **Parser** (`parser.ts`): converts each transcript line into normalized `AgentEvent`s (`user_prompt`, `tool_use`,
   `tool_result`, `tool_error`, `subagent_spawn`, `turn_end`, `title`…). Unknown record types are
   **ignored**, never guessed. Each summary is masked (see *Privacy*) and truncated.
2. **AgentManager** (`agentManager.ts`): receives identities and events from connectors, **deduplicates** them by stable
   id through the database, applies the reducer, assigns an office desk, raises notifications and batches updates to
   the UI roughly every 120 ms.
3. **Reducer** (`reducer.ts`): a pure function `(agent state, event) → new state`. It updates the current task, files
   read and modified, commands, tests and errors.
4. **Interface**: receives the changed agents and live events, and renders them.

### Status: observed or inferred

Status comes from several signals, in order of authority:

1. The **sessions registry** (`busy` → working, `idle` → idle) decides *working / idle* as long as the session is alive,
   because transcript lines can arrive slightly late.
2. The **transcript** drives errors: a failing tool puts the agent in *error* until the registry or a successful result
   moves it on.
3. **Hooks** provide *waiting* reliably.
4. **Inferences**, always marked "inferred":
   - *possibly stuck*: a working agent with no event for *N* minutes (10 by default);
   - *session ended*: absent from the registry with an inactive transcript for more than 30 s at start, or 5 minutes
     of no activity for a session outside the registry (`-p` mode);
   - *sub-agent ended*: parent session closed.

A process that disappears while its registry file still exists is declared **lost** (crash or forced kill). If the
stop was requested from the app, it is not reported as a crash.

### Linking sub-agents to their parent

When an agent calls the `Agent` or `Task` tool, that call's id is remembered. The sub-agent's `.meta.json` contains the
same id, so it can be attached to the right parent, including nested sub-agents (the link is corrected as soon as the
parent call is read).

### Visual activity

`activity.ts` maps each tool to an activity (reading, coding, searching, testing, command, delegating, browsing,
waiting…). A shell command is classed as "testing" when it matches a known test runner (`npm test`, `vitest`, `jest`,
`pytest`, `go test`, `cargo test`, `dotnet test`, `mvn test`…).

### Progress

Progress is shown only when it is **measurable**: it is computed from the agent's to-do list (the `TodoWrite` tool) as
the number of completed items. Otherwise it reads "not measurable".

## Controlling sessions

Sessions launched from the app use Claude Code's documented non-interactive mode:

```
claude -p --input-format stream-json --output-format stream-json --verbose
       [--model <m>] [--permission-mode <mode>] [--resume <id>]
```

- Each JSON line `{"type":"user",…}` written to standard input starts a turn; the process stays alive between turns.
- `{"type":"control_request","request":{"subtype":"interrupt"}}` interrupts the running turn.
- Standard output (`system/init`, `assistant`, `user`, `result`) feeds the **built-in terminal**. The **agent's activity** itself is read from the transcript, which remains the single source of
  truth, exactly as for an external session.
- *Stop* kills the process tree (`taskkill /T /F`). *Resume* relaunches with `--resume` and the session id.

For an external session, Claude Code exposes no documented way to send an instruction: the app does not pretend
otherwise and only offers forced stop, opening a terminal, and resuming once the session has closed.

## Usage and quotas

The app computes and displays your sessions' usage as well as your subscription quotas. This document does not detail these
mechanisms.

## Privacy and security

- **Everything stays local.** The app sends no data to any external service.
- **Systematic masking** (`redact.ts`) before anything is displayed, stored or exported: Anthropic (`sk-ant-…`) and
  OpenAI-style keys, AWS keys, GitHub, Slack and Google tokens, JWTs, PEM private keys, `Bearer` headers, and the values
  of `key=value` pairs such as `api_key`, `secret`, `token`, `password`, `authorization`… You can add your own regular
  expressions in the settings.
- **Read-only** on Claude Code's files. The only write is the hooks installation, at your request, after a backup.
- **Isolated interface**: no Node.js in the renderer, limited IPC API, new windows and external navigation refused.
- The hook relay records only a minimal subset (identifiers, event type, message truncated to 500 characters).

## Storage

The SQLite database (`%APPDATA%\AI Agent Office\office.db`) is handled with **sql.js** (SQLite compiled to
WebAssembly), so there is no native module to compile on Windows. It lives in memory and is written to disk
**atomically** (temporary file then rename), at most every 3 seconds, and synchronously on exit. A corrupted file is
renamed `office.db.corrupt-<date>` and the app starts from a fresh database rather than crashing.

| Table | Content |
|---|---|
| `agents` | Each agent's state (JSON) and index columns |
| `events` | Normalized events ("thinking" events are not stored) |
| `notifications` | Notification history |
| `settings` | Settings and window geometry |
| `offsets` | Read position of each transcript |
| `meta` | Internal metadata |

Retention (30 days by default) removes old events at start.

## Demo mode

`DemoProvider` implements the same contract as the Claude Code connector (`AgentProvider`) with clearly flagged fake
data. These agents are never saved and no real command is executed.

---

[![Previous Usage](https://img.shields.io/badge/Previous-Usage-57606a?style=for-the-badge)](usage.md) [![Contents ☰](https://img.shields.io/badge/Contents-%E2%98%B0-57606a?style=for-the-badge)](README.md) [![Next Development](https://img.shields.io/badge/Next-Development-bf8700?style=for-the-badge)](development.md)

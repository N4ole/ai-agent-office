# Usage

[![Langue Français](https://img.shields.io/badge/Langue-Fran%C3%A7ais-1f6feb?style=for-the-badge)](../fr/utilisation.md) [![Back Contents](https://img.shields.io/badge/Back-Contents-57606a?style=for-the-badge)](README.md)

> The interface is in French. Control names below are given in English followed by the French label in parentheses.

## Contents

- [Getting around the interface](#getting-around-the-interface)
- [Understanding what is shown](#understanding-what-is-shown)
- [Watching your agents](#watching-your-agents)
- [Controlling sessions](#controlling-sessions)
- [Notifications](#notifications)
- [Usage and quotas](#usage-and-quotas)
- [Settings](#settings)
- [Optional hooks](#optional-hooks)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

## Getting around the interface

```
┌─ ☰ ─ AI AGENT OFFICE ── Office · Dashboard · Logs · History · Settings ── counters · 🔔 · + ─┐
│ Agent list        │            Main view (office, dashboard…)             │ Selected agent's panel       │
│ (tabs, filters)   │                                                       │ (Sheet · Log · Terminal)     │
├───────────────────┴───────────────────────────────────────────────────────┴──────────────────────────────┤
│ Status bar: Claude Code connection · active sessions · hooks · last event · stored events                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The five views open with keys `1` to `5`:

| Key | View | Purpose |
|---|---|---|
| `1` | **Office** (Bureau) | A pixel-art office where each agent is a character at a desk. Its animation reflects its real activity (reading, coding, testing, delegating…). |
| `2` | **Dashboard** (Tableau de bord) | Colored indicators, activity over 14 days, parent ↔ sub-agent org chart, recent alerts. It also shows usage and subscription quotas. |
| `3` | **Logs** (Journaux) | Stream of every event, colored by type, with day separators, search, filters and export. |
| `4` | **History** (Historique) | All recorded sessions, including finished ones, searchable by name, project, folder, task or identifier. |
| `5` | **Settings** (Paramètres) | Claude Code connection, hooks, notifications, data, appearance. |

The window adapts to your screen (laptops at 125–150 % scaling). Below 1440 / 1280 / 1100 px the interface becomes more
compact, the agent list hides (`☰` button or `Ctrl+B`) and the agent panel appears as an overlay. Window size and
position are remembered.

## Understanding what is shown

### The three provenance badges

| Badge | Meaning |
|---|---|
| **observed** (observé) | Value read as-is from a Claude Code file or from the process. |
| **inferred** (déduit) | A conclusion by the app (for example "possibly stuck"). Always labelled. |
| **unavailable** (indispo.) | Claude Code does not provide that information. The app invents nothing. |

### Agent statuses

| Status | Meaning |
|---|---|
| Working | A tool is running or the model is generating a reply. |
| Waiting | The agent is waiting for you (permission, input). Most reliable with the [hooks](#optional-hooks). |
| Idle | Alive, but its turn is over: it waits for a new request. |
| Done | Sub-agent finished or session closed cleanly. |
| Error | The last tool returned an error. |
| Lost | The process vanished without a clean end (crash, forced kill). |
| Unknown | Not enough information. |

A character's posture (twelve possible activities) follows the last tool used: thinking, coding (`Edit`, `Write`…),
reading (`Read`), searching (`Grep`, `Glob`…), testing (`npm test`, `pytest`, `go test`…), running a command,
delegating (`Agent`, `Task`), browsing the web, waiting, idle, error, done.

## Watching your agents

There is **nothing to configure**: start Claude Code in any terminal and the session appears within a few seconds, with
its sub-agents attached to their parent.

### The agent list (left)

- Quick tabs with counters: **All / Active / To check / Finished** (Tous / Actifs / À voir / Finis). "To check" gathers
  agents that are waiting, in error or lost.
- **Advanced filters** (button next to the search field): project, type (session / sub-agent), session, activity,
  priority, and showing history. They are remembered.
- Collapsible project groups, sub-agents as a tree, avatar, last action and age.
- Finished or lost agents free their desk after 10 minutes; their history remains available.

### The agent panel (right)

Click a character or a row in the list. The name can be edited (kept after a restart), as can the agent's color.

| Tab | Content |
|---|---|
| **Sheet** (Fiche) | "What it is doing now", summary tiles (actions, duration, usage), then collapsible sections: Task (with progress when the agent keeps a to-do list), Development (files modified and read, commands, tests, errors), Usage & resources (usage, CPU, RAM), Identity (folder, session, git branch), Relations (parent and sub-agents). |
| **Log** (Journal) | This agent's events only. |
| **Terminal** | The process's real output, for sessions launched from the app ("live"). |

Only actions that are actually possible are offered; the others are listed with the reason (for example "Sub-agents
are driven by their parent agent").

### Global search

`Ctrl+K` opens a search grouped by views, agents and events: agent, project, task, command, file or error. Move with
`↑` `↓`, confirm with `Enter`.

### Logs and export

The *Logs* view filters by category (*Requests & messages*, *Tools*, *Errors*, *Lifecycle*), can hide successful tool
results (there are many), copies the displayed lines, loads older events and exports to JSON. *Settings → Data &
privacy → Export everything* exports it all.

## Controlling sessions

### Launching a session

`Ctrl+N` or the **+ New session** button (Nouvelle session). Fill in:

| Field | Details |
|---|---|
| Working folder | Required. A "Browse…" button is available. Pre-filled with the selected agent's folder. |
| First instruction | Required: a controlled session starts with a prompt. `Ctrl+Enter` to launch. |
| Name | Optional, to recognise the session. |
| Model | Default, Opus, Sonnet or Haiku. |
| Permissions | See below. |

| Mode | Effect |
|---|---|
| **Edit files** (recommended) | File edits are accepted; commands that are not allowed are refused. |
| **Plan only** | The agent analyses and proposes, without changing anything. |
| **Read only** | In controlled mode Claude Code cannot ask you for permission: any tool that needs it is refused. |
| **Allow everything** | **Dangerous**: any command runs without confirmation. An extra confirmation is requested. Reserve for an isolated folder. |

The app uses Claude Code's documented non-interactive mode (`claude -p` with `stream-json` input/output).

### What you can do depending on where the session started

| Action | Session launched from the app | Session launched in a terminal | Sub-agent |
|---|---|---|---|
| Send an instruction | ✔ | ✖ no documented interface | ✖ driven by its parent |
| Interrupt the current turn | ✔ | ✖ | ✖ |
| Pause | ✖ does not exist in Claude Code (use *Interrupt*) | ✖ | ✖ |
| Stop (with confirmation) | ✔ | ✔ forced process kill | ✖ |
| Resume in the app (`--resume`) | ✔ once stopped | ✔ once closed | — |
| Resume in a terminal | ✔ | ✔ once closed | — |
| Built-in terminal | ✔ real output | ✖ (see the Log tab) | — |
| Open a terminal / the folder | ✔ | ✔ | ✔ |

When you close the window while sessions launched from the app are still running, a confirmation is requested:
quitting stops them, but their history remains and they can be resumed.

## Notifications

They appear inside the app (bell 🔔, top right) and, depending on your settings, as Windows notifications. Clicking a
Windows notification opens the app and selects the agent concerned.

| Event | When | Windows by default |
|---|---|---|
| New agent / sub-agent | A session or sub-agent appears | No |
| Task start | A new request is received | No |
| Task end | A turn or sub-agent finishes | **Yes** |
| Execution error | A tool fails (at most one per minute per agent) | No |
| Agent stuck / waiting | Permission needed (hooks), or no event for *N* min (inferred) | **Yes** |
| Session interrupted | The process vanished without a clean end | **Yes** |
| High resources | A process's CPU or RAM is above the threshold (at most every 10 min) | No |

Each row can be set separately for "In the app" and "Windows" in *Settings → Notifications & thresholds*.

## Usage and quotas

The app displays your sessions' usage and your Claude subscription quotas (dashboard, top bar, agent panel). This guide does
not detail these features.

## Settings

| Section | Options |
|---|---|
| **Connection to Claude Code** (Connexion à Claude Code) | Environment checks; `claude` executable (name or full path); data folder (default `~/.claude`, restart required after changing); number of days of transcripts loaded at start (7 by default). |
| **Optional hooks** (Hooks optionnels) | Install or remove the hooks. |
| **Notifications & thresholds** (Notifications & seuils) | Per-event switches; agent "stuck" after (10 min); CPU (80 %) and RAM (2,048 MB) thresholds. |
| **Data & privacy** (Données & confidentialité) | History retention (30 days by default, purged at start); extra masking by regular expression (one per line); export, purge old data, erase everything. |
| **Appearance & demo** (Apparence & démo) | Light theme (dark by default); demo mode. Office lighting follows the real time: day, dusk, night. |

## Optional hooks

Without hooks, the app already observes everything through Claude Code's files. Hooks add two signals:

- a **reliable** indicator when an agent is *waiting for your permission*;
- the exact reason a session ended.

Install from *Settings → Optional hooks → Install* (Node.js required).

- Three entries (`Notification`, `SessionStart`, `SessionEnd`), tagged "ai-agent-office", are added to
  `~/.claude/settings.json`; a timestamped backup `settings.json.ai-agent-office-<date>.bak` is made right before (also on uninstall), and the file is written atomically.
- They only affect **new** Claude Code sessions.
- The relay never blocks Claude Code: it exits by itself after 2 seconds at most and ignores any error.
- *Remove* deletes only the entries the app added. If `settings.json` cannot be read, the operation is cancelled so
  nothing is overwritten.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1` … `5` | Switch view |
| `Ctrl+K` | Global search |
| `Ctrl+N` | New session |
| `Ctrl+B` | Show / hide the agent list |
| `J` / `K` | Next / previous agent |
| `F` | Center the camera on the selected agent |
| `+` `−` `0` | Zoom in / out / overview |
| `L` | Show / hide parent ↔ sub-agent links |
| `B` | Show / hide action bubbles |
| `Esc` | Close the panel |
| Drag · wheel | Pan · zoom the office |
| `?` | Shortcut help |

Single-key shortcuts are disabled while typing in a text field.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "Claude Code introuvable" in the status bar | The `~/.claude/projects` folder does not exist. Run Claude Code once, or fix the data folder in *Settings → Connection*. A custom folder is set via `CLAUDE_CONFIG_DIR`. |
| The "Claude Code CLI" check fails | `claude` is not in your `PATH`. Enter the full path to `claude.exe` in the settings. |
| No session shows up | Check the status bar ("N active sessions · N transcripts followed"). Transcripts older than the configured number of days are not loaded at start (*Sessions loaded at start*). |
| An agent stays "working" | Without hooks, "stuck" is an inference (no event for *N* minutes). An agent outside the registry (`-p` mode) with no activity for 5 minutes is considered finished. |
| No "waiting" notification | Install the [hooks](#optional-hooks) for a reliable permission-wait signal. |
| Cannot send an instruction | The session was started from a terminal: Claude Code exposes no interface for that. Stop it and resume it from the app, or use its terminal. |
| Terminal buttons do not open | Windows Terminal is missing: the app falls back to `cmd.exe`. These buttons work on Windows only. |
| Start over | *Settings → Data & privacy → Erase everything* removes only the app's history; active sessions reappear on their next event. |

---

[![Previous Installation](https://img.shields.io/badge/Previous-Installation-57606a?style=for-the-badge)](installation.md) [![Contents ☰](https://img.shields.io/badge/Contents-%E2%98%B0-57606a?style=for-the-badge)](README.md) [![Next How it works](https://img.shields.io/badge/Next-How%20it%20works-8250df?style=for-the-badge)](how-it-works.md)

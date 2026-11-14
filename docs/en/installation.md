# Installation

[![Langue Français](https://img.shields.io/badge/Langue-Fran%C3%A7ais-1f6feb?style=for-the-badge)](../fr/installation.md) [![Back Contents](https://img.shields.io/badge/Back-Contents-57606a?style=for-the-badge)](README.md)

## Requirements

| Item | Required | Details |
|---|---|---|
| Windows 10 or 11 | Yes | The app relies on `taskkill`, PowerShell and Windows Terminal; other systems are not supported. |
| Claude Code CLI | Yes | Check with `claude --version`. It must have run at least once so that the `~/.claude` folder exists. |
| Node.js | No | Only for the [optional hooks](usage.md#optional-hooks) and for building the app from source. |
| Windows Terminal (`wt`) | No | Used by the "Terminal" and "Resume in a terminal" buttons. Falls back to `cmd.exe` automatically. |

## Install from a Release (recommended)

1. Open the [Releases](https://github.com/N4ole/ai-agent-office/releases) page and pick the latest version.
2. Download one of the two files:
   - **`AI-Agent-Office-Setup-<version>.exe`**: installer with a desktop shortcut and a clean uninstall. You can change
     the installation folder. (Up to 1.3.1: `AI.Agent.Office.Setup.<version>.exe`.)
   - **`AI-Agent-Office-<version>-portable.exe`**: a single file, no installation. It unpacks itself on every launch,
     which takes a few seconds.
3. Run the file.

### SmartScreen warning

The executables are **not signed**, so Windows SmartScreen will show "Windows protected your PC". Click **More info**,
then **Run anyway**. If you would rather not run a downloaded binary, build the app yourself (next section).

Why no signature? A Windows code-signing certificate (OV/EV or Azure Trusted Signing) has a yearly cost and is not in
place yet. Instead, every release lets you check what you downloaded (next section). Some antivirus products may also
flag the portable build, which unpacks itself on every launch: use the installer in that case.

### Verify a download

Starting with the release after 1.3.1, the executables are built by GitHub Actions from the tagged commit
([`release.yml` workflow](../../.github/workflows/release.yml)), and every release includes `SHA256SUMS.txt`.

1. **SHA-256 hash** (PowerShell, in the download folder):

   ```powershell
   Get-FileHash .\AI-Agent-Office-Setup-<version>.exe -Algorithm SHA256
   ```

   The value must match (case-insensitive) the one in `SHA256SUMS.txt`.

2. **Provenance** (proves the file was produced by this repository's workflow, and from which commit), with the
   [GitHub CLI](https://cli.github.com/):

   ```powershell
   gh attestation verify .\AI-Agent-Office-Setup-<version>.exe --repo N4ole/ai-agent-office
   ```

Versions 1.1.0 to 1.3.1 were built by hand, without hashes or attestations; 1.1.0 to 1.3.0 have no matching source in
the git history (see the [CHANGELOG](../../CHANGELOG.md)).

## Build from source

```bash
git clone https://github.com/N4ole/ai-agent-office.git
cd ai-agent-office
npm install
npm run dist            # installer + portable in release/
# or
npm run dist:portable   # portable only
```

If npm blocks install scripts and Electron is not downloaded, run:

```bash
node node_modules/electron/install.js
```

The executables are written to the `release/` folder. To run the app without packaging it:

```bash
npm run build
npm start
```

## First launch

On first start, a "Welcome to AI Agent Office" (Bienvenue dans AI Agent Office) wizard checks your environment:

| Check | Meaning |
|---|---|
| Claude Code CLI | `claude --version` answers. Otherwise, enter the full path to `claude.exe` in *Settings → Connection to Claude Code* (Paramètres → Connexion à Claude Code). |
| Claude Code data folder | `~/.claude` exists (or the folder named by the `CLAUDE_CONFIG_DIR` variable). |
| Session transcripts | The `projects/` subfolder exists. Run a Claude Code session once if it is missing. |
| Active sessions registry | The `sessions/` subfolder exists. Without it, live status is inferred from transcripts only. |
| Read permission | The data folder is readable. |
| Node.js | Only needed for the optional hooks. |
| Optional hooks | Installed or not (optional). |
| Windows Terminal | Available, otherwise falls back to `cmd.exe`. |

Click **Open the office** (Ouvrir le bureau) to finish. Claude Code sessions that are already open, whichever terminal they were started
in, show up on their own. You can reopen these checks at any time from *Settings → Connection to Claude Code → Check
again* (Revérifier).

> **Try it without an active Claude Code**: turn on *demo mode* in *Settings → Appearance & demo* (Apparence & démo). Fictional agents,
> tagged with a "DEMO MODE" badge, appear. They are never saved.

## Where the app stores its data

| Location | Content |
|---|---|
| `%APPDATA%\AI Agent Office\office.db` | SQLite database: agents, events, notifications, settings. Shared by the installed and portable versions. |
| `%USERPROFILE%\.ai-agent-office\` | Working folder: hook relay (`hook-relay.js`, `hook-events.jsonl`) and an internal technical folder. |
| `%USERPROFILE%\.claude\settings.json` | **Modified only** if you install the hooks (a timestamped backup `settings.json.ai-agent-office-<date>.bak` is created before every change, including uninstall; older backups are never overwritten). |

## Update

Download the new Release and run it: the installer replaces the old version, and the portable build is a single file to
swap. Your history is kept because it lives in `%APPDATA%\AI Agent Office`.

## Uninstall

1. If you installed the hooks, remove them first: *Settings → Optional hooks → Remove* (Paramètres → Hooks optionnels → Retirer).
2. Uninstall the app (Windows "Installed apps") or delete the portable file.
3. To erase all data, delete `%APPDATA%\AI Agent Office` and `%USERPROFILE%\.ai-agent-office`. Claude Code's own files
   are never touched.

---

[![Contents ☰](https://img.shields.io/badge/Contents-%E2%98%B0-57606a?style=for-the-badge)](README.md) [![Next Usage](https://img.shields.io/badge/Next-Usage-0969da?style=for-the-badge)](usage.md)

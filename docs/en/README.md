# AI Agent Office documentation

[![Download Releases](https://img.shields.io/badge/Download-Releases-2da44e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/N4ole/ai-agent-office/releases) [![Issues GitHub](https://img.shields.io/badge/Issues-GitHub-d1242f?style=for-the-badge)](https://github.com/N4ole/ai-agent-office/issues) [![License MIT](https://img.shields.io/badge/License-MIT-57606a?style=for-the-badge)](../../LICENSE) [![Langue Français](https://img.shields.io/badge/Langue-Fran%C3%A7ais-1f6feb?style=for-the-badge)](../fr/README.md)

AI Agent Office is a Windows (Electron) application that shows your **Claude Code** sessions and sub-agents as a
pixel-art virtual office. Each character is a real session or a real sub-agent; every piece of information comes from
an actual event or from a conclusion clearly labelled as inferred.

**Get started**

[![1 Installation](https://img.shields.io/badge/1-Installation-2da44e?style=for-the-badge)](installation.md) [![2 Usage](https://img.shields.io/badge/2-Usage-0969da?style=for-the-badge)](usage.md) [![3 How it works](https://img.shields.io/badge/3-How%20it%20works-8250df?style=for-the-badge)](how-it-works.md) [![4 Development](https://img.shields.io/badge/4-Development-bf8700?style=for-the-badge)](development.md)

## Contents

| Document | What it covers |
|---|---|
| [Installation](installation.md) | Requirements, installing from a Release, building from source, first launch, uninstalling |
| [Usage](usage.md) | Interface, watching agents, controlling sessions, notifications, settings, shortcuts, troubleshooting |
| [How it works](how-it-works.md) | Architecture, data sources, state machine, privacy, storage |
| [Development](development.md) | Code layout, commands, tests, adding a connector, publishing a release |

## At a glance

- **Non-intrusive observation**: the app reads files Claude Code already writes to your disk. It never modifies them.
- **Honest data**: every value carries an *observed*, *inferred* or *unavailable* badge.
- **Control**: launch sessions from the app, send them instructions, interrupt, stop and resume them.
- **Usage and quotas**: the app displays them as well; this documentation does not detail them.
- **Local only**: no data leaves your computer; secrets are masked before display, storage or export.

## Useful links

- Downloads: the repository's [Releases](https://github.com/N4ole/ai-agent-office/releases) tab.
- Report a problem: [Issues](https://github.com/N4ole/ai-agent-office/issues).
- License: [MIT](../../LICENSE).

> The application's interface is in French. Labels quoted in this documentation are given in English first, with the
> French text shown in the interface in parentheses where it helps you find the right control.

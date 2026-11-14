# Politique de sécurité / Security policy

## Versions prises en charge / Supported versions

Seule la **dernière version publiée** reçoit des correctifs de sécurité.
Only the **latest release** receives security fixes.

## Signaler une vulnérabilité / Reporting a vulnerability

**N’ouvrez pas d’issue publique.** Utilisez le signalement privé de GitHub :
onglet **Security** du dépôt → **Report a vulnerability**
([lien direct](https://github.com/N4ole/ai-agent-office/security/advisories/new)).

**Do not open a public issue.** Use GitHub private vulnerability reporting: repository **Security** tab →
**Report a vulnerability** ([direct link](https://github.com/N4ole/ai-agent-office/security/advisories/new)).

Indiquez si possible / Please include if you can:

- la version de l’app et de Windows / app and Windows versions;
- les étapes pour reproduire / steps to reproduce;
- l’impact estimé / the expected impact.

Projet maintenu sur le temps libre d’une personne : accusé de réception visé sous 7 jours, sans garantie de délai de
correction. / Maintained by one person in their spare time: acknowledgement targeted within 7 days, no guaranteed fix
time.

## Périmètre / Scope

Dans le périmètre / In scope: the Electron app (main process, preload, renderer), the hook relay
(`hook-relay.js`), the way the app reads `~/.claude`, writes `~/.claude/settings.json` and starts processes
(`claude`, `taskkill`, `cmd`, `wt`, PowerShell), and the release pipeline.

Hors périmètre / Out of scope: Claude Code itself (report to Anthropic), and vulnerabilities in build-only tooling
that does not ship in the app (e.g. the `minimatch` advisories reached through `electron-builder`).

## Ce que fait l’app / What the app does

L’app ne fait **aucun appel réseau**. Les secrets reconnus sont masqués avant affichage, stockage et export. Les
exécutables ne sont pas signés : vérifiez leur empreinte SHA-256 et leur attestation de provenance
([docs/fr/installation.md](docs/fr/installation.md#vérifier-un-téléchargement)).

The app makes **no network calls**. Recognized secrets are masked before display, storage and export. Executables are
not code-signed: check their SHA-256 and provenance attestation
([docs/en/installation.md](docs/en/installation.md#verify-a-download)).

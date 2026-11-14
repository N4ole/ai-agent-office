# Contribuer à AI Agent Office

Merci de votre intérêt ! Les issues et pull requests sont les bienvenues. *English speakers: issues and PRs in English
are welcome too.*

Merci de respecter le [code de conduite](CODE_OF_CONDUCT.md). Pour une faille de sécurité, suivez
[SECURITY.md](SECURITY.md) (pas d’issue publique).

## Installation

Prérequis : Windows 10/11, **Node.js 24+** (voir `engines` dans `package.json`), git. Claude Code n’est nécessaire que
pour essayer l’app avec de vraies sessions (le mode démo suffit sinon).

```bash
git clone https://github.com/N4ole/ai-agent-office.git
cd ai-agent-office
npm ci
npm run lint:setup   # installe l’outillage ESLint isolé dans tools/lint (une fois)
npm run dev          # app en mode développement (Vite + Electron)
```

Évitez de placer le dépôt dans un dossier synchronisé (OneDrive…) : le packaging peut échouer sur des fichiers
verrouillés.

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | lance l’app en développement (rechargement de l’UI) |
| `npm run build` | compile le process principal (esbuild) et l’UI (Vite) dans `dist/` |
| `npm start` | lance l’app depuis `dist/` |
| `npm test` | tests (vitest) |
| `npm run test:coverage` | tests + couverture (`coverage/index.html`) |
| `npm run typecheck` | vérification des types (TypeScript 7) |
| `npm run lint` | ESLint (après `npm run lint:setup`) |
| `npm run format` / `format:check` | Prettier : formate / vérifie |
| `npm run dist` | crée l’installateur et le portable dans `release/` (essai local uniquement) |

Pourquoi `tools/lint` ? `typescript-eslint` a besoin de l’API JavaScript de TypeScript (< 6.1), que TypeScript 7 ne
fournit plus. ESLint utilise donc sa propre copie de TypeScript 6, le projet reste en TypeScript 7.

## Lancer les tests

```bash
npm test                        # tout
npx vitest run tests/purge.test.ts   # un fichier
npx vitest                      # mode surveillance
```

Les tests n’écrivent que dans des dossiers temporaires et ne touchent ni `~/.claude` ni vos données. Certains tests
lancent de vrais `cmd.exe` / PowerShell et ne s’exécutent que sous Windows.

**Toute correction de bug ou de sécurité s’accompagne d’un test qui échoue avant la correction et passe après.**

## Avant d’ouvrir une pull request

La CI (GitHub Actions, `windows-latest`) doit passer ; en local :

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

- Une PR = un sujet. Mettez à jour la doc FR **et** EN si le comportement change, et `CHANGELOG.md` (section
  « Non publié »).
- Les textes de l’interface et les messages utilisateur sont **en français**.
- L’app ne doit faire **aucun appel réseau**.
- Ne cassez pas les données existantes (`%APPDATA%\AI Agent Office\office.db`, `~/.claude`, `~/.ai-agent-office`) :
  tout changement de format doit être discuté dans une issue d’abord.

## Conventions de commit

Messages **en anglais**, à l’impératif, ligne de titre ≤ 72 caractères, corps qui explique le *pourquoi* :

```
Kill the whole process tree when the /usage probe times out (R-15)

child.kill() only ended the first process on Windows...
```

- Référencez l’issue ou le point d’audit concerné (`#12`, `R-04`).
- Commits de pur formatage séparés des changements de code.
- Les noms de workflows et de jobs sont aussi en anglais.

## Labels

`bug`, `enhancement`, `security`, `documentation`, `dependencies`, `ci`, `skip-changelog`. Ils déterminent la
catégorie dans les notes de version générées ([.github/release.yml](.github/release.yml)) ; certains sont posés
automatiquement selon les fichiers modifiés ([.github/labeler.yml](.github/labeler.yml)).

## Publier une version

Réservé au mainteneur : voir [docs/fr/developpement.md](docs/fr/developpement.md#publier-une-version).

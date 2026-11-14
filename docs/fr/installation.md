# Installation

[![Language English](https://img.shields.io/badge/Language-English-1f6feb?style=for-the-badge)](../en/installation.md) [![Retour Sommaire](https://img.shields.io/badge/Retour-Sommaire-57606a?style=for-the-badge)](README.md)

## Prérequis

| Élément | Obligatoire | Détail |
|---|---|---|
| Windows 10 ou 11 | Oui | L'application utilise `taskkill`, PowerShell et Windows Terminal ; les autres systèmes ne sont pas pris en charge. |
| Claude Code CLI | Oui | Vérifiez avec `claude --version`. Il doit avoir été lancé au moins une fois pour créer le dossier `~/.claude`. |
| Node.js | Non | Uniquement pour les [hooks optionnels](utilisation.md#hooks-optionnels) et pour construire l'application depuis les sources. |
| Windows Terminal (`wt`) | Non | Utilisé pour les boutons « Terminal » et « Reprendre dans un terminal ». Repli automatique sur `cmd.exe`. |

## Installer depuis une Release (recommandé)

1. Ouvrez la page [Releases](https://github.com/N4ole/ai-agent-office/releases) et choisissez la version la plus récente.
2. Téléchargez l'un des deux fichiers :
   - **`AI Agent Office Setup <version>.exe`** : installateur avec raccourci sur le bureau et désinstallation propre.
     Le dossier d'installation est modifiable.
   - **`AI-Agent-Office-<version>-portable.exe`** : fichier unique, sans installation. Il se décompresse à chaque
     lancement, ce qui demande quelques secondes.
3. Lancez le fichier.

### Avertissement SmartScreen

Les exécutables ne sont **pas signés**. Windows SmartScreen affichera donc « Windows a protégé votre ordinateur » :
cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**. Si vous préférez ne pas exécuter un
binaire téléchargé, construisez l'application vous-même (section suivante).

## Construire depuis les sources

```bash
git clone https://github.com/N4ole/ai-agent-office.git
cd ai-agent-office
npm install
npm run dist            # installateur + portable dans release/
# ou
npm run dist:portable   # portable seul
```

Si npm bloque les scripts d'installation et qu'Electron n'est pas téléchargé, exécutez :

```bash
node node_modules/electron/install.js
```

Les exécutables produits se trouvent dans le dossier `release/`. Pour lancer l'application sans l'empaqueter :

```bash
npm run build
npm start
```

## Premier lancement

Au premier démarrage, un assistant « Bienvenue dans AI Agent Office » vérifie votre environnement :

| Vérification | Signification |
|---|---|
| Claude Code CLI | `claude --version` répond. Sinon, indiquez le chemin complet de `claude.exe` dans *Paramètres → Connexion à Claude Code*. |
| Dossier de données Claude Code | `~/.claude` existe (ou le dossier désigné par la variable `CLAUDE_CONFIG_DIR`). |
| Transcripts de sessions | Le sous-dossier `projects/` existe. Lancez une session Claude Code une première fois s'il est absent. |
| Registre des sessions actives | Le sous-dossier `sessions/` existe. Sans lui, le statut en direct est déduit des transcripts uniquement. |
| Permission de lecture | Le dossier de données est lisible. |
| Node.js | Nécessaire seulement pour les hooks optionnels. |
| Hooks optionnels | Installés ou non (facultatif). |
| Windows Terminal | Disponible, sinon repli sur `cmd.exe`. |

Cliquez sur **Ouvrir le bureau** pour terminer. Les sessions Claude Code déjà ouvertes, quel que soit le terminal où
elles ont été lancées, apparaissent d'elles-mêmes. Vous pouvez rouvrir ces vérifications à tout moment dans
*Paramètres → Connexion à Claude Code → Revérifier*.

> **Essayer sans Claude Code actif** : activez le *mode démonstration* dans *Paramètres → Apparence & démo*. Des agents
> fictifs, marqués d'un badge « MODE DÉMO », apparaissent. Ils ne sont jamais enregistrés.

## Où l'application stocke ses données

| Emplacement | Contenu |
|---|---|
| `%APPDATA%\AI Agent Office\office.db` | Base SQLite : agents, événements, notifications, paramètres. Commune à la version installée et à la version portable. |
| `%USERPROFILE%\.ai-agent-office\` | Dossier de travail : relais des hooks (`hook-relay.js`, `hook-events.jsonl`) et dossier technique interne. |
| `%USERPROFILE%\.claude\settings.json` | **Modifié uniquement** si vous installez les hooks (sauvegarde horodatée `settings.json.ai-agent-office-<date>.bak` créée avant chaque modification, désinstallation comprise ; les anciennes ne sont jamais écrasées). |

## Mettre à jour

Téléchargez la nouvelle Release et lancez-la : l'installateur remplace l'ancienne version, et le portable est un simple
fichier à remplacer. L'historique est conservé car il vit dans `%APPDATA%\AI Agent Office`.

## Désinstaller

1. Si vous avez installé les hooks, retirez-les d'abord : *Paramètres → Hooks optionnels → Retirer*.
2. Désinstallez l'application (« Applications installées » de Windows) ou supprimez le fichier portable.
3. Pour effacer toutes les données : supprimez `%APPDATA%\AI Agent Office` et `%USERPROFILE%\.ai-agent-office`.
   Les fichiers de Claude Code ne sont jamais touchés.

---

[![Sommaire ☰](https://img.shields.io/badge/Sommaire-%E2%98%B0-57606a?style=for-the-badge)](README.md) [![Suivant Utilisation](https://img.shields.io/badge/Suivant-Utilisation-0969da?style=for-the-badge)](utilisation.md)

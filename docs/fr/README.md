# Documentation d'AI Agent Office

[![Télécharger Releases](https://img.shields.io/badge/T%C3%A9l%C3%A9charger-Releases-2da44e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/N4ole/ai-agent-office/releases) [![Issues GitHub](https://img.shields.io/badge/Issues-GitHub-d1242f?style=for-the-badge)](https://github.com/N4ole/ai-agent-office/issues) [![Licence MIT](https://img.shields.io/badge/Licence-MIT-57606a?style=for-the-badge)](../../LICENSE) [![Language English](https://img.shields.io/badge/Language-English-1f6feb?style=for-the-badge)](../en/README.md)

AI Agent Office est une application Windows (Electron) qui affiche vos sessions et sous-agents **Claude Code** sous la
forme d'un bureau virtuel en pixel art. Chaque personnage correspond à une vraie session ou à un vrai sous-agent ;
chaque information affichée vient d'un événement réel ou d'une déduction clairement signalée comme telle.

**Commencer**

[![1 Installation](https://img.shields.io/badge/1-Installation-2da44e?style=for-the-badge)](installation.md) [![2 Utilisation](https://img.shields.io/badge/2-Utilisation-0969da?style=for-the-badge)](utilisation.md) [![3 Fonctionnement](https://img.shields.io/badge/3-Fonctionnement-8250df?style=for-the-badge)](fonctionnement.md) [![4 Développement](https://img.shields.io/badge/4-D%C3%A9veloppement-bf8700?style=for-the-badge)](developpement.md)

## Sommaire

| Document | Contenu |
|---|---|
| [Installation](installation.md) | Prérequis, installation depuis une Release, construction depuis les sources, premier lancement, désinstallation |
| [Utilisation](utilisation.md) | Interface, observer des agents, piloter des sessions, notifications, paramètres, raccourcis, dépannage |
| [Fonctionnement](fonctionnement.md) | Architecture, sources de données, machine d'états, confidentialité, stockage |
| [Développement](developpement.md) | Structure du code, commandes, tests, ajouter un connecteur, publier une version |

## En bref

- **Observation sans intrusion** : l'application lit les fichiers que Claude Code écrit déjà sur votre disque. Elle ne
  les modifie jamais.
- **Honnêteté des données** : chaque valeur porte un badge *observé*, *déduit* ou *indispo.*.
- **Pilotage** : vous pouvez lancer des sessions depuis l'application, leur envoyer des instructions, les interrompre,
  les arrêter et les reprendre.
- **Consommation et quotas** : l'application les affiche également ; cette documentation ne les détaille pas.
- **Local uniquement** : aucune donnée ne quitte votre ordinateur ; les secrets sont masqués avant affichage,
  enregistrement ou export.

## Liens utiles

- Téléchargements : onglet [Releases](https://github.com/N4ole/ai-agent-office/releases) du dépôt.
- Signaler un problème : onglet [Issues](https://github.com/N4ole/ai-agent-office/issues).
- Licence : [MIT](../../LICENSE).

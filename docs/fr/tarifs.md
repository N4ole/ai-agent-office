# Grille tarifaire (coût estimé)

Le « coût estimé » affiché par l’app n’est pas une donnée de Claude Code : c’est un calcul **tokens × tarif API
public** du modèle qui a produit chaque réponse. La grille est **codée en dur** dans
[`src/shared/pricing.ts`](../../src/shared/pricing.ts) et consultable dans l’app (Paramètres → Tarifs des modèles).

| | |
|---|---|
| Date de la grille | **30/10/2026** (`PRICES_AS_OF`) |
| Source | [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) (`PRICES_SOURCE`) |
| Unité | dollars US par million de tokens |
| Vérification | tokens × grille = relevé de coût de Claude Code au centime près sur une session réelle (Opus 5.5) |

Ce que couvre chaque ligne : entrée, sortie, lecture du cache, écriture du cache 5 min (×1,25 l’entrée) et 1 h
(×2 l’entrée), et pour Haiku 5.5 un palier plus cher au-delà de 100 000 tokens de prompt.

## Limites

- **Abonnement claude.ai** : le montant affiché est l’équivalent au tarif API, pas ce qui est facturé.
- **Modèle absent de la grille** (nouveau modèle) : le coût de ses réponses s’affiche « indisponible » au lieu d’un
  chiffre inventé.
- **Prix modifiés par Anthropic** : les estimations restent calculées avec l’ancienne grille tant qu’elle n’est pas
  mise à jour. La date de la grille est affichée dans Paramètres → Tarifs des modèles.

## Mettre la grille à jour

1. Relevez les prix sur la page source (entrée, sortie, lecture du cache ; l’écriture du cache se déduit de l’entrée
   sauf mention contraire).
2. Dans [`src/shared/pricing.ts`](../../src/shared/pricing.ts) :
   - ajoutez ou corrigez les lignes de `PRICES` (clé = identifiant du modèle tel qu’écrit dans les transcripts, sans
     date ni suffixe `[1m]`) ;
   - mettez à jour `PRICES_AS_OF` (date du relevé) et, si besoin, `PRICES_SOURCE`.
3. Ajoutez un cas dans [`tests/pricing.test.ts`](../../tests/pricing.test.ts) pour chaque nouveau modèle (identifiant
   reconnu et coût d’une réponse type).
4. `npm test`, puis une PR avec une entrée dans `CHANGELOG.md` (« Modifié : grille tarifaire au JJ/MM/AAAA »).

Les coûts déjà calculés ne sont pas recalculés rétroactivement : seuls les agents enregistrés sans coût estimé sont
retarifés au démarrage.

---

[![Sommaire ☰](https://img.shields.io/badge/Sommaire-%E2%98%B0-57606a?style=for-the-badge)](README.md)

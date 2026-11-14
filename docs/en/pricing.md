# Price table (estimated cost)

The "estimated cost" shown by the app does not come from Claude Code: it is **tokens × public API price** of the
model that produced each response. The table is **hard-coded** in
[`src/shared/pricing.ts`](../../src/shared/pricing.ts) and visible in the app (Settings → « Tarifs des modèles » (model prices)).

| | |
|---|---|
| Table date | **2026-10-30** (`PRICES_AS_OF`) |
| Source | [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) (`PRICES_SOURCE`) |
| Unit | US dollars per million tokens |
| Check | tokens × table = Claude Code's recorded cost to the cent on a real session (Opus 5.5) |

Each row covers input, output, cache read, cache write 5 min (×1.25 input) and 1 h (×2 input), and for Haiku 5.5 a
higher rate above 100,000 prompt tokens.

## Limits

- **claude.ai subscription**: the amount is the API-equivalent, not what you are billed.
- **Model missing from the table** (new model): its responses show "unavailable" instead of a made-up number.
- **Prices changed by Anthropic**: estimates keep using the old table until it is updated. The table date is shown in
  Settings → « Tarifs des modèles » (model prices).

## Updating the table

1. Read the prices on the source page (input, output, cache read; cache writes derive from input unless stated).
2. In [`src/shared/pricing.ts`](../../src/shared/pricing.ts): add or fix `PRICES` rows (key = model id as written in
   transcripts, without date or `[1m]` suffix) and update `PRICES_AS_OF` (and `PRICES_SOURCE` if needed).
3. Add a case to [`tests/pricing.test.ts`](../../tests/pricing.test.ts) for each new model.
4. `npm test`, then a PR with a `CHANGELOG.md` entry.

Costs already computed are not recomputed: only agents saved without an estimated cost are re-priced at startup.

---

[![Contents ☰](https://img.shields.io/badge/Contents-%E2%98%B0-57606a?style=for-the-badge)](README.md)

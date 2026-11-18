[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/1834017743/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/1834017743/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Built for [make.fun's "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01) ($1,325 in USDC).

# Token Radar — make.fun token-radar-01

The best token launch radar: every pre-token protocol in the sealed DefiLlama snapshot,
ranked by what its token would be worth, with a farm plan for each one.

## The model (radar-2)

Implied value is computed from the snapshot's own figures only, never from a list of names:

```
implied = TVL × class multiple × growth factor × age factor
```

| Factor | Value | Why |
| --- | --- | --- |
| Vault curators (Risk Curators, Onchain Capital Allocator) | × 0.22 | They earn fees on assets they manage, so they are priced like asset managers: a low multiple of managed capital. |
| Operating protocols (DEX, lending, yield, derivatives, …) | × 0.55 | They capture protocol fees directly and their token has direct utility at launch. |
| Chains | × 1.00 | A chain's token is the gas and governance asset of a whole network. |
| Growth factor | 1 + clamp(7d %, −50, +100) / 100 | One week is noise. The clamp stops a single hot week from multiplying a protocol forty-fold, and a bad week from erasing it. |
| Age factor | 1 + 0.12 × min(years without a token, 5) | Longer without a token means more pent-up launch value, capped at five years. |

The class is read from each protocol's own `category` field, so a future snapshot
reclasses itself. No protocol name is ever special-cased.

## The board

- **198 rows**: all 40 watchlist protocols, plus every other pre-token protocol that
  records no token and is not a wrapped, staked or bridged product of a token that
  already trades, and not an exchange. That is the checkable half of the watchlist
  rule, applied to every row.
- **Rank 1** is Sentora Curator at $704,071,921; rank 198 is Monarq at $940,204.
  Implied value is strictly decreasing with rank.
- **Every row carries a 7-step farm plan** (151–329 characters a step): fresh wallet,
  two category-fitted actions with capital and per-chain gas costs, a weekly cadence,
  a hold window, points/claim hygiene, and the don'ts (no Sybil wallets, no dust,
  no same-week withdrawal). Plans are generated from each protocol's own category,
  chains, TVL and age.
- **12 live-token protocols** are kept apart in an "Already trading" view with the
  market's own values, never mixed into the ranking.

## The dashboard

Static page, no framework, no network: `dashboard/index.html`, `app.css`, `app.js`
(23,793 bytes in all, inside the judge's 65,536-byte text budget). It sorts by implied
value, TVL, 7-day growth or age; filters by category, chain, pricing class, text search
and watchlist-only; and opens a detail view per protocol (`#/protocol/<slug>`) with the
model breakdown (each factor shown with its real numbers) and the farm plan.

## Run it

Node 22 or later, standard library only, no install step:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. The output is deterministic: two runs on the same snapshot write
the same bytes.

## Layout

```
main.ts                  the program (reads the snapshot, writes the entry)
lib/radar.ts             the model, the farm plans, the board validation, data.js
vendor/makefun-board.ts  the kit's vendored dossier library, byte for byte
dashboard/               index.html, app.css, app.js
screenshots/              1-board, 2-detail, 3-filtered, 4-watchlist (1440×900)
```

## Honesty notes

- A protocol "records no token" when its DefiLlama record carries no market cap, no
  CoinGecko id and no symbol. That is a record, not proof: a protocol on the list may
  still have a token its record does not carry.
- The implied value is this radar's own claim, never a prediction that a token will be
  issued, or when, or at what price.
- Farm plans assume no points program exists unless the protocol's own app says so.

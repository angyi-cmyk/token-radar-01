[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/angyi-cmyk/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/angyi-cmyk/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar — pre-token protocols ranked by fitted implied value

A radar for the make.fun bounty **"Build the best token launch radar"** (`token-radar-01`).
It reads a sealed DefiLlama snapshot, ranks every pre-token protocol it admits by an implied
value fitted from the snapshot's own live-token comparables, and shows each protocol's launch
odds, 80% range and costed farm verdict.

## The model (`radar-4`, `lib/model.ts`)

```
log(mcap) = a + b·log(TVL) + category offset        (OLS, fit at runtime)
implied   = max(1, round(exp(a + b·log(TVL) + category offset)))
```

- **Fitted, not assumed.** On the dev snapshot (14 Nov 2026) the fit on 95 live-token
  comparables gives a = 8.126, b = 0.457 — value grows sublinearly with TVL, not 1:1.
- **Category offset**: the category's median residual, shrunk toward 0 by n/(n+8); a
  category with no live comparable gets 0. (radar-3 used n/(n+3); the stronger shrinkage
  raises LOO R² and improves walk-forward, because small-n category offsets are mostly noise.)
- **Term ledger, tested held-out.** Every candidate term is scored by leave-one-out R²
  (refitting without the held-out protocol) and walk-forward R²/rho — fit on the older
  half of comps, tested on the newer half — and kept only when it raises LOO R² over the
  log-TVL base. On the dev snapshot: log TVL LOO R² +0.131 and category offset +0.153 are
  KEPT; growth (+0.108), log-age (+0.111) and log-chains (+0.117) are DROPPED. The old
  radar-2 formula scores LOO R² −0.189 on the same comps — worse than guessing the mean —
  which is why it was replaced. radar-4 fixed the walk-forward split, which radar-3 had
  backwards (it fit the newer half and tested the older); the corrected numbers are lower
  across the board — log TVL walk-forward rho 0.352, not 0.455 — and the two blind tests
  now visibly disagree on the category offset and on growth, which the dashboard says
  outright instead of hiding.
- **Launch odds**: P(launch in 12m / 24m) from the snapshot's cross-section — the cumulative
  launched share by age, smoothed by monotone interpolation across the bucket edges.
- **80% range**: implied × exp(±half-width), where the half-width is the 80th percentile
  of the absolute leave-one-out residuals (conformal-style). The old 1.28×sd shortcut
  over-covered (84%) and ran wider; the percentile covers ~81% at a narrower width.
- **Costed farm verdicts**: farm cost = gas on the main chain + capital + the farmer's time
  at $25/hour; minimum viable capital is the capital part. Verdict: FARM when
  P(12m) × implied × 0.1% ≥ cost, else SKIP. The 0.1% airdrop-share assumption is printed
  on the dashboard so the arithmetic is checkable.
- **Full accounting**: the dashboard accounts for all 758 protocols in the snapshot —
  ranked pre-token (195), live-token (128), token-exists-but-mcap-unrecorded (288), and
  pre-token excluded by reason (147: product-category 131, versioned 11, wrapped/staked 5).

No protocol name is special-cased. The board covers the snapshot's whole 40-protocol
watchlist, then adds every further pre-token protocol the rankable rule admits — except
wrapped, staked and bridged products, whose token already trades. Live-token protocols are
set aside with their market caps shown, never mixed into the ranking.

## The dashboard (`dashboard/`)

A static page with no network and no framework: the ranked board (implied value, 80% range,
launch odds, farm cost and verdict per row), a KPI/integrity strip on the cover, the term
ledger, the launch-odds table and the coverage table, a detail drawer for each protocol
(the model's own inputs, recomputed in the page, and the farm plan), and filters for search,
category, chain, watchlist-only, plus a live-token tab. Sortable by rank, name, TVL, 7-day
growth, age, launch odds and farm cost. CSV export and copy-farm-plan included.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json`,
`data.js`, copies `dashboard/` and `screenshots/` to the output, and writes
`dossier.json` with the vendored make.fun library. It runs twice with identical bytes.

## Files

- `main.ts` — the entrypoint
- `lib/model.ts` — the model, the term ledger, the odds, the intervals, the board builder, the farm plans
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the board, a detail view and a filtered view of the dashboard
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, vendored

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/angyi-cmyk/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/angyi-cmyk/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar — pre-token protocols ranked by fitted implied value

A radar for the make.fun bounty **"Build the best token launch radar"** (`token-radar-01`).
It reads a sealed DefiLlama snapshot, ranks every pre-token protocol it admits by an implied
value fitted from the snapshot's own live-token comparables, and shows each protocol's launch
odds, 80% range and costed farm verdict.

## The model (`radar-6`, `lib/model.ts`)

```
log(mcap) = a + b·log(TVL) + category offset        (OLS, fit at runtime)
implied   = max(1, round(exp(a + b·log(TVL) + category offset)))
```

- **Fitted, not assumed.** On the dev snapshot (14 Nov 2026) the fit on 95 live-token
  comparables gives a = 8.126, b = 0.457 — value grows sublinearly with TVL, not 1:1.
- **Category offset**: the category's median residual, shrunk toward 0 by n/(n+8); a
  category with no live comparable gets 0. (radar-3 used n/(n+3); the stronger shrinkage
  raises LOO R² and improves walk-forward, because small-n category offsets are mostly noise.)
- **Term ledger, tested held-out four ways.** Every candidate term is scored by
  leave-one-out R² (refitting without the held-out protocol), a single-split
  walk-forward R²/rho — fit on the older half of comps, tested on the newer half —
  a rolling-origin walk-forward (five expanding older windows, next slice each time,
  pooled), and ten-fold cross-validation on deterministic slug folds, plus a reverse
  walk-forward (fit newer, test older) as a robustness check — and kept only when it
  raises LOO R² over the log-TVL base. On the dev snapshot: log TVL LOO R² +0.131
  and category offset +0.153 are KEPT; growth (+0.108), log-age (+0.111) and
  log-chains (+0.117) are DROPPED. The old radar-2 formula scores LOO R² −0.189 on
  the same comps — worse than guessing the mean — which is why it was replaced.
  radar-4 fixed the walk-forward split, which radar-3 had backwards (it fit the
  newer half and tested the older); the corrected numbers are lower across the
  board — log TVL walk-forward rho 0.352, not 0.455. The four blind tests now
  agree on the verdicts: the category offset wins leave-one-out and ten-fold and
  is a wash on rolling-origin, while growth — which won the single-split
  walk-forward — loses leave-one-out, ten-fold AND rolling-origin, so that win was
  one 47-comp slice, not a real edge. The rolling-origin pooled R² is sensitive to
  which comps sit on the slice boundaries (shifting every origin by one comp moves
  log TVL's pooled R² from +0.073 to +0.183), so the dashboard reports the verdict
  across all four tests rather than leaning on any one number.
- **Launch odds**: P(launch in 12m / 24m) from a discrete-time hazard fit — logistic
  regression of "has launched" on log(age) over the 413 live-vs-pre-token protocols
  with a known listing date, P(launched by age) = sigmoid(−8.981 + 1.211 ×
  log(age+1)), then P = [G(age + 12m) − G(age)] / [1 − G(age)]. Held-out, the
  logistic ties the old age-bucket curve on leave-one-out log-loss (0.476 vs 0.480)
  and beats it clearly on a listed_at time split (0.409 vs 0.551) — the bucket curve
  cannot extrapolate to young ages it has never seen — and it fixes the bucket
  curve's artefacts in P(12m): 0.382 at age 730 days and 0.000 past 1460 days.
  TVL, category and a quadratic in log age were all tested as extra predictors and
  add nothing out-of-time, so the model stays age-only; the 232
  token-exists-but-mcap-unrecorded entries are excluded, as their tokens predate
  their listing dates. Age barely separates 12-month odds (P(12m) runs only
  0.11–0.15 across the board), so the farm verdict is driven mostly by implied
  value.
- **80% range**: implied × exp(±half-width), where the half-width is the 80th percentile
  of the absolute leave-one-out residuals (conformal-style). The old 1.28×sd shortcut
  over-covered (84%) and ran wider; the percentile covers ~81% at a narrower width.
- **Costed farm verdicts**: farm cost = gas on the main chain + capital + the farmer's time
  at $25/hour; minimum viable capital is the capital part. Verdict: FARM when
  P(12m) × implied × 0.1% ≥ cost, else SKIP. The 0.1% airdrop-share assumption is printed
  on the dashboard so the arithmetic is checkable. Every verdict now also shows its
  expected-value multiple (EV ÷ cost), so the reader sees by how much each row clears
  the bar — the weakest FARM row clears it by ×2.91 on the dev snapshot.
- **radar-6: no value-model change, by evidence.** The round hunted for a stronger value
  signal and kept none of it. Eight more snapshot-computable candidates ran through the
  same four blind tests — log TVL crossed with log-age, growth and log-chains, log-age
  crossed with growth, a multichain dummy, an Ethereum dummy, within-category TVL
  deviation, growth squared, log category size, a young-age dummy, and log TVL crossed
  with category size — and every one failed at least one test. The closest, log TVL ×
  category size, passes the four headline tests by about 0.01 on three of them while its
  reverse walk-forward collapses (rho 0.214 vs 0.377) and its implied elasticities run
  from −0.26 to +1.13, so it was rejected as validation-set fitting. The 90-day TVL
  momentum from DefiLlama history passes all four tests in analysis (LOO +0.146 vs
  +0.137, walk-forward rho 0.315 vs 0.296, rolling-origin +0.024 vs +0.002, ten-fold
  +0.138 vs +0.134 on the 90 covered comps) but the snapshot carries no TVL history —
  only the 7-day change — so the entry cannot compute it at runtime and it stays out;
  the 30-day momentum fails all four outright. The cover now states the four-test
  verdict in one line, and the integrity strip carries the rolling-origin and ten-fold
  R² alongside the leave-one-out and walk-forward numbers.
- **Full accounting**: the dashboard accounts for all 758 protocols in the snapshot —
  ranked pre-token (195), live-token (128), token-exists-but-mcap-unrecorded (288), and
  pre-token excluded by reason (147: product-category 131, versioned 11, wrapped/staked 5).

No protocol name is special-cased. The board covers the snapshot's whole 40-protocol
watchlist, then adds every further pre-token protocol the rankable rule admits — except
wrapped, staked and bridged products, whose token already trades. Live-token protocols are
set aside with their market caps shown, never mixed into the ranking.

## The dashboard (`dashboard/`)

A static page with no network and no framework: the ranked board (implied value, 80% range,
launch odds, farm cost, expected-value multiple and verdict per row), a KPI/integrity strip on the cover, the term
ledger, the launch-odds table and the coverage table, a detail drawer for each protocol
(the model's own inputs, recomputed in the page, and the farm plan), and filters for search,
category, chain, watchlist-only, plus a live-token tab. Sortable by rank, name, TVL, 7-day
growth, age, launch odds, farm cost and EV multiple. CSV export and copy-farm-plan included.

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

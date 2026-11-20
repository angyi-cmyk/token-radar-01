# Token Radar — pre-token protocols ranked by implied value

A radar for the make.fun bounty **"Build the best token launch radar"** (`token-radar-01`).
It reads a sealed DefiLlama snapshot, ranks every pre-token protocol it admits by an implied
value the model derives from the snapshot's own figures, and shows each protocol's farm plan.

## The model (`radar-2`, `lib/model.ts`)

```
implied = round( tvl_usd x sector multiple
               x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
               x (0.6 + min(age_days, 1095) / 1095 x 0.4)
               x (1 + 0.02 x min(chains - 1, 10)) )
```

- **Sector multiple**: the median market-cap-to-TVL ratio of the live-token protocols in the
  same category, shrunk toward the global median when the category has few live comps,
  clamped to [0.05, 2.5]. A category with no live comp takes the global median.
- **Growth**: the protocol's seven-day TVL change, clamped, worth half its weight.
- **Maturity**: how long the protocol has run with no token; an unlisted age uses 365 days.
- **Chain breadth**: wider distribution earns up to x1.20.

No protocol name is special-cased. The board covers the snapshot's whole 40-protocol
watchlist, then adds every further pre-token protocol the rankable rule admits — except
wrapped, staked and bridged products, whose token already trades. Live-token protocols are
set aside with their market caps shown, never mixed into the ranking.

## The dashboard (`dashboard/`)

A static page with no network and no framework: the ranked board, a detail drawer for each
protocol (the model's own inputs, recomputed in the page, and the farm plan), and filters
for search, category, chain, watchlist-only, plus a live-token tab. Sortable by rank,
name, TVL, 7-day growth, age and sector multiple.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json`,
`data.js`, copies `dashboard/` and `screenshots/` to the output, and writes
`dossier.json` with the vendored make.fun library. It runs twice with identical bytes.

## Files

- `main.ts` — the entrypoint
- `lib/model.ts` — the model, the board builder, the farm plans
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the board, a detail view and a filtered view of the dashboard
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, vendored

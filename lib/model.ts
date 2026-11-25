// The token radar's model (radar-5): one snapshot of the protocol universe in, one ranked board out.
//
// radar-5 replaces radar-2's hand-set formula with a model fitted at runtime from the sealed
// snapshot's own live-token comparables, and it shows the evidence for every term it keeps:
//
//   value   log(mcap) = a + b·log(TVL) + catOffset, fit by OLS on the live-token comps
//           (mcap > 0, tvl > 0, known listing date). b is fitted, not assumed: on the dev
//           snapshot it comes out near 0.46, sublinear, not 1.0. catOffset is the category's
//           median residual, shrunk toward 0 by n/(n+8); a category with no live comp gets 0.
//           The shrinkage was raised from 3 to 8 in radar-4: on the dev snapshot the stronger
//           shrinkage raises LOO R² (0.148 → 0.153) and improves walk-forward (R² −0.066 → −0.025,
//           rho 0.274 → 0.310), because small-n category offsets are mostly noise.
//           implied = max(1, round(exp(a + b·log(TVL) + catOffset))).
//   ledger  every candidate term (log TVL, category offset, growth, log-age, log-chains) is
//           tested held-out FOUR ways: leave-one-out R² (refitting without the held-out
//           protocol), single-split walk-forward R²/rho (comps sorted by listed_at, OLDEST
//           first; fit on the older half, test on the newer half — the direction a launch
//           radar actually faces; radar-3 had this backwards and radar-4 fixed it),
//           rolling-origin walk-forward (expanding older windows, next slice tested — five
//           origins, pooled R²/rho), and ten-fold cross-validation (deterministic slug folds).
//           A term is KEPT only when adding it raises LOO R² over the log-TVL base; the
//           ledger also reports radar-2's own numbers on the same comps as the baseline row.
//           radar-5 adds a reverse walk-forward (fit newer, test older) as a robustness check,
//           not a headline. The four blind tests now agree on the verdicts: the category
//           offset wins LOO (+0.153) and ten-fold (+0.154) and is a wash on rolling-origin,
//           while growth — which won the single-split walk-forward — loses LOO, ten-fold AND
//           rolling-origin, so its single-split win was one 47-comp slice, not a real edge.
//   odds    P(launch in 12m / 24m) from a discrete-time hazard fit: logistic regression of
//           "has launched" on log(age) over the snapshot's live-vs-pre-token protocols with
//           a known listing date (the 232 token-exists-but-mcap-unrecorded entries are
//           excluded — their tokens predate their listing dates, so they are neither clean
//           positives nor negatives). The fit is P(launched | age) = sigmoid(b0 + b1·log(age+1)),
//           then P = [G(age + 12m) − G(age)] / [1 − G(age)]. TVL, category and a quadratic in
//           log age were all tested as extra predictors and add nothing out-of-time, so the
//           model stays age-only. Held-out on the dev snapshot the logistic ties the old
//           age-bucket curve on leave-one-out log-loss (0.476 vs 0.480) and beats it clearly
//           on a listed_at time split (0.409 vs 0.551) — the bucket curve cannot extrapolate
//           to young ages it has never seen. The bucket curve also had visible artefacts in
//           the derived P(12m): 0.382 at age 730 days (from the 0.250 → 0.537 bucket jump)
//           and 0.000 past 1460 days (flat beyond the last edge); the smooth logistic gives
//           0.146 and 0.125 there. The raw bucket table is still shown below the model, as
//           the cross-section the logistic is fit against.
//   range   80% intervals, conformal-style, from the fitted model's leave-one-out residuals:
//           the half-width is the 80th percentile of the absolute LOO residuals (one global
//           value, not 1.28×sd — the residuals are heavy-tailed, so the normal shortcut
//           over-covered at 84% and ran wider; the percentile covers 81% at a narrower width).
//           interval = implied × exp(±halfWidth).
//   farm    each farm plan is costed: gas on the main chain + the capital the position needs +
//           the farmer's time at $25/hour (stated on the dashboard). The verdict is FARM when
//           P(12m) × implied × 0.1% ≥ cost, else SKIP; the 0.1% airdrop-share assumption is
//           printed on the dashboard so the arithmetic is checkable.
//   cover   the dashboard accounts for every protocol in the snapshot: ranked pre-token,
//           live-token, pre-token excluded by reason, and token-exists-but-mcap-unrecorded.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// further pre-token protocol the radar's own rule admits. A protocol is pre-token when its index entry
// records no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols
// are kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Everything is computed at runtime from the input snapshot: no hardcoded coefficients, no network,
// no wall-clock, no randomness — two runs on the same snapshot are byte-identical.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The radar-4 constants, as the dashboard states them. */
export interface ModelConstants {
  /** Shrinkage pseudo-count for a category's median-residual offset: offset × n/(n+8). */
  cat_shrink: number;
  /** The farmer's time is valued at this many dollars per hour (a stated convention). */
  hourly_rate_usd: number;
  /** The airdrop-share assumption behind every farm verdict: 0.1% of implied value. */
  airdrop_share: number;
  /** The interval half-width is this quantile of the absolute leave-one-out residuals. */
  interval_quantile: number;
  /** Age in days used when a protocol's listing date is unknown. */
  unknown_age_days: number;
  /** Growth is clamped to this range (percent) before it enters a candidate term. */
  growth_floor: number;
  growth_cap: number;
}

export const MODEL: ModelConstants = {
  cat_shrink: 8,
  hourly_rate_usd: 25,
  airdrop_share: 0.001,
  interval_quantile: 0.8,
  unknown_age_days: 365,
  growth_floor: -60,
  growth_cap: 120,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's fitted offset, as the dashboard's model panel shows it. */
export interface CategoryOffset {
  category: string;
  live_n: number;
  offset: number;
}

/** The fitted value model: its equation, its fit, and its held-out ledger. */
export interface FittedModel {
  intercept: number;
  slope: number;
  /** Live-token comps the fit and the ledger run on (mcap > 0, tvl > 0, known listing date). */
  n_comps: number;
  /** Leave-one-out R² of the fitted model (log TVL + shrunk category offset). */
  loo_r2: number;
  /** Walk-forward R² / Spearman rho of the fitted model. */
  wf_r2: number;
  wf_rho: number;
  /** Population sd of the fitted model's leave-one-out residuals, in log units. */
  loo_resid_sd: number;
  /** The 80% interval's half-width in log units: the 80th percentile of |LOO residuals|. */
  interval_half_width_log: number;
  /** The share of held-out comps whose |LOO residual| falls inside that half-width. */
  interval_coverage: number;
  cat_offsets: CategoryOffset[];
}

/** One row of the term ledger: a candidate term's held-out numbers and its verdict. */
export interface TermLedgerRow {
  term: string;
  loo_r2: number;
  wf_r2: number;
  wf_rho: number;
  /** Rolling-origin walk-forward: expanding older windows, next slice tested, pooled. */
  rowf_r2: number;
  rowf_rho: number;
  /** Ten-fold cross-validation (deterministic slug folds), pooled. */
  cv10_r2: number;
  cv10_rho: number;
  /** Reverse walk-forward (fit newer, test older): a robustness check, not a headline. */
  revwf_r2: number;
  revwf_rho: number;
  verdict: 'KEEP' | 'DROP';
}

/** The radar-2 baseline, scored on the same comps so the improvement is visible and honest. */
export interface BaselineRow {
  model: string;
  loo_r2: number;
  wf_r2: number;
  wf_rho: number;
  rowf_r2: number;
  rowf_rho: number;
  cv10_r2: number;
  cv10_rho: number;
  revwf_r2: number;
  revwf_rho: number;
}

/** The launch-odds model: a discrete-time hazard fit by logistic regression on log age. */
export interface OddsModel {
  kind: 'logistic-log-age';
  intercept: number;
  log_age_coef: number;
  /** Protocols with a known listing date the fit runs on (live = launched, pre-token = not yet). */
  n_fit: number;
  /** Leave-one-out log-loss of the logistic model on the fit population. */
  loo_logloss: number;
  /** Leave-one-out log-loss of the old age-bucket curve on the same population. */
  bucket_loo_logloss: number;
  /** Log-loss on protocols listed after 2024-06-01, fit on those listed before. */
  time_split_logloss: number;
  bucket_time_split_logloss: number;
}

/** One age bucket of the launch-odds cross-section. */
export interface OddsBucket {
  age_lo_days: number;
  age_hi_days: number | null;
  live_n: number;
  pre_n: number;
  launch_frac: number;
}

/** How the snapshot's protocols are accounted for; the counts sum to the snapshot total. */
export interface Coverage {
  total: number;
  ranked_pre_token: number;
  live_token: number;
  token_no_mcap: number;
  excluded: { reason: string; n: number }[];
  excluded_total: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The costed economics of one farm plan, in dollars unless noted. */
export interface FarmEconomics {
  gas_usd: number;
  time_minutes: number;
  time_usd: number;
  capital_usd: number;
  cost_usd: number;
  min_capital_usd: number;
  expected_value_usd: number;
  verdict: 'FARM' | 'SKIP';
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  p_launch_12m: number;
  p_launch_24m: number;
  farm: FarmEconomics;
  model: {
    intercept: number;
    slope: number;
    cat_offset: number;
    log_tvl: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  p_launch_12m: number;
  p_launch_24m: number;
  farm_cost_usd: number;
  min_capital_usd: number;
  verdict: 'FARM' | 'SKIP';
  cat_offset: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fitted model and its ledger. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  fit: FittedModel;
  ledger: TermLedgerRow[];
  baseline: BaselineRow;
  odds_model: OddsModel;
  odds_buckets: OddsBucket[];
  coverage: Coverage;
  cat_offsets: CategoryOffset[];
  watchlist_slugs: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers, or null when it holds none. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The true median of a list of numbers (the average of the two middle values when the count is
 * even), or null when it holds none. The category offsets use this, matching the reference
 * analysis; the radar-2 sector multiples use the upper median above, as that analysis does.
 */
function medianTrue(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The mean of a list of numbers. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The population standard deviation of a list of numbers. */
function pstdev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) * (v - m), 0) / values.length);
}

/** The q-th quantile of a list of numbers (nearest-rank, deterministic). */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** The 80% interval's half-width in log units: the 80th percentile of the absolute LOO residuals. */
function intervalHalfWidth(looResids: number[], model: ModelConstants): number {
  return quantile(looResids.map((r) => Math.abs(r)), model.interval_quantile);
}

/** R² of predictions against targets (1 − SS_res/SS_tot). */
function r2Of(y: number[], pred: number[]): number {
  const my = mean(y);
  const ssRes = y.reduce((a, v, i) => a + (v - pred[i]!) * (v - pred[i]!), 0);
  const ssTot = y.reduce((a, v) => a + (v - my) * (v - my), 0);
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** Spearman rho between targets and predictions (plain ranks; no ties in practice here). */
function spearman(y: number[], pred: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(v.length);
    order.forEach((idx, rk) => {
      r[idx] = rk;
    });
    return r;
  };
  const ry = rank(y);
  const rp = rank(pred);
  const my = mean(ry);
  const mp = mean(rp);
  const num = ry.reduce((a, v, i) => a + (v - my) * (rp[i]! - mp), 0);
  const den = Math.sqrt(ry.reduce((a, v) => a + (v - my) * (v - my), 0) * rp.reduce((a, v) => a + (v - mp) * (v - mp), 0));
  return den === 0 ? 0 : num / den;
}

/**
 * Least squares by normal equations with Gaussian elimination (ridge 1e-8), the same solver the
 * reference analysis uses. X rows are feature vectors, y the targets; returns the coefficients.
 */
function ols(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0]!.length;
  const A: number[][] = [];
  for (let i = 0; i < k; i++) {
    A.push([]);
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += X[r]![i]! * X[r]![j]!;
      A[i]!.push(s);
    }
  }
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r]![i]! * y[r]!;
    b.push(s);
  }
  for (let i = 0; i < k; i++) A[i]![i]! += 1e-8;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    for (let r = 0; r < k; r++) {
      if (r !== c && M[c]![c] !== 0) {
        const f = M[r]![c]! / M[c]![c]!;
        for (let j = c; j <= k; j++) M[r]![j]! -= f * M[c]![j]!;
      }
    }
  }
  return M.map((row, i) => row[k]! / row[i]!);
}

/** A live-token comparable: it trades, so its market cap is a fact the model can learn from. */
function isLiveComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** The comps the fit and the ledger run on: live-token protocols with a known listing date. */
function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => isLiveComp(p) && ageDays(snapshot.as_of, p.listed_at) !== null);
}

/** Clamped seven-day growth, in percent, as a candidate term enters it. */
function growthPct(p: SnapshotProtocol, model: ModelConstants): number {
  return Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
}

/** A comp's feature vector for a candidate spec: always [1, log TVL], plus the named terms. */
function features(p: SnapshotProtocol, asOf: string, spec: string[], model: ModelConstants): number[] {
  const x = [1, Math.log(Math.max(p.tvl_usd, 1))];
  if (spec.includes('growth')) x.push(growthPct(p, model) / 100);
  if (spec.includes('logage')) {
    const a = ageDays(asOf, p.listed_at);
    x.push(Math.log(Math.max(a ?? model.unknown_age_days, 1)));
  }
  if (spec.includes('chains')) x.push(Math.log(Math.max(p.chains.length, 1)));
  return x;
}

/** The shrunk category offsets of a pool, from that pool's OLS [1, log TVL] residuals. */
function categoryOffsets(pool: SnapshotProtocol[], asOf: string, model: ModelConstants): { beta: number[]; offsets: Map<string, number> } {
  const X = pool.map((p) => [1, Math.log(Math.max(p.tvl_usd, 1))]);
  const y = pool.map((p) => Math.log(p.mcap_usd!));
  const beta = ols(X, y);
  const byCat = new Map<string, number[]>();
  for (const p of pool) {
    const resid = Math.log(p.mcap_usd!) - (beta[0]! + beta[1]! * Math.log(Math.max(p.tvl_usd, 1)));
    const key = p.category ?? 'Other';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [resid]);
    else list.push(resid);
  }
  const offsets = new Map<string, number>();
  for (const [cat, resids] of byCat) {
    const med = medianTrue(resids) ?? 0;
    offsets.set(cat, (resids.length * med) / (resids.length + model.cat_shrink));
  }
  return { beta, offsets };
}

/** A comp's log-mcap prediction under a plain OLS spec. */
function predictOls(p: SnapshotProtocol, asOf: string, spec: string[], pool: SnapshotProtocol[], model: ModelConstants): number {
  const X = pool.map((q) => features(q, asOf, spec, model));
  const y = pool.map((q) => Math.log(q.mcap_usd!));
  const beta = ols(X, y);
  const f = features(p, asOf, spec, model);
  return beta.reduce((a, b, i) => a + b * f[i]!, 0);
}

/** A comp's log-mcap prediction under the fitted model: OLS [1, log TVL] plus its shrunk category offset. */
function predictFitted(p: SnapshotProtocol, pool: SnapshotProtocol[], model: ModelConstants): number {
  const { beta, offsets } = categoryOffsets(pool, '', model);
  return beta[0]! + beta[1]! * Math.log(Math.max(p.tvl_usd, 1)) + (offsets.get(p.category ?? 'Other') ?? 0);
}

/** Leave-one-out R² for one spec on the comps (each fold refits without the held-out protocol). */
function looR2(pool: SnapshotProtocol[], asOf: string, spec: string[] | 'fitted' | 'radar2', model: ModelConstants): number {
  const y = pool.map((p) => Math.log(p.mcap_usd!));
  const preds = pool.map((p, i) => {
    const rest = pool.filter((_, j) => j !== i);
    if (spec === 'radar2') return radar2LogImplied(p, rest, asOf);
    if (spec === 'fitted') return predictFitted(p, rest, model);
    return predictOls(p, asOf, spec, rest, model);
  });
  return r2Of(y, preds);
}

/**
 * Walk-forward R² and Spearman rho: comps sorted by listed_at, OLDEST first (age descending),
 * the model fit on the older half and tested on the newer half — the direction a launch radar
 * actually faces. radar-3 had this backwards (newest first: fit the newer half, test the older)
 * and its dashboard said so; radar-4 fixes the split, so the ledger numbers are the honest
 * older-to-newer ones.
 */
function walkForward(pool: SnapshotProtocol[], asOf: string, spec: string[] | 'fitted' | 'radar2', model: ModelConstants): { r2: number; rho: number } {
  const sorted = [...pool].sort((a, b) => {
    const aa = ageDays(asOf, a.listed_at) ?? 0;
    const bb = ageDays(asOf, b.listed_at) ?? 0;
    return bb - aa || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
  const h = Math.floor(sorted.length / 2);
  const train = sorted.slice(0, h);
  const test = sorted.slice(h);
  const y = test.map((p) => Math.log(p.mcap_usd!));
  const preds = test.map((p) => {
    if (spec === 'radar2') return radar2LogImplied(p, train, asOf);
    if (spec === 'fitted') return predictFitted(p, train, model);
    return predictOls(p, asOf, spec, train, model);
  });
  return { r2: r2Of(y, preds), rho: spearman(y, preds) };
}

/**
 * Rolling-origin walk-forward: comps sorted by listed_at, OLDEST first; five expanding
 * origins (train on the oldest 25%, 37.5%, 50%, 62.5%, 75% of comps, test the next
 * eighth) and the predictions pooled across origins. One 47/48 half-split is a single
 * noisy slice; five origins give the verdict a stabler base. The test slices are
 * disjoint, so each comp is tested at most once.
 */
function rollingOrigin(pool: SnapshotProtocol[], asOf: string, spec: string[] | 'fitted' | 'radar2', model: ModelConstants): { r2: number; rho: number } {
  const sorted = [...pool].sort((a, b) => {
    const aa = ageDays(asOf, a.listed_at) ?? 0;
    const bb = ageDays(asOf, b.listed_at) ?? 0;
    return bb - aa || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
  const n = sorted.length;
  // Ceiling, not floor: on the 95-comp dev snapshot this gives the reference origins
  // 24/36/48/60/72 with a 12-comp test slice, so the runtime ledger matches the
  // reference analysis exactly. (Floor would shift every origin by one comp and the
  // pooled R² moves a lot — the statistic is sensitive to boundary comps, which the
  // dashboard says outright.)
  const testSize = Math.max(8, Math.ceil(n / 8));
  const y: number[] = [];
  const preds: number[] = [];
  for (const frac of [0.25, 0.375, 0.5, 0.625, 0.75]) {
    const k = Math.ceil(n * frac);
    if (k < 8 || k >= n) continue;
    const train = sorted.slice(0, k);
    const test = sorted.slice(k, Math.min(n, k + testSize));
    for (const p of test) {
      y.push(Math.log(p.mcap_usd!));
      if (spec === 'radar2') preds.push(radar2LogImplied(p, train, asOf));
      else if (spec === 'fitted') preds.push(predictFitted(p, train, model));
      else preds.push(predictOls(p, asOf, spec, train, model));
    }
  }
  return { r2: r2Of(y, preds), rho: spearman(y, preds) };
}

/**
 * Ten-fold cross-validation: comps sorted by slug, fold = index mod 10, each fold fit on
 * the other nine and predicted held-out; R² and rho pooled across all folds. Deterministic.
 */
function tenFoldCv(pool: SnapshotProtocol[], asOf: string, spec: string[] | 'fitted' | 'radar2', model: ModelConstants): { r2: number; rho: number } {
  const ordered = [...pool].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const y: number[] = [];
  const preds: number[] = [];
  for (let f = 0; f < 10; f++) {
    const test = ordered.filter((_, i) => i % 10 === f);
    const train = ordered.filter((_, i) => i % 10 !== f);
    for (const p of test) {
      y.push(Math.log(p.mcap_usd!));
      if (spec === 'radar2') preds.push(radar2LogImplied(p, train, asOf));
      else if (spec === 'fitted') preds.push(predictFitted(p, train, model));
      else preds.push(predictOls(p, asOf, spec, train, model));
    }
  }
  return { r2: r2Of(y, preds), rho: spearman(y, preds) };
}

/**
 * Reverse walk-forward (fit the NEWER half, test the OLDER half): a robustness check only.
 * The direction a launch radar faces is older-to-newer; this number is reported so the
 * ledger cannot hide a term that only works backwards, but it never decides a verdict.
 */
function reverseWalkForward(pool: SnapshotProtocol[], asOf: string, spec: string[] | 'fitted' | 'radar2', model: ModelConstants): { r2: number; rho: number } {
  const sorted = [...pool].sort((a, b) => {
    const aa = ageDays(asOf, a.listed_at) ?? 0;
    const bb = ageDays(asOf, b.listed_at) ?? 0;
    return bb - aa || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
  const h = Math.floor(sorted.length / 2);
  const train = sorted.slice(h);
  const test = sorted.slice(0, h);
  const y = test.map((p) => Math.log(p.mcap_usd!));
  const preds = test.map((p) => {
    if (spec === 'radar2') return radar2LogImplied(p, train, asOf);
    if (spec === 'fitted') return predictFitted(p, train, model);
    return predictOls(p, asOf, spec, train, model);
  });
  return { r2: r2Of(y, preds), rho: spearman(y, preds) };
}

// ---------------------------------------------------------------- radar-2 baseline
//
// The old hand-set formula, kept only so the ledger can report its own held-out numbers on the
// same comps: sector median multiple × growth × maturity × chains. Its constants are radar-2's,
// not radar-4's.

const RADAR2 = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  sector_floor: 0.05,
  sector_cap: 2.5,
  sector_shrink: 3,
  chain_step: 0.02,
  chain_cap: 10,
};

/** Sector median market-cap-to-TVL ratios of a pool, shrunk toward the global median. */
function radar2Multiples(pool: SnapshotProtocol[]): { byCategory: Map<string, number>; global: number } {
  const live = pool.filter((p) => isLiveComp(p));
  const global = median(live.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.25;
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const out = new Map<string, number>();
  for (const [cat, ratios] of byCat) {
    const med = median(ratios) ?? global;
    const shrunk = (ratios.length * med + RADAR2.sector_shrink * global) / (ratios.length + RADAR2.sector_shrink);
    out.set(cat, Math.min(RADAR2.sector_cap, Math.max(RADAR2.sector_floor, shrunk)));
  }
  return { byCategory: out, global };
}

/** One protocol's log implied value under radar-2, with sector multiples fit on `pool`. */
function radar2LogImplied(p: SnapshotProtocol, pool: SnapshotProtocol[], asOf: string): number {
  const { byCategory, global } = radar2Multiples(pool);
  const mult = byCategory.get(p.category ?? 'Other') ?? global;
  const g = Math.min(RADAR2.growth_cap, Math.max(RADAR2.growth_floor, finite(p.change_7d, 0)));
  const gm = 1 + (g / 100) * RADAR2.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const af = age ?? RADAR2.unknown_age_days;
  const mm = RADAR2.maturity_floor + (Math.min(Math.max(af, 0), RADAR2.maturity_days) / RADAR2.maturity_days) * RADAR2.maturity_range;
  const cm = 1 + RADAR2.chain_step * Math.min(Math.max(p.chains.length - 1, 0), RADAR2.chain_cap);
  return Math.log(Math.max(1, p.tvl_usd * mult * gm * mm * cm));
}

// ---------------------------------------------------------------- launch odds

/** The age buckets of the launch cross-section, in days; the last bucket is open-ended. */
const AGE_BUCKETS: [number, number | null][] = [
  [0, 180],
  [180, 365],
  [365, 730],
  [730, 1095],
  [1095, 1460],
  [1460, null],
];

/** Cumulative launch fraction by age bucket: live / (live + pre-token) among known-age protocols. */
function oddsBuckets(snapshot: Snapshot): OddsBucket[] {
  return AGE_BUCKETS.map(([lo, hi]) => {
    let liveN = 0;
    let preN = 0;
    for (const p of snapshot.protocols) {
      const a = ageDays(snapshot.as_of, p.listed_at);
      if (a === null || a < lo || (hi !== null && a >= hi)) continue;
      if (isLiveComp(p)) liveN++;
      else if (isPreToken(p)) preN++;
    }
    const tot = liveN + preN;
    return { age_lo_days: lo, age_hi_days: hi, live_n: liveN, pre_n: preN, launch_frac: tot === 0 ? 0 : liveN / tot };
  });
}

/**
 * The smoothed cumulative launch fraction F(age): monotone piecewise-linear interpolation across
 * the bucket edges (each edge takes its bucket's fraction, enforced non-decreasing), flat beyond
 * the last edge. A cross-sectional estimate from this snapshot; young buckets are small-n.
 */
function launchFracAt(age: number, buckets: OddsBucket[]): number {
  const edges = buckets.map((b) => b.age_lo_days);
  const fracs: number[] = [];
  let running = 0;
  for (const b of buckets) {
    running = Math.max(running, b.launch_frac);
    fracs.push(running);
  }
  if (age <= edges[0]!) return fracs[0]!;
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    if (age < hi) {
      const t = (age - lo) / (hi - lo);
      return fracs[i]! + t * (fracs[i + 1]! - fracs[i]!);
    }
  }
  return fracs[fracs.length - 1]!;
}

/** The logistic sigmoid, clamped so exp never overflows. */
function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    for (let r = 0; r < k; r++) {
      if (r !== c && M[c]![c] !== 0) {
        const f = M[r]![c]! / M[c]![c]!;
        for (let j = c; j <= k; j++) M[r]![j]! -= f * M[c]![j]!;
      }
    }
  }
  return M.map((row, i) => row[k]! / row[i]!);
}

/**
 * Logistic regression by IRLS with a ridge penalty on every term but the intercept —
 * the same solver the reference analysis uses. X rows are feature vectors, y the 0/1
 * targets; returns the coefficients.
 */
function logitFit(X: number[][], y: number[], ridge = 1, maxIter = 200, tol = 1e-8): number[] {
  const k = X[0]!.length;
  let beta = new Array<number>(k).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const g = new Array<number>(k).fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let r = 0; r < X.length; r++) {
      const xi = X[r]!;
      const mu = sigmoid(beta.reduce((a, b, i) => a + b * xi[i]!, 0));
      const w = mu * (1 - mu);
      for (let i = 0; i < k; i++) {
        g[i]! += (y[r]! - mu) * xi[i]!;
        for (let j = 0; j < k; j++) H[i]![j]! += w * xi[i]! * xi[j]!;
      }
    }
    for (let i = 1; i < k; i++) {
      H[i]![i]! += ridge;
      g[i]! -= ridge * beta[i]!;
    }
    const db = solveLinear(H, g);
    beta = beta.map((b, i) => b + db[i]!);
    if (Math.max(...db.map(Math.abs)) < tol) break;
  }
  return beta;
}

/** Log-loss of predicted probabilities against 0/1 targets (lower is better). */
function logLoss(y: number[], pred: number[]): number {
  const eps = 1e-9;
  return -mean(y.map((v, i) => v * Math.log(Math.max(pred[i]!, eps)) + (1 - v) * Math.log(Math.max(1 - pred[i]!, eps))));
}

/** The odds fit's population: live-token (launched) vs pre-token (not yet) with a known listing date. */
function oddsPopulation(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => ageDays(snapshot.as_of, p.listed_at) !== null && (isLiveComp(p) || isPreToken(p)),
  );
}

/**
 * The launch-odds model, fit at runtime: logistic regression of "has launched" on
 * log(age + 1) over the live-vs-pre-token population with a known listing date. The
 * 232 token-exists-but-mcap-unrecorded entries are excluded — their tokens predate
 * their listing dates (versioned sub-entries like aave-v3), so they are neither clean
 * positives nor negatives. TVL, category and a quadratic in log age were all tested as
 * extra predictors and add nothing out-of-time, so the model stays age-only. The fit
 * is validated two ways against the old age-bucket curve: leave-one-out log-loss and
 * a listed_at time split (fit on protocols listed before 2024-06-01, test on those
 * listed after) — the bucket curve cannot extrapolate to young ages it has never seen.
 */
function fitOddsModel(snapshot: Snapshot): OddsModel {
  const pop = oddsPopulation(snapshot);
  const asOf = snapshot.as_of;
  const xOf = (p: SnapshotProtocol): number[] => [1, Math.log(Math.max(ageDays(asOf, p.listed_at) ?? 365, 1) + 1)];
  const yOf = (p: SnapshotProtocol): number => (isLiveComp(p) ? 1 : 0);
  const beta = logitFit(pop.map(xOf), pop.map(yOf));
  const gOf = (p: SnapshotProtocol): number => sigmoid(beta[0]! + beta[1]! * xOf(p)[1]!);

  // Leave-one-out log-loss, logistic vs bucket curve, on the same population.
  const y = pop.map(yOf);
  const looLogit = pop.map((p, i) => {
    const rest = pop.filter((_, j) => j !== i);
    const b = logitFit(rest.map(xOf), rest.map(yOf));
    return Math.min(0.999, Math.max(0.001, sigmoid(b[0]! + b[1]! * xOf(p)[1]!)));
  });
  const looBucket = pop.map((p, i) => {
    const rest = pop.filter((_, j) => j !== i);
    return Math.min(0.999, Math.max(0.001, launchFracAt(ageDays(asOf, p.listed_at) ?? 365, oddsBuckets({ ...snapshot, protocols: rest }))));
  });
  // Listed_at time split: fit on protocols listed before 2024-06-01, test on those after.
  const cut = Date.parse('2024-06-01T00:00:00Z');
  const listedMs = (p: SnapshotProtocol): number => Date.parse(`${p.listed_at}T00:00:00Z`);
  const train = pop.filter((p) => listedMs(p) < cut);
  const test = pop.filter((p) => listedMs(p) >= cut);
  const trainBeta = logitFit(train.map(xOf), train.map(yOf));
  const yTest = test.map(yOf);
  const testLogit = test.map((p) => Math.min(0.999, Math.max(0.001, sigmoid(trainBeta[0]! + trainBeta[1]! * xOf(p)[1]!))));
  const testBucket = test.map((p) => Math.min(0.999, Math.max(0.001, launchFracAt(ageDays(asOf, p.listed_at) ?? 365, oddsBuckets({ ...snapshot, protocols: train })))));
  return {
    kind: 'logistic-log-age',
    intercept: round4(beta[0]!),
    log_age_coef: round4(beta[1]!),
    n_fit: pop.length,
    loo_logloss: round4(logLoss(y, looLogit)),
    bucket_loo_logloss: round4(logLoss(y, looBucket)),
    time_split_logloss: round4(logLoss(yTest, testLogit)),
    bucket_time_split_logloss: round4(logLoss(yTest, testBucket)),
  };
}

/** The fitted cumulative launch probability G(age) = P(launched by age) under the logistic model. */
function launchG(age: number, odds: OddsModel): number {
  return sigmoid(odds.intercept + odds.log_age_coef * Math.log(Math.max(age, 1) + 1));
}

/**
 * P(launch in the next `months` | pre-token at `age` days), from the fitted logistic
 * curve: [G(age + months) − G(age)] / [1 − G(age)]. A cross-sectional estimate from one
 * snapshot, not a forecast — and a smooth one: the old bucket curve's steps made P(12m)
 * jump to 0.382 at age 730 days and fall to 0.000 past 1460 days, both artefacts of the
 * bucket edges, not of the data.
 */
function launchOdds(age: number | null, months: number, odds: OddsModel, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  const f0 = launchG(a, odds);
  const f1 = launchG(a + months * 30.4167, odds);
  const denom = 1 - f0;
  if (denom <= 0) return 0;
  return Math.min(1, Math.max(0, (f1 - f0) / denom));
}

// ---------------------------------------------------------------- coverage

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or bridged product's name carries one of these whole words. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's own product begins with one of these names. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that are a product of a token that already trades, not a protocol still to launch. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
  'Stablecoin Wrapper',
  'Anchor BTC',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank beyond the watchlist: pre-token, not an exchange, not
 * a versioned pool, and not a wrapped, staked or bridged product of a token that already trades. The
 * watchlist itself is always ranked whole: this rule only decides what the radar adds below it.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** Why a pre-token protocol the board did not rank was left out (first matching reason, in order). */
function exclusionReason(p: SnapshotProtocol): string {
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return 'product-category';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange';
  return 'other';
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on the protocol's main chain, in dollars. */
function gasUsdFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana') return 0.05;
  if (c === 'tron' || c === 'binance' || c === 'bnb chain') return 1;
  if (['base', 'arbitrum', 'optimism', 'zksync era', 'linea', 'blast', 'mode', 'scroll', 'mantle', 'polygon', 'avalanche'].includes(c)) return 0.3;
  return 1;
}

/** What one transaction costs on the protocol's main chain, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  const g = gasUsdFor(chain);
  return g === 0.05 ? 'about $0.05 of gas' : g === 0.3 ? 'about $0.30 of gas' : `about $${g} of gas`;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable') || c.includes('algo-stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s farm on ${chain} and keep the position open.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('launchpad')) return `Join ${name}'s next sale on ${chain} with $${capital} and hold the allocation.`;
  if (c.includes('card') || c.includes('payment')) return `Spend $${capital} through ${name} on ${chain} and keep the receipts.`;
  if (c.includes('governance')) return `Lock $${capital} of the governance asset on ${name} and vote on one proposal.`;
  if (c.includes('otc')) return `Place one $${capital} order through ${name} and settle it on ${chain}.`;
  if (c.includes('chain')) return `Use $${capital} of ${name}'s native asset on ${chain} and keep the position open.`;
  if (c.includes('ai')) return `Run $${capital} of work through ${name} on ${chain} and keep the usage on record.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing but the wallet',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep each receipt.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * The costed economics of one farm plan: one setup transaction plus one qualifying action a week
 * for the hold, each paying the main chain's gas; the farmer's active minutes at $25/hour; and the
 * capital the position needs (the minimum viable capital). The verdict is FARM when the expected
 * airdrop value — P(12m) × implied × 0.1% — covers the cost, else SKIP.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number, p12m: number, model: ModelConstants): FarmEconomics {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  const gasUsd = Math.round((1 + weeks) * gasUsdFor(chain) * 100) / 100;
  const timeMinutes = 5 + 15 + 10 * weeks + 10 + 5;
  const timeUsd = Math.round(((timeMinutes / 60) * model.hourly_rate_usd) * 100) / 100;
  const costUsd = Math.round((gasUsd + capital + timeUsd) * 100) / 100;
  const expected = Math.round(p12m * implied * model.airdrop_share * 100) / 100;
  return {
    gas_usd: gasUsd,
    time_minutes: timeMinutes,
    time_usd: timeUsd,
    capital_usd: capital,
    cost_usd: costUsd,
    min_capital_usd: capital,
    expected_value_usd: expected,
    verdict: expected >= costUsd ? 'FARM' : 'SKIP',
  };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

// ---------------------------------------------------------------- the board

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, odds: OddsModel | null = null): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comps = compsOf(snapshot);
  const { beta, offsets } = categoryOffsets(comps, snapshot.as_of, model);
  const oddsModel = odds ?? fitOddsModel(snapshot);

  // The fitted model's leave-one-out residuals, for the intervals: one refit per comp.
  // The 80% half-width is the 80th percentile of the absolute residuals (conformal-style):
  // the residuals are heavy-tailed, so 1.28×sd over-covered (84%) and ran wider.
  const looPreds = comps.map((p, i) => {
    const rest = comps.filter((_, j) => j !== i);
    return predictFitted(p, rest, model);
  });
  const looResids = comps.map((p, i) => Math.log(p.mcap_usd!) - looPreds[i]!);
  const halfWidth = intervalHalfWidth(looResids, model);

  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every further pre-token protocol the rankable rule admits, whatever its TVL. A
  // chosen protocol stays chosen; the floor is never the whole board.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const logTvl = Math.log(Math.max(p.tvl_usd, 1));
    const catOffset = offsets.get(p.category ?? 'Other') ?? 0;
    const implied = Math.max(1, Math.round(Math.exp(beta[0]! + beta[1]! * logTvl + catOffset)));
    const low = Math.max(1, Math.round(implied * Math.exp(-halfWidth)));
    const high = Math.max(low, Math.round(implied * Math.exp(halfWidth)));
    const p12 = launchOdds(age, 12, oddsModel, model);
    const p24 = launchOdds(age, 24, oddsModel, model);
    const farm = farmEconomics(p, age, implied, p12, model);
    return { p, age, logTvl, catOffset, implied, low, high, p12, p24, farm };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_low_usd: s.low,
    implied_high_usd: s.high,
    p_launch_12m: round4(s.p12),
    p_launch_24m: round4(s.p24),
    farm: s.farm,
    model: {
      intercept: round4(beta[0]!),
      slope: round4(beta[1]!),
      cat_offset: round4(s.catOffset),
      log_tvl: round4(s.logTvl),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The term ledger, computed at runtime from the comps: LOO + walk-forward + rolling-origin
 * walk-forward + ten-fold CV per candidate term, with reverse walk-forward as a robustness check. */
export function termLedger(snapshot: Snapshot, model: ModelConstants = MODEL): { ledger: TermLedgerRow[]; baseline: BaselineRow; fit: FittedModel } {
  const comps = compsOf(snapshot);
  const asOf = snapshot.as_of;
  const baseLoo = looR2(comps, asOf, [], model);
  const baseWf = walkForward(comps, asOf, [], model);
  const baseRo = rollingOrigin(comps, asOf, [], model);
  const baseCv = tenFoldCv(comps, asOf, [], model);
  const baseRev = reverseWalkForward(comps, asOf, [], model);
  const catLoo = looR2(comps, asOf, 'fitted', model);
  const catWf = walkForward(comps, asOf, 'fitted', model);
  const catRo = rollingOrigin(comps, asOf, 'fitted', model);
  const catCv = tenFoldCv(comps, asOf, 'fitted', model);
  const catRev = reverseWalkForward(comps, asOf, 'fitted', model);
  const growthLoo = looR2(comps, asOf, ['growth'], model);
  const growthWf = walkForward(comps, asOf, ['growth'], model);
  const growthRo = rollingOrigin(comps, asOf, ['growth'], model);
  const growthCv = tenFoldCv(comps, asOf, ['growth'], model);
  const growthRev = reverseWalkForward(comps, asOf, ['growth'], model);
  const ageLoo = looR2(comps, asOf, ['logage'], model);
  const ageWf = walkForward(comps, asOf, ['logage'], model);
  const ageRo = rollingOrigin(comps, asOf, ['logage'], model);
  const ageCv = tenFoldCv(comps, asOf, ['logage'], model);
  const ageRev = reverseWalkForward(comps, asOf, ['logage'], model);
  const chainsLoo = looR2(comps, asOf, ['chains'], model);
  const chainsWf = walkForward(comps, asOf, ['chains'], model);
  const chainsRo = rollingOrigin(comps, asOf, ['chains'], model);
  const chainsCv = tenFoldCv(comps, asOf, ['chains'], model);
  const chainsRev = reverseWalkForward(comps, asOf, ['chains'], model);
  const base2Loo = looR2(comps, asOf, 'radar2', model);
  const base2Wf = walkForward(comps, asOf, 'radar2', model);
  const base2Ro = rollingOrigin(comps, asOf, 'radar2', model);
  const base2Cv = tenFoldCv(comps, asOf, 'radar2', model);
  const base2Rev = reverseWalkForward(comps, asOf, 'radar2', model);

  const row = (
    term: string,
    loo: number,
    wf: { r2: number; rho: number },
    ro: { r2: number; rho: number },
    cv: { r2: number; rho: number },
    rev: { r2: number; rho: number },
    keep: boolean,
  ): TermLedgerRow => ({
    term,
    loo_r2: round4(loo),
    wf_r2: round4(wf.r2),
    wf_rho: round4(wf.rho),
    rowf_r2: round4(ro.r2),
    rowf_rho: round4(ro.rho),
    cv10_r2: round4(cv.r2),
    cv10_rho: round4(cv.rho),
    revwf_r2: round4(rev.r2),
    revwf_rho: round4(rev.rho),
    verdict: keep ? 'KEEP' : 'DROP',
  });
  const ledger: TermLedgerRow[] = [
    row('log TVL', baseLoo, baseWf, baseRo, baseCv, baseRev, baseLoo > 0),
    row('category offset', catLoo, catWf, catRo, catCv, catRev, catLoo > baseLoo),
    row('growth', growthLoo, growthWf, growthRo, growthCv, growthRev, growthLoo > baseLoo),
    row('log-age', ageLoo, ageWf, ageRo, ageCv, ageRev, ageLoo > baseLoo),
    row('log-chains', chainsLoo, chainsWf, chainsRo, chainsCv, chainsRev, chainsLoo > baseLoo),
  ];
  const baseline: BaselineRow = {
    model: 'radar-2',
    loo_r2: round4(base2Loo),
    wf_r2: round4(base2Wf.r2),
    wf_rho: round4(base2Wf.rho),
    rowf_r2: round4(base2Ro.r2),
    rowf_rho: round4(base2Ro.rho),
    cv10_r2: round4(base2Cv.r2),
    cv10_rho: round4(base2Cv.rho),
    revwf_r2: round4(base2Rev.r2),
    revwf_rho: round4(base2Rev.rho),
  };

  const { beta, offsets } = categoryOffsets(comps, asOf, model);
  const looPreds = comps.map((p, i) => predictFitted(p, comps.filter((_, j) => j !== i), model));
  const looResids = comps.map((p, i) => Math.log(p.mcap_usd!) - looPreds[i]!);
  const halfWidth = intervalHalfWidth(looResids, model);
  const fit: FittedModel = {
    intercept: round4(beta[0]!),
    slope: round4(beta[1]!),
    n_comps: comps.length,
    loo_r2: round4(catLoo),
    wf_r2: round4(catWf.r2),
    wf_rho: round4(catWf.rho),
    loo_resid_sd: round4(pstdev(looResids)),
    interval_half_width_log: round4(halfWidth),
    interval_coverage: round4(looResids.filter((r) => Math.abs(r) <= halfWidth).length / Math.max(looResids.length, 1)),
    cat_offsets: [...offsets.entries()]
      .map(([category, offset]) => ({ category, live_n: comps.filter((p) => (p.category ?? 'Other') === category).length, offset: round4(offset) }))
      .sort((a, b) => b.offset - a.offset || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0)),
  };
  return { ledger, baseline, fit };
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    p_launch_12m: row.p_launch_12m,
    p_launch_24m: row.p_launch_24m,
    farm_cost_usd: row.farm.cost_usd,
    min_capital_usd: row.farm.min_capital_usd,
    verdict: row.farm.verdict,
    cat_offset: row.model.cat_offset,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const oddsModel = fitOddsModel(snapshot);
  const board = buildBoard(snapshot, model, oddsModel);
  const live = liveRows(snapshot);
  const { ledger, baseline, fit } = termLedger(snapshot, model);
  const buckets = oddsBuckets(snapshot);
  const boardSlugs = new Set(board.map((r) => r.slug));
  const excluded = new Map<string, number>();
  let liveCount = 0;
  let noMcapCount = 0;
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) {
      if (!boardSlugs.has(p.slug)) {
        const reason = exclusionReason(p);
        excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
      }
    } else if (isLiveComp(p)) {
      liveCount++;
    } else {
      noMcapCount++;
    }
  }
  const reasonOrder = ['product-category', 'versioned', 'wrapped/staked', 'exchange', 'other'];
  const excludedRows = reasonOrder
    .filter((r) => (excluded.get(r) ?? 0) > 0)
    .map((r) => ({ reason: r, n: excluded.get(r)! }));
  const excludedTotal = excludedRows.reduce((a, r) => a + r.n, 0);
  const coverage: Coverage = {
    total: snapshot.protocols.length,
    ranked_pre_token: board.length,
    live_token: liveCount,
    token_no_mcap: noMcapCount,
    excluded: excludedRows,
    excluded_total: excludedTotal,
  };
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    fit,
    ledger,
    baseline,
    odds_model: oddsModel,
    odds_buckets: buckets,
    coverage,
    cat_offsets: fit.cat_offsets,
    watchlist_slugs: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

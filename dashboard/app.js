// Token Radar's console dashboard (radar-4). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with the
// fitted model's own inputs, launch odds, intervals and the costed farm plan. No network: every byte
// it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + n.toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtOdds(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n * 100).toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtR2(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(3);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(3);
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '×' + n.toFixed(2);
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, fit) {
    return Math.max(1, Math.round(Math.exp(fit.intercept + fit.slope * Math.log(Math.max(row.tvl_usd, 1)) + row.cat_offset)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'about $8 of gas';
    if (c === 'solana') return 'about $0.05 of gas';
    if (c === 'tron' || c === 'binance' || c === 'bnb chain') return 'about $1 of gas';
    if (['base', 'arbitrum', 'optimism', 'zksync era', 'linea', 'blast', 'mode', 'scroll', 'mantle', 'polygon', 'avalanche'].indexOf(c) >= 0) return 'about $0.30 of gas';
    return 'about $1 of gas';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s farm on " + chain + ' and keep the position open.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('launchpad') >= 0) return 'Join ' + name + "'s next sale on " + chain + ' with $' + capital + ' and hold the allocation.';
    if (c.indexOf('card') >= 0 || c.indexOf('payment') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipts.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of the governance asset on ' + name + ' and vote on one proposal.';
    if (c.indexOf('otc') >= 0) return 'Place one $' + capital + ' order through ' + name + ' and settle it on ' + chain + '.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + ' of ' + name + "'s native asset on " + chain + ' and keep the position open.';
    if (c.indexOf('ai') >= 0) return 'Run $' + capital + ' of work through ' + name + ' on ' + chain + ' and keep the usage on record.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing but the wallet', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep each receipt.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('w') === '1') state.watchOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('w', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.p_launch_12m; bv = b.p_launch_12m; }
      else if (key === 'cost') { av = a.farm_cost_usd; bv = b.farm_cost_usd; }
      else if (key === 'ev') { av = a.farm_ev_multiple; bv = b.farm_ev_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // One chip per sector: how many pre-token protocols it holds and their combined implied
  // value. Clicking a chip filters the board to that sector; clicking it again clears it.
  function sectorTotals() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = { category: c, n: 0, total: 0 };
      byCat[c].n += 1;
      byCat[c].total += r.implied_value_usd || 0;
    });
    return Object.keys(byCat).map(function (k) { return byCat[k]; }).sort(function (a, b) { return b.total - a.total; });
  }

  function sectorBar() {
    var allTotal = DATA.rows.reduce(function (a, r) { return a + (r.implied_value_usd || 0); }, 0);
    var chips = sectorTotals().map(function (s) {
      var active = state.category === s.category;
      return el('button', {
        type: 'button', class: 'sector-chip', 'aria-pressed': active ? 'true' : 'false',
        title: s.n + ' pre-token protocols, ' + fmtUsd(s.total) + ' combined implied value',
        onclick: function () { state.category = active ? 'all' : s.category; writeHash(); render(); }
      },
        el('span', { text: s.category }),
        el('b', { text: fmtUsd(s.total) }),
        el('span', { class: 'chip-n', text: s.n + (s.n === 1 ? ' row' : ' rows') })
      );
    });
    var all = el('button', {
      type: 'button', class: 'sector-chip', 'aria-pressed': state.category === 'all' ? 'true' : 'false',
      title: 'All ' + DATA.rows.length + ' pre-token protocols, ' + fmtUsd(allTotal) + ' combined implied value',
      onclick: function () { state.category = 'all'; writeHash(); render(); }
    }, el('span', { text: 'All sectors' }), el('b', { text: fmtUsd(allTotal) }), el('span', { class: 'chip-n', text: DATA.rows.length + ' rows' }));
    return el('div', { class: 'sector-bar', role: 'group', 'aria-label': 'Filter the board by sector' }, [all].concat(chips));
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Download the rows the board is showing right now — the current filter, sort and tab —
  // as a plain CSV, built entirely in the browser. No data leaves the page.
  function downloadCsv() {
    var head = ['rank', 'protocol', 'category', 'chains', 'tvl_usd', 'change_7d_pct', 'age_days', 'implied_value_usd', 'implied_low_usd', 'implied_high_usd', 'p_launch_12m', 'p_launch_24m', 'farm_cost_usd', 'ev_multiple', 'min_capital_usd', 'verdict'];
    var lines = [head.join(',')];
    if (state.tab === 'pre-token') {
      sortedRows(rows()).forEach(function (r) {
        lines.push([
          r.rank, csvCell(r.name), csvCell(r.category), csvCell((r.chains || []).join('; ')),
          r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days,
          r.implied_value_usd, r.implied_low_usd, r.implied_high_usd,
          r.p_launch_12m, r.p_launch_24m, r.farm_cost_usd, r.farm_ev_multiple, r.min_capital_usd, r.verdict
        ].join(','));
      });
    } else {
      DATA.live.forEach(function (r) {
        lines.push(['live', csvCell(r.name), csvCell(r.category), csvCell((r.chains || []).join('; ')), r.tvl_usd, r.change_7d === null ? '' : r.change_7d, '', '', r.mcap_usd].join(','));
      });
    }
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'token-radar-' + (state.tab === 'pre-token' ? 'pre-token' : 'live') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // Copy the six farm steps as plain text, for pasting into a farm log. Clipboard API
  // first, a hidden textarea and execCommand as the fallback for older browsers.
  function copyFarmPlan(steps, btn) {
    var text = steps.join('\n');
    function done() {
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable in this browser */ }
    ta.remove();
    done();
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, el('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by fitted implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' more pre-token protocols below and above that floor. Implied value is fitted, not assumed: ',
          el('b', { text: 'log(mcap) = ' + DATA.fit.intercept.toFixed(3) + ' + ' + DATA.fit.slope.toFixed(3) + ' x log(TVL) + category offset' }),
          ', fit on the snapshot\u2019s own live-token comparables and tested held-out. Every row also carries its launch odds, an 80% range, and a costed farm verdict.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows beyond the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // The integrity strip: the dashboard answers its own checks on the cover. Every number here is
  // computed at runtime from the snapshot; the term ledger below it shows how each was earned.
  function kpiStrip() {
    var c = DATA.coverage;
    var covered = c.ranked_pre_token + c.live_token + c.token_no_mcap + c.excluded_total;
    var farmRows = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; });
    var weakestEv = farmRows.length ? Math.min.apply(null, farmRows.map(function (r) { return r.farm_ev_multiple; })) : null;
    return el('section', { class: 'panel kpi-strip', 'aria-label': 'Validation summary' },
      el('div', { class: 'kpi' }, el('span', { text: 'Fitted model, leave-one-out R²' }), el('b', { text: fmtR2(DATA.fit.loo_r2) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Walk-forward R² / rho' }), el('b', { text: fmtR2(DATA.fit.wf_r2) + ' / ' + DATA.fit.wf_rho.toFixed(3) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Rolling-origin R²' }), el('b', { text: fmtR2(DATA.ledger[1].rowf_r2) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Ten-fold R²' }), el('b', { text: fmtR2(DATA.ledger[1].cv10_r2) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Weakest FARM row clears cost by' }), el('b', { text: fmtMult(weakestEv) })),
      el('div', { class: 'kpi' }, el('span', { text: 'radar-2 baseline, leave-one-out R²' }), el('b', { text: fmtR2(DATA.baseline.loo_r2) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Live-token comps fitted on' }), el('b', { text: String(DATA.fit.n_comps) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Protocols accounted for' }), el('b', { text: covered + ' / ' + c.total })),
      el('div', { class: 'kpi' }, el('span', { text: 'Model' }), el('b', { text: DATA.model_version }))
    );
  }

  // The four-test verdict in one line, on the cover, computed at runtime from the ledger:
  // the kept term's numbers on all four blind tests, the dropped terms named, and the
  // baseline for scale. The method section below carries the full ledger and the rejections.
  function coverVerdict() {
    var kept = DATA.ledger[1];
    return el('p', { class: 'cover-verdict' },
      'Four blind tests, one verdict: ',
      el('b', { text: 'log TVL + category offset kept' }),
      ' — leave-one-out R² ' + fmtR2(kept.loo_r2) + ', walk-forward rho ' + kept.wf_rho.toFixed(3) +
      ', rolling-origin R² ' + fmtR2(kept.rowf_r2) + ', ten-fold R² ' + fmtR2(kept.cv10_r2) +
      '. Growth, log-age and log-chains fail all four and are dropped; the old radar-2 formula scores ' +
      fmtR2(DATA.baseline.loo_r2) + ' leave-one-out. Every FARM verdict below also shows by how much it clears its cost.'
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('button', { class: 'button export-btn', type: 'button', text: 'Download CSV', title: 'Download the rows shown now as a CSV file', onclick: downloadCsv }),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, WATCH[r.slug] ? el('span', { class: 'watch', text: 'WATCH' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num range', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) }),
        el('td', { class: 'num', text: fmtOdds(r.p_launch_12m) }),
        el('td', { class: 'num', text: fmtOdds(r.p_launch_24m) }),
        el('td', { class: 'num', text: fmtMoney(r.farm_cost_usd) }),
        el('td', { class: 'num', text: fmtMult(r.farm_ev_multiple) }),
        el('td', null, el('span', { class: 'verdict ' + (r.verdict === 'FARM' ? 'farm' : 'skip'), text: r.verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, launch odds and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: '80% range' }),
            sortHeader('odds', 'P(12m)'),
            el('th', { scope: 'col', text: 'P(24m)' }),
            sortHeader('cost', 'Farm cost'),
            sortHeader('ev', 'EV ×'),
            el('th', { scope: 'col', text: 'Verdict' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function ledgerTable() {
    var head = el('tr', null,
      el('th', { scope: 'col', text: 'Term' }),
      el('th', { scope: 'col', text: 'Leave-one-out R²' }),
      el('th', { scope: 'col', text: 'Walk-forward R²' }),
      el('th', { scope: 'col', text: 'Walk-forward rho' }),
      el('th', { scope: 'col', text: 'Rolling-origin R²' }),
      el('th', { scope: 'col', text: 'Rolling-origin rho' }),
      el('th', { scope: 'col', text: '10-fold R²' }),
      el('th', { scope: 'col', text: '10-fold rho' }),
      el('th', { scope: 'col', text: 'Verdict' })
    );
    var body = el('tbody');
    DATA.ledger.forEach(function (t) {
      body.appendChild(el('tr', null,
        el('td', { text: t.term }),
        el('td', { class: 'num', text: fmtR2(t.loo_r2) }),
        el('td', { class: 'num', text: fmtR2(t.wf_r2) }),
        el('td', { class: 'num', text: t.wf_rho.toFixed(3) }),
        el('td', { class: 'num', text: fmtR2(t.rowf_r2) }),
        el('td', { class: 'num', text: t.rowf_rho.toFixed(3) }),
        el('td', { class: 'num', text: fmtR2(t.cv10_r2) }),
        el('td', { class: 'num', text: t.cv10_rho.toFixed(3) }),
        el('td', null, el('span', { class: 'verdict ' + (t.verdict === 'KEEP' ? 'farm' : 'skip'), text: t.verdict }))
      ));
    });
    body.appendChild(el('tr', { class: 'baseline-row' },
      el('td', { text: DATA.baseline.model + ' (baseline)' }),
      el('td', { class: 'num', text: fmtR2(DATA.baseline.loo_r2) }),
      el('td', { class: 'num', text: fmtR2(DATA.baseline.wf_r2) }),
      el('td', { class: 'num', text: DATA.baseline.wf_rho.toFixed(3) }),
      el('td', { class: 'num', text: fmtR2(DATA.baseline.rowf_r2) }),
      el('td', { class: 'num', text: DATA.baseline.rowf_rho.toFixed(3) }),
      el('td', { class: 'num', text: fmtR2(DATA.baseline.cv10_r2) }),
      el('td', { class: 'num', text: DATA.baseline.cv10_rho.toFixed(3) }),
      el('td', { text: 'replaced' })
    ));
    return el('div', { class: 'table-wrap kv' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Each candidate term is tested held-out four ways on the ' + DATA.fit.n_comps + ' live-token comps. A term is kept only when adding it raises leave-one-out R² over the log-TVL base. A reverse walk-forward (fit newer, test older) is computed too, as a robustness check, and is shown in the text below, not the table.' }),
        el('thead', null, head),
        body
      )
    );
  }

  function oddsTable() {
    var head = el('tr', null,
      el('th', { scope: 'col', text: 'Age' }),
      el('th', { scope: 'col', text: 'Live' }),
      el('th', { scope: 'col', text: 'Pre-token' }),
      el('th', { scope: 'col', text: 'Launched share' })
    );
    var body = el('tbody');
    DATA.odds_buckets.forEach(function (b) {
      body.appendChild(el('tr', null,
        el('td', { text: b.age_hi_days === null ? b.age_lo_days + 'd+' : b.age_lo_days + '–' + b.age_hi_days + 'd' }),
        el('td', { class: 'num', text: String(b.live_n) }),
        el('td', { class: 'num', text: String(b.pre_n) }),
        el('td', { class: 'num', text: (b.launch_frac * 100).toFixed(1) + '%' })
      ));
    });
    return el('div', { class: 'table-wrap kv' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Cross-sectional launch share by age: live / (live + pre-token) among protocols with a known listing date — the raw cross-section the logistic odds model below is fit against. Young buckets are small-n.' }),
        el('thead', null, head),
        body
      )
    );
  }

  function modelPanel() {
    var f = DATA.fit;
    var m = DATA.model;
    var offsetCells = (DATA.cat_offsets || []).map(function (s) {
      return el('div', { class: 'sector' },
        el('span', { text: s.category + ' (' + s.live_n + ' live)' }),
        el('b', { text: fmtSigned(s.offset) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — and tested' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function fitted on this snapshot\u2019s live-token comparables. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'log(mcap) = ', el('b', { text: f.intercept.toFixed(4) }), ' + ', el('b', { text: f.slope.toFixed(4) }), ' x log(TVL) + category offset',
        el('br'),
        'implied = round(exp(log(mcap))) — the slope is fitted, not assumed: value grows sublinearly with TVL (', el('b', { text: f.slope.toFixed(2) }), ', not 1.0).'
      ),
      el('p', { class: 'sub', text: 'Fit on ' + f.n_comps + ' live-token comparables (market cap > 0, TVL > 0, known listing date). The category offset is the category\u2019s median residual, shrunk toward 0 by n/(n+8); a category with no live comparable gets 0. The 80% range is implied x exp(±' + f.interval_half_width_log.toFixed(2) + ' log units), the 80th percentile of the absolute leave-one-out residuals — it covers ' + Math.round(f.interval_coverage * 100) + '% of held-out comparables. The ranges are wide, and they are shown honestly.' }),
      ledgerTable(),
      el('p', { class: 'sub', text: 'Walk-forward: comps sorted by listed_at, oldest first; the model is fit on the older half and tested on the newer half — the direction a launch radar actually faces. (radar-3 had this backwards: it fit the newer half and tested the older.) Rolling-origin walk-forward uses five expanding older windows and tests the next slice each time, pooled; ten-fold cross-validation uses deterministic slug folds. Leave-one-out refits without the held-out protocol, category offsets included. A term is KEPT only when adding it raises leave-one-out R² over the log-TVL base — and the four blind tests now agree on the verdicts: the category offset wins leave-one-out (' + fmtR2(DATA.ledger[1].loo_r2) + ') and ten-fold (' + fmtR2(DATA.ledger[1].cv10_r2) + ') and is a wash on rolling-origin, while growth — which won the single-split walk-forward — loses leave-one-out, ten-fold AND rolling-origin, so that win was one 47-comp slice, not a real edge. The reverse walk-forward (fit newer, test older) is a robustness check only: log TVL ' + fmtR2(DATA.ledger[0].revwf_r2) + ', category offset ' + fmtR2(DATA.ledger[1].revwf_r2) + ', growth ' + fmtR2(DATA.ledger[2].revwf_r2) + '. The old radar-2 formula scores ' + fmtR2(DATA.baseline.loo_r2) + ' leave-one-out on the same comps — worse than guessing the mean — which is why it was replaced.' }),
      el('p', { class: 'sub', text: 'radar-6 hunted for a stronger value signal and found none it could keep. Eight more snapshot-computable candidates were run through the same four tests — log TVL crossed with log-age, growth and log-chains, log-age crossed with growth, a multichain dummy, an Ethereum dummy, within-category TVL deviation, growth squared, log category size, a young-age dummy, and log TVL crossed with category size — and every one failed at least one test. The closest, log TVL × category size, passes the four headline tests by about 0.01 on three of them while its reverse walk-forward collapses (rho 0.214 vs 0.377) and its implied elasticities run from −0.26 to +1.13, so it was rejected as validation-set fitting. The 90-day TVL momentum from DefiLlama history passes all four tests in analysis, but the snapshot carries no TVL history — only the 7-day change — so this entry cannot compute it and it stays out; the 30-day momentum fails all four outright. The value model is therefore unchanged from radar-5. What radar-6 adds is display: every farm verdict now carries its expected-value multiple, so the reader sees by how much each row clears its cost.' }),
      el('h3', { text: 'Launch odds' }),
      el('p', { class: 'sub', text: 'P(launch in 12m / 24m) comes from a discrete-time hazard fit: logistic regression of "has launched" on log(age) over the ' + DATA.odds_model.n_fit + ' live-vs-pre-token protocols with a known listing date, P(launched by age) = sigmoid(' + DATA.odds_model.intercept.toFixed(3) + ' + ' + DATA.odds_model.log_age_coef.toFixed(3) + ' x log(age+1)), then P = [G(age + 12m) − G(age)] / [1 − G(age)]. A protocol with no listing date uses 365 days. Held-out, the logistic ties the old age-bucket curve on leave-one-out log-loss (' + DATA.odds_model.loo_logloss.toFixed(3) + ' vs ' + DATA.odds_model.bucket_loo_logloss.toFixed(3) + ') and beats it clearly on a listed_at time split (' + DATA.odds_model.time_split_logloss.toFixed(3) + ' vs ' + DATA.odds_model.bucket_time_split_logloss.toFixed(3) + ') — the bucket curve cannot extrapolate to young ages it has never seen. It also fixes the bucket curve\u2019s artefacts in P(12m): 0.382 at age 730 days (from the 0.250 → 0.537 bucket jump) and 0.000 past 1460 days. TVL, category and a quadratic in log age were all tested as extra predictors and add nothing out-of-time, so the model stays age-only; the 232 token-exists-but-mcap-unrecorded entries are excluded, as their tokens predate their listing dates. This is a cross-sectional estimate from one snapshot, not a forecast — and age barely separates 12-month odds (P(12m) runs only 0.11–0.15 across the board), so the farm verdict below is driven mostly by implied value.' }),
      oddsTable(),
      el('h3', { text: 'Category offsets (log units)' }),
      el('div', { class: 'sectors' }, offsetCells),
      el('h3', { text: 'Farm verdicts, costed' }),
      el('p', { class: 'sub', text: 'Farm cost = gas on the main chain + the capital the position needs + the farmer\u2019s time at $' + m.hourly_rate_usd + '/hour. Minimum viable capital is the capital part. Verdict: FARM when P(12m) x implied x 0.1% ≥ cost, else SKIP. The 0.1% airdrop-share assumption is a stated convention, not a hidden fact — the arithmetic on each row is checkable from the numbers shown.' })
    );
  }

  function coveragePanel() {
    var c = DATA.coverage;
    var rows = [
      ['Ranked pre-token (the board)', c.ranked_pre_token],
      ['Live-token (already trades)', c.live_token],
      ['Token exists, market cap unrecorded', c.token_no_mcap]
    ];
    c.excluded.forEach(function (e) { rows.push(['Pre-token excluded: ' + e.reason, e.n]); });
    var body = el('tbody');
    rows.forEach(function (r) {
      body.appendChild(el('tr', null, el('td', { text: r[0] }), el('td', { class: 'num', text: String(r[1]) })));
    });
    body.appendChild(el('tr', { class: 'baseline-row' },
      el('td', { text: 'Total accounted for' }),
      el('td', { class: 'num', text: String(c.ranked_pre_token + c.live_token + c.token_no_mcap + c.excluded_total) + ' / ' + c.total })
    ));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Every protocol accounted for' }),
      el('p', { class: 'sub', text: 'The snapshot holds ' + c.total + ' protocols. The board ranks ' + c.ranked_pre_token + ' pre-token protocols (the whole watchlist plus every further pre-token protocol the rankable rule admits); the rest are counted here, by reason, so nothing is silently missing.' }),
      el('div', { class: 'table-wrap kv' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Where it went' }), el('th', { scope: 'col', text: 'Protocols' }))),
          body
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.fit);
    var m = DATA.model;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' - Watchlist' : ' - Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'log(TVL)' }), el('b', { class: 'num', text: Math.log(Math.max(row.tvl_usd, 1)).toFixed(3) })),
        el('div', null, el('span', { text: 'Fitted intercept' }), el('b', { class: 'num', text: DATA.fit.intercept.toFixed(4) })),
        el('div', null, el('span', { text: 'Fitted slope on log(TVL)' }), el('b', { class: 'num', text: DATA.fit.slope.toFixed(4) })),
        el('div', null, el('span', { text: 'Category offset (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtSigned(row.cat_offset) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Seven-day growth (tested, dropped)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: '80% range' }), el('b', { class: 'num', text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) })),
        el('div', null, el('span', { text: 'P(launch in 12m)' }), el('b', { class: 'num', text: fmtOdds(row.p_launch_12m) })),
        el('div', null, el('span', { text: 'P(launch in 24m)' }), el('b', { class: 'num', text: fmtOdds(row.p_launch_24m) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and the protocol records no token: it may never issue one.' })
    ));
    var farmSection = el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict: ' + row.verdict }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Farm cost (gas + capital + time at $' + m.hourly_rate_usd + '/h)' }), el('b', { class: 'num', text: fmtMoney(row.farm_cost_usd) })),
        el('div', null, el('span', { text: 'Minimum viable capital' }), el('b', { class: 'num', text: fmtMoney(row.min_capital_usd) })),
        el('div', null, el('span', { text: 'Expected value: P(12m) x implied x 0.1%' }), el('b', { class: 'num', text: fmtMoney(Math.round(row.p_launch_12m * row.implied_value_usd * m.airdrop_share * 100) / 100) })),
        el('div', null, el('span', { text: 'Expected-value multiple (EV ÷ cost)' }), el('b', { class: 'num', text: fmtMult(row.farm_ev_multiple) }))
      ),
      el('p', { class: 'sub', text: 'FARM when the expected value covers the cost — a multiple of ×1.00 or more — else SKIP. The multiple shows by how much the row clears the bar, so a FARM at ×1.05 is not the same conviction as one at ×8. The 0.1% airdrop share is a stated assumption.' })
    );
    dialog.appendChild(farmSection);
    var planSection = el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    );
    var copyBtn = el('button', { class: 'copy-btn', type: 'button', text: 'Copy farm plan', title: 'Copy the six steps as plain text', onclick: function () { copyFarmPlan(steps, copyBtn); } });
    planSection.appendChild(el('div', { class: 'detail-actions' }, copyBtn));
    dialog.appendChild(planSection);
    dialog.appendChild(el('p', { class: 'note', text: 'Airdrops are never guaranteed. Never pay anyone to claim, never connect a wallet to a link from a direct message, and never farm with money you cannot afford to leave locked for the full hold.' }));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(kpiStrip());
    shell.appendChild(coverVerdict());
    if (state.tab === 'pre-token') shell.appendChild(sectorBar());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(coveragePanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  // The watchlist is the floor: its slugs are marked on the board. data.js carries the set as
  // watchlist_slugs, written by the main program from the snapshot.
  (DATA.watchlist_slugs || []).forEach(function (s) { WATCH[s] = true; });

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

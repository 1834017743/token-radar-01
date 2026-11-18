// Token Radar — the dashboard's only script. No framework, no fetch, no network.
//
// window.RADAR arrives from data.js (written by main.ts from the same board as board.json):
//   { as_of, floor_usd, model, model_version, watchlist_size, board_size, early_size,
//     live_size, total_tvl_usd, total_implied_usd, rows[], live[] }
// A row carries rank, slug, name, category, chains, tvl_usd, change_7d, listed_at, age_days,
// implied_value_usd, token_status, model {class, multiple, growth_pct, growth_multiplier,
// age_multiplier, age_days, base_usd} and farm_steps[].
//
// Views: the board (#/ or empty hash) and one protocol's detail (#/protocol/<slug>).
// Filters may also arrive as query parameters (?category=&chain=&class=&sort=&watchlist=1&q=),
// so a filtered view is a plain link. renderBoard, renderDetail and renderLive do the drawing;
// applyFilters is the single place a row passes or fails the current controls.

(function () {
  'use strict';

  var RADAR = window.RADAR || { rows: [], live: [] };
  var rows = RADAR.rows || [];
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var $ = function (id) { return document.getElementById(id); };
  var boardBody = $('board-body');
  var liveBody = $('live-body');

  /* ---------- formatting ---------- */

  /** $1,234,567,890 -> $1.23B; $456,000,000 -> $456.0M; small values stay whole. */
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function moneyFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + s + '</span>';
  }

  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return (days / 30).toFixed(1) + 'mo';
    return (days / 365.25).toFixed(1) + 'y';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var CLASS_LABEL = { curator: 'Vault curator', operating: 'Operating', chain: 'Chain' };

  /* ---------- header and stats ---------- */

  function renderHeader() {
    var wl = RADAR.watchlist_size || 0;
    $('snap-line').textContent =
      'Snapshot: DefiLlama protocols, ' + (RADAR.as_of || '') +
      ' · ' + rows.length + ' protocols ranked · ' + wl + ' on the watchlist · model ' +
      (RADAR.model_version || '');
    var stats = [
      { k: 'Protocols ranked', v: String(rows.length), s: wl + ' watchlist + ' + (rows.length - wl) + ' early' },
      { k: 'Combined TVL', v: money(RADAR.total_tvl_usd), s: 'of the ranked protocols' },
      { k: 'Combined implied value', v: money(RADAR.total_implied_usd), s: 'what the board says the tokens would be worth' },
      { k: 'Top implied value', v: rows.length ? money(rows[0].implied_value_usd) : '—', s: rows.length ? rows[0].name : '' },
    ];
    $('stats').innerHTML = stats.map(function (st) {
      return '<div class="stat"><div class="k">' + esc(st.k) + '</div><div class="v">' + esc(st.v) +
        '</div><div class="s">' + esc(st.s) + '</div></div>';
    }).join('');
  }

  /* ---------- filter controls ---------- */

  function fillSelect(el, values, label) {
    var seen = {};
    values.forEach(function (v) { if (v) seen[v] = true; });
    var opts = Object.keys(seen).sort().map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    });
    el.innerHTML = '<option value="">' + label + '</option>' + opts.join('');
  }

  function readParams() {
    var p = new URLSearchParams(window.location.search);
    if (p.get('category')) $('f-category').value = p.get('category');
    if (p.get('chain')) $('f-chain').value = p.get('chain');
    if (p.get('class')) $('f-class').value = p.get('class');
    if (p.get('sort')) $('f-sort').value = p.get('sort');
    if (p.get('watchlist') === '1') $('f-watchlist').checked = true;
    if (p.get('q')) $('q').value = p.get('q');
  }

  function currentFilters() {
    return {
      q: $('q').value.trim().toLowerCase(),
      category: $('f-category').value,
      chain: $('f-chain').value,
      cls: $('f-class').value,
      sort: $('f-sort').value,
      watchlistOnly: $('f-watchlist').checked,
    };
  }

  /** One place decides whether a row survives the current controls. */
  function applyFilters(list, f) {
    var out = list.filter(function (r) {
      if (f.watchlistOnly && !(RADAR.watchlist || []).includes(r.slug)) return false;
      if (f.category && r.category !== f.category) return false;
      if (f.chain && !(r.chains || []).indexOf(f.chain) >= 0) return false;
      if (f.cls && r.model.class !== f.cls) return false;
      if (f.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(f.q) < 0) return false;
      return true;
    });
    var key = f.sort || 'implied';
    var sorted = out.slice();
    if (key === 'tvl') sorted.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (key === 'growth') sorted.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (key === 'age') sorted.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else sorted.sort(function (a, b) { return a.rank - b.rank; });
    return sorted;
  }

  /* ---------- board ---------- */

  function classBadge(r) {
    return '<span class="cls ' + r.model.class + '">' + CLASS_LABEL[r.model.class] + '</span>';
  }

  function renderBoard() {
    var f = currentFilters();
    var list = applyFilters(rows, f);
    $('row-count').textContent = list.length + ' of ' + rows.length + ' protocols' +
      (f.watchlistOnly ? ' (watchlist only)' : '');
    boardBody.innerHTML = list.map(function (r) {
      var wl = (RADAR.watchlist || []).includes(r.slug) ? '<span class="badge">WATCHLIST</span>' : '';
      var chains = (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + (r.chains.length - 3) : '');
      return '<tr class="row' + (r.rank <= 3 ? ' top3' : '') + '" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + wl + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + classBadge(r) + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(chains || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num imp">' + money(r.implied_value_usd) + '</td>' +
        '</tr>';
    }).join('');
  }

  boardBody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) window.location.hash = '#/protocol/' + tr.getAttribute('data-slug');
  });

  /* ---------- detail ---------- */

  /** Split one "text Cost: … Time: …" farm step back into its parts for display. */
  function splitStep(s) {
    var m = s.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/);
    if (!m) return { text: s, cost: '', time: '' };
    return { text: m[1], cost: m[2], time: m[3] };
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    var view = $('detail-view');
    var box = $('detail');
    if (!r) {
      box.innerHTML = '<p>Unknown protocol: ' + esc(slug) + '. <a href="#/">Back to the board</a></p>';
      view.hidden = false;
      $('board-view').hidden = true;
      $('board-controls').hidden = true;
      return;
    }
    var m = r.model;
    var wl = (RADAR.watchlist || []).includes(r.slug);
    var steps = (r.farm_steps || []).map(function (s) {
      var p = splitStep(s);
      return '<li>' + esc(p.text) +
        '<span class="meta">Cost: <b>' + esc(p.cost) + '</b> · Time: <b>' + esc(p.time) + '</b></span></li>';
    }).join('');
    box.innerHTML =
      '<div class="detail-head"><h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      (wl ? '<span class="badge">WATCHLIST</span>' : '') + classBadge(r) + '</div>' +
      '<p class="detail-meta">' + esc(r.slug) + ' · ' + esc(r.category || 'No category') + ' · ' +
      esc((r.chains || []).join(', ') || 'No chains listed') + ' · Listed ' + esc(r.listed_at || 'date unknown') +
      ' · Records no token.</p>' +
      '<div class="detail-grid">' +
      '<div class="card"><h3>Implied value — how the model gets there</h3>' +
      '<p class="formula">' + moneyFull(r.tvl_usd) + ' TVL × ' + m.multiple.toFixed(2) + ' ' + CLASS_LABEL[m.class] +
      ' multiple × ' + m.growth_multiplier.toFixed(2) + ' growth × ' + m.age_multiplier.toFixed(2) + ' age<br>= <b>' +
      moneyFull(r.implied_value_usd) + '</b></p>' +
      '<table class="factors"><tbody>' +
      '<tr><td>TVL</td><td>' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Class multiple (' + CLASS_LABEL[m.class] + ')</td><td>× ' + m.multiple.toFixed(2) + '</td></tr>' +
      '<tr><td>Base value</td><td>' + moneyFull(m.base_usd) + '</td></tr>' +
      '<tr><td>7-day TVL change</td><td>' + (r.change_7d === null ? 'not reported (× 1.00)' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '% → × ' + m.growth_multiplier.toFixed(2)) + '</td></tr>' +
      '<tr><td>Time without a token</td><td>' + (m.age_days === null ? 'unknown (× 1.00)' : ageText(m.age_days) + ' → × ' + m.age_multiplier.toFixed(2)) + '</td></tr>' +
      '<tr><td><b>Implied value</b></td><td><b>' + moneyFull(r.implied_value_usd) + '</b></td></tr>' +
      '</tbody></table></div>' +
      '<div class="card"><h3>Farm plan — ' + (r.farm_steps || []).length + ' steps</h3>' +
      '<ol class="steps">' + steps + '</ol></div>' +
      '</div>' +
      '<p class="muted">This protocol records no token in the snapshot. That is a record, not proof, and the implied value is this radar\'s own claim, not a prediction that a token will be issued.</p>';
    view.hidden = false;
    $('board-view').hidden = true;
    $('board-controls').hidden = true;
    window.scrollTo(0, 0);
  }

  /* ---------- live view ---------- */

  function renderLive() {
    var live = RADAR.live || [];
    liveBody.innerHTML = live.map(function (p) {
      return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num imp">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    }).join('');
  }

  /* ---------- routing ---------- */

  function route() {
    var hash = window.location.hash || '#/';
    var m = hash.match(/^#\/protocol\/([A-Za-z0-9._-]+)/);
    if (m) { renderDetail(m[1]); return; }
    $('detail-view').hidden = true;
    $('board-view').hidden = false;
    $('board-controls').hidden = false;
    renderBoard();
  }

  /* ---------- boot ---------- */

  fillSelect($('f-category'), rows.map(function (r) { return r.category; }), 'All categories');
  var allChains = [];
  rows.forEach(function (r) { (r.chains || []).forEach(function (c) { allChains.push(c); }); });
  fillSelect($('f-chain'), allChains, 'All chains');
  readParams();
  renderHeader();
  renderLive();
  ['q', 'f-category', 'f-chain', 'f-class', 'f-sort', 'f-watchlist'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
    $(id).addEventListener('change', renderBoard);
  });
  window.addEventListener('hashchange', route);
  route();
})();

'use strict';
/* =====================================================================
   ASX ARCADE – TEACHER DASHBOARD (master.html)
   This page is the "host" of a live room (like a Kahoot PIN):
   - It owns the GAME CLOCK. Only this page can start / pause time.
   - Students connect to it with the class code (PeerJS, no accounts) and send
     their trade log. This page re-calculates every score from the trade logs.
   - It saves the clock and the students' trades in this browser, so the same
     class code continues the same game next lesson (open this page on the same computer).
   - ?demo=1 shows pretend students (no connection) so you can preview the layout.
   ===================================================================== */

const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const H = {
  code: '', MK: null, g: START_GMIN, run: false, ended: false, autoPause: false, showRank: false,
  peer: null, conns: new Map(), players: new Map(), rows: [], charts: {}, detailKey: null,
  news: null, retries: 0, lastSave: 0, lastRank: 0, custom: []   // custom = events written on the Event desk
};
const LAST_KEY = 'asxArcade.teacher.class';
const hostKey = code => 'asxArcade.host3.' + code;

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || ''); el.textContent = msg;
  $('toast-layer').appendChild(el); setTimeout(() => el.remove(), 4500);
}
function studentLink(code) {
  const u = new URL('index.html', location.href); u.search = ''; u.hash = ''; u.searchParams.set('class', code);
  return u.toString();
}
function cleanCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }

/* ---------- saving (this browser only) ---------- */
function persist(force) {
  const now = Date.now(); if (!force && now - H.lastSave < 4000) return; H.lastSave = now;
  if (DEMO || !H.code) return;
  const pl = {}; H.players.forEach((p, k) => { pl[k] = { n: p.name, tr: p.tr }; });
  try { localStorage.setItem(hostKey(H.code), JSON.stringify({ g: H.g, auto: H.autoPause, rank: H.showRank, end: H.ended, ev: H.custom, pl })); } catch (e) { }
}
function restore() {
  let o = null; try { o = JSON.parse(localStorage.getItem(hostKey(H.code)) || 'null'); } catch (e) { }
  if (!o) return;
  if (Number.isFinite(o.g) && o.g >= START_GMIN && o.g < 1e8) H.g = o.g;
  H.autoPause = !!o.auto; H.showRank = !!o.rank; H.ended = !!o.end; H.custom = cleanCustomEvents(o.ev);
  Object.entries(o.pl || {}).forEach(([k, v]) => {
    try { const trades = parseTrades(v.tr || ''); H.players.set(k, { name: String(v.n).slice(0, 20), tr: v.tr || '', trades, seenMs: 0, connected: false }); } catch (e) { }
  });
}

/* ---------- messages to students ---------- */
function clockMsg() { return { t: 'clock', g: H.g, run: H.run, rank: H.showRank, end: H.ended }; }
function broadcastEvents() { const m = { t: 'events', list: H.custom }; H.conns.forEach(c => { try { c.send(m); } catch (e) { } }); }
function broadcast() { const m = clockMsg(); H.conns.forEach(c => { try { c.send(m); } catch (e) { } }); }
function sendRanks() {
  if (!H.showRank && !H.ended) return;
  const n = H.rows.length, top = H.rows.slice(0, 3).map(r => ({ n: r.p.name, nw: Math.round(r.nw * 100) / 100 }));
  H.rows.forEach((r, i) => {
    const c = H.conns.get(r.key); if (!c) return;
    const nw = Math.round(r.nw * 100) / 100;
    try { c.send(H.ended ? { t: 'final', rank: i + 1, of: n, nw, top } : { t: 'rank', rank: i + 1, of: n, nw }); } catch (e) { }
  });
}

/* ---------- the room (PeerJS) ---------- */
function setRoomChip(kind, text) { const el = $('room-chip'); el.className = 'pill ' + kind; el.textContent = text; }
function acceptTrades(pl, str) {
  try {
    const t = parseTrades(str || '');
    if (t.length >= pl.trades.length) { pl.trades = t; pl.tr = encodeTrades(t); return true; }
  } catch (e) { }
  return false;
}
function onConn(conn) {
  let key = null;
  conn.on('data', d => {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hi') {
      if (d.v !== PROTO) { try { conn.send({ t: 'old' }); } catch (e) { } return; }   // an old cached student page
      const name = String(d.name || '').trim().replace(/\s+/g, ' ');
      if (!NAME_RE.test(name)) { try { conn.send({ t: 'err', m: 'name' }); } catch (e) { } return; }
      key = name.toLowerCase();
      const old = H.conns.get(key);
      if (old && old !== conn) { try { old.send({ t: 'replaced' }); } catch (e) { } setTimeout(() => { try { old.close(); } catch (e) { } }, 300); }
      H.conns.set(key, conn);
      let pl = H.players.get(key);
      if (!pl) { pl = { name, tr: '', trades: [], seenMs: 0, connected: true }; H.players.set(key, pl); }
      pl.name = name; pl.connected = true; pl.seenMs = Date.now();
      if (!H.ended) acceptTrades(pl, d.tr);                // scores are locked once the market has ended
      try { conn.send({ ...clockMsg(), t: 'welcome', v: PROTO, tr: pl.tr, ev: H.custom }); } catch (e) { }
      if (H.ended) { H.rows = computeRows(); sendRanks(); }
      persist(true); render();
    } else if (d.t === 'tr' && key) {
      const pl = H.players.get(key); if (!pl) return;
      pl.seenMs = Date.now(); pl.connected = true; if (!H.ended) acceptTrades(pl, d.tr);
      persist(); render();
    } else if (d.t === 'ping' && key) {
      const pl = H.players.get(key); if (pl) { pl.seenMs = Date.now(); pl.connected = true; }
    }
  });
  const gone = () => {
    if (key && H.conns.get(key) === conn) { H.conns.delete(key); const pl = H.players.get(key); if (pl) pl.connected = false; render(); }
  };
  conn.on('close', gone); conn.on('error', gone);
}
function openPeer() {
  if (typeof Peer === 'undefined') { setRoomChip('warn', '⚠ Could not load the connection library (internet?)'); $('room-msg').textContent = 'The page could not load PeerJS. Check the internet connection and refresh.'; return; }
  setRoomChip('', '⏳ Opening the room…');
  const peer = H.peer = new Peer(hostPeerId(H.code));
  peer.on('open', () => { H.retries = 0; setRoomChip('ok', '🟢 Room open'); $('room-msg').textContent = 'Room is open. Students can join now.'; });
  peer.on('connection', onConn);
  peer.on('disconnected', () => { setRoomChip('warn', '⚠ Reconnecting…'); try { peer.reconnect(); } catch (e) { } });
  peer.on('error', err => {
    if (err.type === 'unavailable-id') {
      if (H.peer !== peer) return;
      H.retries++;
      if (H.retries > 12) { setRoomChip('warn', '⚠ Code already in use'); $('room-msg').textContent = 'This class code is already open somewhere else (another tab or computer). Close that one, or use a different code.'; return; }
      setRoomChip('warn', `⏳ Code busy… retrying (${H.retries})`); $('room-msg').textContent = 'If you just refreshed, the old room can take a few seconds to clear. Retrying…';
      try { peer.destroy(); } catch (e) { }
      setTimeout(openPeer, 4000);
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
      setRoomChip('warn', '⚠ Connection problem'); $('room-msg').textContent = 'Cannot reach the connection server. Check this computer is online. Students already connected may keep working.';
    }
  });
}
function openRoom(code) {
  H.code = code; H.MK = makeMarket(code); H.players = new Map(); H.conns = new Map(); H.g = START_GMIN; H.run = false; H.custom = [];
  restore();
  if (H.custom.length) H.MK.setCustom(H.custom);
  try { localStorage.setItem(LAST_KEY, code); } catch (e) { }
  $('gate').classList.add('is-hidden'); $('dash').classList.remove('is-hidden');
  $('pin').textContent = code; $('student-link').value = studentLink(code);
  $('chk-autopause').checked = H.autoPause; $('chk-showrank').checked = H.showRank;
  H.MK.ensure(posOf(H.g).day); updateNewsBar();
  if (DEMO) { $('demo-chip').classList.remove('is-hidden'); setRoomChip('warn', 'Preview (no real room)'); H.players = demoPlayers(); }
  else openPeer();
  try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => { }); } catch (e) { }
  render(); updateClockUi(); renderSent();
  if (H.ended) showFinal();
}

/* ---------- demo students ---------- */
function demoPlayers() {
  const rng = mulberry32(42), names = ['Ava K', 'Ben T', 'Chloe M', 'Dan P', 'Ella R', 'Finn S', 'Grace L', 'Harry W', 'Isla N', 'Jack B', 'Kai D', 'Lily H', 'Mia C', 'Noah F', 'Olivia G', 'Ryan J', 'Sophie V', 'Tom Y'];
  const map = new Map();
  names.forEach((name, i) => {
    const trades = [], n = 1 + Math.floor(rng() * 5);
    const picks = STOCKS.map(s => s.sym).sort(() => rng() - .5).slice(0, n);
    picks.forEach(sym => {
      const px = H.MK.price(sym, 0, 0), spend = (30000 + rng() * 15000) / n;
      trades.push({ day: 0, tick: 0, sym, side: 'B', qty: Math.max(1, Math.floor(spend / px)) });
    });
    map.set(name.toLowerCase(), { name, trades, tr: encodeTrades(trades), seenMs: Date.now(), connected: i < 16 });
  });
  return map;
}

/* ---------- the clock ---------- */
function updateNewsBar() {
  const pos = posOf(H.g); let found = null;
  for (let d = pos.day; d >= 0 && !found; d--) { const e = H.MK.events[d]; if (e && d * KEYMUL + e.tick <= posKey(pos)) found = e; }
  H.news = found;
  $('news-now').textContent = found ? `📰 ${found.custom ? 'YOUR NEWS' : 'NEWS'} (${shortDate(found.day)} ${tickTime(found.tick)}): ${found.ev.icon} ${found.ev.title}. ${found.ev.text}` : '📰 NEWS: Nothing yet.';
}
function setRun(run, why) {
  if (H.ended) return;
  H.run = run; persist(true); updateClockUi(why); broadcast();
}
/* ---------- MARKET END: finish the game and show the final leaderboard ---------- */
function endGame() {
  if (H.ended) { showFinal(); return; }
  if (!confirm('End the market now? The clock stops for everyone and the final leaderboard is shown. You can reopen the market afterwards.')) return;
  H.run = false; H.ended = true; persist(true); render(); updateClockUi(); broadcast(); sendRanks(); showFinal();
}
function reopenMarket() {
  H.ended = false; H.run = false; persist(true); $('final-modal').classList.add('is-hidden'); render(); updateClockUi(); broadcast();
}
function showFinal() {
  H.rows = computeRows();
  const medals = ['🥇', '🥈', '🥉'], cls3 = ['p1', 'p2', 'p3'];
  const order = [1, 0, 2].filter(i => H.rows[i]);          // 2nd, 1st, 3rd (podium shape)
  $('podium').innerHTML = order.map(i => `<div class="pod ${cls3[i]}"><div class="medal">${medals[i]}</div><div class="nm">${esc(H.rows[i].p.name)}</div><div class="nw">${money(H.rows[i].nw)}</div></div>`).join('') || '<p class="dim">No students played.</p>';
  $('final-body').innerHTML = H.rows.map((r, i) => {
    const diff = r.nw - START_CASH;
    return `<tr><td>${medals[i] || (i + 1)}</td><td><b>${esc(r.p.name)}</b></td><td class="num">${money(r.nw)}</td><td class="num ${cls(diff)}">${arrow(diff)} ${pctText(diff / START_CASH)}</td><td>${'⭐'.repeat(r.nSec) || '<span class="dim">none</span>'}</td></tr>`;
  }).join('');
  $('final-modal').classList.remove('is-hidden');
}
function tickClock(dt) {
  if (!H.run) return;
  const oldPos = posOf(H.g);
  let ng = advanceG(H.g, dt);
  const newPos = posOf(ng);
  H.MK.ensure(newPos.day + 1);
  let paused = false;
  if (H.autoPause) {
    const e = eventBetween(H.MK, oldPos, newPos);
    if (e) { ng = gOfPos(e.day, e.tick); H.run = false; paused = true; }
  }
  H.g = ng;
  if (posKey(posOf(ng)) !== posKey(oldPos) || paused) { updateNewsBar(); render(); }
  updateClockUi(paused ? 'news' : '');
  if (paused) { broadcast(); persist(true); }
}
function updateClockUi(why) {
  const g = H.g, d = gDate(g), m = g - calDay(g) * 1440, open = isOpen(g), pos = posOf(g);
  $('g-date').textContent = `${dayName(d)} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${timeText(Math.floor(m))}`;
  $('g-sub').textContent = `Market day ${pos.day} · ${open ? 'market open' : 'market closed'}`;
  $('g-progress').style.width = (open ? (m - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN) * 100 : (m >= CLOSE_MIN ? 100 : 0)) + '%';
  const st = $('g-state');
  st.className = 'pill ' + (H.run ? 'open' : 'closed');
  st.textContent = H.run ? '▶ RUNNING' : (why === 'news' ? '⏸ PAUSED – big news! Talk about it, then press start.' : '⏸ PAUSED');
  const b = $('btn-run');
  b.textContent = H.run ? '⏸ PAUSE THE CLOCK' : '▶ START THE CLOCK';
  b.className = 'btn big ' + (H.run ? 'btn-sell' : 'btn-buy');
  b.disabled = H.ended;
  if (H.ended) { st.className = 'pill closed'; st.textContent = '🏁 MARKET ENDED – game over'; }
  $('btn-end').classList.toggle('is-hidden', H.ended); $('btn-final').classList.toggle('is-hidden', !H.ended);
}

/* ---------- calculating ---------- */
function computeRows() {
  const pos = posOf(H.g);
  H.MK.ensure(pos.day);
  return [...H.players.entries()].map(([key, p]) => {
    const acc = computeAccount(p.trades, pos, H.MK);
    const nSec = SECTORS.filter(sec => STOCKS.some(s => s.sector === sec && acc.qty[s.sym] > 0)).length;
    return { key, p, acc, pos, nw: acc.nw, nSec, cashPct: acc.nw > 0 ? Math.max(0, (acc.cash + acc.pendingSum) / acc.nw) : 0 };
  }).sort((a, b) => b.nw - a.nw);
}

/* ---------- rendering ---------- */
function render() {
  H.rows = computeRows();
  renderKpis(); renderTable(); renderInsights();
  if (H.detailKey) renderDetail();
}
function renderKpis() {
  const rows = H.rows, n = rows.length;
  $('k-count').textContent = n;
  $('k-active').textContent = `${rows.filter(r => r.p.connected).length} online now`;
  if (!n) {
    ['k-leader', 'k-avg', 'k-spread'].forEach(id => { $(id).textContent = '–'; });
    ['k-leader-nw', 'k-avg-diff'].forEach(id => { $(id).innerHTML = '&nbsp;'; });
    return;
  }
  $('k-leader').textContent = rows[0].p.name; $('k-leader-nw').textContent = money(rows[0].nw);
  const avg = rows.reduce((a, r) => a + r.nw, 0) / n, diff = avg - START_CASH;
  $('k-avg').textContent = money(avg);
  const d = $('k-avg-diff'); d.className = 'stat-sub ' + cls(diff); d.textContent = `${arrow(diff)} ${pctText(diff / START_CASH)} since start`;
  $('k-spread').textContent = (rows.reduce((a, r) => a + r.nSec, 0) / n).toFixed(1) + ' / ' + SECTORS.length;
}
function renderTable() {
  $('rank-empty').classList.toggle('is-hidden', H.rows.length > 0);
  const medals = ['🥇', '🥈', '🥉'];
  $('rank-body').innerHTML = H.rows.map((r, i) => {
    const diff = r.nw - START_CASH;
    return `<tr class="mrow clickable${r.p.connected ? '' : ' stale'}" data-key="${esc(r.key)}" tabindex="0" role="button">
      <td>${medals[i] || (i + 1)}</td><td><b>${esc(r.p.name)}</b></td>
      <td class="num">${money(r.nw)}</td><td class="num ${cls(diff)}">${arrow(diff)} ${pctText(diff / START_CASH)}</td>
      <td>${'⭐'.repeat(r.nSec) || '<span class="dim">none</span>'}</td>
      <td class="num hide-sm">${(r.cashPct * 100).toFixed(0)}%</td><td class="num hide-sm">${r.p.trades.length}</td>
      <td><span class="dot ${r.p.connected ? 'live' : 'old'}"></span>${r.p.connected ? 'online' : 'offline'}</td></tr>`;
  }).join('');
}
function renderInsights() {
  const sec = {}; SECTORS.forEach(s => { sec[s] = 0; });
  let cash = 0; const owners = {}; STOCKS.forEach(s => { owners[s.sym] = 0; });
  H.rows.forEach(r => {
    STOCKS.forEach(s => {
      const q = r.acc.qty[s.sym];
      if (q > 0) { sec[s.sector] += q * H.MK.price(s.sym, r.pos.day, r.pos.tick); owners[s.sym]++; }
    });
    cash += Math.max(0, r.acc.cash) + r.acc.pendingSum;
  });
  const labels = SECTORS.concat(['Cash']), data = SECTORS.map(s => sec[s]).concat([cash]);
  const colours = SECTORS.map(s => SECTOR_INFO[s].color).concat([CASH_COLOR]);
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#9fb0d6'; Chart.defaults.font.family = "'Lexend', system-ui, sans-serif";
    let c = H.charts.pie;
    if (!c) c = H.charts.pie = new Chart($('class-pie'), { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colours, borderColor: '#131c3a', borderWidth: 3 }] }, options: { maintainAspectRatio: false, animation: false, cutout: '55%', plugins: { legend: { display: false } } } });
    else { c.data.datasets[0].data = data; c.update('none'); }
  }
  const total = data.reduce((a, b) => a + b, 0) || 1;
  $('class-legend').innerHTML = labels.map((l, i) => `<li><span class="swatch" style="background:${colours[i]}"></span>${l === 'Cash' ? '💵' : SECTOR_INFO[l].icon} ${l}<span class="pc">${(data[i] / total * 100).toFixed(0)}%</span></li>`).join('');
  const top = STOCKS.map(s => ({ s, n: owners[s.sym] })).sort((a, b) => b.n - a.n).slice(0, 8), max = Math.max(1, top[0] ? top[0].n : 1);
  $('popular').innerHTML = top.every(t => t.n === 0) ? '<p class="dim">No shares owned yet.</p>' : top.map(t =>
    `<div class="bar-row"><span style="width:70px"><b class="sym">${t.s.sym}</b></span><div class="bar"><div style="width:${t.n / max * 100}%"></div></div><span style="width:100px;text-align:right;white-space:nowrap">${t.n} ${t.n === 1 ? 'student' : 'students'}</span></div>`).join('');
}
function renderDetail() {
  const r = H.rows.find(x => x.key === H.detailKey); if (!r) { closeDetail(); return; }
  $('d-title').textContent = r.p.name;
  $('d-summary').innerHTML = `Net worth <b>${money(r.nw)}</b> · cash ${money(r.acc.cash)} · pending ${money(r.acc.pendingSum)} · tax estimate ${money(r.acc.taxAll)}${r.acc.gainYear > 0.005 ? ` (${(r.acc.taxPct * 100).toFixed(1)}% of ${money(r.acc.gainYear)} profit)` : ''} · tax bill so far ${money(r.acc.taxEst)} · dividends received ${money(r.acc.divTotal)}`;
  const rows = STOCKS.filter(s => r.acc.qty[s.sym] > 0).map(s => {
    const q = r.acc.qty[s.sym], v = q * H.MK.price(s.sym, r.pos.day, r.pos.tick);
    return `<tr><td><span class="sym">${s.sym}</span> ${SECTOR_INFO[s.sector].icon}</td><td class="num">${q}</td><td class="num">${money(v)}</td></tr>`;
  });
  $('d-holdings').innerHTML = rows.join('') || '<tr><td colspan="3" class="dim">No shares owned.</td></tr>';
  $('d-log').innerHTML = r.acc.ledger.slice().reverse().slice(0, 15).map(e => {
    const t = `<span class="dim">${shortDate(e.day)}</span> `;
    if (e.type === 'buy') return `<li>${t}🛒 Bought ${e.qty} ${e.sym} @ ${money(e.price)}</li>`;
    if (e.type === 'sell') return `<li>${t}💰 Sold ${e.qty} ${e.sym} @ ${money(e.price)}</li>`;
    if (e.type === 'dividend') return `<li>${t}🎁 Dividend ${e.sym} +${money(e.amount)}</li>`;
    return `<li>${t}🧾 Tax Day ${money(e.amount)}</li>`;
  }).join('') || '<li class="dim">No activity.</li>';
}
function openDetail(key) { H.detailKey = key; renderDetail(); $('detail-modal').classList.remove('is-hidden'); }
function closeDetail() { H.detailKey = null; $('detail-modal').classList.add('is-hidden'); }

/* ---------- EVENT DESK: the teacher writes news and picks which sectors move ---------- */
const DESK = { fx: {} };
const LV_LABEL = { '-2': '▼▼', '-1': '▼', '0': '–', '1': '▲', '2': '▲▲' };
function buildDesk() {
  $('desk-preset').innerHTML = '<option value="">✍️ Write my own…</option>' + EVENT_PRESETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('');
  renderDeskSectors();
}
function renderDeskSectors() {
  $('desk-sectors').innerHTML = SECTORS.map(sec => {
    const cur = DESK.fx[sec] || 0;
    return `<div class="sec-row"><span class="sec-name">${SECTOR_INFO[sec].icon} ${sec}</span><div class="lv-group" role="group" aria-label="${sec}">` +
      [-2, -1, 0, 1, 2].map(l => `<button type="button" class="lv lv${l}${cur === l ? ' on' : ''}" data-sec="${sec}" data-lv="${l}" aria-pressed="${cur === l}" title="${sec}: ${l > 0 ? 'up' : l < 0 ? 'down' : 'no change'}${Math.abs(l) === 2 ? ' (big)' : ''}">${LV_LABEL[l]}</button>`).join('') + '</div></div>';
  }).join('');
}
function deskMsg(text, kind) { const e = $('desk-msg'); e.textContent = text; e.className = 'small-note ' + (kind || ''); }
/* the first free moment (10 AM or 1 PM of a day with no news) that is at least LEAD seconds of running time away */
function scheduleSlot() {
  const LEAD = 4, pos = posOf(H.g);
  H.MK.ensure(pos.day + 60);
  for (let d = pos.day; d < pos.day + 60; d++) {
    for (let t = 0; t < TICKS; t++) {
      if (d === 0 && t === 0) continue;
      if (H.MK.events[d]) continue;
      const eg = gOfPos(d, t);
      if (eg > H.g && realSecsBetween(H.g, eg) >= LEAD) return { day: d, tick: t };
    }
  }
  return null;
}
function setCustom(list) {
  H.custom = cleanCustomEvents(list); H.MK.setCustom(H.custom); H.MK.ensure(posOf(H.g).day + 1);
  persist(true); broadcastEvents(); updateNewsBar(); render(); renderSent();
}
function sendEvent() {
  const title = $('desk-title').value.trim(), fx = {};
  SECTORS.forEach(sec => { if (DESK.fx[sec]) fx[sec] = DESK.fx[sec]; });
  if (!title) return deskMsg('Please type a headline.', 'down');
  if (!Object.keys(fx).length) return deskMsg('Press an arrow ▲ or ▼ for at least one sector.', 'down');
  const slot = scheduleSlot(); if (!slot) return deskMsg('Could not find a time for the news. Try again.', 'down');
  const ev = cleanCustomEvents([{ ...slot, icon: $('desk-icon').value.trim() || '📢', title, text: $('desk-text').value, fx }]);
  if (!ev.length) return deskMsg('That event could not be used. Check the headline.', 'down');
  setCustom(H.custom.concat(ev));
  const secs = realSecsBetween(H.g, gOfPos(slot.day, slot.tick));
  deskMsg(H.run ? `✅ Sent! Students will see it in about ${Math.round(secs)} seconds.` : `✅ Sent! Students will see it ${Math.round(secs)} seconds after you press start.`, 'up');
  $('desk-title').value = ''; $('desk-text').value = ''; $('desk-preset').value = ''; DESK.fx = {}; renderDeskSectors();
}
function renderSent() {
  const list = $('desk-sent'); if (!list) return;
  const pos = posOf(H.g);
  list.innerHTML = H.custom.length ? H.custom.map(c => {
    const shown = c.day * KEYMUL + c.tick <= posKey(pos), secs = realSecsBetween(H.g, gOfPos(c.day, c.tick));
    const chips = Object.entries(c.fx).map(([sec, m]) => `<span class="sent-chip ${m > 0 ? 'up' : 'down'}">${SECTOR_INFO[sec].icon} ${'▲▼'[m > 0 ? 0 : 1].repeat(Math.abs(m))}</span>`).join('');
    const status = shown ? '✅ shown to students' : (H.run ? `⏳ in about ${Math.round(secs)} s` : '⏳ waiting for you to press start');
    const cancel = !shown && secs >= 2 ? ` <button class="btn btn-sell small" data-cancel="${c.day}">✖ Cancel</button>` : '';
    return `<li>${esc(c.icon)} <b>${esc(c.title)}</b> ${chips}<br><span class="dim">${shortDate(c.day)} ${tickTime(c.tick)} · ${status}</span>${cancel}</li>`;
  }).join('') : '<li class="dim">None yet.</li>';
}
function wireDesk() {
  buildDesk();
  $('desk-preset').addEventListener('change', e => {
    const p = EVENT_PRESETS[e.target.value]; if (!p) return;
    $('desk-icon').value = p.icon; $('desk-title').value = p.title; $('desk-text').value = p.text; DESK.fx = { ...p.fx }; renderDeskSectors();
  });
  $('desk-sectors').addEventListener('click', e => {
    const b = e.target.closest('button[data-sec]'); if (!b) return;
    DESK.fx[b.dataset.sec] = Number(b.dataset.lv); renderDeskSectors();
  });
  $('desk-clear').addEventListener('click', () => { $('desk-title').value = ''; $('desk-text').value = ''; $('desk-preset').value = ''; $('desk-icon').value = '📢'; DESK.fx = {}; renderDeskSectors(); deskMsg(''); });
  $('desk-send').addEventListener('click', sendEvent);
  $('desk-sent').addEventListener('click', e => {
    const b = e.target.closest('button[data-cancel]'); if (!b) return;
    const day = Number(b.dataset.cancel), c = H.custom.find(x => x.day === day);
    if (!c || realSecsBetween(H.g, gOfPos(c.day, c.tick)) < 2) { renderSent(); return; }
    setCustom(H.custom.filter(x => x.day !== day)); deskMsg('Event cancelled.');
  });
}

/* ---------- buttons ---------- */
function downloadCsv() {
  const head = ['Rank', 'Student', 'Net worth', 'Change %', 'Sectors owned', 'Cash %', 'Trades'];
  const lines = [head.join(',')].concat(H.rows.map((r, i) => [
    i + 1, '"' + r.p.name.replace(/"/g, '""') + '"', r.nw.toFixed(2), ((r.nw / START_CASH - 1) * 100).toFixed(2), r.nSec, (r.cashPct * 100).toFixed(0), r.p.trades.length
  ].join(',')));
  const text = lines.join('\n');
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `ranking-${H.code || 'class'}.csv`; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { }
}
function randomCode() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789'; let s = ''; for (let i = 0; i < 3; i++) s += L[Math.floor(Math.random() * L.length)]; for (let i = 0; i < 2; i++) s += D[Math.floor(Math.random() * D.length)]; return s; }
function wire() {
  wireDesk();
  $('btn-random').addEventListener('click', () => { $('in-class').value = randomCode(); });
  const go = () => {
    const code = cleanCode($('in-class').value);
    if (code.length < 3) { const e = $('gate-error'); e.textContent = 'Class code: 3 to 12 letters or numbers.'; e.classList.remove('is-hidden'); return; }
    openRoom(code);
  };
  $('btn-open').addEventListener('click', go);
  $('in-class').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('btn-copy-link').addEventListener('click', () => {
    const v = $('student-link').value;
    if (navigator.clipboard && /^http/.test(v)) navigator.clipboard.writeText(v).then(() => toast('📋 Student link copied!', 'good'), () => toast('Select the link and copy it.', 'bad'));
    else toast('Select the link and copy it.', 'bad');
  });
  $('btn-run').addEventListener('click', () => setRun(!H.run));
  $('chk-autopause').addEventListener('change', e => { H.autoPause = e.target.checked; persist(true); });
  $('chk-showrank').addEventListener('change', e => { H.showRank = e.target.checked; persist(true); broadcast(); if (H.showRank) sendRanks(); });
  $('btn-csv').addEventListener('click', downloadCsv);
  $('f-csv').addEventListener('click', downloadCsv);
  $('btn-end').addEventListener('click', endGame);
  $('btn-final').addEventListener('click', showFinal);
  $('f-reopen').addEventListener('click', reopenMarket);
  $('f-close').addEventListener('click', () => $('final-modal').classList.add('is-hidden'));
  const open = e => { const tr = e.target.closest('tr[data-key]'); if (tr) openDetail(tr.dataset.key); };
  $('rank-body').addEventListener('click', open);
  $('rank-body').addEventListener('keydown', e => { if (e.key === 'Enter') open(e); });
  document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', closeDetail));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); $('final-modal').classList.add('is-hidden'); } });
  $('d-remove').addEventListener('click', () => {
    const r = H.rows.find(x => x.key === H.detailKey); if (!r) return;
    if (!confirm(`Remove ${r.p.name} from the class? Their game data will be deleted.`)) return;
    const c = H.conns.get(r.key); if (c) { try { c.send({ t: 'removed' }); setTimeout(() => c.close(), 300); } catch (e) { } H.conns.delete(r.key); }
    H.players.delete(r.key); persist(true); closeDetail(); render();
  });

  // the clock and the "heartbeat"
  let last = performance.now();
  setInterval(() => {
    const now = performance.now(); let dt = (now - last) / 1000; last = now;
    if (dt > 5) dt = 5;                     // if the computer slept, do not jump ahead
    tickClock(dt);
  }, 250);
  setInterval(() => { if (H.code) { broadcast(); persist(); renderSent(); } }, 1000);
  setInterval(() => { if (H.code) { render(); sendRanks(); } }, 3000);
  window.addEventListener('beforeunload', () => persist(true));

  const saved = (() => { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } })();
  if (DEMO) { openRoom('COM9A'); }
  else if (saved) $('in-class').value = saved; else $('in-class').value = randomCode();
}

document.addEventListener('DOMContentLoaded', wire);

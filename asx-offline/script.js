'use strict';
/* =====================================================================
   ASX ARCADE – STUDENT GAME  (uses engine.js for all the rules)
   - Saves the game in this browser (localStorage).
   - Joins the teacher's live room with the class code (PeerJS, no accounts) and sends
     the trade log. The TEACHER owns the clock: students only follow it, they cannot
     start, stop or speed up time.
   ===================================================================== */

const SAVE_KEY = 'asxArcade.v3';
const LINK_CLASS = (new URLSearchParams(location.search).get('class') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

const TAXDAY_MIN = YEAR_DAYS * SECONDS_PER_MARKET_DAY / 60;   // minutes between Tax Days
const GLOSSARY = [
  ['Net worth', 'All your money added up: cash + shares + pending money, minus the tax you would owe.'],
  ['Share', 'A small piece of a company. If the company does well, your share can go up ▲.'],
  ['Sector', 'A group of similar companies. Example: Banking, Mining, Gold, Tech.'],
  ['Diversify', 'Spread your money over many sectors so one bad day does not hurt too much. (Do not put all your eggs in one basket.)'],
  ['Market order', 'Buy or sell right now at the price you see.'],
  ['Brokerage', `A small fee (${money(BROKERAGE)}) you pay each time you buy or sell.`],
  [`Pending (T+${SETTLE_DAYS})`, `When you sell, the money is not ready straight away. It arrives ${SETTLE_DAYS} market days later (${SETTLE_DAYS * SECONDS_PER_MARKET_DAY} seconds). This is called settlement (T+${SETTLE_DAYS}).`],
  ['Dividend', `A payment from a company to its owners. You get one every ${DIV_EVERY} market days if you own the share. The box "Dividends received" adds them all up.`],
  ['Capital gain', 'The profit you make when you sell a share for more than you paid.'],
  ['CGT', `Capital Gains Tax. Tax on your profit. If you hold a share for ${YEAR_DAYS} market days (${TAXDAY_MIN} minutes) or more, you pay tax on only half of the profit (50% discount).`],
  ['Tax Day', `Every ${YEAR_DAYS} market days (${TAXDAY_MIN} minutes) is Tax Day. The game takes the tax on the shares you have SOLD out of your cash.`],
  ['Tax (estimate)', 'The tax you would pay if you sold all your shares right now. It changes all the time as prices move. It also shows what % of your profit would go to tax.'],
  ['Paused', 'When your teacher pauses the game, time stops but you can still buy and sell at the prices you see.']
];

let S = null;     // saved game state
let MK = null;    // price provider
let ACC = null;   // account (calculated from the trade log)
let POS = null;   // where we are in time: { day, tick }
const EVENT_SECONDS = 6;    // news pop-ups close by themselves after this many seconds
const UI = { selected: 'BHP', qty: 10, tab: 'shares', range: '1M', evSig: '[]', tipIdx: Math.floor(Math.random() * 100), modalOpen: false, lastPrices: {}, charts: {}, lastFloat: 0 };

/* ---------- prices at a position ---------- */
function P(sym, pos) { pos = pos || POS; return MK.price(sym, pos.day, pos.tick); }
function prevClose(sym) { return MK.price(sym, POS.day - 1, TICKS); }   // yesterday's close (day 0 uses the pretend history)
function change(sym) { return P(sym) / prevClose(sym) - 1; }

/* ---------- saving ---------- */
function newState(nick, classCode) {
  return { nick, classCode, trades: [], gmin: START_GMIN, bigText: false };
}
function saveState() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: game still works */ } }
function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.nick !== 'string' || !Array.isArray(o.trades) || !Number.isFinite(o.gmin)) return null;
    return { ...newState(o.nick, o.classCode || ''), ...o };
  } catch (e) { return null; }
}

/* ---------- live connection to the teacher (PeerJS room) ---------- */
const SOLO_END_DAY = 90;   // SOLO MODE only: the game ends by itself after this many market days (10 s each, so 90 days = 15 minutes)
const NET = { solo: false, ended: false, peer: null, conn: null, state: 'off', clock: null, lastMsg: 0, showRank: false, rank: null, timer: null, stopped: false, hello: false };
function setChip(state) {
  NET.state = state;
  const el = $('cloud-chip'); if (!el) return;
  const map = {
    off:        ['pill',      '⏳ Connecting…'],
    connecting: ['pill',      '⏳ Connecting to teacher…'],
    ok:         ['pill ok',   '🟢 Connected to teacher'],
    noroom:     ['pill warn', '⚠ Teacher room not open yet – trying again'],
    lost:       ['pill warn', '⚠ Connection lost – trying again'],
    replaced:   ['pill warn', '⚠ You joined on another computer'],
    removed:    ['pill warn', '⚠ Removed by your teacher'],
    nolib:      ['pill warn', '⚠ Could not load the connection (internet?)'],
    oldver:     ['pill warn', '⚠ Old version – refresh this page (Ctrl+F5)']
  };
  el.className = map[state][0]; el.textContent = map[state][1];
  if (NET.solo && state === 'ok') { el.className = 'pill'; el.textContent = '🧍 Solo mode'; }
  updateClock && S && POS && updateClock();
}
function netSend(obj) { try { if (NET.conn && NET.conn.open) { NET.conn.send(obj); return true; } } catch (e) { } return false; }
function netPush() { if (S) netSend({ t: 'tr', tr: encodeTrades(S.trades) }); }
function netRedial(ms) {
  if (NET.stopped || NET.timer) return;
  NET.timer = setTimeout(() => { NET.timer = null; netDial(); }, ms || 4000);
}
function netFreeze() {            // lost the teacher: stop the clock where it is
  if (NET.clock && NET.clock.run) NET.clock = { g: targetG(), run: false, at: performance.now(), frozen: true };
}
function netDial() {
  if (NET.stopped || !NET.peer) return;
  if (NET.peer.disconnected && !NET.peer.destroyed) { try { NET.peer.reconnect(); } catch (e) { } }
  if (!NET.peer.open) { netRedial(2000); return; }
  setChip(NET.state === 'ok' ? 'ok' : 'connecting');
  const conn = NET.conn = NET.peer.connect(hostPeerId(S.classCode), { reliable: true });
  conn.on('open', () => { netSend({ t: 'hi', v: PROTO, name: S.nick, tr: encodeTrades(S.trades) }); });
  conn.on('data', netData);
  const lost = () => { if (NET.conn !== conn) return; netFreeze(); if (!NET.stopped) { setChip('lost'); netRedial(); } };
  conn.on('close', lost); conn.on('error', lost);
}

/* ---------- SOLO MODE: no teacher link, no internet. The clock runs on this computer. ---------- */
function soloInit() {
  NET.solo = true; NET.stopped = true; setChip('ok');
  NET.clock = null;                       // no clock until the student presses GO
  $('btn-solo-finish').classList.remove('is-hidden');
  $('solo-text').textContent = S.gmin > START_GMIN ? 'Welcome back! Press GO to carry on from where you stopped.' : 'Everyone presses the button together. Your game clock runs on this computer.';
  openModal('solo-overlay'); updateClock();
}
function soloGo() {
  NET.clock = { g: S.gmin, run: true, at: performance.now() };
  closeModal('solo-overlay'); updateClock();
  const nb = $('news-bar'); if (nb && /^📰 NEWS: Nothing yet/.test(nb.textContent)) nb.textContent = '📰 NEWS: Nothing yet. Watch the market for news!';
}
function soloFinish() {
  if (NET.ended) return;
  NET.ended = true; NET.clock = { g: S.gmin, run: false, at: performance.now() };
  $('final-me').textContent = `Game over, ${S.nick}! Your final net worth is ${money(ACC.nw)}. Show this number to your teacher.`;
  $('final-top').innerHTML = '';
  closeModal('settings-modal'); openModal('final-modal'); updateClock();
}
function netInit() {
  if (typeof Peer === 'undefined') { setChip('nolib'); return; }
  setChip('connecting');
  const peer = NET.peer = new Peer();
  peer.on('open', () => netDial());
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') { netFreeze(); setChip('noroom'); netRedial(5000); }
    else if (['network', 'server-error', 'socket-error', 'socket-closed', 'webrtc'].includes(err.type)) { netFreeze(); setChip('lost'); netRedial(5000); }
  });
  setInterval(() => {
    if (!NET.stopped && NET.conn && NET.conn.open) {
      netSend({ t: 'ping' });
      if (NET.lastMsg && performance.now() - NET.lastMsg > 7000 && NET.state === 'ok') { netFreeze(); setChip('lost'); try { NET.conn.close(); } catch (e) { } }
    }
  }, 4000);
}
function netData(d) {
  if (!d || typeof d !== 'object') return;
  NET.lastMsg = performance.now();
  if (d.t === 'welcome' || d.t === 'clock') {
    if (!Number.isFinite(d.g) || d.g < 0 || d.g > 1e8) return;
    NET.clock = { g: d.g, run: !!d.run, at: performance.now() };
    NET.showRank = !!d.rank;
    if (NET.state !== 'ok') setChip('ok');
    const ended = !!d.end;
    if (ended && !NET.ended) { NET.ended = true; $('final-me').textContent = 'Waiting for the final results…'; $('final-top').innerHTML = ''; openModal('final-modal'); }
    if (!ended && NET.ended) { NET.ended = false; closeModal('final-modal'); }
    if (!NET.showRank && !NET.ended) $('rank-chip').classList.add('is-hidden');
  }
  if (d.t === 'welcome' && d.v !== PROTO) { NET.stopped = true; netFreeze(); setChip('oldver'); return; }
  if (d.t === 'old') { NET.stopped = true; netFreeze(); setChip('oldver'); toast('This page is an old version. Refresh it (Ctrl+F5) and join again.', 'bad'); return; }
  if (d.t === 'welcome' || d.t === 'events') applyEvents(d.t === 'events' ? d.list : d.ev);
  if (d.t === 'welcome') {            // the teacher may know more trades than this computer (e.g. new computer)
    try {
      const t = parseTrades(d.tr || '');
      if (t.length > S.trades.length) { S.trades = t; saveState(); recalc(); renderAll(); toast('👋 Welcome back! Your game was loaded.', 'good'); }
    } catch (e) { }
    netPush();
  }
  if (d.t === 'rank' && NET.showRank && Number.isInteger(d.rank) && Number.isInteger(d.of)) {
    NET.rank = d; const el = $('rank-chip'); el.textContent = `🏅 Rank ${d.rank} of ${d.of}`; el.classList.remove('is-hidden');
  }
  if (d.t === 'final' && NET.ended && Number.isInteger(d.rank) && Number.isInteger(d.of)) {
    $('final-me').textContent = `You finished #${d.rank} of ${d.of} with ${money(d.nw)}.`;
    const medals = ['🥇', '🥈', '🥉'];
    $('final-top').innerHTML = (Array.isArray(d.top) ? d.top.slice(0, 3) : []).map((p, i) => `<div class="pod p${i + 1}"><div class="medal">${medals[i]}</div><div class="nm">${esc(String(p.n).slice(0, 20))}</div><div class="nw">${money(Number(p.nw) || 0)}</div></div>`).join('');
    const el = $('rank-chip'); el.textContent = `🏁 Final rank ${d.rank} of ${d.of}`; el.classList.remove('is-hidden');
  }
  if (d.t === 'replaced' || d.t === 'removed') { NET.stopped = true; netFreeze(); setChip(d.t); }
  if (d.t === 'err') { NET.stopped = true; setChip('lost'); toast('Your teacher could not accept that name. Use first name + first letter, e.g. Liam T.', 'bad'); }
}
/* where should the game clock be right now? (null = no teacher clock yet) */
function targetG() {
  const c = NET.clock; if (!c) return null;
  return c.run ? advanceG(c.g, (performance.now() - c.at) / 1000) : c.g;
}
/* news written by the teacher (never trusted: cleaned first). Only ever changes FUTURE prices. */
function applyEvents(list) {
  if (!MK) return;
  const clean = cleanCustomEvents(list), sig = JSON.stringify(clean);
  if (sig === UI.evSig) return;
  UI.evSig = sig; MK.setCustom(clean); MK.ensure(POS.day); recalc(); renderAll();
}
function clockRunning() { return !!(NET.clock && NET.clock.run && NET.state === 'ok' && !NET.ended); }

/* ---------- floating text & toasts ---------- */
function floatText(text, kind, anchor) {
  const layer = $('float-layer'); if (!layer || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-text ' + kind; el.textContent = text;
  el.style.left = (r.left + r.width / 2) + 'px'; el.style.top = (r.top + r.height / 2) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || ''); el.textContent = msg;
  $('toast-layer').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ---------- charts ---------- */
function chartsReady() { return typeof Chart !== 'undefined'; }
function setupChartDefaults() {
  if (!chartsReady()) return;
  Chart.defaults.color = '#9fb0d6';
  Chart.defaults.font.family = "'Lexend', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
}
const RANGE_DAYS = { '1W': 5, '1M': 21, '1Y': 252, '5Y': 1260 };   // market days shown on the chart (1D is made from the price steps of today)
function dateLabel(d, withYear) { return shortDate(d) + (withYear ? ' ' + String(marketDate(d).getFullYear()).slice(2) : ''); }
function priceSeries(sym) {
  const labels = [], data = [];
  if (UI.range === '1D') {
    labels.push('Yesterday'); data.push(prevClose(sym));
    for (let t = 0; t <= POS.tick; t++) { labels.push(tickTime(t)); data.push(MK.price(sym, POS.day, t)); }
    return { labels, data };
  }
  const n = RANGE_DAYS[UI.range] || 21;
  for (let d = POS.day - n + 1; d <= POS.day; d++) {
    labels.push(dateLabel(d, n >= 252)); data.push(MK.price(sym, d, d === POS.day ? POS.tick : TICKS));
  }
  return { labels, data };
}
function renderPriceChart() {
  if (!chartsReady()) return;
  const { labels, data } = priceSeries(UI.selected);
  const colour = data[data.length - 1] >= data[0] ? '#34d399' : '#fb7185';
  let c = UI.charts.price;
  if (!c) {
    c = UI.charts.price = new Chart($('price-chart'), {
      type: 'line',
      data: { labels, datasets: [{ data, borderWidth: 2.5, pointRadius: data.length <= 6 ? 4 : 0, tension: 0.15, borderColor: colour, backgroundColor: colour + '22', fill: true }] },
      options: {
        maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 5 }, grid: { color: 'rgba(42,55,100,.5)' } }, y: { grid: { color: 'rgba(42,55,100,.5)' }, ticks: { callback: v => '$' + v } } }
      }
    });
  } else {
    c.data.labels = labels; const ds = c.data.datasets[0];
    ds.data = data; ds.borderColor = colour; ds.backgroundColor = colour + '22'; ds.pointRadius = data.length <= 6 ? 4 : 0; c.update('none');
  }
}
function sectorValues() {
  const vals = {}; SECTORS.forEach(s => { vals[s] = 0; });
  STOCKS.forEach(s => { vals[s.sector] += ACC.qty[s.sym] * P(s.sym); });
  return vals;
}
function renderPie() {
  const vals = sectorValues();
  const invested = SECTORS.reduce((a, s) => a + vals[s], 0);
  const cashLike = Math.max(0, ACC.cash) + ACC.pendingSum;
  const labels = SECTORS.concat(['Cash']);
  const data = SECTORS.map(s => vals[s]).concat([cashLike]);
  const colours = SECTORS.map(s => SECTOR_INFO[s].color).concat([CASH_COLOR]);
  if (chartsReady()) {
    let c = UI.charts.pie;
    if (!c) {
      c = UI.charts.pie = new Chart($('pie-chart'), {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colours, borderColor: '#131c3a', borderWidth: 3 }] },
        options: { maintainAspectRatio: false, animation: false, cutout: '55%', plugins: { legend: { display: false } } }
      });
    } else { c.data.datasets[0].data = data; c.update('none'); }
  }
  const total = invested + cashLike || 1;
  $('pie-legend').innerHTML = labels.map((l, i) => {
    const icon = l === 'Cash' ? '💵' : SECTOR_INFO[l].icon;
    return `<li><span class="swatch" style="background:${colours[i]}"></span>${icon} ${l}<span class="pc">${(data[i] / total * 100).toFixed(0)}%</span></li>`;
  }).join('');
  const w = $('div-warning');
  if (invested < 1) { w.className = 'warn none'; w.textContent = '🥧 Buy some shares to fill your pie!'; return; }
  let top = SECTORS[0]; SECTORS.forEach(s => { if (vals[s] > vals[top]) top = s; });
  const share = vals[top] / invested, nSec = SECTORS.filter(s => vals[s] > 0).length;
  if (share >= 0.6) {
    w.className = 'warn bad';
    w.innerHTML = nSec === 1
      ? `⚠️ <b>All your eggs are in one basket!</b> All your shares are in ${SECTOR_INFO[top].icon} ${top}. If ${top} falls, you lose a lot. Try another sector.`
      : `⚠️ <b>Careful!</b> ${(share * 100).toFixed(0)}% of your shares are in ${SECTOR_INFO[top].icon} ${top}. Spread your money more.`;
  } else if (share >= 0.4 || nSec < 3) {
    w.className = 'warn mid'; w.innerHTML = `🟡 <b>Getting better.</b> You have ${nSec} sectors. Try for 3 or more.`;
  } else {
    w.className = 'warn ok'; w.innerHTML = `👍 <b>Nice mix!</b> Your money is spread over ${nSec} sectors.`;
  }
}
/* ---------- trading tips (change every minute) ---------- */
const TIPS = [
  () => '🥚 Do not put all your eggs in one basket. Try to own shares in 3 or more sectors.',
  () => `💸 Every buy or sell costs ${money(BROKERAGE)}. Buying and selling again and again costs you a lot.`,
  () => `⏳ Money from a sale takes ${SETTLE_DAYS} market days (${SETTLE_DAYS * SECONDS_PER_MARKET_DAY} seconds) to arrive. Keep some cash ready to buy.`,
  () => `🎁 You get a dividend every ${DIV_EVERY} market days. Shares with a high yield pay you more just for owning them.`,
  () => `🧾 Tax Day is every ${YEAR_DAYS} market days (${TAXDAY_MIN} minutes). Keep enough cash to pay your tax bill.`,
  () => `🕐 Hold a share for ${YEAR_DAYS} market days or more and you pay tax on only half of the profit.`,
  () => '📰 When news appears, look at which sectors have arrows ▲▼. Then think: buy, sell or wait?',
  () => '📉 When the market falls, do not panic-sell. Prices go up and down. Ask: is this company still good?',
  () => '🪙 Gold often rises when people are scared. It can help when other shares fall.',
  () => '🔎 Check the 1 year and 5 year charts before you buy. Is the share going up over time, or just jumping around?',
  () => '💻 Tech shares jump up and down a lot (more risk, more reward). Banks and shops move more slowly.',
  () => '📊 Compare two shares in the same sector: which pays a higher dividend? Which one moves less?',
  () => '🧮 Look at the Tax (estimate) box. It shows how much of your profit would go to tax. Waiting can cut it in half.',
  () => '⏸ When your teacher pauses the game you can still buy and sell. Use the break to think.'
];
function showTip(fade) {
  const el = $('tip-text'); if (!el) return;
  const set = () => { el.textContent = TIPS[UI.tipIdx % TIPS.length](); el.classList.remove('fade'); };
  if (fade) { el.classList.add('fade'); setTimeout(set, 450); } else set();
}
function startTips() {
  showTip(false);
  setInterval(() => { UI.tipIdx++; showTip(true); }, 60000);
}
function renderNWChart() {
  if (!chartsReady() || UI.tab !== 'progress') return;
  const labels = ACC.history.map((_, d) => shortDate(d));
  const base = ACC.history.map(() => START_CASH);
  const colour = ACC.history[ACC.history.length - 1] >= START_CASH ? '#34d399' : '#fb7185';
  let c = UI.charts.nw;
  if (!c) {
    c = UI.charts.nw = new Chart($('nw-chart'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Net worth', data: ACC.history, borderColor: colour, borderWidth: 3, pointRadius: 2, tension: 0.1 },
        { label: 'Start', data: base, borderColor: '#fbbf24', borderWidth: 2, borderDash: [6, 6], pointRadius: 0 }
      ] },
      options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { color: 'rgba(42,55,100,.5)' } }, y: { grid: { color: 'rgba(42,55,100,.5)' }, ticks: { callback: v => '$' + v.toLocaleString('en-AU') } } } }
    });
  } else {
    c.data.labels = labels; c.data.datasets[0].data = ACC.history; c.data.datasets[0].borderColor = colour; c.data.datasets[1].data = base; c.update('none');
  }
}

/* ---------- rendering ---------- */
function recalc() { ACC = computeAccount(S.trades, POS, MK); }
/* You can trade whenever the market is open and you are connected to your teacher - even if the teacher has PAUSED the clock
   (time stops, prices stay still, so it is fair). Not allowed: market closed, game over, no clock yet, or connection lost. */
function tradingAllowed() { return isOpen(S.gmin) && !!NET.clock && NET.state === 'ok' && !NET.ended; }
function isPaused() { return !!(NET.clock && !NET.clock.run && NET.state === 'ok' && !NET.ended); }

function opensText() {
  const g = nextOpenG(S.gmin), d = gDate(g);
  return dayName(d) + ' ' + timeText(OPEN_MIN);
}
function updateClock() {
  const g = S.gmin, d = gDate(g), m = g - calDay(g) * 1440, open = isOpen(g);
  $('hdr-date').textContent = `${dayName(d)} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${timeText(m)}`;
  $('hdr-day').textContent = POS.day;
  $('hdr-player').textContent = S.nick;
  const pill = $('hdr-status');
  pill.className = 'pill ' + (open ? 'open' : 'closed');
  pill.textContent = open ? '🟢 MARKET OPEN' : '🔴 MARKET CLOSED · opens ' + opensText();
  $('hdr-progress').style.width = (open ? (m - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN) * 100 : (m >= CLOSE_MIN ? 100 : 0)) + '%';
  const run = $('hdr-run'), can = tradingAllowed();
  if (NET.ended) { run.className = 'pill warn'; run.textContent = '🏁 Game over'; }
  else if (!NET.clock) { run.className = 'pill'; run.textContent = NET.solo ? '⏳ Press GO' : '⏳ Waiting for your teacher…'; }
  else if (NET.clock.run && NET.state === 'ok') { run.className = 'pill ok'; run.textContent = '▶ Game running'; }
  else if (NET.state === 'lost' || NET.state === 'noroom') { run.className = 'pill warn'; run.textContent = '⏸ Connection lost'; }
  else { run.className = 'pill warn'; run.textContent = '⏸ Paused – you can still trade'; }
  $('trade-closed').classList.toggle('is-hidden', can);
  $('trade-closed').textContent = NET.ended ? '🏁 The market has ended. Well played!' : !open ? '🔴 The market is closed. Trading is 10:00 AM – 4:00 PM, Monday to Friday.' : !NET.clock ? '⏳ Waiting for your teacher to start the game.' : '⚠ Not connected to your teacher. Trading comes back when you are connected again.';
  $('trade-paused').classList.toggle('is-hidden', !(can && isPaused()));
  $('btn-buy').disabled = !can; $('btn-sell').disabled = !can;
}
function renderStats() {
  $('st-nw').textContent = money(ACC.nw);
  const diff = ACC.nw - START_CASH;
  const el = $('st-nw-change'); el.className = 'stat-sub ' + cls(diff);
  el.textContent = `${arrow(diff)} ${money(Math.abs(diff))} (${pctText(diff / START_CASH)}) since start`;
  $('st-cash').textContent = money(ACC.cash);
  $('st-cash').className = 'stat-big' + (ACC.cash < 0 ? ' down' : '');
  $('st-pending').textContent = money(ACC.pendingSum);
  $('st-pending-list').innerHTML = ACC.pending.length
    ? ACC.pending.slice(0, 3).map(p => { const n = p.settleDay - POS.day; return `⏳ ${money(p.amount)} in ${n} market day${n === 1 ? '' : 's'}`; }).join('<br>')
    : 'Money from sold shares';
  $('st-shares').textContent = money(ACC.holdVal);
  $('st-div').textContent = money(ACC.divTotal);
  // live tax estimate: tax if you sold everything now, and what % of your share profit it is
  $('st-tax').textContent = money(ACC.taxAll);
  const pc = $('st-tax-pct');
  if (ACC.gainYear > 0.005) { pc.className = 'stat-sub amber'; pc.textContent = `= ${(ACC.taxPct * 100).toFixed(1)}% of your ${money(ACC.gainYear)} profit`; }
  else { pc.className = 'stat-sub'; pc.textContent = ACC.gainYear < -0.005 ? `Profit is ${money(ACC.gainYear)} = no tax` : 'No profit yet = no tax'; }
  const n = daysToTaxDay(POS.day), mins = Math.max(1, Math.ceil(n * SECONDS_PER_MARKET_DAY / 60));
  $('st-tax-sub').textContent = `Tax Day in ${mins} min · bill so far: ${money(ACC.taxEst)}`;
  $('card-tax').title = 'Estimate: the tax you would pay if you sold ALL your shares now. On Tax Day you pay only on shares you have already sold (bill so far).';
}
function renderMarket() {
  let h = '';
  STOCKS.forEach(s => {
    const p = P(s.sym), ch = change(s.sym), info = SECTOR_INFO[s.sector], own = ACC.qty[s.sym];
    const last = UI.lastPrices[s.sym];
    const flash = last === undefined || last === p ? '' : (p > last ? ' flash-up' : ' flash-down');
    h += `<tr class="mrow${s.sym === UI.selected ? ' sel' : ''}" data-sym="${s.sym}" tabindex="0" role="button" aria-label="${esc(s.name)}, price ${money(p)}">
      <td title="${s.sector}"><span class="sec-dot" style="background:${info.color}"></span>${info.icon}</td>
      <td><div class="sym">${s.sym}</div><div class="co">${esc(s.name)}</div></td>
      <td class="num${flash}">${money(p)}</td>
      <td class="num ${cls(ch)}">${arrow(ch)} ${pctText(ch)}</td>
      <td class="num own">${own || '-'}</td></tr>`;
    UI.lastPrices[s.sym] = p;
  });
  $('market-body').innerHTML = h;
}
function renderSelected() {
  const s = STOCK[UI.selected], p = P(s.sym), ch = change(s.sym);
  $('sel-icon').textContent = SECTOR_INFO[s.sector].icon;
  $('sel-sym').textContent = s.sym;
  $('sel-name').textContent = `${s.name} · ${s.sector}`;
  $('sel-price').textContent = money(p);
  const c = $('sel-change'); c.className = cls(ch); c.textContent = `${arrow(ch)} ${pctText(ch)} today`;
  $('sel-own').textContent = ACC.qty[s.sym];
  renderPreview();
}
function renderPreview() {
  const qty = Math.max(0, Math.floor(UI.qty) || 0), px = P(UI.selected), sym = UI.selected;
  const cost = qty * px, total = cost + BROKERAGE, own = ACC.qty[sym];
  const row = (a, b, c) => `<div class="row"><span>${a}</span><span class="${c || ''}">${b}</span></div>`;
  let h = '<div class="dim">If you BUY:</div>';
  h += row(`${qty} × ${money(px)}`, money(cost));
  h += row('Fee (brokerage)', money(BROKERAGE));
  h += row('<b>Total</b>', `<b>${money(total)}</b>`, total <= ACC.cash ? '' : 'down');
  h += total <= ACC.cash ? row('Cash left', money(ACC.cash - total)) : '<div class="down">❌ Not enough cash</div>';
  if (own > 0) {
    const q = Math.min(qty, own), sim = ACC.lots[sym].map(l => ({ ...l }));
    const pieces = consumeLots(sim, q, px, POS.day, BROKERAGE);
    const gain = pieces.reduce((a, g) => a + g.gain, 0), longQ = pieces.filter(g => g.long).reduce((a, g) => a + g.qty, 0);
    h += `<div class="dim" style="margin-top:8px">If you SELL ${q}:</div>`;
    h += row('You get', money(q * px - BROKERAGE) + ' ⏳');
    h += row('Profit / loss', `${arrow(gain)} ${money(Math.abs(gain))}`, cls(gain));
    h += `<div class="dim">${longQ > 0 ? `✅ ${longQ} share${longQ > 1 ? 's' : ''} get the 50% tax discount` : `No tax discount yet (hold ${YEAR_DAYS} market days)`} · money arrives in ${SETTLE_DAYS} market days</div>`;
  }
  $('trade-preview').innerHTML = h;
}
function renderHoldings() {
  let h = '', any = false;
  STOCKS.forEach(s => {
    const q = ACC.qty[s.sym]; if (!q) return; any = true;
    const lots = ACC.lots[s.sym], p = P(s.sym);
    const cost = lots.reduce((a, l) => a + l.qty * l.cps, 0), val = q * p, pl = val - cost;
    const held = POS.day - Math.min(...lots.map(l => l.day)), left = YEAR_DAYS - held;
    const badge = left <= 0 ? '<span class="badge ok">✅ 50% off</span>' : `<span class="badge wait">🕐 in ${left} market day${left === 1 ? '' : 's'}</span>`;
    h += `<tr class="mrow" data-sym="${s.sym}"><td><span class="sym">${s.sym}</span> ${SECTOR_INFO[s.sector].icon}</td><td class="num">${q}</td>
      <td class="num">${money(cost / q)}</td><td class="num">${money(p)}</td><td class="num">${money(val)}</td>
      <td class="num ${cls(pl)}">${arrow(pl)} ${money(Math.abs(pl))} (${pctText(pl / cost)})</td><td class="hide-sm">${badge}</td></tr>`;
  });
  $('holdings-body').innerHTML = h;
  $('holdings-empty').classList.toggle('is-hidden', any);
}
function renderLog() {
  const when = e => `<span class="dim">${shortDate(e.day)} ${e.type === 'dividend' || e.type === 'tax' ? '' : tickTime(e.tick)}</span> `;
  const items = ACC.ledger.slice().reverse().slice(0, 60).map(e => {
    if (e.type === 'buy') return `<li>${when(e)}🛒 Bought ${e.qty} ${e.sym} @ ${money(e.price)} <span class="down">${money(e.amount)}</span></li>`;
    if (e.type === 'sell') return `<li>${when(e)}💰 Sold ${e.qty} ${e.sym} @ ${money(e.price)} <span class="up">+${money(e.amount)}</span> <span class="amber">⏳ ready ${shortDate(e.settleDay)}</span></li>`;
    if (e.type === 'dividend') return `<li>${when(e)}🎁 Dividend: ${e.qty} ${e.sym} × ${money(e.dps)} <span class="up">+${money(e.amount)}</span></li>`;
    return `<li>${when(e)}🧾 Tax Day <span class="down">${money(e.amount)}</span></li>`;
  });
  $('log-list').innerHTML = items.join('') || '<li class="dim">Nothing yet.</li>';
  const news = [];
  for (let d = POS.day; d >= 0 && news.length < 30; d--) {
    const e = MK.events[d]; if (!e || d * KEYMUL + e.tick > posKey(POS)) continue;
    const arrows = Object.entries(e.ev.fx).map(([sec, m]) => `${SECTOR_INFO[sec].icon}${m > 0 ? '<span class="up">▲</span>' : '<span class="down">▼</span>'}`).join(' ');
    news.push(`<li><span class="dim">${shortDate(d)} ${tickTime(e.tick)}</span> ${esc(e.ev.icon)} ${esc(e.ev.title)} ${arrows}</li>`);
  }
  $('news-list').innerHTML = news.join('') || '<li class="dim">No news yet.</li>';
}
function renderTab() {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === UI.tab));
  ['shares', 'log', 'progress'].forEach(t => $('tab-' + t).classList.toggle('is-hidden', t !== UI.tab));
  if (UI.tab === 'shares') renderHoldings(); else if (UI.tab === 'log') renderLog(); else renderNWChart();
}
function renderAll() {
  updateClock(); renderStats(); renderMarket(); renderSelected(); renderPriceChart(); renderPie(); renderTab();
}

/* ---------- trading ---------- */
function setQty(n) { UI.qty = Math.max(1, Math.min(1000000, Math.floor(n) || 1)); $('qty').value = UI.qty; renderPreview(); }

function placeTrade(side) {
  if (!tradingAllowed()) { toast(NET.ended ? 'The market has ended.' : !isOpen(S.gmin) ? 'The market is closed. Trading is 10:00 AM – 4:00 PM, Monday to Friday.' : !NET.clock ? 'Wait for your teacher to start the game.' : 'You are not connected to your teacher right now.', 'bad'); return; }
  const sym = UI.selected, qty = Math.floor(UI.qty), px = P(sym);
  if (!(qty >= 1)) { toast('Choose how many shares first.', 'bad'); return; }
  if (side === 'B') {
    if (qty * px + BROKERAGE > ACC.cash + 1e-9) { toast(`❌ Not enough cash. Cash ready: ${money(ACC.cash)}. Money from sales takes ${SETTLE_DAYS} market days.`, 'bad'); return; }
  } else if (qty > ACC.qty[sym]) { toast(`❌ You only own ${ACC.qty[sym]} ${sym}.`, 'bad'); return; }

  S.trades.push({ day: POS.day, tick: POS.tick, sym, side, qty });
  saveState(); recalc(); renderAll(); netPush();
  if (side === 'B') {
    floatText(`-${money(qty * px + BROKERAGE)}`, 'down', $('btn-buy'));
    toast(`🛒 Bought ${qty} ${sym}. Good luck!`, 'good');
  } else {
    floatText(`+${money(qty * px - BROKERAGE)} ⏳`, 'gold', $('card-pending'));
    toast(`💰 Sold ${qty} ${sym}. Money arrives in ${SETTLE_DAYS} market days.`, 'gold');
  }
}

/* ---------- clock & news ---------- */
function openModal(id) { $(id).classList.remove('is-hidden'); UI.modalOpen = true; }
function closeModal(id) { $(id).classList.add('is-hidden'); UI.modalOpen = !!document.querySelector('.overlay:not(.is-hidden):not(#join-screen)'); }

function showEvent(e) {
  $('ev-icon').textContent = e.ev.icon;
  $('ev-title').textContent = e.ev.title;
  $('ev-text').textContent = e.ev.text;
  $('ev-sectors').innerHTML = Object.entries(e.ev.fx).map(([sec, m]) => {
    const c = m > 0 ? 'var(--green)' : 'var(--red)', a = (m > 0 ? '▲' : '▼').repeat(Math.abs(m));
    return `<span class="ev-chip" style="border-color:${c};color:${c}">${SECTOR_INFO[sec].icon} ${sec} ${a}</span>`;
  }).join('');
  $('news-bar').textContent = `📰 NEWS (${shortDate(e.day)} ${tickTime(e.tick)}): ${e.ev.title}`;
  openModal('event-modal');
  const bar = $('ev-bar'); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';   // restart the 6-second bar
  clearTimeout(UI.evTimer); UI.evTimer = setTimeout(() => closeModal('event-modal'), EVENT_SECONDS * 1000);
}

function setTime(g) {
  const prev = POS, prevNW = ACC.nw;
  S.gmin = g; POS = posOf(g);
  if (posKey(POS) === posKey(prev)) { updateClock(); return; }
  MK.ensure(POS.day); recalc(); saveState(); renderAll();
  // floating profit / loss text (not too often)
  const diff = ACC.nw - prevNW, now = performance.now();
  if (Math.abs(diff) >= 25 && now - UI.lastFloat > 4000) {
    UI.lastFloat = now;
    floatText(`${diff > 0 ? '▲ +' : '▼ -'}${money(Math.abs(diff)).replace('-', '')}`, diff > 0 ? 'up' : 'down', $('st-nw'));
  }
  // news that happened between the last step and this one
  for (let d = prev.day; d <= POS.day; d++) {
    const e = MK.events[d]; if (!e) continue;
    const k = d * KEYMUL + e.tick;
    if (k > posKey(prev) && k <= posKey(POS)) { showEvent(e); break; }
  }
  // a new market day began
  if (POS.day > prev.day) {
    const divs = ACC.ledger.filter(e => e.day === POS.day && e.type === 'dividend');
    if (divs.length) {
      const sum = divs.reduce((a, e) => a + e.amount, 0);
      floatText(`🎁 +${money(sum)}`, 'gold', $('card-div'));
      toast(`🎁 Dividend! ${divs.map(e => e.sym).join(', ')} paid you ${money(sum)}.`, 'gold');
    }
    ACC.ledger.filter(e => e.day === POS.day && e.type === 'tax').forEach(e => {
      toast(`🧾 Tax Day! ${money(-e.amount)} was taken from your cash.`, 'bad');
    });
    ACC.ledger.filter(e => e.type === 'sell' && e.settleDay === POS.day).forEach(e => {
      floatText(`✅ +${money(e.amount)}`, 'up', $('card-cash')); toast(`✅ Money from your ${e.sym} sale (${money(e.amount)}) is ready to spend!`, 'good');
    });
  }
}

function loop() {
  if (!S) return;
  const tg = targetG(); if (tg === null) return;
  if (NET.solo && !NET.ended && POS.day >= SOLO_END_DAY) { soloFinish(); return; }
  let ng = tg;
  const a = POS, b = posOf(ng);
  if (posKey(b) > posKey(a)) {                 // never skip a news story: stop at it, show it, then carry on
    MK.ensure(b.day + 1);
    const e = eventBetween(MK, a, b);
    if (e) { if (!$('event-modal').classList.contains('is-hidden')) return; ng = gOfPos(e.day, e.tick); }   // wait until the last story has closed
  }
  if (Math.abs(ng - S.gmin) > 1e-9) setTime(ng);
}

/* ---------- buttons ---------- */
function copyText(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(msg || 'Copied!', 'good'), () => toast('Could not copy. Select the text and copy it.', 'bad'));
  else toast('Could not copy. Select the text and copy it.', 'bad');
}
function wireEvents() {
  const pick = e => {
    const tr = e.target.closest('tr[data-sym]'); if (!tr) return;
    UI.selected = tr.dataset.sym; renderMarket(); renderSelected(); renderPriceChart();
  };
  $('market-body').addEventListener('click', pick);
  $('holdings-body').addEventListener('click', pick);
  $('market-body').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });

  $('qty').addEventListener('input', () => { UI.qty = Math.floor($('qty').value) || 0; renderPreview(); });
  $('qty').addEventListener('change', () => setQty($('qty').value));
  $('qty-minus').addEventListener('click', () => setQty(UI.qty - 1));
  $('qty-plus').addEventListener('click', () => setQty(UI.qty + 1));
  $('qty-max').addEventListener('click', () => {
    const buyMax = Math.floor((ACC.cash - BROKERAGE) / P(UI.selected)), own = ACC.qty[UI.selected];
    setQty(buyMax >= 1 ? buyMax : (own || 1));
  });
  $('btn-buy').addEventListener('click', () => placeTrade('B'));
  $('btn-sell').addEventListener('click', () => placeTrade('S'));

  document.querySelectorAll('.range-btn').forEach(b => b.addEventListener('click', () => {
    UI.range = b.dataset.range;
    document.querySelectorAll('.range-btn').forEach(x => x.classList.toggle('active', x === b));
    renderPriceChart();
  }));
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => { UI.tab = b.dataset.tab; renderTab(); }));
  $('final-ok').addEventListener('click', () => closeModal('final-modal'));

  $('btn-help').addEventListener('click', () => openModal('help-modal'));
  $('btn-settings').addEventListener('click', () => {
    $('set-big').checked = S.bigText; $('my-code').value = encodeCode(S);
    openModal('settings-modal');
  });
  document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['help-modal', 'settings-modal', 'final-modal'].forEach(id => { if (!$(id).classList.contains('is-hidden')) closeModal(id); });
  });
  $('set-big').addEventListener('change', e => { S.bigText = e.target.checked; document.body.classList.toggle('big-text', S.bigText); saveState(); });
  $('btn-copy-code').addEventListener('click', () => copyText($('my-code').value, '📋 Save code copied!'));
  $('btn-reset').addEventListener('click', () => {
    if (confirm('Erase this game on this computer and start again? This cannot be undone.')) { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } location.reload(); }
  });
}

/* ---------- start / join ---------- */
function buildHelp() {
  $('glossary').innerHTML = GLOSSARY.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('');
  $('time-help').textContent = `${SECONDS_PER_MARKET_DAY} real seconds = 1 market day (Monday to Friday, game time). Prices change twice a day. Tax Day is every ${YEAR_DAYS} market days (${TAXDAY_MIN} minutes). News stories pop up for ${EVENT_SECONDS} seconds. Your teacher starts and pauses the clock for the whole class. When it is paused you can still buy and sell.`;
  $('lbl-pending').textContent = `Pending (${SETTLE_DAYS} days)`;
  $('st-div-sub').textContent = `Paid every ${DIV_EVERY} market days`;
}
function startGame() {
  MK = makeMarket(S.classCode); POS = posOf(S.gmin); MK.ensure(POS.day);
  document.body.classList.toggle('big-text', !!S.bigText);
  $('join-screen').classList.add('is-hidden'); $('app').classList.remove('is-hidden');
  setupChartDefaults(); recalc(); setQty(UI.qty); renderAll();
  for (let d = POS.day; d >= 0; d--) {
    const e = MK.events[d];
    if (e && d * KEYMUL + e.tick <= posKey(POS)) { $('news-bar').textContent = `📰 NEWS (${shortDate(d)} ${tickTime(e.tick)}): ${e.ev.title}`; break; }
  }
  setInterval(loop, 250);
  startTips();
  if (S.solo) soloInit(); else netInit();
}
function joinError(msg) { const e = $('join-error'); e.textContent = msg; e.classList.remove('is-hidden'); }

function initJoin() {
  if (LINK_CLASS) { $('in-class').value = LINK_CLASS; $('in-class').readOnly = true; }
  $('btn-start').addEventListener('click', () => {
    const nick = $('in-nick').value.trim().replace(/\s+/g, ' '), code = $('in-class').value.trim().toUpperCase();
    if (!NAME_RE.test(nick)) return joinError('Please type your first name and the first letter of your last name (letters only). Example: Liam T');
    if (!/^[A-Z0-9]{3,12}$/.test(code)) return joinError('Class code: 3 to 12 letters or numbers.');
    S = newState(nick, code); saveState(); startGame();
  });
  $('btn-solo').addEventListener('click', () => {
    const nick = $('in-nick').value.trim().replace(/\s+/g, ' '), code = $('in-class').value.trim().toUpperCase();
    if (!NAME_RE.test(nick)) return joinError('Please type your first name and the first letter of your last name (letters only). Example: Liam T');
    if (!/^[A-Z0-9]{3,12}$/.test(code)) return joinError('Class code: 3 to 12 letters or numbers.');
    S = newState(nick, code); S.solo = true; saveState(); startGame();
  });
  $('btn-solo-go').addEventListener('click', soloGo);
  $('btn-solo-finish').addEventListener('click', () => { if (confirm('Finish your game now? You cannot trade after this.')) soloFinish(); });
  $('btn-show-restore').addEventListener('click', () => $('restore-box').classList.toggle('is-hidden'));
  $('btn-restore').addEventListener('click', () => {
    try {
      const p = decodeCode($('in-restore').value);
      if (LINK_CLASS && p.classCode.toUpperCase() !== LINK_CLASS) return joinError('That save code is for a different class.');
      S = { ...newState(p.nick, p.classCode.toUpperCase()), trades: p.trades, gmin: START_GMIN }; saveState(); startGame();
    } catch (e) { joinError('That save code did not work. Check you copied all of it.'); }
  });
  ['in-nick', 'in-class'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-start').click(); }));
}

document.addEventListener('DOMContentLoaded', () => {
  buildHelp(); wireEvents(); initJoin();
  S = loadState();
  if (S && LINK_CLASS && S.classCode !== LINK_CLASS) S = null;   // saved game is from a different class
  if (S) startGame();
});

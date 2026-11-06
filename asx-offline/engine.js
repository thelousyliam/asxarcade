'use strict';
/* =====================================================================
   ENGINE – shared by the student game (index.html) and the teacher
   dashboard (master.html). No page code in here, only rules and maths.

   KEY IDEAS
   - TIME: 10 real seconds = 1 market day (SECONDS_PER_MARKET_DAY). The market is open
     10:00 AM – 4:00 PM Mon–Fri game time. Prices change twice a day (TICKS = 2: at 1:00 PM
     and again at the next open). Overnight and weekends are skipped instantly (FF_MIN_PER_SEC).
     The TEACHER's page owns the clock (start / pause); students only follow it.
   - The only thing a student saves is a TRADE LOG. Cash, shares, tax, dividends
     and net worth are re-calculated from it (computeAccount), so scores cannot
     be edited.
   - Prices come from a PRICE PROVIDER (MockMarket), seeded by the CLASS CODE:
     everyone in a class sees the same prices and news. To use real prices later,
     write a provider with the same methods: ensure(day), price(sym,day,tick),
     dividend(sym,day), events[day].
   ===================================================================== */

/* ---------- GAME SETTINGS (change numbers here) ---------- */
const START_CASH = 50000;          // virtual dollars
const BROKERAGE = 10;              // flat fee per trade
const TAX_RATE = 0.30;             // simple flat tax rate on capital gains
const CGT_DISCOUNT = 0.5;          // 50% discount on long-held profits
const SETTLE_DAYS = 4;             // money from a sale arrives this many market days later (T+4)
const SECONDS_PER_MARKET_DAY = 10; // 10 real seconds = 1 market day  <-- CHANGE THE GAME SPEED HERE
const YEAR_DAYS = 30;              // 1 "tax year" = 30 market days = 5 real minutes (30 x 10 s).
                                   // Tax Day happens every tax year, and a share held a full tax year
                                   // gets the 50% CGT discount. Formula: minutes x 60 / SECONDS_PER_MARKET_DAY.
const DIV_EVERY = 2;               // dividends are paid every 2 market days
const DIV_BOOST = 1;               // 1 = realistic yearly dividend. Use 2 or 3 to make dividends bigger.
const DIV_FRACTION = DIV_BOOST * DIV_EVERY / YEAR_DAYS; // each payout = this share of the company's yearly yield
const OPEN_MIN = 600, CLOSE_MIN = 960; // 10:00 AM – 4:00 PM
const MIN_PER_TICK = 180;          // price steps inside a market day: 180 game-minutes = 2 steps (10 AM-1 PM, 1 PM-4 PM)
const TICKS = (CLOSE_MIN - OPEN_MIN) / MIN_PER_TICK; // price steps per market day (= 2)
const VOL_SCALE = 0.7;             // 1 = full normal wiggle. Lower = calmer, more gradual price moves (news jumps are not affected).
const PTS = TICKS + 1;             // price points per day (open ... close)
const KEYMUL = 1000;               // position key = day * KEYMUL + tick
const GAME_MIN_PER_SEC = (CLOSE_MIN - OPEN_MIN) / SECONDS_PER_MARKET_DAY; // = 36 game-minutes per real second
const FF_MIN_PER_SEC = 1e7;        // closed time (overnight / weekend) is skipped instantly, so a day is really SECONDS_PER_MARKET_DAY long
const START_DATE = new Date(2026, 10, 9); // Monday 9 Nov 2026 (game calendar)
const START_GMIN = OPEN_MIN;       // game starts at 10:00 AM on day 0
const PROTO = 3;                   // version of the teacher <-> student messages (an old cached page is turned away)
const HIST_DAYS = 1300;            // pretend price history before the game starts (so the 1-year and 5-year charts are not empty)
const EVENT_GAP_MIN = 8, EVENT_GAP_MAX = 16;   // random news every 8-16 market days (about every 1.5-2.5 real minutes). Change these two numbers for more or fewer events.
const CUSTOM_DUR = 15;             // a teacher-written event keeps pushing prices for 15 market days

/* ---------- DUMMY MARKET DATA (pretend prices – not real) ---------- */
const SECTORS = ['Mining', 'Gold', 'Banking', 'Tech', 'Healthcare', 'Retail'];
const SECTOR_INFO = {
  Mining:     { icon: '⛏️', color: '#34d399', easy: 'Digging up iron and other metals' },
  Gold:       { icon: '🪙', color: '#fbbf24', easy: 'Digging up gold' },
  Banking:    { icon: '🏦', color: '#38bdf8', easy: 'Banks and loans' },
  Tech:       { icon: '💻', color: '#e879f9', easy: 'Computers and apps' },
  Healthcare: { icon: '💊', color: '#a78bfa', easy: 'Medicine and health' },
  Retail:     { icon: '🛍️', color: '#fb7185', easy: 'Shops' }
};
const CASH_COLOR = '#64748b';

/* 6 sectors x 2 companies */
const STOCKS = [
  { sym: 'BHP', name: 'BHP Group',          sector: 'Mining',     price: 45.20,  vol: 0.26, yield: 0.050 },
  { sym: 'RIO', name: 'Rio Tinto',          sector: 'Mining',     price: 118.50, vol: 0.27, yield: 0.050 },
  { sym: 'NST', name: 'Northern Star',      sector: 'Gold',       price: 24.50,  vol: 0.32, yield: 0.015 },
  { sym: 'EVN', name: 'Evolution Mining',   sector: 'Gold',       price: 5.80,   vol: 0.36, yield: 0.012 },
  { sym: 'CBA', name: 'Commonwealth Bank',  sector: 'Banking',    price: 152.30, vol: 0.18, yield: 0.035 },
  { sym: 'NAB', name: 'National Aus. Bank', sector: 'Banking',    price: 39.70,  vol: 0.19, yield: 0.050 },
  { sym: 'XRO', name: 'Xero',               sector: 'Tech',       price: 148.00, vol: 0.40, yield: 0 },
  { sym: 'WTC', name: 'WiseTech Global',    sector: 'Tech',       price: 72.40,  vol: 0.42, yield: 0.002 },
  { sym: 'CSL', name: 'CSL',                sector: 'Healthcare', price: 243.60, vol: 0.22, yield: 0.012 },
  { sym: 'RMD', name: 'ResMed',             sector: 'Healthcare', price: 41.90,  vol: 0.28, yield: 0.008 },
  { sym: 'WOW', name: 'Woolworths',         sector: 'Retail',     price: 30.40,  vol: 0.17, yield: 0.030 },
  { sym: 'JBH', name: 'JB Hi-Fi',           sector: 'Retail',     price: 98.30,  vol: 0.27, yield: 0.045 }
];
const STOCK = {}; const SYM_INDEX = {};
STOCKS.forEach((s, i) => { STOCK[s.sym] = s; SYM_INDEX[s.sym] = i; });

/* ---------- NEWS ----------
   An event is { icon, title, text, fx } where fx = { Sector: level } and level is -2, -1, +1 or +2
   (+2 = big rise, -2 = big fall). Random events are made by makeAutoEvent(); the teacher can also write their own. */
const STORIES = {
  Mining: {
    up:   [{ icon: '🚢', title: 'China wants more iron ore', text: 'Mines sell more metal. Mining companies earn more money.', short: 'Mines sell more metal.' },
           { icon: '⛏️', title: 'Big new mine opens', text: 'A huge new mine starts work. Mining companies will dig up more metal.', short: 'A big new mine opens.' }],
    down: [{ icon: '🪧', title: 'Mine workers go on strike', text: 'The mines stop work. There is less metal to sell.', short: 'Mine workers stop work.' },
           { icon: '📉', title: 'Metal prices fall', text: 'Metals are worth less around the world. Miners earn less.', short: 'Metal is worth less.' }]
  },
  Gold: {
    up:   [{ icon: '🥇', title: 'Gold hits a record price', text: 'People buy gold when they feel worried. Gold miners earn more.', short: 'Gold price is very high.' },
           { icon: '💍', title: 'Everyone wants gold', text: 'Banks and families around the world are buying lots of gold.', short: 'Many people buy gold.' }],
    down: [{ icon: '📉', title: 'Gold price drops', text: 'Investors feel safe again, so they sell gold. Gold miners earn less.', short: 'Gold price drops.' },
           { icon: '🚧', title: 'Gold mine has an accident', text: 'A big gold mine must close for repairs. There is less gold to sell.', short: 'A gold mine closes.' }]
  },
  Banking: {
    up:   [{ icon: '🏦', title: 'Banks report big profits', text: 'Banks made lots of money this year. Bank shares look good.', short: 'Banks make big profits.' },
           { icon: '📈', title: 'Interest rates go UP', text: 'Loans cost more, so banks earn more money.', short: 'Banks earn more from loans.' }],
    down: [{ icon: '💸', title: 'People cannot pay their loans', text: 'Many people cannot pay back their loans. Banks lose money.', short: 'Banks lose money on loans.' },
           { icon: '📉', title: 'Interest rates go DOWN', text: 'Loans are cheaper, so banks earn less money.', short: 'Banks earn less from loans.' }]
  },
  Tech: {
    up:   [{ icon: '💡', title: 'New tech invention!', text: 'A new app changes how people work. Tech companies are very excited.', short: 'A new app excites people.' },
           { icon: '🤖', title: 'Everyone wants smart computers', text: 'Companies buy lots of new software. Tech companies sell more.', short: 'Companies buy new software.' }],
    down: [{ icon: '🦠', title: 'Big computer hack', text: 'Hackers attack many companies. People are scared of tech.', short: 'Hackers attack computers.' },
           { icon: '🔌', title: 'Computer systems crash', text: 'A big computer problem stops many websites. People stop trusting tech companies.', short: 'Computer systems crash.' }]
  },
  Healthcare: {
    up:   [{ icon: '💉', title: 'New medicine approved', text: 'A new medicine can help many people. Health companies grow.', short: 'A new medicine is approved.' },
           { icon: '🏥', title: 'More people need health care', text: 'There are more older people. Health companies sell more.', short: 'More people need health care.' }],
    down: [{ icon: '⚠️', title: 'Medical device recall', text: 'A health product has a problem. Health companies must fix it.', short: 'A health product has a problem.' },
           { icon: '💊', title: 'Medicine prices are cut', text: 'The government makes medicines cheaper. Health companies earn less.', short: 'Medicine prices are cut.' }]
  },
  Retail: {
    up:   [{ icon: '🎁', title: 'Big shopping season', text: 'Everyone is buying gifts. Shops sell a lot!', short: 'Shops sell a lot.' },
           { icon: '💰', title: 'People get a pay rise', text: 'People have more money to spend. Shops sell more.', short: 'People spend more.' }],
    down: [{ icon: '🛒', title: 'Cost of living goes up', text: 'Food and bills cost more. People spend less in shops.', short: 'People spend less in shops.' },
           { icon: '🏬', title: 'Shoppers stay home', text: 'Fewer people go to the shops. Shops sell less.', short: 'Fewer people go shopping.' }]
  }
};
const GLOBAL_STORIES = {
  crash: [{ icon: '💥', title: 'World share markets fall', text: 'Investors are scared all over the world. Almost all shares drop.', fx: { Mining: -2, Gold: -1, Banking: -2, Tech: -2, Healthcare: -1, Retail: -2 } },
          { icon: '🌪️', title: 'Big money panic', text: 'Banks around the world are in trouble. People sell shares fast. Most shares drop.', fx: { Mining: -2, Gold: -1, Banking: -2, Tech: -2, Healthcare: -1, Retail: -2 } }],
  rise:  [{ icon: '🌱', title: 'The economy is growing fast', text: 'More jobs and more money. Most companies do well.', fx: { Mining: 2, Gold: 1, Banking: 2, Tech: 2, Healthcare: 1, Retail: 2 } },
          { icon: '🎉', title: 'World share markets boom', text: 'Investors feel happy all over the world. Most shares rise.', fx: { Mining: 2, Gold: 1, Banking: 2, Tech: 2, Healthcare: 1, Retail: 2 } }]
};
const MIXED_TITLES = ['Mixed news day', 'Winners and losers', 'Some up, some down'];
/* ready-made events for the teacher's Event desk */
const EVENT_PRESETS = [];
SECTORS.forEach(sec => ['up', 'down'].forEach(dir => STORIES[sec][dir].forEach(st => {
  EVENT_PRESETS.push({ label: `${SECTOR_INFO[sec].icon} ${st.title}`, icon: st.icon, title: st.title, text: st.text, fx: { [sec]: dir === 'up' ? 2 : -2 } });
})));
['crash', 'rise'].forEach(k => GLOBAL_STORIES[k].forEach(g => EVENT_PRESETS.push({ label: `🌍 ${g.title}`, icon: g.icon, title: g.title, text: g.text, fx: { ...g.fx } })));

const pickOne = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function shuffled(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/* a "deck" of 20 events: 50% one sector (5 up + 5 down), 30% mixed, 10% world crash, 10% world rise. Shuffled, then dealt one by one,
   so the mix is fair even in a short game. */
function buildDeck(rng) {
  const d = [];
  for (let i = 0; i < 5; i++) d.push('up', 'down');
  for (let i = 0; i < 6; i++) d.push('mixed');
  d.push('crash', 'crash', 'rise', 'rise');
  return shuffled(d, rng);
}
function makeAutoEvent(kind, rng) {
  const lvl = () => (rng() < 0.5 ? 1 : 2);
  if (kind === 'crash' || kind === 'rise') { const g = pickOne(GLOBAL_STORIES[kind], rng); return { icon: g.icon, title: g.title, text: g.text, fx: { ...g.fx } }; }
  if (kind === 'up' || kind === 'down') {
    const sec = pickOne(SECTORS, rng), st = pickOne(STORIES[sec][kind], rng);
    return { icon: st.icon, title: st.title, text: st.text, fx: { [sec]: kind === 'up' ? lvl() : -lvl() } };
  }
  const order = shuffled(SECTORS, rng), nUp = 1 + Math.floor(rng() * 2), nDown = 1 + Math.floor(rng() * 2);
  const ups = order.slice(0, nUp), downs = order.slice(nUp, nUp + nDown), fx = {}, lines = [];
  ups.forEach(sec => { fx[sec] = lvl(); lines.push(`${SECTOR_INFO[sec].icon} ${pickOne(STORIES[sec].up, rng).short}`); });
  downs.forEach(sec => { fx[sec] = -lvl(); lines.push(`${SECTOR_INFO[sec].icon} ${pickOne(STORIES[sec].down, rng).short}`); });
  return { icon: '📰', title: pickOne(MIXED_TITLES, rng), text: lines.join(' '), fx };
}
/* check a list of teacher-written events that came over the network (never trust it) */
function cleanText(v, max) { return String(v == null ? '' : v).replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function cleanCustomEvents(list) {
  if (!Array.isArray(list)) return [];
  const out = [], seen = {};
  list.slice(0, 60).forEach(c => {
    if (!c || typeof c !== 'object') return;
    const day = c.day, tick = c.tick;
    if (!Number.isInteger(day) || day < 0 || day > 20000 || !Number.isInteger(tick) || tick < 0 || tick >= TICKS || seen[day]) return;
    const fx = {};
    if (c.fx && typeof c.fx === 'object') SECTORS.forEach(sec => { const m = c.fx[sec]; if (Number.isInteger(m) && m >= -2 && m <= 2 && m !== 0) fx[sec] = m; });
    if (!Object.keys(fx).length) return;
    const title = cleanText(c.title, 60); if (!title) return;
    seen[day] = true;
    out.push({ day, tick, icon: cleanText(c.icon, 8) || '📰', title, text: cleanText(c.text, 240), fx });
  });
  return out.sort((a, b) => a.day - b.day);
}

/* ---------- SMALL HELPERS ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYNAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function money(n) {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return (n < -0.004 ? '-' : '') + '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function arrow(n) { return n > 0.00005 ? '▲' : n < -0.00005 ? '▼' : '■'; }
function cls(n) { return n > 0.00005 ? 'up' : n < -0.00005 ? 'down' : 'flat'; }
function pctText(n) { return Math.abs(n * 100).toFixed(2) + '%'; }

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randn(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* ---------- GAME CLOCK ----------
   gmin = game minutes since 00:00 on Monday 9 Nov 2026 (weekends included).
   A "position" {day, tick} says which market day and PRICE-step we are at.
   day = market day number (Mon-Fri only). tick 0 = 10:00 open ... tick 72 = 4:00 PM close. */
function calDay(g) { return Math.floor(g / 1440); }
function isOpen(g) { const c = calDay(g), m = g - c * 1440; return (c % 7) < 5 && m >= OPEN_MIN && m < CLOSE_MIN; }
function posOf(g) {
  const c = calDay(g), dow = c % 7, m = g - c * 1440;
  if (dow >= 5) return { day: Math.floor(c / 7) * 5 + 4, tick: TICKS };      // weekend: Friday's close
  const d = Math.floor(c / 7) * 5 + dow;
  if (m < OPEN_MIN) return d === 0 ? { day: 0, tick: 0 } : { day: d - 1, tick: TICKS }; // before open: last close
  return { day: d, tick: Math.min(TICKS, Math.floor((m - OPEN_MIN) / MIN_PER_TICK)) };
}
function posKey(p) { return p.day * KEYMUL + p.tick; }
function nextOpenG(g) {
  let c = calDay(g); const m = g - c * 1440;
  if ((c % 7) < 5 && m < OPEN_MIN) return c * 1440 + OPEN_MIN;
  do { c++; } while ((c % 7) >= 5);
  return c * 1440 + OPEN_MIN;
}
function closeG(g) { return calDay(g) * 1440 + CLOSE_MIN; }
/* game minute of a market position (inverse of posOf) */
function gOfPos(day, tick) { return (Math.floor(day / 5) * 7 + (day % 5)) * 1440 + OPEN_MIN + tick * MIN_PER_TICK; }
/* move the game clock forward by `secs` real seconds (market hours slow, closed time fast) */
function advanceG(g, secs) {
  for (let guard = 0; secs > 1e-9 && guard < 60; guard++) {
    const open = isOpen(g), rate = open ? GAME_MIN_PER_SEC : FF_MIN_PER_SEC, target = open ? closeG(g) : nextOpenG(g);
    const room = (target - g) / rate;
    if (secs >= room) { g = target; secs -= room; } else { g += secs * rate; secs = 0; }
  }
  return g;
}
/* real seconds of RUNNING time between two game minutes (closed time is skipped instantly, so it counts as 0) */
function realSecsBetween(a, b) {
  let secs = 0, g = a;
  for (let guard = 0; g < b - 1e-9 && guard < 800; guard++) {
    if (isOpen(g)) { const end = Math.min(b, closeG(g)); secs += (end - g) / GAME_MIN_PER_SEC; g = end; }
    else g = Math.min(b, nextOpenG(g));
  }
  return secs;
}
function marketDate(day) { const w = Math.floor(day / 5), d = new Date(START_DATE); d.setDate(d.getDate() + w * 7 + (day - w * 5)); return d; }   // works for days before the game too
function gDate(g) { const d = new Date(START_DATE); d.setDate(d.getDate() + calDay(g)); return d; }
function shortDate(day) { const d = marketDate(day); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function timeText(minOfDay) {
  const h = Math.floor(minOfDay / 60), m = Math.floor(minOfDay % 60), ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
function tickTime(tick) { return timeText(OPEN_MIN + tick * MIN_PER_TICK); }
function dayName(d) { return DAYNAMES[(d.getDay() + 6) % 7]; }
function daysToTaxDay(day) { return YEAR_DAYS - (day % YEAR_DAYS); }

/* ---------- PRICE PROVIDER (mock market) ---------- */
/* pretend price history BEFORE the game (daily closes, newest first: [0] = the day before day 0). Only used for the long charts. */
function genHistory(seed) {
  const rng = mulberry32(hashStr('asx-hist-3|' + String(seed).trim().toLowerCase())), N = HIST_DAYS, out = {};
  const mk = [], sc = {};
  for (let i = 0; i < N; i++) mk.push(0.006 * randn(rng));
  SECTORS.forEach(sec => { sc[sec] = []; for (let i = 0; i < N; i++) sc[sec].push(0.005 * randn(rng)); });
  STOCKS.forEach(s => {
    const a = [s.price]; let p = s.price;
    for (let k = 1; k < N; k++) {
      const r = 0.0003 + mk[k] + sc[s.sector][k] + (s.vol / Math.sqrt(252)) * 0.7 * randn(rng);   // that day's return
      p = Math.max(0.5, p / Math.exp(r)); a.push(Math.round(p * 100) / 100);
    }
    out[s.sym] = a;
  });
  return out;
}

class MockMarket {
  constructor(seedText) {
    this.seed = String(seedText).trim().toLowerCase();
    this.hist = genHistory(this.seed);
    this.custom = {};           // day -> teacher-written event {day,tick,icon,title,text,fx}
    this.customList = [];
    this._init();
  }
  _init() {
    this.rng = mulberry32(hashStr('asx-arcade-3|' + this.seed));
    this.days = 0;              // number of market days generated so far
    this.prices = {};           // sym -> flat array, index = day * PTS + tick
    STOCKS.forEach(s => { this.prices[s.sym] = []; });
    this.events = {};           // day -> { ev, dur, day, tick }
    this.active = [];           // news effects still running
    this.deck = [];             // the shuffled deck of event kinds
    this.nextEventDay = 3 + Math.floor(this.rng() * 4);   // first news on day 3-6
    this.ensure(0);
  }
  /* Install the teacher's events. The market is made again from the start with the same random numbers, so every price BEFORE a
     teacher event is exactly the same as before (only prices after it change). Events must be set for the future only. */
  setCustom(list) {
    const keep = Math.max(1, this.days);
    this.customList = cleanCustomEvents(list); this.custom = {};
    this.customList.forEach(c => { this.custom[c.day] = c; });
    this._init(); this.ensure(keep - 1);
  }
  ensure(day) { while (this.days <= day) this.genDay(this.days++); }
  price(sym, day, tick) {
    if (day < 0) return this.hist[sym][Math.min(-day - 1, HIST_DAYS - 1)];   // before the game: daily closes only
    this.ensure(day); return this.prices[sym][day * PTS + tick];
  }
  dividend(sym, day) {
    if (day <= 0 || day % DIV_EVERY !== 0) return 0;
    return Math.round(this.price(sym, day - 1, TICKS) * STOCK[sym].yield * DIV_FRACTION * 10000) / 10000;   // dollars per share (4 decimals; paid out rounded to cents in total)
  }
  genDay(d) {
    const rng = this.rng;
    let evTick = -1, evObj = null;
    if (d >= this.nextEventDay) {                      // a news event happens today (every EVENT_GAP_MIN-EVENT_GAP_MAX market days)
      if (!this.deck.length) this.deck = buildDeck(rng);
      const kind = this.deck.pop();
      const ev = makeAutoEvent(kind, rng);
      const dur = 10 + Math.floor(rng() * 11);         // the story keeps pushing prices for 10-20 market days
      evTick = Math.max(1, Math.floor(TICKS * 0.08)) + Math.floor(rng() * Math.floor(TICKS * 0.77));   // somewhere in the middle of the day
      this.events[d] = { ev, dur, day: d, tick: evTick };
      evObj = { ev, dur };
      this.nextEventDay = d + EVENT_GAP_MIN + Math.floor(rng() * (EVENT_GAP_MAX - EVENT_GAP_MIN + 1));
    }
    const c = this.custom[d];                          // a teacher-written event takes the place of the random one (the random numbers above were still used, so nothing else shifts)
    if (c) {
      evTick = c.tick; evObj = { ev: { icon: c.icon, title: c.title, text: c.text, fx: c.fx }, dur: CUSTOM_DUR };
      this.events[d] = { ev: evObj.ev, dur: CUSTOM_DUR, day: d, tick: evTick, custom: true };
    }
    const JUMP = 0.03, DRIFT = 0.003, sq = Math.sqrt(TICKS) / VOL_SCALE;
    for (let t = 0; t <= TICKS; t++) {
      if (d === 0 && t === 0) { STOCKS.forEach(s => this.prices[s.sym].push(s.price)); continue; }
      if (evObj && t === evTick) this.active.push({ fx: evObj.ev.fx, left: evObj.dur * TICKS, jump: true });
      const push = {}; SECTORS.forEach(s => { push[s] = 0; });
      this.active.forEach(a => {
        for (const sec in a.fx) push[sec] += a.fx[sec] * DRIFT / TICKS + (a.jump ? a.fx[sec] * JUMP : 0);
        a.jump = false; a.left--;
      });
      this.active = this.active.filter(a => a.left > 0);
      const gap = (t === 0);                           // t = 0 is the opening price (overnight gap)
      const mkt = gap ? 0.004 * VOL_SCALE * randn(rng) : 0.0003 / TICKS + (0.008 / sq) * randn(rng);
      const sec = {}; SECTORS.forEach(s => { sec[s] = (gap ? 0.002 * VOL_SCALE : 0.004 / sq) * randn(rng); });
      STOCKS.forEach(s => {
        const idio = (s.vol / Math.sqrt(252)) * (gap ? 0.4 * VOL_SCALE : 0.9 / sq) * randn(rng);
        const arr = this.prices[s.sym], prev = arr[arr.length - 1];
        const p = prev * Math.exp(mkt + sec[s.sector] + push[s.sector] + idio);
        arr.push(Math.max(0.5, Math.round(p * 100) / 100));
      });
    }
  }
}
function makeMarket(classCode) { return new MockMarket(classCode); }

/* ---------- ACCOUNT ENGINE (rebuilds everything from the trade log) ---------- */
function qtyOf(lots) { return lots.reduce((a, l) => a + l.qty, 0); }

function consumeLots(arr, qty, px, day, fee) {
  const out = []; let need = qty;
  while (need > 0 && arr.length) {
    const lot = arr[0], take = Math.min(need, lot.qty);
    out.push({ qty: take, gain: take * px - fee * take / qty - take * lot.cps, long: (day - lot.day) >= YEAR_DAYS });
    lot.qty -= take; need -= take;
    if (lot.qty <= 0) arr.shift();
  }
  return out;
}

function calcTax(gains, carry) {
  let S = -carry, L = 0;                               // S = short-term, L = held YEAR_DAYS or more (50% discount)
  gains.forEach(g => { if (g.long) L += g.gain; else S += g.gain; });
  if (S < 0 && L > 0) { const x = Math.min(-S, L); S += x; L -= x; }   // losses cancel gains
  else if (L < 0 && S > 0) { const x = Math.min(-L, S); L += x; S -= x; }
  const taxable = Math.max(S, 0) + Math.max(L, 0) * (1 - CGT_DISCOUNT);
  return { tax: Math.round(taxable * TAX_RATE * 100) / 100, taxable, loss: Math.max(0, -(Math.min(S, 0) + Math.min(L, 0))) };
}

/* profit you have NOT locked in yet (shares you still own, valued at today's price). Used to show a live tax estimate. */
function paperGains(lots, day, tick, mkt) {
  const out = [];
  STOCKS.forEach(s => {
    const px = mkt.price(s.sym, day, tick);
    lots[s.sym].forEach(l => out.push({ gain: l.qty * (px - l.cps), long: (day - l.day) >= YEAR_DAYS }));
  });
  return out;
}

/* trades: [{day, tick, sym, side:'B'|'S', qty}]   upTo: {day, tick} */
function computeAccount(trades, upTo, mkt) {
  mkt.ensure(upTo.day);
  const uk = posKey(upTo);
  const sorted = trades.map((t, i) => ({ ...t, i })).filter(t => posKey(t) <= uk)
    .sort((a, b) => a.day - b.day || a.tick - b.tick || a.i - b.i);
  let cash = START_CASH, pending = [], fyGains = [], carry = 0, ti = 0;
  const lots = {}; STOCKS.forEach(s => { lots[s.sym] = []; });
  const ledger = [], history = [];
  let divTotal = 0, taxPaid = 0, feesTotal = 0;

  for (let day = 0; day <= upTo.day; day++) {
    if (day > 0) {
      pending = pending.filter(p => { if (p.settleDay <= day) { cash += p.amount; return false; } return true; }); // pending money arrives (T+SETTLE_DAYS)
      if (day % DIV_EVERY === 0) {                                   // dividends
        STOCKS.forEach(s => {
          const q = qtyOf(lots[s.sym]); if (q <= 0) return;
          const dps = mkt.dividend(s.sym, day);
          if (dps > 0) {
            const amt = Math.round(q * dps * 100) / 100;
            cash += amt; divTotal += amt;
            ledger.push({ day, tick: 0, type: 'dividend', sym: s.sym, qty: q, dps, amount: amt });
          }
        });
      }
      if (day % YEAR_DAYS === 0) {                                   // Tax Day
        const r = calcTax(fyGains, carry);
        cash -= r.tax; taxPaid += r.tax; carry = r.loss; fyGains = [];
        ledger.push({ day, tick: 0, type: 'tax', amount: -r.tax, taxable: r.taxable, loss: r.loss });
      }
    }
    const limit = day === upTo.day ? upTo.tick : TICKS;
    while (ti < sorted.length && sorted[ti].day === day) {
      const t = sorted[ti++], px = mkt.price(t.sym, day, t.tick);
      if (t.side === 'B') {
        const cost = t.qty * px + BROKERAGE;
        if (cost <= cash + 1e-9) {
          cash -= cost; feesTotal += BROKERAGE;
          lots[t.sym].push({ qty: t.qty, cps: cost / t.qty, day });
          ledger.push({ day, tick: t.tick, type: 'buy', sym: t.sym, qty: t.qty, price: px, amount: -cost });
        }
      } else if (t.qty <= qtyOf(lots[t.sym])) {
        const net = t.qty * px - BROKERAGE; feesTotal += BROKERAGE;
        consumeLots(lots[t.sym], t.qty, px, day, BROKERAGE).forEach(g => fyGains.push({ gain: g.gain, long: g.long }));
        pending.push({ amount: net, settleDay: day + SETTLE_DAYS, sym: t.sym });
        ledger.push({ day, tick: t.tick, type: 'sell', sym: t.sym, qty: t.qty, price: px, amount: net, settleDay: day + SETTLE_DAYS });
      }
    }
    let hv = 0; STOCKS.forEach(s => { hv += qtyOf(lots[s.sym]) * mkt.price(s.sym, day, limit); });
    const pendSum = pending.reduce((a, p) => a + p.amount, 0);
    history.push(cash + pendSum + hv - calcTax(fyGains.concat(paperGains(lots, day, limit, mkt)), carry).tax);
  }

  const qty = {}; let holdVal = 0;
  STOCKS.forEach(s => { qty[s.sym] = qtyOf(lots[s.sym]); holdVal += qty[s.sym] * mkt.price(s.sym, upTo.day, upTo.tick); });
  const pendingSum = pending.reduce((a, p) => a + p.amount, 0);
  const taxEst = calcTax(fyGains, carry).tax;                                   // tax you will pay on Tax Day from shares you have already SOLD
  const paper = paperGains(lots, upTo.day, upTo.tick, mkt);
  const paperGain = paper.reduce((a, g) => a + g.gain, 0);                      // profit on shares you still own (not sold yet)
  const realGain = fyGains.reduce((a, g) => a + g.gain, 0);                     // profit on shares sold since the last Tax Day
  const taxAll = calcTax(fyGains.concat(paper), carry).tax;                     // live estimate: tax if you sold everything right now
  const gainYear = realGain + paperGain;
  return {
    pos: upTo, cash, pending, pendingSum, lots, qty, holdVal, taxEst, taxAll,
    gainYear, realGain, paperGain, taxPct: gainYear > 0.005 ? taxAll / gainYear : 0,
    nw: cash + pendingSum + holdVal - taxAll,
    history, ledger, divTotal, taxPaid, feesTotal
  };
}

/* ---------- TRADE LOG <-> TEXT (cloud + save code) ---------- */
function encodeTrades(trades) {
  return trades.map(t => [t.day, t.tick, SYM_INDEX[t.sym], t.side === 'B' ? 0 : 1, t.qty].join(',')).join(';');
}
function parseTrades(str) {
  if (typeof str !== 'string') throw new Error('bad trades');
  if (!str) return [];
  return str.split(';').map(part => {
    const r = part.split(',').map(Number);
    if (r.length !== 5) throw new Error('bad trade');
    const [day, tick, si, side, qty] = r;
    if (!Number.isInteger(day) || day < 0 || day > 20000 || !Number.isInteger(tick) || tick < 0 || tick > TICKS ||
        !STOCKS[si] || (side !== 0 && side !== 1) || !Number.isInteger(qty) || qty < 1 || qty > 1000000) throw new Error('bad trade');
    return { day, tick, sym: STOCKS[si].sym, side: side === 0 ? 'B' : 'S', qty };
  });
}
function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); }
function b64dec(b64) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function encodeCode(st) {
  return 'ASX2.' + b64enc(JSON.stringify({ n: st.nick, c: st.classCode, g: Math.floor(st.gmin), tr: encodeTrades(st.trades) }));
}
function decodeCode(text) {
  text = String(text).trim();
  if (!text.startsWith('ASX2.')) throw new Error('Not a game code');
  const o = JSON.parse(b64dec(text.slice(5)));
  if (typeof o.n !== 'string' || typeof o.c !== 'string' || !Number.isFinite(o.g) || o.g < 0 || o.g > 1e8) throw new Error('Bad code');
  return { nick: o.n.slice(0, 20), classCode: o.c.slice(0, 12), gmin: o.g, trades: parseTrades(o.tr) };
}

/* first news event after position a, up to and including position b (or null) */
function eventBetween(MK, a, b) {
  for (let d = a.day; d <= b.day; d++) {
    const e = MK.events[d]; if (!e) continue;
    const k = d * KEYMUL + e.tick;
    if (k > posKey(a) && k <= posKey(b)) return e;
  }
  return null;
}

/* ---------- LIVE ROOM (PeerJS) ---------- */
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,19}$/;   // first name + last initial, e.g. "Liam T"
/* The teacher's dashboard opens a "room" with this id; students connect to it with the class code. */
function hostPeerId(code) { return 'asxarcade26-' + String(code).toLowerCase().replace(/[^a-z0-9]/g, ''); }

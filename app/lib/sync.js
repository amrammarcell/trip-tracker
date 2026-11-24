// Google Sheets sync: pull (public link or Apps Script) and push (Apps Script)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { importExcel, importFromSheets, gridsToSheets } = require('./xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CFG = path.join(DATA_DIR, 'sync.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const SCRIPT_TEMPLATE = path.join(__dirname, '..', 'google-apps-script', 'Code.gs');

function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) {}
  if (!c.token) { c.token = crypto.randomBytes(18).toString('base64url'); saveConfig(c); }
  return { sheetUrl: '', scriptUrl: '', auto: false, dirty: false, lastPull: null, lastPush: null, ...c };
}
function saveConfig(c) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
}

const sheetId = url => (String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];

function scriptText(cfg) {
  return fs.readFileSync(SCRIPT_TEMPLATE, 'utf8').replace('__TOKEN__', cfg.token);
}

function backupLocal(state) {
  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(BACKUPS, `db-${ts}.json`), JSON.stringify(state, null, 2));
  const files = fs.readdirSync(BACKUPS).filter(f => f.startsWith('db-')).sort();
  files.slice(0, Math.max(0, files.length - 30)).forEach(f => fs.unlinkSync(path.join(BACKUPS, f)));
}

const doneKey = (dayLabel, i) => [dayLabel, i.start, i.activity, i.location].join('|');

// App-only data that has no place in the original sheet layout
function buildMeta(state) {
  const dayLabel = Object.fromEntries(state.days.map(d => [d.id, d.label]));
  return {
    trip: { name: state.trip.name, budget: state.trip.budget || 0, categories: state.trip.categories },
    payments: state.payments || [],
    done: state.itinerary.filter(i => i.done).map(i => doneKey(dayLabel[i.dayId], i)),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchJson(url, opts) {
  const r = await fetch(url, { redirect: 'follow', ...opts });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) {
    if (/<html/i.test(text)) throw new Error('Apps Script membalas halaman HTML — pastikan deploy sebagai Web app dengan akses "Anyone" dan URL berakhiran /exec');
    throw new Error('Respons tidak valid dari Apps Script');
  }
  if (j.error) throw new Error(j.error);
  return j;
}

async function pull(cfg, local) {
  let imported, meta = null;
  if (cfg.scriptUrl) {
    const u = new URL(cfg.scriptUrl);
    u.searchParams.set('token', cfg.token); u.searchParams.set('action', 'pull');
    const j = await fetchJson(u);
    imported = importFromSheets(gridsToSheets(j.sheets));
    meta = j.meta;
  } else {
    const id = sheetId(cfg.sheetUrl);
    if (!id) throw new Error('Link Google Sheet belum diisi atau tidak valid');
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.includes('spreadsheetml')) throw new Error('Sheet tidak bisa diakses. Pastikan General access = "Anyone with the link" (Viewer), atau pasang Apps Script.');
    imported = importExcel(Buffer.from(await r.arrayBuffer()));
  }
  if (!imported.trip.members.length) throw new Error('Format sheet tidak dikenali (header anggota tidak ditemukan)');

  // Merge app-only fields: from sheet meta if available, otherwise keep local
  const m = meta || buildMeta(local);
  imported.trip.name = m.trip?.name || local.trip.name || imported.trip.name;
  imported.trip.budget = m.trip?.budget ?? local.trip.budget ?? 0;
  for (const c of m.trip?.categories || local.trip.categories || []) if (!imported.trip.categories.includes(c)) imported.trip.categories.push(c);
  imported.payments = (m.payments || []).filter(p => imported.trip.members.includes(p.from) && imported.trip.members.includes(p.to));
  const done = new Set(m.done || []);
  const dayLabel = Object.fromEntries(imported.days.map(d => [d.id, d.label]));
  imported.itinerary.forEach(i => (i.done = done.has(doneKey(dayLabel[i.dayId], i))));
  // Keep local ids stable where an expense is unchanged (nicer for UI; not required)
  const pool = [...local.expenses];
  imported.expenses.forEach(e => {
    const k = pool.findIndex(x => x.desc === e.desc && +x.amount === +e.amount && x.paidBy === e.paidBy && x.date === e.date);
    if (k >= 0) { e.id = pool[k].id; pool.splice(k, 1); }
  });
  imported.importedAt = new Date().toISOString();
  imported.source = cfg.scriptUrl ? 'apps-script' : 'public-link';
  return imported;
}

const pad = n => String(n).padStart(2, '0');
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function sheetDayDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return `${DAYS_EN[d.getUTCDay()]}, ${d.getUTCDate()} ${MON_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function durationText(s, e) {
  if (!s || !e) return '';
  const [h1, m1] = s.split(':').map(Number), [h2, m2] = e.split(':').map(Number);
  let d = h2 * 60 + m2 - (h1 * 60 + m1); if (isNaN(d)) return ''; if (d < 0) d += 1440;
  const h = Math.floor(d / 60), m = d % 60;
  return [h ? `${h} Hour${h > 1 ? 's' : ''}` : '', m ? `${m} Min${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}

function buildItineraryRows(state) {
  const rows = [];
  const days = [...state.days].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  for (const d of days) {
    const items = state.itinerary.filter(i => i.dayId === d.id).sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
    const head = [d.label, sheetDayDate(d.date)];
    if (!items.length) { rows.push([...head, '', '', '', '', '', '']); continue; }
    items.forEach((i, k) => rows.push([
      ...(k === 0 ? head : ['', '']),
      (i.start || '').replace(':', '.'), (i.end || '').replace(':', '.'), durationText(i.start, i.end),
      i.location || '', i.activity || '', i.notes || '',
    ]));
  }
  return rows;
}

async function push(cfg, state) {
  if (!cfg.scriptUrl) throw new Error('Untuk mengirim ke Google Sheet, pasang Apps Script dulu (Pengaturan → Sync)');
  const days = state.trip.start && state.trip.end ? Math.round((new Date(state.trip.end) - new Date(state.trip.start)) / 864e5) + 1 : state.days.length;
  const data = {
    members: state.trip.members,
    expenses: state.expenses.map(e => ({ date: e.date, desc: e.desc, category: e.category, amount: +e.amount || 0, paidBy: e.paidBy, splits: e.splits })),
    itineraryRows: buildItineraryRows(state),
    start: state.trip.start, end: state.trip.end, days,
    meta: buildMeta(state),
  };
  return fetchJson(cfg.scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: cfg.token, action: 'push', data }),
  });
}

module.exports = { loadConfig, saveConfig, scriptText, pull, push, backupLocal, sheetId };

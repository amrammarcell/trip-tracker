// Trip & Split Bill Tracker — zero-dependency Node.js server
const http = require('http');
const fs = require('fs');
const path = require('path');
const { importExcel } = require('./lib/xlsx');
const sync = require('./lib/sync');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB = path.join(ROOT, 'data', 'db.json');
const EXCEL = path.join(ROOT, '..', 'FILE KEUANGAN NEGARA.xlsx');
const PUBLIC = path.join(ROOT, 'public');

function load() {
  if (!fs.existsSync(DB)) {
    fs.mkdirSync(path.dirname(DB), { recursive: true });
    const data = fs.existsSync(EXCEL) ? importExcel(EXCEL) : {
      trip: { name: 'Trip Baru', start: '', end: '', members: [], categories: ['Makan', 'Transportasi', 'Jajan', 'Lain-lain'], budget: 0 },
      expenses: [], days: [], itinerary: [], payments: [],
    };
    save(data);
    console.log(fs.existsSync(EXCEL) ? '✓ Data awal di-import dari Excel' : '! Excel tidak ditemukan, mulai dengan data kosong');
    return data;
  }
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}

function save(data) {
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

let state = load();
let cfg = sync.loadConfig();
const publicCfg = () => ({ sheetUrl: cfg.sheetUrl, scriptUrl: cfg.scriptUrl, auto: cfg.auto, dirty: cfg.dirty, lastPull: cfg.lastPull, lastPush: cfg.lastPush, hasToken: !!cfg.token });
const setCfg = patch => { cfg = { ...cfg, ...patch }; sync.saveConfig(cfg); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/data' && req.method === 'GET') return send(res, 200, state);
    if (url.pathname === '/api/data' && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body || !body.trip || !Array.isArray(body.expenses)) return send(res, 400, { error: 'Data tidak valid' });
      state = body; save(state);
      if (cfg.sheetUrl || cfg.scriptUrl) setCfg({ dirty: true });
      return send(res, 200, { ok: true, sync: publicCfg() });
    }
    // ---- Google Sheets sync ----
    if (url.pathname === '/api/sync' && req.method === 'GET') return send(res, 200, publicCfg());
    if (url.pathname === '/api/sync' && req.method === 'PUT') {
      const b = await readBody(req);
      const patch = {};
      if ('sheetUrl' in b) {
        if (b.sheetUrl && !sync.sheetId(b.sheetUrl)) return send(res, 400, { error: 'Link Google Sheet tidak valid' });
        patch.sheetUrl = String(b.sheetUrl || '').trim();
      }
      if ('scriptUrl' in b) {
        const s = String(b.scriptUrl || '').trim();
        if (s && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(s)) return send(res, 400, { error: 'URL Apps Script harus berbentuk https://script.google.com/macros/s/…/exec' });
        patch.scriptUrl = s;
      }
      if ('auto' in b) patch.auto = !!b.auto;
      setCfg(patch);
      return send(res, 200, publicCfg());
    }
    if (url.pathname === '/api/sync/script' && req.method === 'GET') return send(res, 200, sync.scriptText(cfg), 'text/plain; charset=utf-8');
    if (url.pathname === '/api/sync/pull' && req.method === 'POST') {
      const b = await readBody(req);
      if (cfg.dirty && !b.force) return send(res, 409, { error: 'Ada perubahan lokal yang belum dikirim ke Google Sheet', sync: publicCfg() });
      const next = await sync.pull(cfg, state);
      sync.backupLocal(state);
      state = next; save(state);
      setCfg({ lastPull: new Date().toISOString(), dirty: false });
      return send(res, 200, { state, sync: publicCfg() });
    }
    if (url.pathname === '/api/sync/push' && req.method === 'POST') {
      const result = await sync.push(cfg, state);
      setCfg({ lastPush: new Date().toISOString(), dirty: false });
      return send(res, 200, { result, sync: publicCfg() });
    }
    if (url.pathname === '/api/import' && req.method === 'POST') {
      if (!fs.existsSync(EXCEL)) return send(res, 404, { error: 'File Excel tidak ditemukan: ' + EXCEL });
      state = importExcel(EXCEL); save(state);
      return send(res, 200, state);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Trip & Split Bill Tracker berjalan di  http://localhost:${PORT}\n  (Ctrl+C untuk berhenti)\n`);
});

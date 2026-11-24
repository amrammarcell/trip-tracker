/* Trip & Split Bill Tracker — frontend (vanilla JS) */
let S = null;            // app state (same shape as data/db.json)
let tab = localStorage.getItem('tab') || 'dashboard';
const F = { q: '', cat: '', member: '' }; // expense filters

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const rp = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtShort = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—';
const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#059669', '#dc2626', '#4f46e5', '#0891b2', '#65a30d'];
const color = name => PALETTE[Math.max(0, S.trip.members.indexOf(name)) % PALETTE.length];
const catColor = c => ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'][Math.max(0, S.trip.categories.indexOf(c)) % 6];
const CAT_ICON = { Makan: '🍜', Transportasi: '🚗', Jajan: '🧋', 'Lain-lain': '📦', Penginapan: '🏨', Akomodasi: '🏨', Tiket: '🎟️', Belanja: '🛍️' };
const catIcon = c => CAT_ICON[c] || '💸';
const avatarStack = names => `<span class="stack">${names.slice(0, 5).map(n => avatar(n)).join('')}${names.length > 5 ? `<span class="avatar more">+${names.length - 5}</span>` : ''}</span>`;
const avatar = n => `<span class="avatar" style="background:${color(n)}">${esc((n || '?')[0].toUpperCase())}</span>`;
const chip = n => `<span class="chip">${avatar(n)}${esc(n)}</span>`;

function toast(msg, undo) {
  const t = $('#toast');
  $('#toastMsg').textContent = msg;
  t.classList.toggle('has-undo', !!undo);
  $('#toastUndo').onclick = undo ? () => { t.classList.remove('show'); undo(); } : null;
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), undo ? 8000 : 2200);
}
// Custom confirm (window.confirm can be blocked in embedded browsers)
function ask(title, msg, okLabel = 'Hapus') {
  return new Promise(resolve => {
    const d = $('#confirmDlg');
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = msg || '';
    $('#confirmOk').textContent = okLabel;
    d.returnValue = '';
    d.onclose = () => resolve(d.returnValue === 'yes');
    d.showModal();
  });
}
// Delete with undo: snapshot the list, remove, offer "Urungkan"
function removeWithUndo(key, id, label) {
  const before = [...S[key]];
  const extra = key === 'days' ? [...S.itinerary] : null;
  S[key] = S[key].filter(x => x.id !== id);
  if (key === 'days') S.itinerary = S.itinerary.filter(i => i.dayId !== id);
  persist();
  toast(label + ' dihapus', () => { S[key] = before; if (extra) S.itinerary = extra; persist('Dikembalikan'); });
}

/* ---------------- Mode: 'server' (Node, localhost) or 'static' (GitHub Pages, no backend) ---------------- */
let MODE = 'server';
const RO = () => MODE === 'static'; // in static mode, expenses & itinerary come from the Sheet (read-only)
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const staticSheetUrl = () => LS.get('sheetUrl', '') || (window.TRIP_CONFIG && window.TRIP_CONFIG.sheetUrl) || '';
const sheetIdOf = u => (String(u || '').match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1];
const doneKeyOf = (s, i) => [(s.days.find(d => d.id === i.dayId) || {}).label, i.start, i.activity, i.location].join('|');
// App-only data kept in this browser: trip name/budget, payments, itinerary check marks
function saveLocal() {
  LS.set('trip-local', {
    name: S.trip.name, budget: S.trip.budget || 0, payments: S.payments,
    done: S.itinerary.filter(i => i.done).map(i => doneKeyOf(S, i)),
  });
}
function applyLocal(state) {
  const l = LS.get('trip-local', {});
  if (l.name) state.trip.name = l.name;
  state.trip.budget = l.budget || 0;
  state.payments = (l.payments || []).filter(p => state.trip.members.includes(p.from) && state.trip.members.includes(p.to));
  const done = new Set(l.done || []);
  state.itinerary.forEach(i => (i.done = done.has(doneKeyOf(state, i))));
  return state;
}
async function staticFetchSheet() {
  const id = sheetIdOf(staticSheetUrl());
  if (!id) throw new Error('Link Google Sheet belum diatur');
  let r;
  try { r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { cache: 'no-store' }); }
  catch (e) { throw new Error('Sheet tidak bisa diakses. Pastikan dibagikan “Anyone with the link”.'); }
  if (!r.ok) throw new Error('Google Sheet membalas ' + r.status);
  const fresh = SheetImport.importFromSheets(await SheetImport.readXlsxBrowser(await r.arrayBuffer()));
  if (!fresh.trip.members.length) throw new Error('Format sheet tidak dikenali');
  LS.set('trip-cache', fresh);
  LS.set('trip-lastPull', new Date().toISOString());
  return applyLocal(fresh);
}

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function persist(msg) {
  if (MODE === 'static') { saveLocal(); if (msg) toast(msg); return render(); }
  try {
    const r = await api('PUT', '/api/data', S);
    if (r.sync) SYNC = r.sync;
    if (msg) toast(msg);
    if (SYNC.auto && SYNC.scriptUrl) schedulePush();
  } catch (e) { toast('Gagal menyimpan: ' + e.message); }
  render();
}

/* ---------------- Google Sheets sync ---------------- */
let SYNC = { sheetUrl: '', scriptUrl: '', auto: false, dirty: false };
let syncBusy = '', pushTimer = null;
const timeAgo = iso => {
  if (!iso) return 'belum pernah';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
function renderSyncBadge() {
  const dot = $('#syncDot'), label = $('#syncLabel');
  if (MODE === 'static') {
    const err = renderSyncBadge.err;
    dot.className = 'sync-dot ' + (syncBusy ? 'busy' : err ? 'warn' : 'ok');
    label.textContent = syncBusy ? 'Menarik…' : err ? 'Gagal sinkron' : 'Tersinkron';
    $('#btnSync').title = err ? err : 'Diambil dari Google Sheet ' + timeAgo(LS.get('trip-lastPull', null));
    return;
  }
  const on = SYNC.sheetUrl || SYNC.scriptUrl;
  let st = 'off', text = 'Sync';
  if (syncBusy) { st = 'busy'; text = syncBusy === 'push' ? 'Mengirim…' : 'Menarik…'; }
  else if (!on) { st = 'off'; text = 'Hubungkan Sheet'; }
  else if (SYNC.dirty) { st = 'warn'; text = 'Belum tersinkron'; }
  else { st = 'ok'; text = 'Tersinkron'; }
  dot.className = 'sync-dot ' + st; label.textContent = text;
  $('#btnSync').title = on ? `Tarik terakhir: ${timeAgo(SYNC.lastPull)} · Kirim terakhir: ${timeAgo(SYNC.lastPush)}` : 'Hubungkan ke Google Sheet';
}
async function doPull({ silent = false, force = false } = {}) {
  if (syncBusy) return;
  syncBusy = 'pull'; renderSyncBadge();
  if (MODE === 'static') {
    try {
      const next = await staticFetchSheet();
      const changed = !S || JSON.stringify(stripIds(S)) !== JSON.stringify(stripIds(next));
      S = next; renderSyncBadge.err = '';
      render();
      if (!silent || (changed && S)) toast(changed ? `Data diperbarui dari Google Sheet (${S.expenses.length} pengeluaran)` : 'Sudah sama dengan Google Sheet');
    } catch (e) {
      renderSyncBadge.err = e.message;
      if (!silent) toast('Gagal menarik: ' + e.message); else console.warn(e);
      if (!S) $('#view').innerHTML = `<div class="card empty">Gagal mengambil data dari Google Sheet: ${esc(e.message)}</div>`;
    } finally { syncBusy = ''; renderSyncBadge(); }
    return;
  }
  try {
    const r = await fetch('/api/sync/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) });
    const j = await r.json();
    if (r.status === 409) {
      syncBusy = ''; SYNC = j.sync || SYNC; renderSyncBadge();
      if (silent) return;
      const msg = SYNC.scriptUrl ? 'Ada perubahan di aplikasi yang belum dikirim. Kalau ditarik sekarang, perubahan itu akan diganti isi Google Sheet. (Backup lokal tetap dibuat.)'
                                 : 'Perubahan yang kamu buat di aplikasi akan diganti isi Google Sheet. Untuk menyimpannya ke Sheet, pasang Apps Script (sinkron dua arah). Backup lokal tetap dibuat.';
      if (await ask('Timpa perubahan lokal?', msg, 'Tarik & timpa')) return doPull({ force: true });
      return;
    }
    if (!r.ok) throw new Error(j.error || r.statusText);
    const changed = JSON.stringify(stripIds(S)) !== JSON.stringify(stripIds(j.state));
    S = j.state; SYNC = j.sync;
    render();
    if (!silent || changed) toast(changed ? `Data diperbarui dari Google Sheet (${S.expenses.length} pengeluaran)` : 'Sudah sama dengan Google Sheet');
  } catch (e) { if (!silent) toast('Gagal menarik: ' + e.message); else console.warn(e); }
  finally { syncBusy = ''; renderSyncBadge(); }
}
const stripIds = s => ({ e: s.expenses.map(({ id, ...x }) => x), i: s.itinerary.map(({ id, dayId, ...x }) => x), p: s.payments, t: s.trip });
async function doPush({ silent = false } = {}) {
  clearTimeout(pushTimer);
  if (syncBusy) { pushTimer = setTimeout(() => doPush({ silent }), 1500); return; }
  syncBusy = 'push'; renderSyncBadge();
  try {
    const j = await api('POST', '/api/sync/push');
    SYNC = j.sync;
    const w = j.result?.warnings || [];
    if (w.length) toast('Terkirim, dengan catatan: ' + w.join('; '));
    else if (!silent) toast('Terkirim ke Google Sheet ✓');
  } catch (e) { toast('Gagal mengirim: ' + e.message); }
  finally { syncBusy = ''; renderSyncBadge(); }
}
function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => doPush({ silent: true }), 1500); }
// Auto: pull every 60s when idle (and nothing local is pending)
setInterval(() => {
  if (syncBusy || document.hidden || $('#modal').open || $('#confirmDlg').open) return;
  if (MODE === 'static') return doPull({ silent: true });
  if (!SYNC.auto || !(SYNC.sheetUrl || SYNC.scriptUrl) || SYNC.dirty) return;
  doPull({ silent: true });
}, 60000);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove(); return ok;
}

function staticSyncForm() {
  const url = staticSheetUrl();
  openModal('Sinkron Google Sheet', `
    <div class="sync-status">
      <div><span class="sync-dot ${renderSyncBadge.err ? 'warn' : 'ok'}"></span><b>${renderSyncBadge.err ? 'Gagal sinkron' : 'Tersinkron dengan Google Sheet'}</b></div>
      <div class="sub">Diambil ${timeAgo(LS.get('trip-lastPull', null))} · otomatis tiap 1 menit saat halaman terbuka${renderSyncBadge.err ? ' · <span class="neg">' + esc(renderSyncBadge.err) + '</span>' : ''}</div>
      <div class="sync-actions">
        <button type="button" class="btn" id="sPull">⬇ Tarik sekarang</button>
        ${sheetIdOf(url) ? `<a class="btn ghost" href="https://docs.google.com/spreadsheets/d/${sheetIdOf(url)}/edit" target="_blank" rel="noopener">↗ Buka Google Sheet</a>` : ''}
      </div>
    </div>
    <p class="sub">Versi online ini membaca data langsung dari Google Sheet. Untuk menambah atau mengubah pengeluaran & itinerary, edit di Sheet, lalu halaman ini ikut ter-update.
      Pembayaran (“Tandai lunas”), centang itinerary, nama trip & budget disimpan <b>di browser ini saja</b>.</p>
    <details class="field step"><summary><b>Ganti link Google Sheet</b></summary>
      <input id="sUrl" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(url)}">
      <p class="sub">Hanya berlaku di browser ini. Kosongkan untuk kembali ke Sheet bawaan.</p>
    </details>`, 'Simpan', () => {
      const u = val('sUrl');
      if (u && !sheetIdOf(u)) return toast('Link Google Sheet tidak valid'), false;
      const changed = u !== url;
      if (u && u !== (window.TRIP_CONFIG && window.TRIP_CONFIG.sheetUrl)) LS.set('sheetUrl', u); else LS.del('sheetUrl');
      if (changed) doPull();
    });
  $('#sPull').onclick = () => { closeModal(); doPull(); };
}

function syncForm() {
  if (MODE === 'static') return staticSyncForm();
  const two = !!SYNC.scriptUrl;
  openModal('Sinkron Google Sheet', `
    <div class="sync-status">
      <div><span class="sync-dot ${SYNC.dirty ? 'warn' : (SYNC.sheetUrl || SYNC.scriptUrl) ? 'ok' : 'off'}"></span>
        <b>${!(SYNC.sheetUrl || SYNC.scriptUrl) ? 'Belum terhubung' : two ? 'Sinkron dua arah' : 'Tarik saja (satu arah)'}</b></div>
      <div class="sub">Tarik terakhir: ${timeAgo(SYNC.lastPull)} · Kirim terakhir: ${timeAgo(SYNC.lastPush)}${SYNC.dirty ? ' · <span class="neg">ada perubahan lokal yang belum tersinkron</span>' : ''}</div>
      <div class="sync-actions">
        <button type="button" class="btn" id="sPull" ${SYNC.sheetUrl || SYNC.scriptUrl ? '' : 'disabled'}>⬇ Tarik dari Sheet</button>
        <button type="button" class="btn ghost" id="sPush" ${two ? '' : 'disabled title="Pasang Apps Script dulu"'}>⬆ Kirim ke Sheet</button>
      </div>
    </div>

    <div class="field"><label>1 · Link Google Sheet</label>
      <input id="sUrl" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(SYNC.sheetUrl)}">
      <p class="sub">Sheet harus dibagikan <b>“Anyone with the link”</b>. Cukup ini untuk <b>menarik</b> data.</p></div>

    <details class="field step" ${two ? '' : 'open'}>
      <summary><b>2 · Aktifkan kirim balik ke Sheet (opsional)</b></summary>
      <ol class="steps">
        <li>Buka Google Sheet → menu <b>Extensions → Apps Script</b>.</li>
        <li>Hapus isi <code>Code.gs</code>, lalu tempel script ini: <button type="button" class="btn ghost sm" id="sCopy">📋 Salin script</button> <a class="btn ghost sm" href="/api/sync/script" download="Code.gs">⬇ Code.gs</a></li>
        <li>Klik <b>Deploy → New deployment</b> → pilih tipe <b>Web app</b>. Execute as: <b>Me</b>, Who has access: <b>Anyone</b>. Klik Deploy dan izinkan akses.</li>
        <li>Salin <b>Web app URL</b> (berakhiran <code>/exec</code>) ke kolom di bawah.</li>
      </ol>
      <input id="sScript" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(SYNC.scriptUrl)}">
      <p class="sub">Script berisi token rahasia, jadi hanya aplikasi ini yang bisa menulis ke Sheet. Sebelum menulis pertama kali tiap hari, script otomatis membuat salinan cadangan sheet (tersembunyi, nama <code>_backup_…</code>).</p>
    </details>

    <label class="toggle"><input type="checkbox" id="sAuto" ${SYNC.auto ? 'checked' : ''}>
      <span><b>Sinkron otomatis</b><br><span class="sub">Tarik tiap 1 menit saat aplikasi terbuka${two ? ', dan kirim otomatis setiap ada perubahan' : ''}.</span></span></label>
  `, 'Simpan', () => {
    (async () => {
      try {
        const before = { ...SYNC };
        SYNC = await api('PUT', '/api/sync', { sheetUrl: val('sUrl'), scriptUrl: val('sScript'), auto: $('#sAuto').checked });
        renderSyncBadge(); toast('Pengaturan sync disimpan');
        const linked = SYNC.sheetUrl !== before.sheetUrl || SYNC.scriptUrl !== before.scriptUrl;
        if (linked && (SYNC.sheetUrl || SYNC.scriptUrl)) doPull();
      } catch (e) { toast(e.message); syncForm(); }
    })();
  });
  $('#sCopy').onclick = async () => {
    const txt = await (await fetch('/api/sync/script')).text();
    toast((await copyText(txt)) ? 'Script disalin — tempel di Apps Script' : 'Gagal menyalin, pakai tombol ⬇ Code.gs');
  };
  $('#sUrl').oninput = $('#sScript').oninput = () => {
    $('#sPull').disabled = !val('sUrl') && !val('sScript');
    $('#sPush').disabled = !val('sScript');
  };
  const saveFirst = async () => { SYNC = await api('PUT', '/api/sync', { sheetUrl: val('sUrl'), scriptUrl: val('sScript'), auto: $('#sAuto').checked }); };
  $('#sPull').onclick = async () => { try { await saveFirst(); closeModal(); doPull(); } catch (e) { toast(e.message); } };
  $('#sPush').onclick = async () => {
    try { await saveFirst(); } catch (e) { return toast(e.message); }
    closeModal();
    if (await ask('Kirim ke Google Sheet?', 'Isi pengeluaran & itinerary di Sheet akan diganti dengan data aplikasi. Salinan cadangan sheet dibuat otomatis.', 'Kirim')) doPush();
  };
}

/* ---------------- Calculations ---------------- */
function tripDays() {
  const { start, end } = S.trip;
  if (start && end) return Math.round((new Date(end) - new Date(start)) / 864e5) + 1;
  return S.days.length;
}
function balances() {
  const b = {};
  S.trip.members.forEach(m => (b[m] = { paid: 0, share: 0, sent: 0, received: 0 }));
  const get = m => (b[m] ||= { paid: 0, share: 0, sent: 0, received: 0 });
  for (const e of S.expenses) {
    get(e.paidBy).paid += +e.amount || 0;
    for (const [m, a] of Object.entries(e.splits || {})) get(m).share += +a || 0;
  }
  for (const p of S.payments) { get(p.from).sent += +p.amount; get(p.to).received += +p.amount; }
  for (const m in b) b[m].net = b[m].paid - b[m].share + b[m].sent - b[m].received;
  return b;
}
// Minimal transfers to settle all net balances (greedy)
function suggestions() {
  const b = balances();
  const cred = [], debt = [];
  for (const [m, v] of Object.entries(b)) {
    if (v.net > 0.5) cred.push({ m, a: v.net });
    else if (v.net < -0.5) debt.push({ m, a: -v.net });
  }
  cred.sort((x, y) => y.a - x.a); debt.sort((x, y) => y.a - x.a);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const a = Math.min(debt[i].a, cred[j].a);
    if (a > 0.5) out.push({ from: debt[i].m, to: cred[j].m, amount: Math.round(a) });
    debt[i].a -= a; cred[j].a -= a;
    if (debt[i].a < 0.5) i++;
    if (cred[j].a < 0.5) j++;
  }
  return out;
}
// Pairwise debts (like the "Utang" table in the Excel): owe[debtor][creditor], netted & minus payments
function pairwise() {
  const M = S.trip.members, o = {};
  M.forEach(a => { o[a] = {}; M.forEach(c => (o[a][c] = 0)); });
  const add = (d, c, v) => { if (d === c || !(d in o) || !(c in o)) return; o[d][c] += v; };
  for (const e of S.expenses) for (const [m, a] of Object.entries(e.splits || {})) add(m, e.paidBy, +a || 0);
  for (const p of S.payments) add(p.to, p.from, +p.amount);
  M.forEach(a => M.forEach(c => {
    if (a < c) { const n = o[a][c] - o[c][a]; o[a][c] = Math.max(0, n); o[c][a] = Math.max(0, -n); }
  }));
  return o;
}

/* ---------------- Rendering ---------------- */
function renderHeader() {
  $('#tripName').textContent = S.trip.name || 'Trip';
  const d = tripDays();
  $('#tripDates').textContent = S.trip.start ? `${fmtDate(S.trip.start)} – ${fmtDate(S.trip.end)} · ${d} hari` : 'Tanggal belum diatur';
  $('#memberChips').innerHTML = S.trip.members.map(chip).join('');
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function render() {
  renderHeader();
  const v = $('#view');
  v.innerHTML = { dashboard: viewDashboard, itinerary: viewItinerary, expenses: viewExpenses, split: viewSplit }[tab]();
}

function viewDashboard() {
  const total = S.expenses.reduce((s, e) => s + (+e.amount || 0), 0);
  const days = tripDays() || 1;
  const n = S.trip.members.length || 1;
  const b = balances();
  const sug = suggestions();
  const outstanding = sug.reduce((s, x) => s + x.amount, 0);
  const byCat = {};
  S.expenses.forEach(e => (byCat[e.category] = (byCat[e.category] || 0) + (+e.amount || 0)));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(c => c[1]));
  const maxShare = Math.max(1, ...Object.values(b).map(x => Math.max(x.share, x.paid)));
  const budget = +S.trip.budget || 0;
  const doneCnt = S.itinerary.filter(i => i.done).length;

  const upcoming = S.days.flatMap(d => S.itinerary.filter(i => i.dayId === d.id && !i.done).sort(byTime).map(i => ({ ...i, day: d }))).slice(0, 5);

  return `
  <div class="grid stats">
    <div class="card stat"><div class="stat-icon">💰</div><div class="label">Total pengeluaran</div><div class="value num">${rp(total)}</div><div class="hint">${S.expenses.length} transaksi</div></div>
    <div class="card stat"><div class="stat-icon">👥</div><div class="label">Rata-rata per orang</div><div class="value num">${rp(total / n)}</div><div class="hint">${n} anggota · ${rp(total / days)}/hari</div></div>
    <div class="card stat"><div class="stat-icon">${budget ? '🎯' : '📅'}</div><div class="label">${budget ? 'Sisa budget' : 'Lama perjalanan'}</div>
      ${budget ? `<div class="value num ${budget - total < 0 ? 'neg' : ''}">${rp(budget - total)}</div><div class="hint">dari ${rp(budget)} · ${days} hari</div>`
               : `<div class="value">${days} hari</div><div class="hint">${S.trip.start ? fmtShort(S.trip.start) + ' – ' + fmtShort(S.trip.end) : 'atur di Pengaturan'}</div>`}</div>
    <div class="card stat"><div class="stat-icon">${outstanding ? '⏳' : '✅'}</div><div class="label">Belum lunas</div><div class="value num ${outstanding ? 'neg' : 'pos'}">${rp(outstanding)}</div><div class="hint">${sug.length ? sug.length + ' transfer diperlukan' : 'Semua sudah impas 🎉'}</div></div>
  </div>
  <div class="grid two">
    <div class="card">
      <h3>Pengeluaran per kategori</h3>
      ${cats.length ? cats.map(([c, a]) => `
        <div class="bar-row"><span>${catIcon(c)} ${esc(c)}</span>
        <div class="bar"><span style="width:${(a / maxCat) * 100}%;background:${catColor(c)}"></span></div>
        <span class="num">${rp(a)} <span class="muted">(${Math.round((a / total) * 100)}%)</span></span></div>`).join('') : '<div class="empty">Belum ada pengeluaran</div>'}
    </div>
    <div class="card">
      <h3>Dibayar vs. bagian tiap orang</h3>
      ${S.trip.members.map(m => `
        <div class="bar-row" title="Dibayar ${rp(b[m].paid)} · Bagian ${rp(b[m].share)}">
          <span>${chip(m)}</span>
          <div><div class="bar" style="margin-bottom:3px"><span style="width:${(b[m].paid / maxShare) * 100}%;background:var(--accent)"></span></div>
               <div class="bar"><span style="width:${(b[m].share / maxShare) * 100}%;background:var(--c3)"></span></div></div>
          <span class="num ${b[m].net > 0.5 ? 'pos' : b[m].net < -0.5 ? 'neg' : 'muted'}">${b[m].net > 0.5 ? '+' : ''}${rp(b[m].net)}</span>
        </div>`).join('')}
      <p class="sub"><span class="legend-dot" style="background:var(--accent)"></span>Dibayar &nbsp; <span class="legend-dot" style="background:var(--c3)"></span>Bagian &nbsp;· angka kanan = saldo (+ piutang, − utang)</p>
    </div>
    <div class="card">
      <h3>Agenda berikutnya <span class="muted" style="font-weight:400">· ${doneCnt}/${S.itinerary.length} selesai</span></h3>
      ${upcoming.length ? `<ul class="timeline">${upcoming.map(i => `
        <li class="tl-item" style="grid-template-columns:92px 1fr"><div class="tl-time">${esc(i.start || '—')}<small>${esc(i.day.label)}</small></div>
        <div><div class="tl-title">${esc(i.activity || i.location)}</div><div class="tl-meta">${esc([i.location, i.notes].filter(Boolean).join(' · '))}</div></div></li>`).join('')}</ul>`
        : '<div class="empty">Tidak ada agenda tersisa</div>'}
    </div>
    <div class="card">
      <h3>Siapa bayar ke siapa</h3>
      ${settleList(sug, false)}
    </div>
  </div>`;
}

const byTime = (a, b) => (a.start || '99').localeCompare(b.start || '99');
function duration(s, e) {
  if (!s || !e) return '';
  const [h1, m1] = s.split(':').map(Number), [h2, m2] = e.split(':').map(Number);
  let d = h2 * 60 + m2 - (h1 * 60 + m1); if (d < 0) d += 1440;
  if (isNaN(d)) return '';
  return (Math.floor(d / 60) ? Math.floor(d / 60) + ' j ' : '') + (d % 60 ? d % 60 + ' m' : '');
}

function viewItinerary() {
  const days = [...S.days].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return `
  <div class="section-head"><div><h2>Itinerary</h2><p class="sub">Jadwal perjalanan per hari. Centang kegiatan yang sudah selesai.</p></div>
    ${RO() ? '' : '<button class="btn" data-act="add-day">+ Tambah hari</button>'}</div>
  ${sheetBanner('itinerary')}
  ${days.length ? days.map(d => {
    const items = S.itinerary.filter(i => i.dayId === d.id).sort(byTime);
    const spent = S.expenses.filter(e => e.date === d.date).reduce((s, e) => s + (+e.amount || 0), 0);
    return `<div class="card day">
      <div class="day-head"><div><h3>${esc(d.label)} <span class="muted" style="font-weight:500">· ${fmtDate(d.date)}</span></h3>
        <p class="sub">${items.length} kegiatan${spent ? ' · pengeluaran tanggal ini ' + rp(spent) : ''}</p></div>
        ${RO() ? '' : `<div><button class="btn sm" data-act="add-item" data-id="${d.id}">+ Kegiatan</button>
        <button class="icon-btn" data-act="edit-day" data-id="${d.id}" title="Ubah hari">✎</button>
        <button class="icon-btn" data-act="del-day" data-id="${d.id}" title="Hapus hari">🗑</button></div>`}</div>
      ${items.length ? `<ul class="timeline">${items.map(i => `
        <li class="tl-item ${i.done ? 'done' : ''}">
          <input type="checkbox" data-act="toggle-item" data-id="${i.id}" ${i.done ? 'checked' : ''} aria-label="Selesai">
          <div class="tl-time num">${esc(i.start || '—')}${i.end ? ` – ${esc(i.end)}` : ''}<small>${duration(i.start, i.end)}</small></div>
          <div><div class="tl-title">${esc(i.activity || '(tanpa judul)')}</div>
            <div class="tl-meta">${i.location ? '📍 ' + esc(i.location) : ''}${i.location && i.notes ? ' · ' : ''}${esc(i.notes || '')}</div></div>
          ${RO() ? '<div></div>' : `<div class="tl-actions"><button class="icon-btn" data-act="edit-item" data-id="${i.id}" title="Ubah">✎</button>
            <button class="icon-btn" data-act="del-item" data-id="${i.id}" title="Hapus">🗑</button></div>`}
        </li>`).join('')}</ul>` : '<div class="empty">Belum ada kegiatan di hari ini</div>'}
    </div>`;
  }).join('') : `<div class="card empty">${RO() ? 'Belum ada jadwal di Google Sheet.' : 'Belum ada hari. Klik “Tambah hari”.'}</div>`}`;
}
function sheetBanner(what) {
  if (!RO()) return '';
  const id = sheetIdOf(staticSheetUrl());
  return `<div class="sheet-banner"><span>📄 Data ${what === 'itinerary' ? 'itinerary' : 'pengeluaran'} diambil dari Google Sheet dan ikut ter-update otomatis. Untuk menambah atau mengubah, edit di Sheet.</span>
    ${id ? `<a class="btn ghost sm" href="https://docs.google.com/spreadsheets/d/${id}/edit" target="_blank" rel="noopener">↗ Buka Sheet</a>` : ''}</div>`;
}

function viewExpenses() {
  const q = F.q.toLowerCase();
  const list = S.expenses
    .filter(e => (!F.cat || e.category === F.cat) && (!F.member || e.paidBy === F.member || (e.splits && e.splits[F.member])) && (!q || (e.desc || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const total = list.reduce((s, e) => s + (+e.amount || 0), 0);
  return `
  <div class="section-head"><div><h2>Pengeluaran</h2><p class="sub">Catat setiap pengeluaran, siapa yang bayar, dan dibagi ke siapa saja.</p></div>
    ${RO() ? '' : '<button class="btn" data-act="add-exp">+ Tambah pengeluaran</button>'}</div>
  ${sheetBanner('expenses')}
  <div class="filters">
    <input type="search" id="fq" placeholder="Cari keterangan…" value="${esc(F.q)}">
    <select id="fcat"><option value="">Semua kategori</option>${S.trip.categories.map(c => `<option ${F.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select id="fmem"><option value="">Semua anggota</option>${S.trip.members.map(m => `<option ${F.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
  </div>
  <div class="list-summary"><span>${list.length} transaksi${F.q || F.cat || F.member ? ' (difilter)' : ''}</span><b class="num">${rp(total)}</b></div>
  ${list.length ? groupByDate(list).map(([date, items]) => `
    <div class="exp-group">
      <div class="exp-date"><span>${date ? fmtDate(date) : 'Tanpa tanggal'}</span><span class="num">${rp(items.reduce((s, e) => s + (+e.amount || 0), 0))}</span></div>
      <div class="card exp-card">${items.map(expenseRow).join('')}</div>
    </div>`).join('')
    : `<div class="card empty">${F.q || F.cat || F.member ? 'Tidak ada pengeluaran yang cocok dengan filter' : 'Belum ada pengeluaran. Klik “Tambah pengeluaran”.'}</div>`}`;
}
function groupByDate(list) {
  const g = new Map();
  list.forEach(e => { const k = e.date || ''; if (!g.has(k)) g.set(k, []); g.get(k).push(e); });
  return [...g.entries()];
}
function expenseRow(e) {
  const sp = Object.keys(e.splits || {});
  const mine = F.member && e.splits?.[F.member];
  return `<div class="exp-row">
    <div class="cat-icon" style="--cc:${catColor(e.category)}">${catIcon(e.category)}</div>
    <div class="exp-main">
      <div class="exp-title">${esc(e.desc || '—')}</div>
      <div class="exp-meta"><span class="tag" style="color:${catColor(e.category)}">${esc(e.category)}</span>
        ${e.autoSplit ? '<span class="tag warn-tag" title="Kolom pembagian di Google Sheet masih kosong, jadi sementara dibagi rata ke semua anggota. Isi kolom pembagiannya di Sheet (atau ubah pengeluaran ini) untuk mengaturnya.">⚠ dibagi rata otomatis</span>' : ''}
        <span>dibayar <b>${esc(e.paidBy)}</b></span>
        <span class="split-info" title="${esc(sp.map(m => m + ': ' + rp(e.splits[m])).join('\n'))}">${avatarStack(sp)} ${sp.length === S.trip.members.length ? 'semua' : sp.length + ' orang'} · ${rp(e.amount / (sp.length || 1))}/org</span>
      </div>
    </div>
    <div class="exp-amt num">${rp(e.amount)}${mine ? `<small>bagian ${esc(F.member)}: ${rp(mine)}</small>` : ''}</div>
    ${RO() ? '<div></div>' : `<div class="exp-actions">
      <button class="icon-btn" data-act="edit-exp" data-id="${e.id}" title="Ubah" aria-label="Ubah">✎</button>
      <button class="icon-btn del" data-act="del-exp" data-id="${e.id}" title="Hapus" aria-label="Hapus">🗑</button>
    </div>`}
  </div>`;
}

function settleList(sug, actions) {
  if (!S.expenses.length) return '<div class="empty">Belum ada pengeluaran</div>';
  if (!sug.length) return '<div class="ok-banner">Semua sudah impas 🎉</div>';
  return sug.map((s, i) => `<div class="settle">${chip(s.from)}<span class="arrow">bayar ke →</span>${chip(s.to)}
    <span class="amt num">${rp(s.amount)}</span>${actions ? `<button class="btn sm" data-act="settle" data-i="${i}">Tandai lunas</button>` : ''}</div>`).join('');
}

function viewSplit() {
  const b = balances(), sug = suggestions(), pw = pairwise(), M = S.trip.members;
  return `
  <div class="section-head"><div><h2>Split Bill</h2><p class="sub">Saldo dihitung dari semua pengeluaran dan pembayaran yang sudah tercatat.</p></div>
    <button class="btn ghost" data-act="add-pay">+ Catat pembayaran</button></div>
  <div class="grid two" style="margin-bottom:14px">
    <div class="card"><h3>Penyelesaian paling ringkas</h3><p class="sub" style="margin:-6px 0 8px">Jumlah transfer paling sedikit agar semua impas.</p>${settleList(sug, true)}</div>
    <div class="card table-wrap"><h3>Saldo per orang</h3>
      <table><thead><tr><th>Nama</th><th class="r">Dibayar</th><th class="r">Bagian</th><th class="r">Saldo</th></tr></thead>
      <tbody>${M.map(m => `<tr><td>${chip(m)}</td><td class="r num">${rp(b[m].paid)}</td><td class="r num">${rp(b[m].share)}</td>
        <td class="r num ${b[m].net > 0.5 ? 'pos' : b[m].net < -0.5 ? 'neg' : 'muted'}">${b[m].net > 0.5 ? '+' : ''}${rp(b[m].net)}</td></tr>`).join('')}</tbody></table>
      <p class="sub">Saldo + berarti akan menerima uang, − berarti masih harus bayar. Sudah termasuk pembayaran yang dicatat.</p>
    </div>
  </div>
  <div class="card table-wrap" style="margin-bottom:14px"><h3>Tabel utang langsung</h3>
    <p class="sub" style="margin:-6px 0 8px">Baris = yang berutang, kolom = yang dibayar (berdasarkan siapa yang menalangi tiap pengeluaran).</p>
    <table class="matrix"><thead><tr><th>Utang ke →</th>${M.map(m => `<th>${esc(m)}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>${M.map(a => { const tot = M.reduce((s, c) => s + pw[a][c], 0); return `<tr><td>${chip(a)}</td>${M.map(c => `<td class="num ${a === c ? 'self' : ''} ${pw[a][c] > 0.5 ? 'neg' : 'muted'}">${a === c ? '' : pw[a][c] > 0.5 ? rp(pw[a][c]) : '–'}</td>`).join('')}<td class="num"><b>${tot > 0.5 ? rp(tot) : '–'}</b></td></tr>`; }).join('')}</tbody></table>
  </div>
  <div class="card table-wrap"><h3>Riwayat pembayaran</h3>
    ${S.payments.length ? `<table><thead><tr><th>Tanggal</th><th>Dari</th><th>Ke</th><th class="r">Jumlah</th><th class="hide-sm">Catatan</th><th></th></tr></thead><tbody>
      ${[...S.payments].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(p => `<tr><td class="num">${fmtShort(p.date)}</td><td>${chip(p.from)}</td><td>${chip(p.to)}</td><td class="r num">${rp(p.amount)}</td><td class="hide-sm muted">${esc(p.note || '')}</td>
      <td><button class="icon-btn" data-act="del-pay" data-id="${p.id}" title="Hapus">🗑</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Belum ada pembayaran. Klik “Tandai lunas” atau “Catat pembayaran”.</div>'}
  </div>`;
}

/* ---------------- Modal helpers ---------------- */
let onSubmit = null;
function openModal(title, body, submitLabel, handler, extraFoot = '') {
  $('#modalTitle').textContent = title;
  const mb = $('#modalBody');
  mb.oninput = mb.onclick = mb.onchange = null;
  mb.innerHTML = body;
  $('#modalFoot').innerHTML = `${extraFoot}<span style="flex:1"></span><button type="button" class="btn ghost" data-close>Batal</button><button type="submit" class="btn" value="ok">${submitLabel}</button>`;
  onSubmit = handler;
  $('#modal').showModal();
  setTimeout(() => { const f = $('#modalBody input:not([type=checkbox]), #modalBody select'); f && f.focus(); }, 30);
}
const closeModal = () => $('#modal').close();
const val = id => $('#' + id).value.trim();
const opts = (arr, sel) => arr.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const today = () => new Date().toISOString().slice(0, 10);

/* Expense form */
function expenseForm(e) {
  const isNew = !e;
  e = e || { date: S.trip.start && today() < S.trip.start ? S.trip.start : today(), desc: '', category: S.trip.categories[0], amount: '', paidBy: S.trip.members[0], splitMode: 'equal', splits: Object.fromEntries(S.trip.members.map(m => [m, 0])) };
  let mode = e.splitMode === 'custom' ? 'custom' : 'equal';
  const sel = new Set(Object.keys(e.splits || {}));
  const M = [...new Set([...S.trip.members, ...Object.keys(e.splits || {})])];
  openModal(isNew ? 'Tambah pengeluaran' : 'Ubah pengeluaran', `
    <div class="field"><label>Keterangan</label><input id="ed" required value="${esc(e.desc)}" placeholder="mis. Makan siang di Lembang"></div>
    <div class="row2"><div class="field"><label>Jumlah (Rp)</label><input id="ea" type="number" min="0" step="1" required value="${e.amount}"></div>
      <div class="field"><label>Tanggal</label><input id="edt" type="date" value="${e.date || ''}"></div></div>
    <div class="row2"><div class="field"><label>Kategori</label><select id="ec">${opts(S.trip.categories, e.category)}</select></div>
      <div class="field"><label>Dibayar oleh</label><select id="ep">${opts(S.trip.members, e.paidBy)}</select></div></div>
    <div class="field"><label>Dibagi ke</label>
      <div class="seg"><button type="button" data-mode="equal">Rata</button><button type="button" data-mode="custom">Nominal custom</button></div>
      <div style="margin-bottom:6px"><button type="button" class="btn ghost sm" id="selAll">Pilih semua</button> <button type="button" class="btn ghost sm" id="selNone">Kosongkan</button></div>
      <div id="splitRows">${M.map(m => `<div class="split-row"><input type="checkbox" data-m="${esc(m)}" ${sel.has(m) ? 'checked' : ''}>
        <span>${chip(m)}</span><input type="number" min="0" step="1" class="num" data-amt="${esc(m)}" value="${Math.round(e.splits?.[m] || 0)}"></div>`).join('')}</div>
      <div class="split-sum" id="splitSum"></div>
    </div>`, isNew ? 'Simpan' : 'Simpan perubahan', () => {
      const amount = +val('ea');
      const checked = [...document.querySelectorAll('#splitRows input[type=checkbox]:checked')].map(c => c.dataset.m);
      if (!val('ed') || !(amount > 0)) return toast('Isi keterangan dan jumlah'), false;
      if (!checked.length) return toast('Pilih minimal satu orang'), false;
      const splits = {};
      if (mode === 'equal') {
        const base = Math.floor(amount / checked.length); let rem = amount - base * checked.length;
        checked.forEach(m => (splits[m] = base + (rem-- > 0 ? 1 : 0)));
      } else {
        checked.forEach(m => (splits[m] = +$(`[data-amt="${CSS.escape(m)}"]`).value || 0));
        const sum = Object.values(splits).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - amount) > 1) return toast('Total pembagian harus sama dengan jumlah'), false;
      }
      const rec = { id: e.id || uid(), date: val('edt'), desc: val('ed'), category: val('ec'), amount, paidBy: val('ep'), splitMode: mode, splits };
      if (isNew) S.expenses.push(rec); else S.expenses[S.expenses.findIndex(x => x.id === e.id)] = rec;
      persist(isNew ? 'Pengeluaran ditambahkan' : 'Pengeluaran diperbarui');
    });

  const refresh = () => {
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    const amount = +$('#ea').value || 0;
    const rows = [...document.querySelectorAll('#splitRows .split-row')];
    const checked = rows.filter(r => $('input[type=checkbox]', r).checked);
    rows.forEach(r => { const inp = $('[data-amt]', r), on = $('input[type=checkbox]', r).checked; inp.disabled = mode === 'equal' || !on; if (!on) inp.value = 0; });
    if (mode === 'equal' && checked.length) checked.forEach(r => ($('[data-amt]', r).value = Math.round(amount / checked.length)));
    const sum = checked.reduce((s, r) => s + (+$('[data-amt]', r).value || 0), 0);
    const box = $('#splitSum');
    if (mode === 'equal') { box.className = 'split-sum'; box.textContent = checked.length ? `${checked.length} orang × ${rp(amount / checked.length)}` : 'Pilih orang yang ikut menanggung'; }
    else { const diff = amount - sum; box.className = 'split-sum' + (Math.abs(diff) > 1 ? ' bad' : ''); box.textContent = `Terbagi ${rp(sum)} dari ${rp(amount)}` + (Math.abs(diff) > 1 ? ` · selisih ${rp(diff)}` : ' ✓'); }
  };
  $('#modalBody').oninput = refresh;
  $('#modalBody').onclick = ev => {
    const m = ev.target.dataset.mode; if (m) { mode = m; refresh(); }
    if (ev.target.id === 'selAll' || ev.target.id === 'selNone') { document.querySelectorAll('#splitRows input[type=checkbox]').forEach(c => (c.checked = ev.target.id === 'selAll')); refresh(); }
  };
  $('#modalBody').onchange = refresh;
  refresh();
}

function itemForm(dayId, it) {
  const isNew = !it; it = it || { start: '', end: '', location: '', activity: '', notes: '' };
  openModal(isNew ? 'Tambah kegiatan' : 'Ubah kegiatan', `
    <div class="field"><label>Kegiatan</label><input id="ia" required value="${esc(it.activity)}" placeholder="mis. Makan siang"></div>
    <div class="field"><label>Lokasi</label><input id="il" value="${esc(it.location)}"></div>
    <div class="row2"><div class="field"><label>Mulai</label><input id="is" type="time" value="${esc(it.start)}"></div>
      <div class="field"><label>Selesai</label><input id="ie" type="time" value="${esc(it.end)}"></div></div>
    <div class="field"><label>Hari</label><select id="iday">${S.days.map(d => `<option value="${d.id}" ${d.id === (it.dayId || dayId) ? 'selected' : ''}>${esc(d.label)} · ${fmtShort(d.date)}</option>`).join('')}</select></div>
    <div class="field"><label>Catatan</label><textarea id="in" rows="2">${esc(it.notes)}</textarea></div>`,
    isNew ? 'Simpan' : 'Simpan perubahan', () => {
      if (!val('ia') && !val('il')) return toast('Isi kegiatan atau lokasi'), false;
      const rec = { id: it.id || uid(), dayId: val('iday'), start: val('is'), end: val('ie'), location: val('il'), activity: val('ia'), notes: val('in'), done: !!it.done };
      if (isNew) S.itinerary.push(rec); else S.itinerary[S.itinerary.findIndex(x => x.id === it.id)] = rec;
      persist('Itinerary disimpan');
    });
}

function dayForm(d) {
  const isNew = !d;
  const last = [...S.days].sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
  const next = last?.date ? new Date(new Date(last.date + 'T00:00:00').getTime() + 864e5 + 7 * 36e5).toISOString().slice(0, 10) : (S.trip.start || today());
  d = d || { label: 'Day ' + (S.days.length + 1), date: next };
  openModal(isNew ? 'Tambah hari' : 'Ubah hari', `
    <div class="row2"><div class="field"><label>Nama</label><input id="dl" required value="${esc(d.label)}"></div>
    <div class="field"><label>Tanggal</label><input id="dd" type="date" required value="${d.date || ''}"></div></div>`,
    'Simpan', () => {
      if (!val('dl') || !val('dd')) return toast('Isi nama dan tanggal'), false;
      if (isNew) S.days.push({ id: uid(), label: val('dl'), date: val('dd') }); else Object.assign(S.days.find(x => x.id === d.id), { label: val('dl'), date: val('dd') });
      syncTripDates(); persist('Hari disimpan');
    });
}
function syncTripDates() {
  const ds = S.days.map(d => d.date).filter(Boolean).sort();
  if (ds.length) { if (!S.trip.start || ds[0] < S.trip.start) S.trip.start = ds[0]; if (!S.trip.end || ds[ds.length - 1] > S.trip.end) S.trip.end = ds[ds.length - 1]; }
}

function paymentForm(pre) {
  pre = pre || { from: S.trip.members[0], to: S.trip.members[1] || S.trip.members[0], amount: '' };
  openModal('Catat pembayaran', `
    <div class="row2"><div class="field"><label>Dari</label><select id="pf">${opts(S.trip.members, pre.from)}</select></div>
      <div class="field"><label>Ke</label><select id="pt">${opts(S.trip.members, pre.to)}</select></div></div>
    <div class="row2"><div class="field"><label>Jumlah (Rp)</label><input id="pa" type="number" min="1" step="1" required value="${pre.amount}"></div>
      <div class="field"><label>Tanggal</label><input id="pd" type="date" value="${today()}"></div></div>
    <div class="field"><label>Catatan</label><input id="pn" placeholder="mis. transfer BCA" value="${esc(pre.note || '')}"></div>`,
    'Simpan', () => {
      if (val('pf') === val('pt')) return toast('Pengirim dan penerima harus berbeda'), false;
      if (!(+val('pa') > 0)) return toast('Isi jumlah'), false;
      S.payments.push({ id: uid(), from: val('pf'), to: val('pt'), amount: +val('pa'), date: val('pd'), note: val('pn') });
      persist('Pembayaran dicatat');
    });
}

function exportCsv() {
  const M = S.trip.members, q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Tanggal', 'Keterangan', 'Kategori', 'Jumlah', 'Dibayar oleh', ...M].map(q).join(',')];
  S.expenses.forEach(e => rows.push([e.date, e.desc, e.category, e.amount, e.paidBy, ...M.map(m => e.splits?.[m] || 0)].map(q).join(',')));
  download('pengeluaran.csv', '﻿' + rows.join('\n'), 'text/csv');
}
function staticSettingsForm() {
  openModal('Pengaturan trip', `
    <div class="field"><label>Nama trip</label><input id="sn" value="${esc(S.trip.name)}"></div>
    <div class="field"><label>Budget total (Rp, opsional)</label><input id="sb" type="number" min="0" value="${S.trip.budget || ''}"></div>
    <p class="sub">Anggota, kategori, tanggal, pengeluaran & itinerary mengikuti Google Sheet. Nama trip, budget, pembayaran, dan centang disimpan di browser ini saja.</p>
    <hr style="border:0;border-top:1px solid var(--border);margin:16px 0">
    <div class="field"><label>Data</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn ghost" id="exportJson">⬇ Export JSON</button>
        <button type="button" class="btn ghost" id="exportCsv">⬇ Export CSV pengeluaran</button>
        <button type="button" class="btn danger" id="resetLocal">Hapus data browser</button>
      </div></div>`, 'Simpan', () => {
      S.trip.name = val('sn') || 'Trip'; S.trip.budget = +val('sb') || 0;
      persist('Pengaturan disimpan');
    });
  $('#exportJson').onclick = () => download('trip-data.json', JSON.stringify(S, null, 2), 'application/json');
  $('#exportCsv').onclick = exportCsv;
  $('#resetLocal').onclick = async () => {
    closeModal();
    if (!(await ask('Hapus data di browser ini?', 'Pembayaran yang dicatat, centang itinerary, nama trip, dan budget di browser ini akan dihapus. Data di Google Sheet tidak berubah.'))) return;
    ['trip-local', 'trip-cache', 'sheetUrl'].forEach(LS.del);
    S = null; doPull();
  };
}

function settingsForm() {
  if (MODE === 'static') return staticSettingsForm();
  let members = [...S.trip.members];
  const used = m => S.expenses.some(e => e.paidBy === m || (e.splits && m in e.splits)) || S.payments.some(p => p.from === m || p.to === m);
  const drawMembers = () => {
    $('#memList').innerHTML = members.map(m => `<span class="chip">${avatar(m)}${esc(m)}${used(m) ? '' : `<button type="button" data-rm="${esc(m)}" title="Hapus">✕</button>`}</span>`).join('');
  };
  openModal('Pengaturan trip', `
    <div class="field"><label>Nama trip</label><input id="sn" value="${esc(S.trip.name)}"></div>
    <div class="row2"><div class="field"><label>Mulai</label><input id="ss" type="date" value="${S.trip.start}"></div>
      <div class="field"><label>Selesai</label><input id="se" type="date" value="${S.trip.end}"></div></div>
    <div class="field"><label>Budget total (Rp, opsional)</label><input id="sb" type="number" min="0" value="${S.trip.budget || ''}"></div>
    <div class="field"><label>Anggota</label><div class="member-edit" id="memList"></div>
      <div style="display:flex;gap:6px"><input id="newMem" placeholder="Nama anggota baru"><button type="button" class="btn ghost" id="addMem">Tambah</button></div>
      <p class="sub">Anggota yang sudah punya transaksi tidak bisa dihapus.</p></div>
    <div class="field"><label>Kategori (pisahkan dengan koma)</label><input id="sc" value="${esc(S.trip.categories.join(', '))}"></div>
    <hr style="border:0;border-top:1px solid var(--border);margin:16px 0">
    <div class="field"><label>Data</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn ghost" id="exportJson">⬇ Export JSON</button>
        <button type="button" class="btn ghost" id="exportCsv">⬇ Export CSV pengeluaran</button>
        <button type="button" class="btn danger" id="reimport">↻ Import ulang dari Excel</button>
      </div>
      <p class="sub">Import ulang akan menimpa semua data dengan isi “FILE KEUANGAN NEGARA.xlsx”.</p></div>`,
    'Simpan', () => {
      const cats = val('sc').split(',').map(s => s.trim()).filter(Boolean);
      S.trip = { ...S.trip, name: val('sn') || 'Trip', start: val('ss'), end: val('se'), budget: +val('sb') || 0, members, categories: cats.length ? cats : S.trip.categories };
      persist('Pengaturan disimpan');
    });
  drawMembers();
  const add = () => { const n = val('newMem'); if (n && !members.includes(n)) { members.push(n); $('#newMem').value = ''; drawMembers(); } };
  $('#addMem').onclick = add;
  $('#newMem').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } };
  $('#memList').onclick = ev => { const m = ev.target.dataset.rm; if (m) { members = members.filter(x => x !== m); drawMembers(); } };
  $('#exportJson').onclick = () => download('trip-data.json', JSON.stringify(S, null, 2), 'application/json');
  $('#exportCsv').onclick = exportCsv;
  $('#reimport').onclick = async () => {
    closeModal();
    if (!(await ask('Import ulang dari Excel?', 'Semua data akan ditimpa dengan isi file Excel. Perubahan yang dibuat di aplikasi akan hilang.', 'Timpa data'))) return;
    try { S = await api('POST', '/api/import'); closeModal(); render(); toast('Data di-import ulang dari Excel'); }
    catch (e) { toast('Gagal import: ' + e.message); }
  };
}
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- Events ---------------- */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act], [data-tab], [data-close], #btnSettings, #btnSync');
  if (!t) return;
  if (t.dataset.close !== undefined) return closeModal();
  if (t.id === 'btnSettings') return settingsForm();
  if (t.id === 'btnSync') return syncForm();
  if (t.dataset.tab) { tab = t.dataset.tab; localStorage.setItem('tab', tab); return render(); }
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case 'add-exp': return expenseForm();
    case 'edit-exp': return expenseForm(S.expenses.find(e => e.id === id));
    case 'del-exp': { const e = S.expenses.find(x => x.id === id); return removeWithUndo('expenses', id, `“${e.desc}”`); }
    case 'add-day': return dayForm();
    case 'edit-day': return dayForm(S.days.find(d => d.id === id));
    case 'del-day': { const d = S.days.find(x => x.id === id); const n = S.itinerary.filter(i => i.dayId === id).length;
      if (!n) return removeWithUndo('days', id, d.label);
      return ask(`Hapus ${d.label}?`, `${n} kegiatan di hari ini juga akan terhapus.`).then(ok => ok && removeWithUndo('days', id, d.label)); }
    case 'add-item': return S.days.length ? itemForm(id) : toast('Tambah hari terlebih dulu');
    case 'edit-item': return itemForm(null, S.itinerary.find(i => i.id === id));
    case 'del-item': return removeWithUndo('itinerary', id, 'Kegiatan');
    case 'toggle-item': { const it = S.itinerary.find(i => i.id === id); it.done = t.checked; return persist(); }
    case 'add-pay': return paymentForm();
    case 'settle': { const s = suggestions()[+t.dataset.i]; return paymentForm({ ...s, note: 'Pelunasan split bill' }); }
    case 'del-pay': return removeWithUndo('payments', id, 'Pembayaran');
  }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'fq') { F.q = ev.target.value; const pos = ev.target.selectionStart; render(); const el = $('#fq'); el.focus(); el.setSelectionRange(pos, pos); }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'fcat') { F.cat = ev.target.value; render(); }
  if (ev.target.id === 'fmem') { F.member = ev.target.value; render(); }
});
$('#modalForm').addEventListener('submit', ev => {
  ev.preventDefault();
  if (onSubmit && onSubmit() !== false) closeModal();
});

(async () => {
  // Server available (npm start)? Use it. Otherwise (GitHub Pages / static hosting) read the Sheet directly.
  let server = false;
  try {
    const r = await fetch('api/data', { cache: 'no-store' });
    server = r.ok && (r.headers.get('content-type') || '').includes('json');
    if (server) { S = await r.json(); SYNC = await api('GET', 'api/sync'); }
  } catch (e) { server = false; }

  if (server) {
    render(); renderSyncBadge();
    if (SYNC.auto && (SYNC.sheetUrl || SYNC.scriptUrl) && !SYNC.dirty) doPull({ silent: true });
    return;
  }
  MODE = 'static';
  document.body.classList.add('static-mode');
  const cached = LS.get('trip-cache', null);
  if (cached) { S = applyLocal(cached); render(); }
  else $('#view').innerHTML = '<div class="card empty">Mengambil data dari Google Sheet…</div>';
  renderSyncBadge();
  doPull({ silent: !!cached });
})();

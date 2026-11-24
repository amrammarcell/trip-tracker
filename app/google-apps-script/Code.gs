/**
 * Trip & Split Bill Tracker — Google Sheets sync endpoint
 *
 * Cara pasang (sekali saja):
 *  1. Buka Google Sheet → Extensions → Apps Script
 *  2. Hapus isi Code.gs, tempel seluruh file ini, Save
 *  3. Deploy → New deployment → tipe "Web app"
 *       Execute as: Me   |   Who has access: Anyone
 *  4. Authorize, lalu salin "Web app URL" ke Pengaturan → Sync di aplikasi
 *
 * TOKEN di bawah harus sama dengan yang ada di aplikasi (sudah otomatis terisi
 * kalau script ini disalin dari aplikasi).
 */
const TOKEN = '__TOKEN__';
const EXP_SHEET = 'Itinerary';   // sheet pengeluaran (header "Paid By")
const ITI_SHEET = 'Sheet3';      // sheet jadwal (header "Activities")
const META_SHEET = '_app_data';  // sheet tersembunyi untuk data khusus aplikasi (pembayaran, centang, dll)

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle_(Object.assign({}, e.parameter || {}, body));
}

function handle_(p) {
  if (p.token !== TOKEN) return out_({ error: 'Token tidak cocok' });
  const ss = SpreadsheetApp.getActive();
  try {
    if (p.action === 'push') return out_(push_(ss, p.data));
    return out_(pull_(ss));
  } catch (err) {
    return out_({ error: String(err && err.stack || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- PULL ---------------- */
function pull_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const sheets = {};
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (name === META_SHEET || name.indexOf('_backup_') === 0) return;
    const range = sh.getDataRange();
    const vals = range.getValues(), disp = range.getDisplayValues();
    sheets[name] = vals.map((row, r) => row.map((v, c) => {
      if (v instanceof Date) {
        if (v.getFullYear() < 1901) return disp[r][c];           // time-only cell → keep "06.00"
        const s = Utilities.formatDate(v, tz, 'yyyy-MM-dd').split('-');
        return (Date.UTC(+s[0], +s[1] - 1, +s[2]) - Date.UTC(1899, 11, 30)) / 86400000; // Excel serial
      }
      return v;
    }));
  });
  const meta = ss.getSheetByName(META_SHEET);
  let m = null;
  if (meta) { try { m = JSON.parse(meta.getRange('A1').getValue() || 'null'); } catch (err) {} }
  return { ok: true, sheets: sheets, meta: m };
}

/* ---------------- PUSH ---------------- */
function push_(ss, data) {
  if (!data) throw new Error('Data kosong');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const warnings = [];
    writeExpenses_(ss, data, warnings);
    if (data.itineraryRows) writeItinerary_(ss, data.itineraryRows);
    writeMeta_(ss, data.meta);
    SpreadsheetApp.flush();
    return { ok: true, expenses: data.expenses.length, warnings: warnings };
  } finally {
    lock.releaseLock();
  }
}

// One backup copy per sheet per day, before the app first writes to it
function backupOnce_(ss, sh) {
  const tz = ss.getSpreadsheetTimeZone();
  const name = '_backup_' + sh.getName() + '_' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (ss.getSheetByName(name)) return;
  const copy = sh.copyTo(ss).setName(name);
  copy.hideSheet();
}

function toDate_(iso) {
  if (!iso) return '';
  const s = iso.split('-');
  return new Date(+s[0], +s[1] - 1, +s[2]);
}

function writeExpenses_(ss, data, warnings) {
  const sh = ss.getSheetByName(EXP_SHEET);
  if (!sh) throw new Error('Sheet "' + EXP_SHEET + '" tidak ditemukan');
  backupOnce_(ss, sh);
  let vals = sh.getDataRange().getValues();
  const header = vals.findIndex(r => String(r[6]).trim() === 'Paid By');
  if (header < 0) throw new Error('Header "Paid By" tidak ditemukan di kolom G');
  let total = -1;
  for (let r = header + 1; r < vals.length; r++) if (String(vals[r][0]).trim().toLowerCase() === 'total') { total = r; break; }
  if (total < 0) throw new Error('Baris "Total" tidak ditemukan di kolom A');

  // member name → 0-based column
  const memberCol = {};
  for (let c = 7; c < vals[header].length; c++) {
    const n = String(vals[header][c] || '').trim();
    if (n) memberCol[n.toLowerCase()] = c;
  }
  const lastCol = Math.max.apply(null, Object.values(memberCol)) + 2; // include paired column
  (data.members || []).forEach(m => { if (!(m.toLowerCase() in memberCol)) warnings.push('Anggota "' + m + '" tidak punya kolom di sheet'); });

  const first = header + 1;                 // 0-based first data row
  let capacity = total - first;
  const need = data.expenses.length;
  if (need > capacity) {
    const extra = need - capacity + 5;
    sh.insertRowsBefore(total + 1, extra);  // 1-based
    total += extra; capacity += extra;
    vals = sh.getDataRange().getValues();
  }

  const width = lastCol - 1;               // columns B..lastCol (1-based 2..lastCol)
  const block = sh.getRange(first + 1, 2, capacity, width).getValues();
  for (let i = 0; i < capacity; i++) {
    const row = block[i], e = data.expenses[i];
    row[0] = i + 1;                                   // B  No
    row[1] = e ? toDate_(e.date) : '';                // C  Date
    row[2] = e ? e.desc : '';                         // D  Spending details
    row[3] = e ? e.category : '';                     // E  Category
    row[4] = e ? e.amount : '';                       // F  Amount
    row[5] = e ? e.paidBy : '';                       // G  Paid by
    Object.keys(memberCol).forEach(k => {
      const c = memberCol[k] - 1;                     // index inside block (block starts at B = col 1)
      let v = '';
      if (e) {
        const name = Object.keys(e.splits || {}).find(n => n.toLowerCase() === k);
        v = name ? e.splits[name] : 0;
      }
      row[c] = v;
    });
  }
  sh.getRange(first + 1, 2, capacity, width).setValues(block);

  // Totals row + header summary
  const r1 = first + 1, r2 = first + capacity, tr = total + 1;
  const colL = c => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  sh.getRange(tr, 6).setFormula('=SUM(F' + r1 + ':F' + r2 + ')');
  Object.values(memberCol).forEach(c => sh.getRange(tr, c + 1).setFormula('=SUM(' + colL(c) + r1 + ':' + colL(c) + r2 + ')'));
  for (let r = 0; r < header; r++) for (let c = 0; c < vals[r].length; c++) {
    const label = String(vals[r][c]).trim();
    if (label === 'Total Expenses') sh.getRange(r + 2, c + 1).setFormula('=SUM(F' + r1 + ':F' + r2 + ')');
    if (label === 'Days of Travelling' && data.days) sh.getRange(r + 2, c + 1).setValue(data.days);
    if (label === 'Start' && data.start) sh.getRange(r + 1, c + 2).setValue(toDate_(data.start));
    if (label === 'End' && data.end) sh.getRange(r + 1, c + 2).setValue(toDate_(data.end));
  }
}

function writeItinerary_(ss, rows) {
  const sh = ss.getSheetByName(ITI_SHEET);
  if (!sh) return;
  backupOnce_(ss, sh);
  const last = Math.max(sh.getLastRow(), 2);
  sh.getRange(2, 1, last - 1, 8).clearContent();
  if (!rows.length) return;
  const range = sh.getRange(2, 1, rows.length, 8);
  sh.getRange(2, 3, rows.length, 3).setNumberFormat('@'); // keep "06.00" as text
  range.setValues(rows);
}

function writeMeta_(ss, meta) {
  if (!meta) return;
  let sh = ss.getSheetByName(META_SHEET);
  if (!sh) { sh = ss.insertSheet(META_SHEET); sh.hideSheet(); }
  sh.getRange('A1').setValue(JSON.stringify(meta));
  sh.getRange('A2').setValue('Data khusus aplikasi Trip Tracker — jangan diedit manual.');
}

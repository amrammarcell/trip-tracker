/* Shared XLSX → trip data importer. Works in Node (require) and the browser (window.SheetImport). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SheetImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  // txt(name) → contents of a file inside the xlsx zip ('' if missing)
  function parseWorkbook(txt) {
    const shared = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map(m => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
    const wb = txt('xl/workbook.xml');
    const rels = txt('xl/_rels/workbook.xml.rels');
    const sheets = {};
    for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
      const target = (rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`)) ||
        rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`)) || [])[1];
      if (!target) continue;
      const xml = txt('xl/' + target.replace(/^\/?xl\//, ''));
      const cells = {};
      for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const body = c[3] || '';
        let v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v === undefined) {
          const is = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          if (is) v = decode(is[1]); else continue;
        } else if (/t="s"/.test(c[2])) v = shared[+v];
        else if (/t="str"/.test(c[2])) v = decode(v);
        cells[c[1]] = v;
      }
      sheets[decode(m[1])] = cells;
    }
    return sheets;
  }

  // Browser: read an xlsx ArrayBuffer (uses DecompressionStream, available in all modern browsers)
  async function readXlsxBrowser(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer), dv = new DataView(arrayBuffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('File dari Google Sheet bukan xlsx yang valid');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {}, dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/\.(xml|rels)$/.test(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.slice(start, start + csize);
      files[name] = method === 0 ? dec.decode(data)
        : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    }
    return parseWorkbook(n => files[n] || '');
  }

  const col = n => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colIdx = s => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const num = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  const serialToISO = s => new Date(Math.round((num(s) - 25569) * 86400000)).toISOString().slice(0, 10);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, MEI: 5, JUN: 6, JUL: 7, AUG: 8, AGU: 8, AGT: 8, SEP: 9, OCT: 10, OKT: 10, NOV: 11, DEC: 12, DES: 12 };

  // "06.00", "6.3", 6, "6:35", 0.25 (time serial) → "HH:MM"
  function normTime(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{1,2})(?:[.:](\d{1,2}))?$/);
    if (m) {
      let mm = m[2] || '0';
      if (mm.length === 1 && s.includes('.') && !/^\d{1,2}\.0\d$/.test(s)) mm += '0'; // 10.3 → 10:30
      return `${m[1].padStart(2, '0')}:${mm.padStart(2, '0').slice(0, 2)}`;
    }
    const f = parseFloat(s);
    if (!isNaN(f) && f > 0 && f < 1) { const t = Math.round(f * 1440); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
    return s;
  }

  function parseDayDate(s) {
    if (!s) return '';
    if (/^\d+(\.\d+)?$/.test(s)) return serialToISO(s);
    const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/);
    if (!m) return '';
    const mo = MONTHS[m[2].toUpperCase()];
    return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }

  // Convert {sheetName: [[row values]]} (from Apps Script) into {A1: value} cell maps
  function gridsToSheets(grids) {
    const out = {};
    for (const [name, rows] of Object.entries(grids || {})) {
      const cells = {};
      (rows || []).forEach((row, r) => (row || []).forEach((v, c) => {
        if (v !== '' && v !== null && v !== undefined) cells[col(c) + (r + 1)] = String(v);
      }));
      out[name] = cells;
    }
    return out;
  }

  function importFromSheets(sheets) {
    const names = Object.keys(sheets);
    // Expense sheet = the one with "Paid By" header; itinerary = the one with "Activities" header
    const expName = names.find(n => Object.values(sheets[n]).includes('Paid By')) || names[0];
    const itiName = names.find(n => Object.values(sheets[n]).includes('Activities')) || names[1];
    const E = sheets[expName] || {}, I = sheets[itiName] || {};

    // --- Expenses ---
    let headerRow = 7;
    for (const [ref, v] of Object.entries(E)) if (v === 'Paid By') headerRow = +ref.match(/\d+/)[0];
    const members = [], memberCols = [];
    for (let c = colIdx('H'); c < colIdx('H') + 40; c++) {
      const v = E[col(c) + headerRow];
      if (v && v.trim()) { members.push(v.trim()); memberCols.push(c); }
    }
    const categories = ['Makan', 'Transportasi', 'Jajan', 'Lain-lain'];
    const expenses = [];
    for (let r = headerRow + 1; r < headerRow + 500; r++) {
      if ((E['A' + r] || '').toLowerCase() === 'total') break;
      const amount = num(E['F' + r]);
      const desc = (E['D' + r] || '').trim();
      if (!amount && !desc) continue;
      const splits = {};
      memberCols.forEach((c, i) => { const a = num(E[col(c) + r]); if (a) splits[members[i]] = Math.round(a * 100) / 100; });
      // Row not split yet in the sheet → split equally across everyone, flagged so the UI can show it
      const autoSplit = !Object.keys(splits).length;
      if (autoSplit) members.forEach(m => (splits[m] = Math.round((amount / members.length) * 100) / 100));
      const category = E['E' + r] || 'Lain-lain';
      if (!categories.includes(category)) categories.push(category);
      expenses.push({
        id: 'r' + r, date: E['C' + r] ? serialToISO(E['C' + r]) : '', desc, category, amount,
        paidBy: E['G' + r] || members[0], splitMode: autoSplit ? 'equal' : 'custom', splits,
        ...(autoSplit ? { autoSplit: true } : {}),
      });
    }

    // --- Itinerary ---
    const days = [], itinerary = [];
    let cur = null;
    const maxRow = Math.max(1, ...Object.keys(I).map(k => +k.match(/\d+/)[0]));
    for (let r = 2; r <= maxRow; r++) {
      const row = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(k => (I[k + r] || '').trim());
      if (row.every(x => !x)) continue;
      if (row[0]) {
        cur = { id: 'd' + r, label: row[0], date: parseDayDate(row[1]) };
        days.push(cur);
      }
      if (!cur) continue;
      const [, , start, end, , location, activity, notes] = row;
      if (!location && !activity && !notes) continue; // skip blank template slots
      itinerary.push({ id: 'i' + r, dayId: cur.id, start: normTime(start), end: normTime(end), location, activity, notes, done: false });
    }

    const dates = days.map(d => d.date).filter(Boolean).sort();
    return {
      trip: { name: 'Trip Bandung', start: dates[0] || '', end: dates[dates.length - 1] || '', members, categories, budget: 0 },
      expenses, days, itinerary, payments: [],
      importedAt: new Date().toISOString(),
    };
  }

  return { parseWorkbook, readXlsxBrowser, importFromSheets, gridsToSheets, uid };
});

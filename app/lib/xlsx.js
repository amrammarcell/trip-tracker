// Node side of the XLSX importer: unzip with zlib, then use the shared parser (also used by the browser)
const fs = require('fs');
const zlib = require('zlib');
const { parseWorkbook, importFromSheets, gridsToSheets } = require('../public/sheet-import');

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Bukan file xlsx/zip yang valid');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lxlen;
    const data = buf.subarray(start, start + csize);
    files[name] = method === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

function readWorkbook(pathOrBuf) {
  const files = unzip(Buffer.isBuffer(pathOrBuf) ? pathOrBuf : fs.readFileSync(pathOrBuf));
  return parseWorkbook(n => (files[n] ? files[n].toString('utf8') : ''));
}

const importExcel = pathOrBuf => importFromSheets(readWorkbook(pathOrBuf));

module.exports = { importExcel, importFromSheets, gridsToSheets, readWorkbook };

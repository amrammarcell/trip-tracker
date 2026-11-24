# trip-tracker

Web app lokal untuk **trip tracker** (itinerary) dan **split bill** (patungan), dengan data yang bisa ditarik dari Google Sheet atau file Excel.

## Menjalankan
Butuh [Node.js](https://nodejs.org) 18+ (tanpa `npm install`).

```bash
cd app
npm start
```
Lalu buka http://localhost:3000. Di Windows bisa juga klik dua kali `app/start.bat`.

## Fitur
- **Ringkasan**: total pengeluaran, rata-rata per orang, per kategori, saldo tiap orang, agenda berikutnya
- **Itinerary**: jadwal per hari, centang kegiatan yang sudah selesai
- **Pengeluaran**: split rata atau nominal custom, filter & cari, hapus dengan tombol Urungkan
- **Split Bill**: saldo per orang, saran transfer paling ringkas, tabel utang, catatan pelunasan
- **Sync Google Sheet**: tarik data dari Sheet (link publik), bisa kirim balik lewat Apps Script (opsional)

Detail lengkap ada di [app/README.md](app/README.md).

## Data
Data tersimpan di `app/data/` (tidak ikut di-commit). Saat pertama kali dijalankan, data diambil dari `FILE KEUANGAN NEGARA.xlsx` di root repo kalau file itu ada.

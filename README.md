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

## Versi online (GitHub Pages)
Setiap push ke `main` yang mengubah `app/public/` akan otomatis di-deploy ke GitHub Pages lewat workflow `.github/workflows/pages.yml`.

Versi online tidak punya server, jadi:
- Data pengeluaran & itinerary diambil **langsung dari Google Sheet** (link-nya ada di `app/public/config.js`) setiap kali halaman dibuka, lalu otomatis setiap 1 menit. Untuk mengubah data, edit di Sheet.
- Pembayaran ("Tandai lunas"), centang itinerary, nama trip, dan budget disimpan **di browser masing-masing**, jadi tidak terlihat di perangkat lain.
- Situsnya publik. Siapa pun yang tahu alamatnya bisa melihat isi Sheet.

Pengaturan awal (sekali saja): buka **Settings → Pages → Source: GitHub Actions**.

### Pasang di HP (iOS & Android)
Versi online bisa dipasang seperti aplikasi biasa (PWA): ada ikon di layar utama, terbuka layar penuh, dan tetap bisa dibuka saat offline dengan menampilkan data terakhir.
- **iPhone/iPad:** buka di Safari → tombol **Bagikan** → **Add to Home Screen**
- **Android:** buka di Chrome → muncul tombol **Pasang**, atau lewat menu **⋮ → Install app**

Kalau ada versi baru yang di-deploy, aplikasi yang sudah terpasang akan ter-update sendiri. Ikon bisa dibuat ulang dengan `node app/tools/make-icons.js`.

## Data
Data tersimpan di `app/data/` (tidak ikut di-commit). Saat pertama kali dijalankan, data diambil dari `FILE KEUANGAN NEGARA.xlsx` di root repo kalau file itu ada.

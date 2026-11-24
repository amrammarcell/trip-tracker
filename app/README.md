# Trip & Split Bill Tracker

Web app lokal berbasis `FILE KEUANGAN NEGARA.xlsx`. Hanya butuh **Node.js**, tanpa `npm install`.

## Menjalankan
- Klik dua kali `start.bat`, atau
- Di terminal: `cd app` lalu `npm start`

Buka http://localhost:3000

## Fitur
- **Ringkasan** – total pengeluaran, rata-rata per orang, pengeluaran per kategori, saldo tiap orang, agenda berikutnya.
- **Itinerary** – jadwal per hari (dari sheet *Sheet3*), tambah/ubah/hapus kegiatan, centang yang sudah selesai.
- **Pengeluaran** – catat pengeluaran (dari sheet *Itinerary*), split rata atau nominal custom, filter & cari.
- **Split Bill** – saldo per orang, saran transfer paling ringkas, tabel utang langsung (seperti tabel "Utang" di Excel), riwayat pelunasan.
- **Pengaturan** – nama trip, tanggal, budget, anggota, kategori, export JSON/CSV, import ulang dari Excel.

## Data
- Disimpan di `app/data/db.json`. Saat pertama dijalankan, data otomatis di-import dari file Excel di folder induk.
- Hapus `db.json` atau pakai tombol *Import ulang dari Excel* untuk mengulang dari Excel (data yang dibuat di aplikasi akan tertimpa).

## Sinkron Google Sheet
Klik tombol **Sync** di header.

**Tarik saja (tanpa setup):** isi link Google Sheet (harus dibagikan *Anyone with the link*), lalu klik **Tarik dari Sheet**. Data pengeluaran & itinerary diganti dengan isi Sheet; pembayaran dan centang itinerary yang hanya ada di aplikasi tetap disimpan. Setiap kali menarik, backup lokal dibuat di `data/backups/`.

**Dua arah (kirim balik ke Sheet):**
1. Di Google Sheet: *Extensions → Apps Script*, tempel script dari tombol **Salin script** (atau `google-apps-script/Code.gs` versi yang diunduh dari aplikasi; versi itu sudah berisi token).
2. *Deploy → New deployment → Web app*, Execute as **Me**, Who has access **Anyone**.
3. Tempel Web app URL (`…/exec`) di panel Sync.

Saat mengirim, script menulis ulang baris pengeluaran (kolom B–U) dan sheet itinerary. Sebelum itu, script otomatis membuat salinan cadangan tersembunyi `_backup_<sheet>_<tanggal>` sekali per hari. Data khusus aplikasi disimpan di sheet tersembunyi `_app_data`.

**Sinkron otomatis:** menarik data tiap 1 menit saat aplikasi terbuka. Kalau Apps Script terpasang, aplikasi juga mengirim otomatis setiap ada perubahan. Kalau ada perubahan lokal yang belum terkirim, penarikan otomatis berhenti dan aplikasi meminta konfirmasi dulu supaya data tidak tertimpa.

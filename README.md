# Ruang IDB — Sistem Peminjaman Ruangan

Aplikasi web responsif/PWA untuk melihat ketersediaan ruangan, mengajukan peminjaman, memproses persetujuan, dan memantau status peminjaman di Institut Desain dan Bisnis Bali (IDB Bali).

Dibangun dari **PRD Sistem Peminjaman Ruangan IDB Bali v1.1** dengan fokus pada seluruh kebutuhan **Must** MVP, ditambah beberapa kebutuhan **Should** yang murah dan langsung berguna.

## Menjalankan

Prasyarat: **Node.js 22.5+** (memakai `node:sqlite` bawaan). Tidak ada dependensi npm.

```bash
npm start
```

Buka <http://127.0.0.1:3000>. Untuk pengembangan dengan auto-restart:

```bash
npm run dev
```

Database SQLite dibuat otomatis di `data/idb.sqlite` dan diisi data contoh saat pertama kali dijalankan. Hapus file `data/idb.sqlite*` untuk mengembalikan data demo ke kondisi awal.

Variabel lingkungan opsional:

| Variabel | Default | Kegunaan |
| --- | --- | --- |
| `PORT` | `3000` | Port server |
| `HOST` | `127.0.0.1` | Alamat bind |
| `DB_PATH` | `data/idb.sqlite` | Lokasi database |
| `HTTPS` | tidak diset | Set `1` agar cookie sesi memakai flag `Secure` di belakang HTTPS |

## Akun demo

Kata sandi semua akun: **`idb12345`**

| Akun | Peran | Kegunaan |
| --- | --- | --- |
| `rani@idb.ac.id` | Mahasiswa / UKM | Pemohon, melihat pengajuan sendiri |
| `sinta@idb.ac.id` | Dosen | Pemohon, pengajuan akademik |
| `gede@idb.ac.id` | Staf | Pemohon, kegiatan unit |
| `dimas@idb.ac.id` | Admin sarana prasarana | Panel admin, persetujuan, ruangan, blokir |

## Cakupan PRD

### Must (MVP) — selesai

| ID | Kebutuhan | Implementasi |
| --- | --- | --- |
| RM-01 | Katalog ruangan: nama, gedung, lantai, kapasitas, fasilitas | 8 ruangan contoh, kategori, fasilitas, deskripsi |
| AV-01 | Ketersediaan per tanggal | Grid jam per ruangan; warna tersedia / menunggu / terisi / diblokir |
| BK-01 | Formulir pengajuan singkat | Dialog tiga langkah: pilih ruang, isi keperluan, kirim |
| BK-02 | Validasi bentrok otomatis | Pemeriksaan ulang di dalam transaksi `BEGIN IMMEDIATE` |
| BK-03 | Pembatalan oleh pemohon sebelum mulai | Tombol batal dengan konfirmasi; slot langsung terbuka |
| AP-01 | Setujui/tolak dengan alasan wajib | Panel admin + validasi alasan minimal 5 karakter |
| AP-02 | Daftar pengajuan menunggu terpusat | Ringkasan admin dan tab Jadwal |
| NT-01 | Email saat disetujui/ditolak | Email dicatat di outbox (simulasi; lihat Log Email) |
| NT-02 | Notifikasi saat diubah/dibatalkan | Email pembatalan ke pemohon dan admin |
| RP-01 | Riwayat pengajuan pemohon | Halaman Pengajuan Saya dengan saringan status |
| RP-02 | Jadwal seluruh ruangan untuk admin | Tab Jadwal dengan filter tanggal/status/ruangan |
| UA-01 | Login akun kampus | Login email + kata sandi (stub SSO kampus) |
| UA-02 | Peran Pemohon dan Admin | Kontrol akses berbasis peran di API dan UI |

### Should yang ikut dikerjakan

- **RM-02** kelola ruangan oleh admin (tambah, ubah, aktif/nonaktif).
- **RM-03** kategori ruangan dan tag fasilitas.
- **RM-04** blokir jadwal untuk perkuliahan, libur, perawatan.
- **AV-02** pencarian dan filter tanggal, kapasitas, kategori, fasilitas.
- **BK-04** validasi kapasitas, jam operasional, durasi maksimum.
- **BK-05** pengajuan atas nama organisasi/UKM.
- **AP-03** target proses 2 hari kerja ditampilkan di antrean admin (pengingat otomatis belum dijadwalkan).
- **RP-05** audit log aktivitas penting tersimpan di database.

### Di luar rilis ini

Pembayaran/sewa eksternal, peminjaman peralatan, persetujuan berjenjang, kunci pintar/IoT, penjadwalan kuliah otomatis, QR check-in/no-show, WhatsApp, impor jadwal akademik, laporan ekspor, dan aplikasi native. Arsitektur sengaja dibuat sederhana agar modul-modul itu dapat ditambahkan tanpa mengubah alur inti.

## Aturan bisnis yang diterapkan

- Satu ruangan tidak boleh punya dua peminjaman tumpang tindih.
- Status **menunggu** dan **disetujui** sama-sama menahan slot; **ditolak** dan **dibatalkan** melepaskannya.
- Jadwal kuliah/blokir admin selalu didahulukan dan tidak bisa ditembus pengajuan biasa.
- Pengajuan minimal **H-2** dan maksimal **30 hari** ke depan (dapat diubah admin di Pengaturan).
- Jam operasional dan durasi maksimum mengikuti pengaturan tiap ruangan.
- Penolakan wajib disertai alasan; email keputusan dicatat ke outbox.
- Pemeriksaan bentrok dilakukan di dalam transaksi database, sehingga dua permintaan bersamaan hanya menghasilkan satu pemesanan.

## Arsitektur

```
server.js                 HTTP server, sesi cookie, static files, security headers
src/db.js                 Skema SQLite, seed data, migrasi awal
src/api.js                REST API, otorisasi, transaksi, audit log
src/domain.js             Ketersediaan, validasi, aturan bisnis, saran slot alternatif
src/email.js              Outbox email (simulasi pengiriman)
src/security.js           Hash scrypt, token sesi, perbandingan aman
public/                   SPA tanpa build: HTML, CSS token, app.js
tests/                    Tes integrasi end-to-end (node --test)
```

- **Frontend:** SPA mobile-first, hash routing, CSS design token, PWA shell + service worker.
- **Backend:** `node:http` + `node:sqlite`, API JSON, transaksi `BEGIN IMMEDIATE`.
- **Data:** tabel `users`, `sessions`, `rooms`, `bookings`, `blocks`, `email_outbox`, `audit_log`, `settings`.

## Keamanan

- Kata sandi di-hash dengan **scrypt** bersalt; sesi memakai token acak 32 byte.
- Cookie `HttpOnly`, `SameSite=Strict`, masa berlaku 7 hari; `Secure` diaktifkan lewat `HTTPS=1`.
- Pemeriksaan `Origin` untuk semua permintaan pengubah data.
- Semua query memakai prepared statement; input divalidasi dan dibatasi panjangnya.
- Konten dinamis di-escape di klien; CSP membatasi script ke origin sendiri.
- Rate limit login sederhana (8 percobaan per 15 menit per IP+email).
- Audit log mencatat login, pembuatan, persetujuan, penolakan, pembatalan, perubahan ruangan, blokir, dan pengaturan.

## Pengujian

```bash
npm test
```

Tes integrasi menjalankan server dengan database sementara dan memeriksa:

- login benar/salah, atribut cookie, pembatasan admin, dan penolakan origin asing;
- katalog ketersediaan dan validasi pengajuan (bentrok, H-2, kapasitas);
- persetujuan admin, alasan penolakan wajib, email outbox;
- pembatalan pemohon dan slot yang kembali tersedia;
- **uji konkurensi**: dua pemohon pada slot yang sama, hanya satu yang berhasil;
- blokir jadwal, pengelolaan ruangan, dan perubahan pengaturan minimal hari.

## Catatan integrasi

- **SSO kampus:** login saat ini memakai tabel pengguna lokal sebagai stub. Ganti `POST /api/auth/login` dengan verifikasi SSO tanpa mengubah kontrak sesi.
- **Email:** pengiriman disimulasikan ke `email_outbox` dan dapat dilihat admin. Integrasi SMTP/API email cukup mengganti `queueEmail` di `src/email.js`.
- **Waktu:** seluruh tanggal dan jam ditampilkan dalam **WITA** (`Asia/Makassar`); penyimpanan jadwal memakai tanggal lokal dan menit sejak tengah malam.

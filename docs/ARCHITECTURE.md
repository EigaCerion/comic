# Arsitektur NaruReader (Phase 1)

## Gambaran

```
┌──────────────── apps/web (Vite :5173) ────────────────┐
│  React 18 · React Router 6 · Tailwind                 │
│  RTK Query  ──► /api  (di-proxy Vite ke :3000)        │
│  <img src="/media/...">                               │
└───────────────────────────────────────────────────────┘
                        │ HTTP
┌──────────────── apps/api (Express :3000) ─────────────┐
│  routes  →  services  →  better-sqlite3 (sinkron)     │
│                      └─►  Sharp (kompresi WebP)       │
│  /media  →  express.static(DATA_DIR)                  │
│  jobs/downloadQueue  ──► fetch → Sharp → pages        │
└───────────────────────────────────────────────────────┘
                        │
                DATA_DIR (apps/api/data)
                ├── comics.db (+ -wal, -shm)
                ├── comics/<slug>/cover.webp
                ├── comics/<slug>/chapters/chapter-N/001.webp
                ├── cache/
                └── backups/
```

Satu proses Node melayani API **dan** worker download (`WORKER_ENABLED=true`).
Kalau download berat ingin dipisah, jalankan `npm run start:worker` dan set
`WORKER_ENABLED=false` di API — WAL + `busy_timeout` membuat dua proses aman
menulis ke database yang sama.

## Lapisan backend

| Lapisan | Tanggung jawab |
| ------- | -------------- |
| `routes/` | parsing request, status code, tidak ada SQL |
| `services/` | seluruh logika + query berparameter; dipakai bersama oleh routes, worker, dan script CLI |
| `db/` | koneksi tunggal + pragma + `schema.sql` |
| `jobs/` | worker antrian (claim job → unduh → kompresi → tulis pages) |
| `utils/` | config (dotenv berlapis), logger file+console, validator & guard path |

Karena `better-sqlite3` sinkron, service layer tidak perlu async kecuali yang
menyentuh filesystem atau jaringan. Transaksi memakai `db.transaction()` —
dipakai saat menulis pages (hapus lama + insert baru + update chapter jadi satu unit).

## Alur data penting

**Baca chapter.** `GET /api/chapters/:id` mengembalikan chapter + pages (URL
media) + tetangga prev/next dalam satu respons, jadi reader hanya butuh satu
request. Reader menyimpan posisi lewat `PUT /chapters/:id/progress` dengan
debounce 800ms; `reading_progress` di-upsert (`ON CONFLICT`) dan `comics.last_read_at`
ikut diperbarui supaya Home bisa menampilkan "lanjut baca".

**Upload manual.** Multer menahan file di memori → Sharp mengompresi ke
`DATA_DIR/comics/<slug>/chapters/<chapter-slug>/NNN.webp` dengan concurrency
`COMPRESSION_CONCURRENCY` (p-limit) → `replacePages()` menulis metadata halaman
(ukuran asli, ukuran akhir, rasio, sha1) dalam satu transaksi. Tidak ada file
mentah yang mendarat di disk.

**Download queue.** `download_queue` berfungsi sebagai queue: worker
`claimNextJob()` memakai transaksi untuk memindahkan job `pending` → `downloading`
(aman walau ada beberapa worker), mengunduh tiap URL dengan timeout + `AbortController`,
mengompresi, lalu menandai `completed`. Kegagalan dikembalikan ke `pending` sampai
`DOWNLOAD_MAX_ATTEMPTS`, setelah itu `failed` dengan pesan error yang tersimpan.
Job yang tertinggal berstatus `downloading` (app mati mendadak) dipulihkan saat
worker start.

## Konvensi penyimpanan

- `comics.cover_image` menyimpan **path relatif dari `DATA_DIR`**
  (`comics/<slug>/cover.webp`); URL untuk klien = `/media/<path>`.
- `pages.image_filename` menyimpan **nama file saja**; foldernya diturunkan dari
  `comics.slug` + `chapters.slug`, sehingga rename judul tidak merusak referensi
  halaman selama slug tidak diubah.
- Semua path dibangun lewat `safeJoin()` — hasil resolve wajib di dalam `DATA_DIR`.

## Frontend

- **RTK Query** sebagai satu-satunya lapisan data (`src/api/apiSlice.js`), dengan
  tag invalidation: mutasi upload/favorit/hapus otomatis menyegarkan daftar terkait.
  Halaman Downloads memakai `pollingInterval` 2s, sidebar 5s.
- **State lokal UI** (tema, grid/list) dan **preferensi reader** (mode, fit, zoom,
  brightness, contrast) di slice terpisah, dipersist ke `localStorage` lewat
  middleware kecil — tidak menyentuh server.
- **Reader** memakai `IntersectionObserver` pada container scroll; halaman aktif
  adalah halaman terlihat paling atas (berbasis posisi, bukan rasio, supaya tetap
  benar sebelum gambar selesai dimuat).
- **Tema** memakai class `dark` di `<html>` + token warna di `styles/theme.css`,
  jadi palet Konoha dipakai konsisten oleh Tailwind dan CSS mentah.

## Batas yang diketahui (Phase 1)

- Belum ada virtual scrolling; grid mengandalkan pagination 24 item + lazy image.
  Untuk >1000 komik, ganti `ComicGrid` dengan `react-window` (Phase 3).
- Belum ada scraper: sumber download berupa daftar URL gambar eksplisit.
- Belum ada test otomatis; verifikasi Phase 1 dilakukan manual + `npm run test:db`.
- Single-user, tanpa autentikasi — server sengaja hanya untuk `localhost`.

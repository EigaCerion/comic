# 📖 NaruReader

**Pembaca komik pribadi yang berjalan di komputer sendiri.** Simpan koleksimu
secara lokal, baca dari HP lewat Wi-Fi rumah, tanpa iklan dan tanpa akun pihak
ketiga. Gambar dikompresi otomatis ke WebP sehingga ribuan chapter tetap ringan
di disk.

Dibuat oleh **Yusuf Aristokrat**.

---

## Apa yang bisa dilakukan

| | |
|---|---|
| 📚 **Perpustakaan lokal** | Semua komik dan gambar tinggal di disk sendiri. Tidak ada telemetry, tidak ada layanan luar. |
| 📖 **Pembaca layar panjang** | Mode gulir menerus dan mode per-halaman, lanjut otomatis dari posisi terakhir. |
| 📥 **Impor fleksibel** | Dari folder gambar, berkas `.cbz`, atau URL halaman komik. |
| 🗜️ **Kompresi otomatis** | WebP kualitas HD, ukuran berkas turun 70–80%. |
| 🤖 **Bot pengawas** | Memeriksa kelengkapan chapter dan mengantre ulang yang cacat. |
| 👤 **Akun & peran** | Membaca bebas tanpa login; akun dipakai untuk rating, komentar, dan pengelolaan. |
| 📱 **Akses dari HP** | Buka lewat Wi-Fi yang sama, lengkap dengan QR dan pemeriksaan koneksi. |
| 🌙 **Tema gelap** | Dirancang gelap sejak awal, nyaman untuk membaca lama. |

---

## Yang dibutuhkan

- **Node.js 20 atau lebih baru** (diuji di Node 24)
- **npm 10+**
- Ruang disk secukupnya untuk koleksimu
- Windows, macOS, atau Linux

---

## Pemasangan

### 1. Ambil kodenya

```bash
git clone <url-repo-ini>
```

```bash
cd naruread-app
```

### 2. Pasang dependensi

```bash
npm install
```

> **Catatan npm 12+.** Versi npm terbaru memblokir install script paket native
> secara default. Persetujuan untuk `better-sqlite3`, `sharp`, dan `esbuild`
> sudah tercatat di `package.json`. Kalau saat dijalankan muncul error soal
> binding native, jalankan sekali:
>
> ```bash
> npm rebuild better-sqlite3 sharp
> ```

### 3. Siapkan konfigurasi

Salin berkas contoh menjadi konfigurasi aktif:

```bash
cp .env.example apps/api/.env
```

Di Windows (Command Prompt), pakai:

```bash
copy .env.example apps\api\.env
```

Lalu **buka `apps/api/.env` dan isi akun admin pertama**:

```
SUPERADMIN_USERNAME=namamu
SUPERADMIN_PASSWORD=sandi-pilihanmu-minimal-8-karakter
```

> Tanpa dua baris ini tidak ada satu pun akun yang bisa mengelola koleksi.
> Sandinya hanya dipakai saat akun belum ada — setelah itu, mengganti sandi
> lewat aplikasi tidak akan tertimpa oleh isi berkas ini.

### 4. Buat database

```bash
npm run init:db
```

Database, folder gambar, dan folder cadangan dibuat otomatis. Tidak ada langkah
manual lain.

### 5. (Opsional) Isi data contoh

Kalau ingin langsung mencoba pembacanya tanpa mengimpor apa pun — 4 komik, 8
chapter, 48 halaman dengan gambar placeholder asli:

```bash
npm run seed:test-data
```

---

## Menjalankan

Ada dua cara, dipakai untuk keperluan berbeda.

### Cara harian — satu proses, siap dipakai

Bangun frontend sekali:

```bash
npm run build
```

Lalu jalankan:

```bash
npm run start:quiet
```

Aplikasi terbuka di **http://localhost:3000** dan sekaligus melayani HP di
jaringan yang sama. Di Windows, `NaruReader.bat` melakukan hal yang sama dengan
satu klik ganda, dan `NaruReader-Stop.bat` menghentikannya.

Menghentikan lewat terminal:

```bash
npm run stop
```

### Cara pengembangan — dua port, muat ulang otomatis

```bash
npm run dev
```

| Servis | Alamat |
|---|---|
| Frontend (Vite) | http://localhost:5173 |
| API (Express) | http://localhost:3000 |

Vite mem-proxy `/api` dan `/media` ke port 3000, jadi tidak ada urusan CORS saat
pengembangan. Port 5173 **hanya** untuk pengembangan — HP tetap memakai port
3000.

---

## Login pertama kali

1. Buka http://localhost:3000
2. Klik **Masuk** di sidebar
3. Gunakan `SUPERADMIN_USERNAME` dan `SUPERADMIN_PASSWORD` yang tadi diisi

Setelah masuk, menu pengelolaan (Unduhan, Import, Pengguna) akan muncul.

**Membaca komik tidak memerlukan login sama sekali.** Akun hanya dibutuhkan
untuk memberi rating, berkomentar, dan mengelola koleksi.

---

## 📱 Buka dari HP

Cara paling ringan: **satu port**. Kalau `apps/web/dist` ada, API sekalian
menyajikan frontend, jadi HP hanya perlu menjangkau port 3000 — tanpa proxy,
tanpa CORS.

```bash
npm run start:lan
```

Script itu build frontend → menampilkan alamat LAN → menjalankan API. Lihat
alamatnya kapan saja dengan:

```bash
npm run lan
```

Lalu buka `http://<ip-laptop>:3000` di HP (harus satu Wi-Fi). Di Chrome/Safari
bisa **Add to Home Screen** — meta tag PWA-nya sudah dipasang, jadi tampil tanpa
address bar.

Kalau HP tidak bisa connect, biasanya Windows Firewall. Jalankan **sekali** di
PowerShell sebagai Administrator:

```powershell
New-NetFirewallRule -DisplayName "NaruReader" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000,5173 -Profile Private
```

Untuk ngoding sambil melihat hasilnya langsung di HP (hot reload, dua port):

```bash
npm run dev:lan
```

→ buka `http://<ip-laptop>:5173` di HP.

### Cara lain menjalankan (tanpa `npm run`)

Yang membuat aplikasi ini bisa diakses lewat jaringan bukan perintahnya,
melainkan servernya yang bind ke semua interface. Jadi perintah mana pun di
bawah ini sama-sama bisa dibuka dari HP:

```bash
node apps/api/src/server.js
```

Paling ringan dan tanpa perantara npm. Boleh dipanggil dari folder mana pun
dengan path lengkap — lokasi `data/` dan `dist/` dihitung dari letak berkasnya,
bukan dari direktori kerja.

```bash
npx naruread
```

Paket workspace ini punya `bin`, jadi `npx naruread` (dan `npx naruread-worker`
untuk worker terpisah) bisa dipakai dari dalam repo tanpa mengingat path.

**`NaruReader.bat`** — klik dua kali dari Explorer. Otomatis mem-build frontend
kalau `dist` belum ada, menampilkan alamat, lalu menjalankan server.
**`NaruReader-Stop.bat`** mematikannya, termasuk kalau jendelanya sudah tidak ada.

Server berjalan **di dalam proses launcher itu sendiri**, bukan sebagai proses
anak. Ini disengaja: Windows tidak mengirim sinyal ke Node saat jendela console
ditutup, sehingga proses anak akan selamat sebagai proses yatim tanpa jendela —
"sudah ditutup tapi aplikasinya masih jalan". Satu jendela = satu proses = pasti
berhenti bersama jendelanya. Menekan launcher dua kali juga tidak menggandakan
proses: instance kedua mendeteksi yang pertama, menampilkan alamatnya, lalu keluar.

Kalau suatu saat masih ada proses tertinggal (mis. dimatikan paksa), hentikan
lewat port-nya — bukan dengan membunuh semua node:

```bash
npm run stop
```

Untuk jalan terus di latar belakang / otomatis saat Windows menyala, gunakan
process manager seperti `pm2` (`npx pm2 start apps/api/src/server.js --name naruread`),
atau daftarkan `NaruReader.bat` di Task Scheduler. Keduanya belum saya uji di
mesin ini.

**Yang tidak bisa dipakai:** `npx serve`, `npx http-server`, atau `vite preview`
hanya menyajikan berkas statis di `dist`. Aplikasi akan terbuka tapi kosong —
API, database, `/media`, dan worker download tidak ikut jalan.

**Di luar rumah?** Jangan buka port 3000 ke internet lewat port forwarding atau
tunnel publik (ngrok/cloudflared): server ini tanpa autentikasi, siapa pun yang
menemukan URL-nya bisa membaca dan menghapus library-mu. Kalau butuh akses dari
luar, pakai VPN jaringan pribadi seperti Tailscale sehingga hanya perangkatmu
sendiri yang bisa menjangkau.

Catatan:

- `npm run dev` biasa **juga** sudah bisa diakses dari HP di port 3000, karena
  API menyajikan `dist` kalau ada. Tapi `dist` itu snapshot — setelah mengubah
  kode, jalankan `npm run build` lagi supaya tampilan di HP ikut berubah
  (atau pakai `dev:lan` + port 5173 yang hot reload). Tidak perlu restart API:
  keberadaan `dist` diperiksa per request.
- Kalau `npm run dev` masih jalan saat `npm run start:lan` dipanggil, port 3000
  sudah terpakai. Server mendeteksi bahwa yang menempati adalah NaruReader juga,
  lalu berhenti dengan pesan (exit 0) alih-alih crash — build barunya memang
  sudah langsung dipakai proses yang sedang jalan. Untuk berganti proses,
  hentikan yang lama dengan Ctrl+C lebih dulu. Kalau port dipakai aplikasi lain,
  pesannya memberi perintah `netstat`/`taskkill` dan opsi `API_PORT`.
- Server ini **tanpa autentikasi**. Begitu terikat ke LAN, siapa pun di jaringan
  yang sama bisa membuka library-mu. Pakai di Wi-Fi rumah, jangan di Wi-Fi publik,
  dan matikan servernya kalau tidak dipakai.
- Reader sudah disiapkan untuk layar HP: sidebar off-canvas dengan tombol ☰,
  grid 2 kolom, tinggi halaman memakai `dvh` (address bar HP ikut dihitung),
  dan tap pada gambar = halaman berikutnya.

---

## 📁 Struktur

```
naruread-app/
├── apps/
│   ├── api/                     # Express + SQLite + Sharp
│   │   ├── src/
│   │   │   ├── db/              # koneksi + schema.sql
│   │   │   ├── routes/          # comics, chapters, search, downloads, uploads, bookmarks, stats
│   │   │   ├── services/        # logika bisnis (comic, chapter, upload, kompresi, queue, stats)
│   │   │   ├── jobs/            # worker download berbasis SQLite
│   │   │   ├── utils/           # config, logger, validators
│   │   │   ├── app.js           # susunan Express
│   │   │   ├── server.js        # entry API (+ worker embedded)
│   │   │   └── worker.js        # entry worker standalone
│   │   ├── scripts/             # init-db, seed, backup, stats, test-db
│   │   └── data/                # comics.db + gambar (di-gitignore)
│   └── web/                     # React 18 + Vite + Tailwind + RTK Query
│       └── src/
│           ├── api/apiSlice.js  # semua endpoint di satu tempat
│           ├── components/      # Layout, ComicList, Reader, Common
│           ├── pages/           # Home, Browse, ComicDetail, Reader, Downloads, Upload, Settings
│           ├── store/           # RTK store + ui/reader slice (persist ke localStorage)
│           └── styles/          # theme.css (token warna) + globals.css
└── docs/                        # ARCHITECTURE.md, API-REFERENCE.md
```

---

## 🧾 Perintah

| Perintah                  | Fungsi                                              |
| ------------------------- | --------------------------------------------------- |
| `npm run dev`             | API + frontend sekaligus (concurrently)             |
| `npm run dev:api`         | hanya API (`node --watch`)                          |
| `npm run dev:web`         | hanya Vite                                          |
| `npm run start:worker`    | worker download terpisah (set `WORKER_ENABLED=false` di API) |
| `npm run init:db`         | buat folder data + schema (idempotent)              |
| `npm run reset:db`        | hapus database lalu buat ulang                      |
| `npm run seed:test-data`  | isi data contoh                                     |
| `npm run test:db`         | cek schema, FTS5, foreign key, integrity            |
| `npm run test:extractor`  | uji parser import URL terhadap fixture HTML         |
| `npm run test:audit --workspace apps/api` | uji logika bot pengawas (berkas rusak, nomor bolong) |
| `npm run start:quiet`     | jalankan tenang: hanya alamat yang tampil, log ke berkas |
| `npm run stop`            | hentikan NaruReader lewat port-nya (termasuk proses yatim) |
| `npm run bench:compress`  | ukur ukuran/waktu/penyimpangan tiap setelan kompresi |
| `npm run covers:backfill --workspace apps/api` | isi cover komik yang belum punya poster |
| `npm run backup:db`       | backup ke `data/backups/database-backup-YYYY-MM-DD.db` |
| `npm run stats:db`        | ringkasan library + storage + rasio kompresi        |
| `npm run build`           | build produksi frontend ke `apps/web/dist`          |
| `npm run lan`             | tampilkan alamat untuk dibuka dari HP + hint firewall |
| `npm run dev:lan`         | dev server terbuka ke LAN (hot reload, port 5173)   |
| `npm run start:lan`       | build + jalankan API satu port (port 3000)           |

---

## ✅ Yang sudah berjalan

**Week 1 — Setup & Database**

- Monorepo npm workspaces, Vite + Express siap jalan bersamaan
- Schema SQLite lengkap: `comics`, `chapters`, `pages`, `reading_progress`,
  `bookmarks`, `download_queue` + index + FTS5
- Pragma performa: WAL, `cache_size` 20MB, `temp_store=MEMORY`, `foreign_keys=ON`

**Week 2 — Core UI & Layout**

- Home: hero tema Konoha, statistik library, "lanjut baca", favorit, terbaru
- Browse: grid/list, filter genre (dengan facet count) + status + 6 opsi sort, pagination
- Detail komik: metadata, daftar chapter dengan indikator progress, favorit, hapus
- Search: FTS5 prefix match dengan fallback LIKE, plus suggestion dropdown di topbar

**Week 3 — Reader & Download**

- Reader full-screen: mode scroll & per-halaman, fit lebar/tinggi/zoom,
  brightness & contrast, bookmark, navigasi prev/next chapter
- Shortcut keyboard: `← →` halaman, `Space` lanjut, `[ ]` chapter, `F` fit, `Esc` keluar
- Progress baca tersimpan otomatis (debounce 800ms) dan dilanjutkan saat chapter dibuka lagi
- Download manager: antrian berbasis SQLite, worker concurrency, progress per job,
  retry otomatis (3 attempt), jeda/lanjut/bersihkan, pemulihan job setelah crash
- Pipeline kompresi Sharp: WebP q75, maksimum 1600×2560, EXIF dibuang
  (terukur **±78% lebih kecil** pada data uji — target dokumentasi 70–80%)

**Week 4 — Upload Manual & Polish**

- Upload komik + cover, dan upload chapter multi-file (urutan halaman dari nama
  file secara natural: `2.png` sebelum `10.png`)
- Settings: tema terang/gelap, preferensi reader, statistik storage & kompresi
- Halaman Settings juga menampilkan health API, versi Node, RAM
- Error handling terpusat, logger ke `apps/api/logs/`, 404 & error state di UI

---

## 📦 Import komik

Ada dua jalur di halaman **Import** (`/import`).

### 1. Folder & CBZ (paling cepat dan paling andal)

Taruh sumber di `IMPORT_DIR` (default `apps/api/import`):

```
import/
├── Judul Komik A/
│   ├── Chapter 1/        → 001.webp, 002.webp, …
│   └── Chapter 10.5/
├── Judul Komik B/        → gambar langsung di sini = satu chapter
└── Judul Komik C.cbz     → satu arsip; subfolder di dalamnya = chapter
```

Klik **Segarkan** untuk memindai (tidak menulis apa pun), lalu **Import**.
Yang dilakukan importer:

- nomor chapter dibaca dari nama folder/file — `Chapter 10.5` → `10.5`,
  `ch-007` → `7`, `Vol 2 Chapter 13` → `13`
- urutan halaman natural (`2.jpg` sebelum `10.jpg`), lalu ditulis ulang jadi
  `001.webp`, `002.webp`, …
- judul dibersihkan dari tanda kurung/bracket: `[Grup] Naruto (2024)` → `Naruto`
- semua halaman dikompresi Sharp; import berjalan sebagai job background dengan
  progress per halaman

Arsip juga bisa diunggah langsung dari browser (maks 512 MB) tanpa menaruh file
di `IMPORT_DIR`.

### 2. Dari URL

Tempel URL halaman daftar chapter → **Deteksi** → pilih chapter → **Unduh**.
Yang masuk antrian hanyalah URL halaman chapter; worker yang mengekstrak daftar
gambarnya saat job diproses, jadi mengantre 200 chapter tetap instan.

Desainnya **satu extractor generik + tabel selector**, bukan satu scraper per
situs:

- `apps/api/src/services/sources/selectors.json` — peta host → preset/selector.
  Kalau sebuah situs mengubah layout, yang diperbaiki hanya baris di file ini.
- Preset yang tersedia: `generic`, `wp-manga`, `ts-reader`.
- Tanpa entri host, extractor memakai heuristik: daftar gambar dari JSON inline
  di `<script>` (pola paling akurat di tema populer), lalu fallback ke container
  dengan `<img>` terbanyak, membaca `data-src`/`data-lazy-src`/`srcset` untuk
  gambar lazy-load, dan menyaring ikon/banner.
- **Deteksi bersifat preview**: tidak ada yang ditulis sampai kamu menekan Unduh,
  dan tombol *cek gambar* per chapter memperlihatkan URL yang akan diambil.

### Poster otomatis

Grid tidak boleh kosong, jadi cover diisi berlapis:

1. poster dari halaman seri — `og:image` → `twitter:image` → JSON-LD →
   selector tema → gambar terbesar di paruh atas halaman
2. kalau itu gagal (situs tidak menyediakan, atau CDN-nya menolak), cover dibuat
   dari **halaman pertama chapter paling awal** — tanpa jaringan, selalu tersedia
3. tombol *Buat cover dari halaman 1* di halaman detail untuk memperbaiki manual

Cover dinormalkan ke maksimum 600×900 WebP q82 (grid memakai rasio 2:3; poster
asli tetap proporsional, cover dari halaman komik dipotong dari atas).

URL media diberi penanda versi (`cover.webp?v=<timestamp>`) karena `/media`
dikirim dengan cache 30 hari `immutable` sementara nama berkasnya tetap. Tanpa
penanda itu, cover yang diperbarui tetap tampil lama di browser sampai cache
kedaluwarsa. Hal yang sama berlaku untuk halaman chapter yang diunduh ulang.

Catatan: sebagian situs menyisipkan halaman promo di awal chapter, jadi cover
hasil fallback "halaman 1" bisa berupa banner situs. Kalau itu terjadi, ambil
poster aslinya lewat Deteksi di halaman Import atau
`POST /api/comics/:id/cover/from-url`.

Untuk library yang sudah ada:

```bash
npm run covers:backfill --workspace apps/api
```

### Efisiensi download

Diukur, bukan diasumsikan — jalankan `npm run bench:compress`. Hasil pada
halaman uji 1600×2400 (8 halaman, sumber 1,28 MB):

| Varian | Ukuran | Hemat | Waktu | MAE vs sumber |
| ------ | ------ | ----- | ----- | ------------- |
| q75 effort4 warna (default) | 0,34 MB | 73,1% | 6,95s | 0,79 |
| q75 effort4 grayscale | 0,34 MB | 73,3% | 13,28s | 0,79 |
| q75 effort6 warna | 0,34 MB | 73,6% | 15,58s | 0,79 |
| q80 effort4 grayscale | 0,38 MB | 70,6% | 16,11s | 0,78 |

Kesimpulannya: **menaikkan effort atau memaksa grayscale tidak layak** — hemat
0,2–0,5pp dengan biaya waktu 2×. Yang benar-benar berpengaruh:

- **Passthrough** — gambar yang sudah WebP, sudah di bawah batas resolusi, dan
  sudah efisien (≤0,35 byte/pixel) disimpan apa adanya. Nol CPU, nol kehilangan
  kualitas. Untuk situs yang sudah menyajikan WebP, ini menghilangkan seluruh
  tahap encode.
- **Paralelisme jaringan** — gambar kini punya jatah terpisah dari halaman HTML:
  `IMAGE_CONCURRENCY=4` dengan `IMAGE_REQUEST_DELAY_MS=150`, bukan satu per satu
  tiap 750ms. Unduhan dan kompresi juga saling menumpuk (halaman berikutnya
  diunduh sementara yang sekarang dikompresi).
- Resolusi tetap 1600×2560 dan kualitas tetap 75 — jadi "HD" tidak berubah;
  yang berubah hanya berapa lama sampainya.

Etika & keamanan permintaan keluar:

- `robots.txt` dipatuhi (`RESPECT_ROBOTS=true`), jeda `REQUEST_DELAY_MS` per host,
  `User-Agent` jujur, `Referer` dikirim (banyak CDN gambar menolak tanpa itu).
- Host wajib ada di `ALLOWED_SOURCE_DOMAINS`; localhost & IP privat selalu ditolak.
- `webtoons.com` ditandai `disabled` di `selectors.json` — layanan resmi berlisensi
  yang ToS-nya melarang pengambilan otomatis. Hapus sendiri kalau memang mau.

Catatan jujur soal status verifikasi: logika parser diuji lewat fixture
(`npm run test:extractor`, 9 pemeriksaan), dan jalur fetch + robots + parsing
sudah dicoba ke host nyata (HTTP 200, tidak diblokir). Tapi **selector untuk
halaman seri tiap situs masih titik awal** — jalankan Deteksi pada satu URL seri
sungguhan, dan kalau hasilnya kosong perbaiki selectors.json. Situs dengan
bot-protection (Cloudflare) akan gagal dengan pesan jelas; itu tidak diakali.

---

## 🤖 Bot importir & bot pengawas

Worker berjalan di latar belakang begitu server menyala.

**5 bot importir** (`IMPORTER_WORKERS`) menarik job chapter dari antrian secara
bersamaan. Kecepatan keluar tetap dibatasi `IMAGE_CONCURRENCY` + jeda per host,
jadi menambah bot mempercepat saat mengimpor beberapa komik/situs sekaligus,
bukan membanjiri satu situs.

**3 bot pengawas** (`SUPERVISOR_WORKERS`) memeriksa hasil kerja importir:

- setiap chapter yang baru selesai langsung diperiksa;
- sapuan berkala tiap `SUPERVISOR_SWEEP_MS` menyisir chapter yang belum pernah
  diperiksa (kolom `chapters.audited_at` menjaga agar koleksi besar tidak
  dipindai ulang berkali-kali);
- yang diperiksa: berkas tiap halaman **ada**, **tidak 0 byte**, dan **header-nya
  memang gambar** (WebP/JPEG/PNG/AVIF) — bukan potongan HTML error; jumlah
  halaman cocok dengan catatan; serta nomor chapter yang bolong;
- chapter yang masih mengantre tidak dianggap cacat;
- temuan yang bisa diperbaiki sendiri langsung diantrekan ulang dengan prioritas
  lebih tinggi. Nomor yang bolong butuh daftar chapter dari situs, jadi ditangani
  tombol **Cek chapter baru** (resync).

**Resync** membandingkan koleksi dengan halaman seri sumber: berapa chapter yang
ada di situs, berapa yang sudah kita punya, lalu mengantrekan selisihnya. Ini
jalur untuk chapter baru rilis maupun menambal nomor yang hilang. URL seri
disimpan otomatis saat import (`comics.source_url`).

Status dan temuan tampil di halaman **Unduhan**; per komik ada tombol
**🛡️ Periksa kelengkapan** dan **🔄 Cek chapter baru** di halaman detail.

### Tahan putus jaringan

- Setiap halaman ditulis ke berkas sementara lalu di-`rename` (atomik), jadi
  tidak pernah ada berkas setengah jadi yang lolos dianggap halaman valid.
- Saat job diulang, halaman yang berkasnya sudah utuh **tidak diunduh ulang** —
  pemulihan hanya mengambil sisa halaman yang benar-benar kurang.
- Job yang tertinggal berstatus `downloading` saat aplikasi mati dikembalikan ke
  `pending` otomatis pada start berikutnya.

Uji logikanya: `npm run test:audit` (10 pemeriksaan, tanpa jaringan/database).

---

## 👤 Akun & peran

Membaca komik **tidak butuh akun**. Akun hanya menambah kemampuan di atas itu.

Saat pertama kali dijalankan, aplikasi membuat satu akun super admin dari
`SUPERADMIN_USERNAME` dan `SUPERADMIN_PASSWORD` di `.env`. Tanpa keduanya tidak
ada akun sama sekali, dan menu pengelolaan tidak akan bisa dibuka oleh siapa pun.

| Peran | Bisa apa |
|---|---|
| `super_admin` | segalanya, termasuk mengelola akun |
| `publisher` | menarik komik baru, mengantre unduhan, resync, audit |
| `editor` | menyunting metadata, memoderasi komentar |
| `author` | mengunggah chapter manual |
| `reader` | memberi rating dan berkomentar |

Pembaca bisa mendaftar sendiri lewat halaman Masuk, dan selalu mendapat peran
`reader`. Peran lain hanya bisa diberikan super admin lewat halaman Pengguna.

Sandi disimpan sebagai hash scrypt (bukan teks biasa), sesi memakai token acak
256-bit di cookie `HttpOnly`, dan menonaktifkan akun langsung mencabut semua
sesinya.

## 🔒 Keamanan yang sudah dipasang

- **Allowlist domain download** (`ALLOWED_SOURCE_DOMAINS`) plus penolakan
  localhost/IP privat → mencegah SSRF lewat endpoint download.
- **Anti directory traversal**: semua path gambar lewat `safeJoin()` yang
  memastikan hasil resolve tetap di dalam `DATA_DIR`.
- **Query berparameter** di seluruh layer database (tidak ada string
  interpolasi ke SQL, termasuk pada pencarian dan pagination).
- **Validasi upload**: hanya MIME `image/*`, batas ukuran file & jumlah halaman,
  file ditahan di memori lalu dikompresi (tidak ada file mentah tertinggal).
- `helmet` + CORS, media disajikan read-only, `dotfiles: 'deny'`.

---

## ⚙️ Konfigurasi (.env)

Lihat [.env.example](.env.example). Yang paling sering diubah:

| Variabel                 | Default | Catatan                                              |
| ------------------------ | ------- | ---------------------------------------------------- |
| `API_PORT`               | 3000    | dibaca lebih dulu daripada `PORT`                    |
| `DATA_DIR`               | ./data  | boleh absolute, mis. `D:/NaruReaderData`             |
| `IMAGE_QUALITY`          | 75      | naikkan kalau ingin kualitas lebih tinggi            |
| `IMAGE_MAX_WIDTH/HEIGHT` | 1600 / 2560 | batas resolusi HD                                |
| `COMPRESSION_CONCURRENCY`| 4       | turunkan ke 2 di laptop 8GB RAM                      |
| `DOWNLOAD_CONCURRENCY`   | 2       | job download paralel                                 |
| `ALLOWED_SOURCE_DOMAINS` | 6 domain | allowlist sumber download                           |
| `WORKER_ENABLED`         | true    | `false` kalau worker dijalankan sebagai proses sendiri |

---

## 🧭 Catatan implementasi (beda dari dokumen desain)

Tiga penyesuaian yang diambil sadar terhadap `naruread-dokumentasi-lengkap.md`:

1. **FTS**: `CREATE FULLTEXT INDEX` di dokumen adalah sintaks MySQL dan tidak
   jalan di SQLite. Diganti virtual table **FTS5** + trigger sinkronisasi.
2. **Queue**: `bull` butuh Redis. Antrian dipakai berbasis **tabel SQLite**
   (`download_queue` + kolom `progress`, `attempts`, `payload`, `error`) sesuai
   catatan "atau gunakan SQLite-based queue untuk zero dependencies".
3. **Scraper & Electron ditunda**: keduanya Phase 2/Phase 4. Download Phase 1
   menerima daftar URL gambar langsung — jadi pipeline unduh → kompresi →
   simpan sudah terbukti jalan, tinggal ditambah adapter sumber nanti.

Selain itu Redux Toolkit dipakai versi 2.x (dokumen menulis 1.9) karena RTK Query
di versi 2 adalah yang didukung untuk React 18/19; API yang dipakai identik.

---

## ➡️ Rencana berikutnya

- Adapter scraper per sumber (`komiku`, `komikpedia`, `webtoons`, dst) yang
  mengubah URL chapter menjadi daftar URL gambar, lalu memakai queue yang sudah ada
- Batch import dari daftar URL + jadwal update otomatis
- `react-window` untuk virtual scrolling saat koleksi >1000 komik
- Unit test (Jest) untuk service layer dan E2E (Cypress) untuk alur baca

# API Reference — NaruReader v0.1.0

Base URL: `http://localhost:3000/api` · media statis: `http://localhost:3000/media/...`

Semua respons JSON. Error memakai bentuk `{ "error": "pesan", "details"?: {...} }`
dengan status 400 (validasi), 404 (tidak ditemukan), atau 500.

---

## Health

| Method | Endpoint  | Keterangan |
| ------ | --------- | ---------- |
| GET    | `/health` | status, versi, uptime |

---

## Comics

| Method | Endpoint | Keterangan |
| ------ | -------- | ---------- |
| GET | `/comics` | daftar komik + pagination |
| GET | `/comics/continue` | komik yang sedang dibaca (untuk Home) |
| GET | `/comics/:idOrSlug` | detail satu komik |
| GET | `/comics/:idOrSlug/chapters` | daftar chapter + progress baca |
| GET | `/comics/:id/progress` | progress semua chapter komik |
| POST | `/comics` | buat komik (metadata JSON, tanpa cover) |
| POST | `/comics/:id/chapters` | daftarkan chapter kosong |
| PATCH | `/comics/:id` | ubah metadata |
| POST | `/comics/:id/cover/from-page` | buat poster dari halaman pertama chapter paling awal (tanpa jaringan) |
| POST | `/comics/:id/cover/from-url` | `{ url, referer? }` → unduh poster; host CDN diizinkan |
| POST | `/comics/:id/favorite` | toggle favorit |
| DELETE | `/comics/:id` | hapus komik **beserta seluruh file gambarnya** |

**Query `GET /comics`**

| Param | Default | Keterangan |
| ----- | ------- | ---------- |
| `page` | 1 | halaman |
| `limit` | 24 | maksimum 100 |
| `search` | — | cocok pada title/author/artist |
| `genre` | — | satu nama genre |
| `status` | — | `Ongoing` / `Completed` / `Hiatus` |
| `favorite` | false | `true` untuk hanya favorit |
| `sort` | `latest` | `latest`, `created`, `alphabetical`, `rating`, `chapters`, `lastRead` |

```json
{
  "items": [
    {
      "id": 1,
      "title": "Kisah Rubah Ekor Sembilan",
      "slug": "kisah-rubah-ekor-sembilan",
      "genres": ["Action", "Shounen"],
      "status": "Ongoing",
      "rating": 4.8,
      "totalChapters": 3,
      "downloadedChapters": 3,
      "coverUrl": "/media/comics/kisah-rubah-ekor-sembilan/cover.webp",
      "isFavorite": false,
      "updatedAt": "2026-08-17 15:43:05"
    }
  ],
  "pagination": { "page": 1, "limit": 24, "total": 4, "totalPages": 1 }
}
```

---

## Chapters

| Method | Endpoint | Keterangan |
| ------ | -------- | ---------- |
| GET | `/chapters/:id` | chapter + daftar halaman + navigasi `prev`/`next` + komiknya |
| PUT | `/chapters/:id/progress` | simpan posisi baca — body `{ "last_page_read": 3 }` |
| DELETE | `/chapters/:id` | hapus chapter + file halamannya |

```json
{
  "id": 1,
  "number": 1,
  "title": "Latihan ke-1",
  "totalPages": 6,
  "isDownloaded": true,
  "lastPageRead": 3,
  "progressPercentage": 50,
  "comic": { "id": 1, "slug": "kisah-rubah-ekor-sembilan" },
  "pages": [{ "number": 1, "url": "/media/comics/.../chapter-1/001.webp", "size": 16384 }],
  "prev": null,
  "next": { "id": 2, "chapter_number": 2 }
}
```

---

## Search

| Method | Endpoint | Keterangan |
| ------ | -------- | ---------- |
| GET | `/search?q=naruto` | FTS5 prefix match, fallback LIKE; `limit` maks 50 |
| GET | `/search/genres` | daftar genre unik + jumlah komik |
| POST | `/search/rebuild-index` | rebuild index FTS5 (setelah import besar) |

---

## Downloads

| Method | Endpoint | Keterangan |
| ------ | -------- | ---------- |
| GET | `/downloads` | antrian (maks 200 terbaru) + `counts` per status |
| POST | `/downloads` | tambah job |
| POST | `/downloads/pause` | semua `pending` → `paused` |
| POST | `/downloads/resume` | semua `paused` → `pending` |
| POST | `/downloads/clear` | hapus job `completed` & `failed` |
| POST | `/downloads/:id/retry` | job `failed`/`paused` → `pending` |
| DELETE | `/downloads/:id` | hapus job (kecuali sedang `downloading`) |

**Body `POST /downloads`**

```json
{
  "comic_id": 1,
  "chapter_number": 4,
  "chapter_title": "Ujian Chunin",
  "image_urls": ["https://komiku.org/ch4/001.jpg", "https://komiku.org/ch4/002.jpg"],
  "source_url": "https://komiku.org/ch4",
  "priority": 0
}
```

URL divalidasi terhadap `ALLOWED_SOURCE_DOMAINS`; localhost dan IP privat selalu
ditolak. Kalau ada URL yang lolos dan ada yang tidak, job tetap dibuat dan URL
yang ditolak dikembalikan di `rejected`. Kalau **semua** ditolak → 400.

Status job: `pending` → `downloading` → `completed` | `failed` (retry sampai
`DOWNLOAD_MAX_ATTEMPTS`), plus `paused`.

---

## Uploads (multipart/form-data)

| Method | Endpoint | Field |
| ------ | -------- | ----- |
| POST | `/uploads/comic` | file `cover` (opsional) + `title` (wajib), `author`, `artist`, `genres`, `status`, `rating`, `description` |
| POST | `/uploads/comic/:id/cover` | file `cover` |
| POST | `/uploads/chapter` | file `pages` (multi) + `comic_id`, `chapter_number`, `chapter_title` |

Urutan halaman diambil dari nama file secara natural (`2.png` sebelum `10.png`),
lalu disimpan ulang sebagai `001.webp`, `002.webp`, … Upload chapter yang nomornya
sudah ada akan **mengganti** halaman lama.

---

## Imports

### Lokal (folder & arsip)

| Method | Endpoint | Keterangan |
| ------ | -------- | ---------- |
| GET | `/imports/config` | lokasi `importDir` & `dataDir` |
| GET | `/imports/scan` | pindai `IMPORT_DIR`, laporkan kandidat — **tidak menulis apa pun** |
| POST | `/imports/local` | import satu kandidat: `{ path, title?, author?, genres?, status? }` |
| POST | `/imports/archive` | multipart, field `archive` (.cbz/.zip, maks 512 MB) |
| GET | `/imports/jobs` | daftar job import |
| GET | `/imports/jobs/:id` | progress satu job |

`POST /imports/local` dan `/imports/archive` mengembalikan **202** beserta job;
pantau progresnya lewat `/imports/jobs/:id`.

```json
{
  "importDir": "D:\\...\\apps\\api\\import",
  "items": [
    {
      "kind": "folder",
      "path": "Judul Komik A",
      "title": "Judul Komik A",
      "totalPages": 5,
      "chapters": [{ "number": 1, "title": "Chapter 1", "source": "Chapter 1", "pages": 3 }]
    }
  ]
}
```

### Dari URL

| Method | Endpoint | Keterangan |
| ------ | -------- | ---------- |
| POST | `/imports/url/preview` | `{ url }` → metadata seri + daftar chapter terdeteksi |
| POST | `/imports/url/chapter-preview` | `{ url }` → jumlah gambar + 5 contoh URL |
| POST | `/imports/url` | antre chapter terpilih ke download queue (**202**) |

```json
{
  "series_url": "https://contoh.com/komik/judul/",
  "title": "Judul",
  "cover_url": "https://contoh.com/cover.jpg",
  "chapters": [{ "number": 1, "title": "Chapter 1", "url": "https://contoh.com/judul-chapter-1/" }]
}
```

Respons berisi `{ comic, queued, skipped }` — `skipped` memuat alasan per chapter
(mis. sudah ada di antrian). Preview bersifat baca-saja; tidak ada file yang
ditulis sebelum `POST /imports/url`.

Semua request keluar mematuhi `robots.txt` (kecuali `RESPECT_ROBOTS=false`),
memakai jeda `REQUEST_DELAY_MS` per host, dan menolak host di luar
`ALLOWED_SOURCE_DOMAINS`.

---

## Bookmarks & Stats

| Method | Endpoint | Keterangan |
| ------ | -------- | ---------- |
| GET | `/bookmarks?comic_id=1` | daftar bookmark |
| POST | `/bookmarks` | body `{ comic_id, chapter_id, page_number, note }` |
| DELETE | `/bookmarks/:id` | hapus bookmark |
| GET | `/stats` | ringkasan library, storage, rasio kompresi, info sistem |

---

## Media

`GET /media/<path relatif dari DATA_DIR>` — read-only, `Cache-Control: 30 hari,
immutable`, dotfile ditolak. Contoh:

```
/media/comics/<comic-slug>/cover.webp
/media/comics/<comic-slug>/chapters/chapter-1/001.webp
```

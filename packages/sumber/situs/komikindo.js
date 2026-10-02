/**
 * Komikindo — komikindo.ch
 *
 * Seperti kiryuu.js, halaman seri dan pembacanya dibaca HEURISTIK: tidak ada
 * kunci `preset`. Yang didaftarkan di sini hanya dua halaman yang heuristik
 * tidak bisa tebak sendiri — etalase dan hasil cari.
 *
 * ── Keanehan yang sudah ditemui ───────────────────────────────────────────
 *
 * 1. `tipe: '.typeflag'` — Manga/Manhwa/Manhua tidak ditulis sebagai teks,
 *    melainkan sebagai NAMA KELAS pada sebuah <span> kosong
 *    (`class="typeflag Manhwa"`). Pembaca tipe di mesin ekstraksi mencoba teks,
 *    lalu alt, baru nama kelas; cabang terakhir itu ada untuk situs ini dan
 *    ngomik.
 * 2. `tandaKosong` pada blok cari memakai `:not(:has(*))` — komikindo menjawab
 *    pencarian tanpa hasil dengan wadah daftar yang ADA tapi kosong, bukan
 *    dengan pesan. Tanpa penanda itu, "tidak ketemu" tidak bisa dibedakan dari
 *    "tata letaknya berubah dan selector kita gagal" — dan keduanya menuntut
 *    tindakan yang sangat berbeda.
 * 3. Tautan serinya memakai `/komik/`, bukan `/manga/` seperti kebanyakan
 *    tetangganya. Itu sebabnya `tautanSeri` di sini tidak bisa disalin mentah
 *    dari berkas situs lain.
 *
 * Pernah hilang dari Scout tanpa satu pun pesan karena host-nya tidak ada di
 * daftar domain bawaan sisi server (ALLOWED_SOURCE_DOMAINS di apps/api). Blok
 * di bawah ini tidak ada hubungannya dengan daftar itu — keduanya harus benar.
 */
export default {
  host: 'komikindo.ch',
  nama: 'Komikindo',
  pola: {
    katalog: {
      nama: 'komikindo-katalog',
      url: 'https://komikindo.ch/',
      bagian: [{ nama: 'terbaru', wadah: '.post-show.chapterbaru .listupd' }],
      kartu: '.animepost',
      tautanSeri: "a[href*='/komik/']",
      judul: '.tt h3',
      sampul: 'img',
      tipe: '.typeflag',
      tautanChapter: '.lsch a',
    },
    cari: {
      nama: 'komikindo-cari',
      url: 'https://komikindo.ch/?s={q}',
      bagian: [{ nama: 'cari', wadah: '.postbody .listupd' }],
      kartu: '.animepost',
      tautanSeri: "a[href*='/komik/']",
      judul: '.tt h3',
      sampul: 'img',
      tipe: '.typeflag',
      tandaKosong: '.postbody .listupd .film-list:not(:has(*))',
    },
  },
};

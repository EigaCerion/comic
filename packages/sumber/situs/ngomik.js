/**
 * Ngomik — ngomik.cc
 *
 * Tema ts-reader untuk halaman seri dan pembacanya, jadi presetnya cukup. Yang
 * butuh perhatian adalah dua halaman daftarnya, dan keduanya pernah merusak
 * angka chapter secara diam-diam.
 *
 * ── 1. Nomor chapter pernah terbaca ribuan ────────────────────────────────
 *
 * URL chapter di sini berbentuk "...-chapter-42/", sementara pembaca nomor
 * generik mensyaratkan segmen "/chapter" untuk mengambil nomor dari URL. Jadi
 * nomornya terpaksa dibaca dari TEKS tautan — dan di teks itu, label chapter
 * dan waktu rilis adalah dua <span> yang menempel tanpa spasi:
 *
 *     "Ch. 154" + "27 detik"  →  "Ch. 15427 detik"  →  terbaca 15427
 *
 * Diukur sebelum `labelChapter` ada: 16 dari 24 kartu etalase ngomik mengaku
 * punya chapter di atas 1500. Akibatnya setiap komik ngomik di koleksi tampak
 * tertinggal ribuan chapter, dan panel Scout menyodorkan "update" yang tidak
 * ada. `labelChapter` menunjuk span labelnya saja, sehingga yang dibaca hanya
 * "Ch. 154".
 *
 * ── 2. Hasil cari menyebut chapter sebagai teks, bukan tautan ─────────────
 *
 * Di halaman hasil cari, chapter terbaru ditulis sebagai teks biasa
 * ("Chapter 71") tanpa tautan sama sekali. `teksChapter` menunjuk elemen itu.
 * Nomornya tetap dibaca — justru itu dasar status "update" di panel Scout —
 * tapi URL-nya sengaja DIBIARKAN KOSONG, bukan ditebak dari pola slug: pola
 * slug chapter tidak dijamin sama untuk setiap seri, dan tebakan yang salah
 * menghasilkan antrean unduh yang 404 tanpa ada yang tahu kenapa.
 *
 * ── 3. Hasil cari kosong punya penandanya sendiri ─────────────────────────
 *
 * `tandaKosong` menunjuk judul "tidak ditemukan" di dalam wadah daftar. Tanpa
 * itu, pencarian tanpa hasil tidak bisa dibedakan dari selector yang rusak.
 */
export default {
  host: 'ngomik.cc',
  nama: 'Ngomik',
  pola: {
    preset: 'ts-reader',
    katalog: {
      nama: 'ngomik-katalog',
      url: 'https://ngomik.cc/',
      bagian: [{ nama: 'terbaru', wadah: '.postbody .listupd' }],
      kartu: '.bs.stylefiv',
      tautanSeri: ".bsx a[href*='/manga/']",
      judul: '.tt',
      sampul: 'img',
      tipe: 'span.type',
      keterangan: '.fivtime',
      tautanChapter: 'ul.chfiv li a',
      // Lihat penjelasan nomor 1 di atas — tanpa ini nomor chapter kacau.
      labelChapter: '.fivchap',
    },
    cari: {
      nama: 'ngomik-cari',
      url: 'https://ngomik.cc/?s={q}',
      bagian: [{ nama: 'cari', wadah: '.postbody .listupd' }],
      kartu: '.bsx',
      tautanSeri: "a[href*='/manga/']",
      judul: '.tt',
      sampul: 'img',
      tipe: 'span.type',
      // Lihat penjelasan nomor 2 di atas.
      teksChapter: '.epxs',
      tandaKosong: '.postbody .listupd center h3',
    },
  },
};

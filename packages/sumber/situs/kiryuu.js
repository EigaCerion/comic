/**
 * Kiryuu — kiryuu.to
 *
 * Halaman seri dan pembacanya dibaca HEURISTIK, bukan preset: tidak ada kunci
 * `preset` di bawah, dan itu disengaja. Temanya tidak cocok dengan ts-reader
 * maupun wp-manga, dan heuristik generik ("container dengan gambar terbanyak",
 * "tautan yang pola href-nya berbentuk chapter") sudah membacanya dengan benar.
 * Menambahkan preset yang salah justru MEMATIKAN heuristik itu.
 *
 * ── Kenapa TIDAK ada blok `cari` ──────────────────────────────────────────
 *
 * Ini keputusan yang paling penting di berkas ini, dan paling mudah dianggap
 * kelalaian lalu "diperbaiki" oleh orang berikutnya.
 *
 * Kiryuu TIDAK punya halaman pencarian yang bisa dipakai. Menebaknya dengan
 * pola umum `?s={q}` menghasilkan halaman yang status HTTP-nya 200 dan tata
 * letaknya normal — tapi isinya judul-judul POPULER, bukan hasil pencarian:
 * kata kuncinya diabaikan sepenuhnya. Akibatnya setiap pencarian "mengembalikan
 * hasil" yang sama sekali tidak berhubungan, dan tidak ada satu pun tanda bahwa
 * itu salah. Host tanpa blok `cari` memang tidak ikut dicari, dan di sini itulah
 * jawaban yang benar.
 *
 * ── Domain pindah, kunci host TIDAK ikut pindah ──────────────────────────
 *
 * Etalasenya sekarang di v7.kiryuu.to; kiryuu.to polos menjawab 522 (origin-nya
 * mati). Yang diganti HANYA alamat katalognya.
 *
 * `host` sengaja tetap 'kiryuu.to', bukan 'v7.kiryuu.to'. resolveSourceConfig
 * mencocokkan host persis DULU, lalu domain induknya — jadi kunci 'kiryuu.to'
 * melayani v7, v8, dan subdomain apa pun yang mereka pakai berikutnya,
 * sementara kunci 'v7.kiryuu.to' akan berhenti bekerja pada pindahan berikutnya
 * tanpa satu pun pesan. Yang dikunci di sini identitas situsnya, bukan alamat
 * yang sedang dipakainya.
 *
 * Catatan untuk ALLOWED_SOURCE_DOMAINS di apps/api/.env: aturannya kebalikan
 * dari ini — `host === domain || host.endsWith('.' + domain)`. Mendaftarkan
 * 'v7.kiryuu.to' di sana TIDAK mengizinkan 'kiryuu.to', jadi alamat katalog di
 * bawah dan daftar di .env harus cocok satu sama lain.
 *
 * ── Keanehan yang sudah ditemui ───────────────────────────────────────────
 *
 * 1. `kartu: '> div'` — kartunya adalah anak LANGSUNG wadahnya, tanpa kelas
 *    sendiri yang bisa dipegang. Selector keturunan biasa ('div') akan ikut
 *    memanen <div> di dalam kartu dan melahirkan kartu kembar.
 * 2. `tipe: "img[src*='/static/svg/']"` — kiryuu tidak menulis Manga/Manhwa/
 *    Manhua sebagai teks di mana pun. Yang membedakannya hanya IKON SVG, dan
 *    yang terbaca darinya adalah atribut alt-nya. Pembaca tipe di mesin
 *    ekstraksi memang mencoba teks, lalu alt, lalu nama kelas — urutan itu ada
 *    justru karena situs ini.
 * 3. `labelChapter: 'p'` — di dalam tautan chapter, label dan waktu rilis
 *    menempel sebagai dua elemen. Tanpa menunjuk label saja, "Chapter 154" dan
 *    "27 detik" terbaca menyatu jadi satu angka raksasa.
 *
 * Kalau suatu hari situsnya berganti tema, yang perlu diperbaiki hanya nilai di
 * bawah — tidak ada satu baris kode pun di tempat lain yang menyebut kiryuu.
 */
export default {
  host: 'kiryuu.to',
  nama: 'Kiryuu',
  pola: {
    katalog: {
      nama: 'kiryuu-katalog',
      url: 'https://v7.kiryuu.to/',
      bagian: [{ nama: 'terbaru', wadah: 'div#latest-list' }],
      kartu: '> div',
      tautanSeri: "a[href*='/manga/']",
      judul: 'h1',
      sampul: 'img.wp-post-image',
      tipe: "img[src*='/static/svg/']",
      keterangan: 'a.link-self time',
      tautanChapter: 'a.link-self',
      labelChapter: 'p',
    },
  },
};

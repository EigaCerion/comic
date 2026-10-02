import kiryuu from './kiryuu.js';
import komikindo from './komikindo.js';
import komiku from './komiku.js';
import komikpedia from './komikpedia.js';
import ngomik from './ngomik.js';
import webtoons from './webtoons.js';

/**
 * Induk daftar situs sumber: satu berkas per situs, dirangkai di sini.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MENAMBAH SITUS BARU — tiga langkah, tidak ada langkah keempat
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. Salin berkas situs yang paling mirip temanya (ngomik.js untuk tema
 *      ts-reader, komiku.js untuk yang punya API pencarian sendiri), ganti
 *      `host`, `nama`, dan selectornya.
 *   2. Impor di atas, dan daftarkan di array DAFTAR di bawah.
 *   3. Naikkan `versi` di packages/sumber/selectors.js.
 *
 * Tidak ada berkas lain yang perlu disentuh. Tidak ada `if (host === ...)` di
 * mana pun di paket ini — dan itu disengaja: mesin ekstraksinya SATU dan
 * generik, situsnya yang berbeda-beda dijelaskan sebagai DATA di berkas-berkas
 * ini. Delapan salinan mesin yang sama adalah delapan tempat yang harus
 * diperbaiki setiap kali ada satu bug, dan tujuh di antaranya pasti terlupa.
 *
 * Satu hal yang MUDAH terlupa: host-nya juga harus ada di
 * ALLOWED_SOURCE_DOMAINS (apps/api/.env, dengan daftar bawaan di
 * apps/api/src/utils/config.js). Daftar itu menjaga ke mana server rumah boleh
 * menembak; berkas di folder ini menjaga BAGAIMANA halamannya dibaca. Keduanya
 * harus benar, dan komikindo pernah hilang dari Scout berminggu-minggu karena
 * yang satu benar dan yang lain tidak.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BENTUK SEBUAH BERKAS SITUS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tiap berkas mengekspor default `{ host, nama, pola }`:
 *
 *   host   kunci pencocokan, tanpa "www." — mis. 'kiryuu.to'. Pencocokannya
 *          exact host dulu, lalu domain induk, jadi 'kiryuu.to' ikut melayani
 *          'cdn.kiryuu.to'.
 *   nama   label untuk manusia; tidak dipakai mesin ekstraksi sama sekali.
 *   pola   isinya yang dibaca extractor. Semua kuncinya OPSIONAL:
 *
 *     preset        'generic' | 'wp-manga' | 'ts-reader' — kumpulan selector
 *                   siap pakai untuk daftar chapter, halaman baca, dan sampul.
 *                   Tanpa preset, extractor memakai heuristik generik
 *                   (container dengan gambar terbanyak + pola tautan chapter).
 *                   Preset yang SALAH lebih buruk daripada tanpa preset: ia
 *                   mematikan heuristik yang sebenarnya sudah benar.
 *     chapterList   selector daftar chapter, menimpa preset
 *     reader        selector gambar halaman baca, menimpa preset
 *     cover         selector sampul, menimpa preset
 *     title         selector judul seri
 *     description   selector sinopsis
 *     note          kalimat untuk manusia; dipakai sebagai pesan galat kalau
 *                   `disabled` menyala
 *     disabled      true membuat setiap URL host ini DITOLAK dengan melempar.
 *                   Dipakai untuk situs yang memang tidak boleh diambil
 *                   otomatis (lihat webtoons.js)
 *     katalog       cara membaca halaman ETALASE (lihat di bawah)
 *     cari          cara membaca halaman HASIL CARI (lihat di bawah)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BLOK `katalog` DAN `cari`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Keduanya berbentuk sama. Host TANPA blok ini sengaja tidak ikut dipindai dan
 * tidak ikut dicari — itu bukan kekurangan yang perlu ditambal buru-buru:
 * memindai situs tanpa blok katalog berarti memanen setiap <article> di
 * halaman, dan yang paling banyak berbentuk <article> adalah iklan.
 *
 *   nama          label extractor yang dilaporkan ke pemanggil
 *   url           halaman yang diambil. Khusus `cari`, {q} diganti kata kunci
 *                 yang sudah di-encode. TANPA {q}, halaman yang sama diambil
 *                 untuk kata apa pun dan hasilnya tampil seolah-olah pencarian
 *                 — jadi blok cari tanpa {q} diabaikan, bukan dijalankan.
 *   bagian        daftar { nama, wadah }; `nama` masuk ke field `bagian` tiap
 *                 item. Pada blok `cari` boleh dikosongkan — tanpa itu kartu
 *                 dicari di seluruh halaman.
 *   kartu         selector SATU kartu komik, dicari DI DALAM wadah
 *   tautanSeri    tautan ke halaman seri; boleh beberapa selector dipisah koma
 *   judul         elemen judul; teksnya dipakai apa adanya
 *   sampul        <img> sampul — data-src didahulukan, src lazy-load ditolak
 *   keterangan    teks '<genre> · <waktu>'; urutan dan kelengkapannya bebas.
 *                 Boleh berupa daftar selector yang dicoba berurutan.
 *   tautanChapter tautan chapter terbaru; boleh tidak ada pada seri kosong
 *   labelChapter  span label DI DALAM tautan chapter, untuk situs yang
 *                 menempelkan waktu rilis ke label tanpa spasi. Tanpa ini
 *                 "Ch. 154" + "27 detik" terbaca sebagai 15427 (lihat ngomik.js)
 *   teksChapter   chapter terbaru yang ditulis sebagai teks biasa, bukan tautan
 *   tipe          elemen penanda Manga/Manhwa/Manhua — dibaca dari teks, lalu
 *                 atribut alt, lalu nama kelas
 *   tipeAttr      atribut di kartu yang memuat tipe (mis. 'data-tipe')
 *   tipeDariAlt   true kalau alt sampul berbentuk 'Baca <tipe> <judul>'
 *   dasarTautan   alamat dasar untuk membuat tautan absolut, kalau halaman yang
 *                 diambil beda host dengan halaman serinya (lihat komiku.js)
 *   tandaKosong   selector yang HANYA muncul saat hasilnya memang nol. Tanpa
 *                 ini, "tidak ketemu" tidak bisa dibedakan dari "selector kita
 *                 rusak" — dan keduanya menuntut tindakan yang berbeda.
 */

/*
 * Urutan di sini tidak menentukan apa pun bagi extractor — pencocokannya lewat
 * kunci host, bukan urutan. Disusun menurut abjad supaya mudah dicari mata.
 */
const DAFTAR = [kiryuu, komikindo, komikpedia, komiku, ngomik, webtoons];

/**
 * Rangkai jadi bentuk yang dibaca extractor: { '<host>': <pola> }.
 *
 * Host kembar DILEMPAR saat modul ini dievaluasi, bukan dibiarkan menang
 * diam-diam. Dua berkas yang mengaku host yang sama adalah kesalahan salin —
 * dan yang kalah akan hilang tanpa satu pun tanda, lalu dihabiskan berjam-jam
 * mencari tahu kenapa suntingannya "tidak berpengaruh".
 */
export const hosts = DAFTAR.reduce((kumpulan, situs) => {
  const host = String(situs?.host ?? '').toLowerCase().replace(/^www\./, '');
  if (!host) throw new Error('Ada berkas situs tanpa "host" di packages/sumber/situs/');
  if (kumpulan[host]) throw new Error(`Host "${host}" didaftarkan dua kali di packages/sumber/situs/`);
  kumpulan[host] = situs.pola ?? {};
  return kumpulan;
}, {});

/** Untuk layar dan log: { host, nama } tiap situs, tanpa selectornya. */
export const daftarSitus = () => DAFTAR.map((situs) => ({ host: situs.host, nama: situs.nama }));

export default { hosts, daftarSitus };

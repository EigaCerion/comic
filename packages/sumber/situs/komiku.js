/**
 * Komiku — komiku.org
 *
 * Situs dengan penyimpangan TERBANYAK di folder ini. Tiga di antaranya pernah
 * merusak data secara diam-diam, dan ketiganya sekarang dijinakkan oleh satu
 * nilai di bawah. Dibaca bersama penjelasannya supaya tidak ada yang
 * "merapikan" nilai itu karena terlihat ganjil.
 *
 * ── 1. Pencariannya dilayani host yang BERBEDA ────────────────────────────
 *
 * `cari.url` menunjuk api.komiku.org, bukan komiku.org — itu memang satu-satunya
 * alamat yang menjawab pencarian. Tapi tautan di dalam jawabannya RELATIF
 * ("/manga/judul/"). Dijadikan absolut terhadap halaman yang diambil, setiap
 * kartu akan menunjuk https://api.komiku.org/manga/... — host yang tidak
 * melayani halaman seri sama sekali. Akibatnya impor gagal DAN pencocokan
 * dengan koleksi gagal, keduanya tanpa pesan yang masuk akal.
 *
 * `dasarTautan` memberi tahu mesin ekstraksi alamat dasar yang BENAR untuk
 * membuat tautan absolut. Ia ada khusus untuk situs ini.
 *
 * ── 2. `data-tipe` hanya ada di sebagian kartu ────────────────────────────
 *
 * Di etalase, atribut `data-tipe` cuma dibawa kartu bagian "Baru Ditambahkan".
 * Kartu "Terbaru" tidak punya. `tipeDariAlt: true` menyalakan cadangannya:
 * membaca tipe dari alt sampul yang berbentuk "Baca Manhwa <judul>". Keduanya
 * dipasang bersama karena masing-masing sendirian hanya benar untuk separuh
 * halaman.
 *
 * ── 3. Sampulnya punya host cadangan sendiri ──────────────────────────────
 *
 * Gambar komiku kadang dikirim dengan atribut onerror yang menukar host saat
 * yang utama gagal (image2.komiku.to → img.komiku.org). Itu dibaca mesin
 * ekstraksi secara generik dan diteruskan ke pengunduh sebagai daftar alamat
 * cadangan — tidak ada yang perlu diatur di berkas ini, tapi kalau suatu hari
 * ada chapter komiku yang gambarnya 404 di semua percobaan, di situlah tempat
 * pertama yang harus dilihat.
 *
 * ── Catatan ───────────────────────────────────────────────────────────────
 *
 * `keterangan` di blok cari sengaja berupa DAFTAR dua selector: hasil cari
 * komiku menaruh genre di tempat yang berbeda dari etalasenya, dan mesin
 * ekstraksi mencoba keduanya berurutan sampai ada yang berisi.
 */
export default {
  host: 'komiku.org',
  nama: 'Komiku',
  pola: {
    preset: 'generic',
    katalog: {
      nama: 'komiku-katalog',
      url: 'https://komiku.org/',
      bagian: [
        { nama: 'terbaru', wadah: '#Terbaru' },
        { nama: 'baru', wadah: '#Baru_Ditambahkan' },
      ],
      kartu: 'article.ls2',
      tautanSeri: '.ls2j h3 a, .ls2v > a[href]',
      judul: '.ls2j h3 a',
      sampul: '.ls2v img.lazy',
      keterangan: '.ls2t',
      tautanChapter: 'a.ls2l',
      tipeAttr: 'data-tipe',
      tipeDariAlt: true,
    },
    cari: {
      nama: 'komiku-cari',
      url: 'https://api.komiku.org/?post_type=manga&s={q}',
      // Lihat penjelasan nomor 1 di atas — jangan dihapus.
      dasarTautan: 'https://komiku.org/',
      kartu: '.bge',
      tautanSeri: "a[href*='/manga/']",
      judul: '.kan h3',
      sampul: '.bgei img',
      tipe: '.tpe1_inf b',
      keterangan: ['.tpe1_inf', '.kan > p'],
      tautanChapter: ".new1:contains('Terbaru') a",
      labelChapter: 'span:last-child',
      tandaKosong: '.no-results',
    },
  },
};

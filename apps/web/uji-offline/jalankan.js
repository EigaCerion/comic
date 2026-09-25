/*
 * Pengujian lapisan offline — jalur BACA, yang di aplikasi nyata dilaporkan
 * "komik tersimpan tidak bisa dibaca sama sekali".
 *
 * Dijalankan di Chromium sungguhan dengan plugin Capacitor ditiruan (lihat
 * vite.config.js), pada mode build `android` supaya IS_APP dan ASLI_NATIF
 * bernilai true — dua konstanta yang menentukan seluruh percabangan di
 * apps/web/src/offline. Menjalankannya di Node tidak mungkin: IS_APP dibaca dari
 * import.meta.env.MODE, yang baru ada setelah Vite mengganti literalnya.
 *
 * Dua skenario dijalankan sebagai dua kali MUAT HALAMAN, bukan dua blok dalam
 * satu proses: siapkanOffline() menyimpan hasilnya di satu promise modul yang
 * sengaja tidak bisa diulang, dan memaksanya berarti menambah ekspor khusus
 * pengujian ke kode produksi — lubang yang tidak sebanding dengan nilainya.
 *   ?skenario=indeks   index.json sah, lalu jalur baca dan penjaga berkas hilang
 *   ?skenario=pulih    index.json tidak ada — harus dibangun ulang dari folder
 */
import { Filesystem, _hapus, _kosongkan, _tulis } from '@capacitor/filesystem';
import { indeksSekarang, komikTersimpan, siapkanOffline } from '../src/offline/penyimpanan.js';
import { daftarChapterLokal, rakitChapterLokal } from '../src/offline/bacaLokal.js';
import { ASLI_NATIF, IS_APP } from '../src/platform/index.js';

const hasil = [];
const cek = (nama, dapat, harap) => {
  hasil.push({ nama, lolos: JSON.stringify(dapat) === JSON.stringify(harap), dapat, harap });
};

/** Satu chapter tersimpan yang utuh: chapter.json + halaman + sampul. */
const seedChapter = (id, { comicId = 9, nomor = 1, halaman = ['001.webp', '002.webp'] } = {}) => {
  const entriChapter = {
    id,
    comicId,
    nomor,
    judul: `Chapter ${nomor}`,
    jumlahHalaman: halaman.length,
    bytes: 1234,
    disimpanPada: '2026-09-01T00:00:00.000Z',
    punyaSampul: true,
    namaSampul: 'sampul.webp',
  };
  const entriKomik = { id: comicId, slug: 'komik-uji', judul: 'Komik Uji', sampul: `${id}/sampul.webp` };

  _tulis(
    `offline/${id}/chapter.json`,
    JSON.stringify({
      versi: 1,
      chapter: entriChapter,
      komik: entriKomik,
      server: { id, comicId, number: nomor, title: `Chapter ${nomor}`, comic: entriKomik },
      halaman: halaman.map((berkas, i) => ({ number: i + 1, berkas, size: 5 })),
    }),
  );
  halaman.forEach((nama) => _tulis(`offline/${id}/${nama}`, 'xxxxx'));
  _tulis(`offline/${id}/sampul.webp`, 'xxxxx');

  return { entriChapter, entriKomik };
};

const indexJson = (chapters, komiks) =>
  JSON.stringify({
    versi: 1,
    komik: Object.fromEntries(komiks.map((k) => [k.id, k])),
    chapter: Object.fromEntries(chapters.map((c) => [c.id, c])),
  });

const skenarioIndeks = async () => {
  const a = seedChapter(501, { nomor: 1 });
  const b = seedChapter(502, { nomor: 2 });
  _tulis('offline/index.json', indexJson([a.entriChapter, b.entriChapter], [a.entriKomik]));

  await siapkanOffline();

  cek('dua chapter terbaca dari index.json', Object.keys(indeksSekarang().chapter).sort(), ['501', '502']);
  cek('satu komik terbaca', komikTersimpan(indeksSekarang()).length, 1);
  cek('daftar chapter lokal urut nomor', daftarChapterLokal(9).map((c) => c.number), [1, 2]);

  const rakit = await rakitChapterLokal(501);
  cek('chapter tersusun, bukan kosong', Boolean(rakit.chapter), true);
  cek('jumlah halaman benar', rakit.halaman?.length ?? 0, 2);
  // Panjangnya ikut disyaratkan: `.every()` pada array kosong mengembalikan true,
  // jadi tanpa itu pemeriksaan ini lolos justru pada kasus yang paling parah —
  // chapter yang tidak menghasilkan satu halaman pun.
  cek(
    'tiap halaman punya URL',
    (rakit.halaman?.length ?? 0) > 0 && rakit.halaman.every((h) => typeof h.url === 'string' && h.url.length > 0),
    true,
  );
  cek(
    'URL halaman lewat jembatan berkas, bukan jalur mentah',
    /_capacitor_file_|^blob:|^data:/.test(rakit.halaman?.[0]?.url ?? ''),
    true,
  );
  cek('tetangga next menunjuk chapter tersimpan', rakit.chapter?.next?.id ?? null, 502);
  cek('chapter utuh TIDAK dibuang dari indeks', Boolean(indeksSekarang().chapter[501]), true);

  // Satu halaman dihapus dari disk: penjaga di rakitChapterLokal harus mengaku
  // tidak punya chapter itu DAN membuang barisnya, tanpa menyentuh yang sehat.
  _hapus('offline/502/002.webp');
  const bolong = await rakitChapterLokal(502);
  cek('chapter bolong dilaporkan kosong', bolong.chapter, null);
  cek('chapter bolong dibuang dari indeks', Boolean(indeksSekarang().chapter[502]), false);
  cek('chapter sehat tetap ada sesudahnya', Boolean(indeksSekarang().chapter[501]), true);
};

const skenarioPulih = async () => {
  // Tanpa index.json sama sekali — keadaan setelah berkas itu rusak, terpotong
  // mati listrik, atau pada pemasangan yang katalognya belum pernah ditulis.
  seedChapter(777, { comicId: 11, nomor: 7 });

  await siapkanOffline();

  cek('chapter pulih dari folder tanpa index.json', Boolean(indeksSekarang().chapter[777]), true);
  cek('komiknya ikut pulih', komikTersimpan(indeksSekarang()).map((k) => k.id), [11]);

  const rakit = await rakitChapterLokal(777);
  cek('chapter hasil pemulihan bisa dibaca', rakit.halaman?.length ?? 0, 2);
};

const jalankan = async () => {
  cek('mode android aktif (IS_APP)', IS_APP, true);
  cek('terdeteksi sebagai native (ASLI_NATIF)', ASLI_NATIF, true);

  _kosongkan();
  await Filesystem.mkdir({ path: 'offline' }).catch(() => {});

  const skenario = new URLSearchParams(window.location.search).get('skenario') ?? 'indeks';
  if (skenario === 'pulih') await skenarioPulih();
  else await skenarioIndeks();

  return hasil;
};

/*
 * Hasil ditulis ke DOM, bukan cuma ke window.
 *
 * Penggeraknya (pandu.mjs) menjalankan Chromium dengan --dump-dom, yang mencetak
 * DOM sesudah halaman tenang. Tanpa perkakas otomasi browser terpasang, DOM
 * itulah satu-satunya saluran keluar — jadi bentuknya dibuat mudah diurai dan
 * dibungkus penanda supaya laporan yang terpotong bisa dikenali sebagai
 * terpotong, bukan disalahartikan sebagai nol kegagalan.
 */
const laporkan = (isi) => {
  const wadah = document.getElementById('keluaran');
  if (wadah) wadah.textContent = `__MULAI__${JSON.stringify(isi)}__SELESAI__`;
  window.__hasilUji = isi;
  window.__selesai = true;
};

jalankan().then(laporkan, (galat) =>
  laporkan([
    {
      nama: `pengujian melempar: ${galat?.message ?? galat}`,
      lolos: false,
      dapat: String(galat?.stack ?? '').slice(0, 800),
      harap: 'tidak melempar',
    },
  ]),
);

/*
 * Uji sumber cadangan per komik (apps/api/src/services/sumberService.js).
 *
 * Kenapa justru ini yang diuji: inilah kode yang memutuskan DARI SITUS MANA
 * chapter sebuah komik diambil, dan ia menulis ke database koleksi. Satu
 * kesalahan di sini tidak muncul sebagai galat — ia muncul sebagai komik yang
 * diam-diam berhenti mendapat chapter baru, atau lebih buruk, mendapat chapter
 * dari komik lain.
 *
 * Yang diuji hanya bagian yang TIDAK butuh jaringan: pencatatan sumber,
 * kenaikan status, persetujuan, penghapusan, dan skor kemiripan judul.
 * ambilSeriDenganCadangan() dan cariSumberLain() memang menembak situs sumber,
 * jadi keduanya di luar jangkauan uji ini — dan itu disebut terang-terangan di
 * sini supaya tidak ada yang mengira seluruh berkas itu sudah tertutup.
 *
 * Seluruhnya berjalan di atas database SEMENTARA di folder temp sistem.
 * DATA_DIR disetel sebelum satu pun modul diimpor, karena config.js membacanya
 * saat modulnya dievaluasi — itu sebabnya impornya dinamis di bawah.
 *
 * Jalankan: npm run test:sumber-cadangan
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sementara = fs.mkdtempSync(path.join(os.tmpdir(), 'naruread-uji-sumber-'));
process.env.DATA_DIR = sementara;
process.env.ALLOWED_SOURCE_DOMAINS = 'satu.test,dua.test,tiga.test';

const { getDb, initSchema, closeDb } = await import('../src/db/index.js');
const { createComic } = await import('../src/services/comicService.js');
const {
  catatSumber,
  daftarSumber,
  hapusSumber,
  setujuiSumber,
  kemiripanJudul,
  tokenJudul,
  AMBANG_MIRIP,
} = await import('../src/services/sumberService.js');

let gagal = 0;
let lolos = 0;

const cek = (nama, dapat, harap) => {
  const sama = JSON.stringify(dapat) === JSON.stringify(harap);
  if (sama) {
    lolos += 1;
    console.log(`  ✅ ${nama}`);
  } else {
    gagal += 1;
    console.log(`  ❌ ${nama}\n       dapat : ${JSON.stringify(dapat)}\n       harap : ${JSON.stringify(harap)}`);
  }
};

const db = initSchema(getDb());
const sumberAktif = (id) => db.prepare('SELECT source_url FROM comics WHERE id = ?').get(id)?.source_url ?? null;

let nomor = 0;
const komikBaru = (sourceUrl = null) => {
  nomor += 1;
  const komik = createComic({ title: `Uji Sumber ${nomor}`, source: 'satu.test' });
  if (sourceUrl) db.prepare('UPDATE comics SET source_url = ? WHERE id = ?').run(sourceUrl, komik.id);
  return komik.id;
};

try {
  console.log('\n── kemiripan judul ───────────────────────────────────');
  cek('kata umum tidak ikut dihitung', tokenJudul('Komik Baca Manga Naruto'), ['naruto']);
  cek('judul sama persis → 1', kemiripanJudul('One Piece', 'One Piece'), 1);
  cek(
    'embel-embel situs tidak menurunkan banyak',
    kemiripanJudul('One Piece', 'Komik One Piece Bahasa Indonesia') >= AMBANG_MIRIP,
    true,
  );
  // Inilah yang membuat persetujuan manusia tetap jadi syarat: sekuel punya
  // skor tinggi, dan memasangnya otomatis berarti chapter komik lain masuk.
  cek('sekuel TETAP mirip (karena itu butuh persetujuan)', kemiripanJudul('Solo Leveling', 'Solo Leveling Season 2') >= AMBANG_MIRIP, true);
  cek('judul tak berhubungan → di bawah ambang', kemiripanJudul('One Piece', 'Tower of God') < AMBANG_MIRIP, true);
  cek('judul kosong → 0, bukan melempar', kemiripanJudul('', 'One Piece'), 0);

  console.log('\n── catatSumber ───────────────────────────────────────');
  {
    const id = komikBaru();
    catatSumber({ comicId: id, seriesUrl: 'https://satu.test/manga/x/', status: 'calon' });
    catatSumber({ comicId: id, seriesUrl: 'https://satu.test/manga/x/', status: 'calon' });
    cek('alamat sama tidak digandakan', daftarSumber(id).items.length, 1);

    catatSumber({ comicId: id, seriesUrl: 'https://satu.test/manga/x/', status: 'siap' });
    cek('status boleh NAIK calon → siap', daftarSumber(id).items[0].status, 'siap');

    // Penemuan otomatis berjalan berkali-kali. Tanpa aturan ini, satu pencarian
    // ulang menurunkan sumber yang sudah disetujui dan perpindahan otomatis
    // diam-diam berhenti memakainya.
    catatSumber({ comicId: id, seriesUrl: 'https://satu.test/manga/x/', status: 'calon' });
    cek('status TIDAK boleh turun siap → calon', daftarSumber(id).items[0].status, 'siap');

    let ditolak = null;
    try {
      catatSumber({ comicId: id, seriesUrl: 'https://entah-siapa.invalid/manga/x/' });
    } catch (galat) {
      ditolak = galat.status ?? 'melempar';
    }
    cek('domain di luar allowlist ditolak', ditolak !== null, true);
    cek('dan tidak ikut tercatat', daftarSumber(id).items.length, 1);
  }

  console.log('\n── daftarSumber menyeragamkan koleksi lama ───────────');
  {
    // Seluruh koleksi yang sudah ada lahir sebelum tabel comic_sources, jadi
    // source_url mereka tidak tercatat di mana pun. Tanpa penyeragaman ini,
    // komik yang sumbernya masih hidup tampil seolah tidak punya sumber.
    const id = komikBaru('https://dua.test/manga/lama/');
    const hasil = daftarSumber(id);
    cek('sumber lama ikut tercatat sendiri', hasil.items.length, 1);
    cek('dan ditandai sebagai yang aktif', hasil.items[0].aktif, true);
    cek('statusnya siap, bukan calon', hasil.items[0].status, 'siap');
  }

  console.log('\n── setujuiSumber ─────────────────────────────────────');
  {
    const id = komikBaru('https://satu.test/manga/utama/');
    const calon = catatSumber({ comicId: id, seriesUrl: 'https://dua.test/manga/cadangan/', status: 'calon' });

    setujuiSumber({ comicId: id, id: calon.id });
    const sesudah = daftarSumber(id).items.find((s) => s.id === calon.id);
    cek('calon jadi siap', sesudah.status, 'siap');
    // Menyetujui cadangan TIDAK memindahkan sumber aktif — yang aktif masih
    // hidup, dan pemindahan itu urusan perpindahan otomatis saat ia gagal.
    cek('sumber aktif tidak ikut pindah', sumberAktif(id), 'https://satu.test/manga/utama/');

    setujuiSumber({ comicId: id, id: calon.id, pakaiSekarang: true });
    cek('pakaiSekarang memindahkan yang aktif', sumberAktif(id), 'https://dua.test/manga/cadangan/');
  }
  {
    // Komik yang sumbernya sudah tidak ada sama sekali tidak perlu menunggu
    // satu kegagalan lagi sebelum memakai sumber yang baru disetujui.
    const id = komikBaru();
    const calon = catatSumber({ comicId: id, seriesUrl: 'https://tiga.test/manga/satu-satunya/', status: 'calon' });
    setujuiSumber({ comicId: id, id: calon.id });
    cek('komik tanpa sumber langsung memakainya', sumberAktif(id), 'https://tiga.test/manga/satu-satunya/');
  }

  console.log('\n── hapusSumber ───────────────────────────────────────');
  {
    const id = komikBaru('https://satu.test/manga/aktif/');
    daftarSumber(id); // seragamkan
    const cadangan = catatSumber({ comicId: id, seriesUrl: 'https://dua.test/manga/cadangan/', status: 'siap' });

    hapusSumber({ comicId: id, id: cadangan.id });
    cek('cadangan terhapus', daftarSumber(id).items.length, 1);
    cek('sumber aktif tidak tersentuh', sumberAktif(id), 'https://satu.test/manga/aktif/');

    const aktif = daftarSumber(id).items[0];
    hapusSumber({ comicId: id, id: aktif.id });
    // Membiarkannya berarti komik menunjuk alamat yang sudah tidak ada di daftar
    // mana pun — keadaan yang tidak bisa diperbaiki dari layar.
    cek('menghapus yang AKTIF ikut melepas source_url', sumberAktif(id), null);
  }
  {
    const id = komikBaru();
    let ditolak = false;
    try {
      hapusSumber({ comicId: id, id: 999999 });
    } catch {
      ditolak = true;
    }
    cek('id asing ditolak, bukan menghapus milik komik lain', ditolak, true);
  }
} finally {
  closeDb();
  fs.rmSync(sementara, { recursive: true, force: true });
}

console.log(`\n${gagal === 0 ? '✅' : '❌'} ${lolos} lolos, ${gagal} gagal\n`);
process.exit(gagal === 0 ? 0 : 1);

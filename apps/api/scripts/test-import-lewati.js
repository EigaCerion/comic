/*
 * Uji penjaga "sudah ada di koleksi" pada impor seri dari URL
 * (apps/api/src/services/urlImportService.js → importSeries).
 *
 * Kenapa justru ini yang diuji: penjaga itu tidak ada selama berbulan-bulan,
 * dan yang menyingkapnya adalah kejadian paling wajar di aplikasi ini — situs
 * sumber sebuah komik mati, komiknya ditemukan lagi di situs lain, lalu daftar
 * chapternya diimpor dari sana. Yang masuk antrian bukan chapter baru saja,
 * melainkan SELURUH seri: 91 chapter untuk koleksi yang sudah punya 44, setiap
 * satunya diunduh ulang dari nol. Berjam-jam kuota, ribuan gambar ditulis
 * ulang, dan chapter baru yang sebenarnya dicari tertimbun di belakang antrian.
 *
 * Seluruh uji ini berjalan di atas database SEMENTARA di folder temp sistem.
 * DATA_DIR disetel sebelum satu pun modul diimpor, karena config.js membacanya
 * saat modulnya dievaluasi — itu sebabnya impornya dinamis di bawah, bukan di
 * kepala berkas. Database sungguhan di apps/api/data tidak pernah disentuh.
 *
 * Jalankan: npm run test:import-lewati
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sementara = fs.mkdtempSync(path.join(os.tmpdir(), 'naruread-uji-import-'));
process.env.DATA_DIR = sementara;
// dotenv tidak menimpa variabel yang sudah ada, jadi dua baris ini menang atas
// apps/api/.env — termasuk DATA_DIR-nya, yang justru yang harus dijauhi.
process.env.ALLOWED_SOURCE_DOMAINS = 'contoh.test,cadangan.test';

const { getDb, initSchema, closeDb } = await import('../src/db/index.js');
const { createComic } = await import('../src/services/comicService.js');
const { importSeries } = await import('../src/services/urlImportService.js');

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

/** Komik dengan chapter 1..`terunduh` yang berkasnya lengkap. */
const siapkanKomik = (judul, terunduh) => {
  const komik = createComic({ title: judul, source: 'contoh.test' });
  const tambah = db.prepare(
    `INSERT INTO chapters (comic_id, chapter_number, chapter_title, slug, total_pages, is_downloaded)
     VALUES (?, ?, ?, ?, 20, 1)`,
  );
  for (let n = 1; n <= terunduh; n += 1) tambah.run(komik.id, n, `Chapter ${n}`, `chapter-${n}`);
  return komik;
};

/** Daftar chapter seperti yang dikembalikan extractSeries dari halaman seri. */
const dariSitus = (sampai, host = 'contoh.test') =>
  Array.from({ length: sampai }, (_, i) => ({
    number: i + 1,
    title: `Chapter ${i + 1}`,
    url: `https://${host}/x-chapter-${i + 1}/`,
  }));

const nomor = (daftar) => daftar.map((satu) => satu.number).sort((a, b) => a - b);
const alasan = (daftar, teks) => daftar.filter((satu) => satu.reason === teks).map((satu) => satu.number);

try {
  console.log('\n── impor ulang dari situs lain ───────────────────────');
  {
    // Persis kejadian yang dilaporkan: koleksi punya 1–3, situs barunya punya 1–5.
    const komik = siapkanKomik('Uji Lewati Dasar', 3);
    const hasil = await importSeries({
      comicId: komik.id,
      seriesUrl: 'https://cadangan.test/manga/uji/',
      chapters: dariSitus(5, 'cadangan.test'),
    });

    cek('hanya chapter yang BELUM ada yang diantre', nomor(hasil.queued), [4, 5]);
    cek('yang sudah lengkap dilewati', alasan(hasil.skipped, 'sudah ada di koleksi'), [1, 2, 3]);
    cek('tidak ada chapter yang hilang dari laporan', hasil.queued.length + hasil.skipped.length, 5);
  }

  console.log('\n── menekan impor dua kali ────────────────────────────');
  {
    const komik = siapkanKomik('Uji Lewati Dua Kali', 3);
    const argumen = { comicId: komik.id, chapters: dariSitus(5) };
    await importSeries(argumen);
    // Tekanan KEDUA adalah yang paling sering terjadi (halamannya dimuat ulang,
    // tombolnya ditekan lagi) dan dulu melahirkan job kembar untuk chapter yang
    // sama — dua pekerja menulis berkas yang sama persis.
    const lagi = await importSeries(argumen);

    cek('tidak ada yang diantre lagi', lagi.queued, []);
    cek('1–3 tetap dilewati karena sudah ada', alasan(lagi.skipped, 'sudah ada di koleksi'), [1, 2, 3]);
    cek(
      '4–5 dilewati karena masih di antrian, bukan diantre dua kali',
      alasan(lagi.skipped, 'Chapter ini sudah ada di antrian download'),
      [4, 5],
    );
  }

  console.log('\n── chapter yang pernah GAGAL harus dicoba lagi ───────');
  {
    // Baris chapter yang ada tapi is_downloaded = 0 adalah bekas unduhan gagal —
    // justru itu yang memang harus diantre, bukan dilewati. Kalau penjaganya
    // dibuat sekadar "barisnya ada", chapter yang gagal karena situs sumbernya
    // sempat mati tidak akan pernah bisa diunduh lagi dari mana pun.
    const komik = siapkanKomik('Uji Chapter Gagal', 2);
    db.prepare(
      `INSERT INTO chapters (comic_id, chapter_number, chapter_title, slug, total_pages, is_downloaded)
       VALUES (?, 3, 'Chapter 3', 'chapter-3', 0, 0)`,
    ).run(komik.id);

    const hasil = await importSeries({ comicId: komik.id, chapters: dariSitus(3) });
    cek('chapter yang gagal ikut diantre lagi', nomor(hasil.queued), [3]);
    cek('yang lengkap tetap dilewati', alasan(hasil.skipped, 'sudah ada di koleksi'), [1, 2]);
  }

  console.log('\n── paksaUlang ────────────────────────────────────────');
  {
    // Satu-satunya kasus yang sah untuk menembus penjaganya: berkas yang sudah
    // ada memang ingin diganti (halaman gepeng dari impor lama, gambar yang
    // raib bersama CDN-nya).
    const komik = siapkanKomik('Uji Paksa Ulang', 3);
    const hasil = await importSeries({ comicId: komik.id, chapters: dariSitus(5), paksaUlang: true });
    cek('seluruh chapter diantre, termasuk yang sudah ada', nomor(hasil.queued), [1, 2, 3, 4, 5]);
    cek('tidak ada yang dilewati', hasil.skipped, []);
  }

  console.log('\n── penjaga lama tidak ikut rusak ─────────────────────');
  {
    const komik = siapkanKomik('Uji URL Ditolak', 0);
    const hasil = await importSeries({
      comicId: komik.id,
      chapters: [
        { number: 1, title: 'Chapter 1', url: 'https://contoh.test/x-chapter-1/' },
        // Domain di luar ALLOWED_SOURCE_DOMAINS harus tetap ditolak satu per
        // satu, bukan menggagalkan seluruh impornya.
        { number: 2, title: 'Chapter 2', url: 'https://entah-siapa.invalid/x-2/' },
      ],
    });
    cek('yang domainnya sah tetap masuk', nomor(hasil.queued), [1]);
    cek('yang ditolak dilaporkan, bukan didiamkan', nomor(hasil.skipped), [2]);
  }
} finally {
  closeDb();
  fs.rmSync(sementara, { recursive: true, force: true });
}

console.log(`\n${gagal === 0 ? '✅' : '❌'} ${lolos} lolos, ${gagal} gagal\n`);
process.exit(gagal === 0 ? 0 : 1);

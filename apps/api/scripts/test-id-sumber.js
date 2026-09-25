/*
 * Uji alokasi id lokal untuk entri situs sumber
 * (apps/web/src/offline/idSumber.js).
 *
 * Kenapa skripnya duduk di apps/api/scripts padahal yang diuji milik apps/web:
 * alasan yang sama dengan test-rentang.js di sebelahnya — di sinilah seluruh
 * skrip uji repo ini berada, dan modul yang diuji adalah JS murni tanpa React,
 * tanpa Capacitor, bahkan tanpa satu pun impor, jadi Node menjalankannya apa
 * adanya.
 *
 * Kenapa justru bagian INI yang diuji, dari seluruh jalur unduh-dari-sumber:
 * id lokal adalah nama folder di penyimpanan HP. Satu id yang dialokasikan dua
 * kali berarti chapter baru menulis halamannya ke dalam folder chapter yang
 * sudah tersimpan — kerusakan yang tidak bisa dibatalkan, tidak memberi satu
 * pun pesan, dan baru terlihat berminggu-minggu kemudian sebagai chapter yang
 * halamannya tercampur. Sisa jalurnya butuh jaringan dan perangkat; yang ini
 * tidak, jadi tidak ada alasan untuk membiarkannya tidak diuji.
 *
 * Jalankan: npm run test:id-sumber
 */
import {
  AWAL_ID_SUMBER,
  alokasikanId,
  dariSumber,
  kunciChapter,
  kunciKomik,
  pemetaanDariChapter,
  pemetaanKosong,
  penandaChapter,
  penandaSeri,
  sahkanPemetaan,
} from '../../web/src/offline/idSumber.js';

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

const SERI = 'https://kiryuu.to/manga/one-piece/';
const spek = (nomor, url = `https://kiryuu.to/one-piece-chapter-${nomor}/`) => ({
  host: 'kiryuu.to',
  urlSeri: SERI,
  nomor,
  urlChapter: url,
});

console.log('\n── dariSumber ────────────────────────────────────────');
cek('id server rumah (lima digit) bukan milik sumber', dariSumber(48213), false);
cek('tepat di awal penghitung sudah milik sumber', dariSumber(AWAL_ID_SUMBER), true);
cek('satu di bawah awal penghitung bukan milik sumber', dariSumber(AWAL_ID_SUMBER - 1), false);
cek('teks angka tetap terbaca (datang dari useParams)', dariSumber(String(AWAL_ID_SUMBER + 7)), true);
cek('bukan angka → false, bukan melempar', dariSumber('sumber/abc'), false);
cek('null → false', dariSumber(null), false);
cek('pecahan → false (id adalah nama folder)', dariSumber(AWAL_ID_SUMBER + 0.5), false);

console.log('\n── penanda seri dan chapter ──────────────────────────');
cek('garis miring di ujung tidak melahirkan seri kedua', penandaSeri(SERI), penandaSeri(SERI.replace(/\/$/, '')));
cek('huruf besar-kecil disamakan', penandaSeri('https://x.id/Manga/One-Piece'), '/manga/one-piece');
cek('kueri dan fragmen bukan bagian identitas seri', penandaSeri('https://x.id/manga/a?utm=1#top'), '/manga/a');
cek(
  'dua seri berbeda yang segmen terakhirnya sama tetap berbeda',
  penandaSeri('https://x.id/manga/naruto') === penandaSeri('https://x.id/manhwa/naruto'),
  false,
);
cek('alamat tak terurai jatuh ke teksnya, tidak melempar', penandaSeri('bukan url'), 'bukan url');
cek('chapter dikenali dari NOMOR, bukan alamatnya', penandaChapter(5, 'https://x.id/a-5/'), 'n5');
cek(
  'alamat chapter berganti, id-nya tidak ikut berganti',
  penandaChapter(5, 'https://x.id/a-5/') === penandaChapter(5, 'https://x.id/a-chapter-5-baru/'),
  true,
);
cek('nomor pecahan dibedakan', penandaChapter(10.5, 'https://x.id/a/') !== penandaChapter(10, 'https://x.id/a/'), true);
cek('tanpa nomor jatuh ke alamatnya', penandaChapter(null, 'https://x.id/a-extra/'), 'u/a-extra');
cek(
  'dua chapter tanpa nomor TIDAK berbagi satu kunci',
  penandaChapter(null, 'https://x.id/a-extra/') === penandaChapter(null, 'https://x.id/b-extra/'),
  false,
);
cek('www. diabaikan pada host', kunciKomik('www.kiryuu.to', SERI), kunciKomik('kiryuu.to', SERI));
cek(
  'host berbeda tetap komik berbeda meski jalurnya sama',
  kunciKomik('a.id', 'https://a.id/manga/x') === kunciKomik('b.id', 'https://b.id/manga/x'),
  false,
);

console.log('\n── alokasikanId ──────────────────────────────────────');
{
  const peta = pemetaanKosong();
  const satu = alokasikanId(peta, spek(1));
  cek('alokasi pertama mulai di awal penghitung', satu.comicId, AWAL_ID_SUMBER);
  cek('chapter mendapat id sendiri, bukan id komiknya', satu.chapterId, AWAL_ID_SUMBER + 1);
  cek('alokasi pertama ditandai baru', satu.baru, true);

  const dua = alokasikanId(peta, spek(2));
  cek('chapter kedua di seri yang sama memakai comicId yang sama', dua.comicId, AWAL_ID_SUMBER);
  cek('chapter kedua mendapat id berikutnya', dua.chapterId, AWAL_ID_SUMBER + 2);

  const ulang = alokasikanId(peta, spek(1));
  cek('chapter yang sama dialokasikan lagi → id yang SAMA', ulang.chapterId, satu.chapterId);
  cek('dan tidak ditandai baru', ulang.baru, false);
  cek('penghitung tidak bergerak untuk yang sudah ada', peta.berikut, AWAL_ID_SUMBER + 3);

  const lain = alokasikanId(peta, { host: 'komikindo.ch', urlSeri: 'https://komikindo.ch/komik/x/', nomor: 1 });
  cek('seri lain mendapat comicId sendiri', lain.comicId, AWAL_ID_SUMBER + 3);
  cek(
    'tidak satu id pun dipakai dua kali',
    new Set([satu.comicId, satu.chapterId, dua.chapterId, lain.comicId, lain.chapterId]).size,
    5,
  );
}

{
  // Dua chapter dari seri yang sama, dialokasikan beruntun dari SATU pemetaan —
  // inilah bentuk "berbarengan" yang sebenarnya terjadi: penyimpanan.js
  // menyerikan setiap alokasi lewat satu rantai promise, jadi yang kedua selalu
  // melihat hasil yang pertama. Yang diuji di sini adalah bahwa melihat hasil
  // itu memang cukup untuk mencegah comicId kembar.
  const peta = pemetaanKosong();
  const hasil = [spek(1), spek(2), spek(3)].map((satu) => alokasikanId(peta, satu));
  cek('tiga chapter beruntun → satu comicId', new Set(hasil.map((h) => h.comicId)).size, 1);
  cek('tiga chapter beruntun → tiga chapterId', new Set(hasil.map((h) => h.chapterId)).size, 3);
}

console.log('\n── sahkanPemetaan ────────────────────────────────────');
cek('index.json versi lama (tanpa blok pemetaan) → pemetaan kosong', sahkanPemetaan(undefined), pemetaanKosong());
cek('blok pemetaan berupa array diabaikan, tidak melempar', sahkanPemetaan({ komik: [] }), pemetaanKosong());
{
  // `berikut` yang mundur adalah bentuk kerusakan paling berbahaya: alokasi
  // berikutnya akan mengembalikan id yang SUDAH jadi nama folder.
  const rusak = { berikut: AWAL_ID_SUMBER, komik: { a: AWAL_ID_SUMBER + 40 }, chapter: { b: AWAL_ID_SUMBER + 90 } };
  cek('berikut dihitung ulang dari id terbesar yang terpakai', sahkanPemetaan(rusak).berikut, AWAL_ID_SUMBER + 91);
}
{
  const hilang = { berikut: AWAL_ID_SUMBER, komik: {}, chapter: {} };
  cek(
    'pemetaan hilang tapi katalog masih memegang id → penghitung tetap di atasnya',
    sahkanPemetaan(hilang, [AWAL_ID_SUMBER + 12, 48213]).berikut,
    AWAL_ID_SUMBER + 13,
  );
}
cek(
  'nilai bukan id (teks, negatif, id server) dibuang dari pemetaan',
  sahkanPemetaan({ komik: { a: 'x', b: -5, c: 48213, d: AWAL_ID_SUMBER + 1 } }).komik,
  { d: AWAL_ID_SUMBER + 1 },
);

console.log('\n── pemetaanDariChapter (pemulihan index.json) ────────');
{
  const entri = [
    {
      id: AWAL_ID_SUMBER + 1,
      comicId: AWAL_ID_SUMBER,
      nomor: 1,
      sumber: { host: 'kiryuu.to', urlSeri: SERI, urlChapter: 'https://kiryuu.to/one-piece-chapter-1/' },
    },
    {
      id: AWAL_ID_SUMBER + 2,
      comicId: AWAL_ID_SUMBER,
      nomor: 2,
      sumber: { host: 'kiryuu.to', urlSeri: SERI, urlChapter: 'https://kiryuu.to/one-piece-chapter-2/' },
    },
    // Chapter dari server rumah ikut ada di katalog yang sama dan harus
    // dilewati tanpa merusak apa pun.
    { id: 48213, comicId: 91, nomor: 7 },
  ];
  const pulih = pemetaanDariChapter(entri);
  cek('komik sumber ditemukan kembali', pulih.komik[kunciKomik('kiryuu.to', SERI)], AWAL_ID_SUMBER);
  cek('chapter sumber ditemukan kembali', pulih.chapter[kunciChapter('kiryuu.to', SERI, 2)], AWAL_ID_SUMBER + 2);
  cek('entri server rumah tidak ikut masuk pemetaan', Object.keys(pulih.chapter).length, 2);
  cek('penghitung melanjutkan di atas id terbesar', pulih.berikut, AWAL_ID_SUMBER + 3);

  // Inilah yang membuat pemulihan berguna: menyimpan chapter 3 sesudahnya harus
  // masuk ke komik yang SAMA, bukan melahirkan kartu kedua di rak.
  const lanjutan = alokasikanId(pulih, spek(3));
  cek('chapter berikutnya menempel ke komik yang sama', lanjutan.comicId, AWAL_ID_SUMBER);
  cek('dan mendapat id yang belum pernah dipakai', lanjutan.chapterId, AWAL_ID_SUMBER + 3);
}
{
  // Folder yang id-nya terpakai tapi blok sumbernya tidak terbaca (chapter.json
  // rusak, atau katalog dari versi yang lebih tua) tetap harus menahan
  // penghitung — folder itu nyata dan ada di disk.
  const pulih = pemetaanDariChapter([{ id: AWAL_ID_SUMBER + 30, comicId: AWAL_ID_SUMBER + 29 }]);
  cek('id tanpa blok sumber tetap menahan penghitung', pulih.berikut, AWAL_ID_SUMBER + 31);
  cek('tapi tidak dipetakan ke seri mana pun', Object.keys(pulih.komik).length, 0);
}
cek('daftar kosong tidak melempar', pemetaanDariChapter([]), pemetaanKosong());
cek('argumen kosong tidak melempar', pemetaanDariChapter(), pemetaanKosong());

console.log(`\n${gagal === 0 ? '✅' : '❌'} ${lolos} lolos, ${gagal} gagal\n`);
process.exit(gagal === 0 ? 0 : 1);

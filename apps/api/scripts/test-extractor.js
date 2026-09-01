#!/usr/bin/env node
// Uji extractor terhadap fixture HTML yang meniru tema pembaca komik umum.
// Tidak menyentuh jaringan — dipakai untuk memastikan logika parsing tidak rusak
// setelah selectors.json atau heuristiknya diubah.
import { extractChapterPages, extractSeries } from '../src/services/sources/index.js';

let failed = 0;

const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) {
    console.log(`   diharapkan: ${JSON.stringify(expected)}`);
    console.log(`   didapat   : ${JSON.stringify(actual)}`);
  }
};

// ── Fixture 1: daftar chapter gaya ts-reader (.eplister) ──────────────────
const seriesTs = `
<html><head><meta property="og:title" content="Komik Uji"/>
<meta property="og:image" content="/img/cover.jpg"/></head><body>
<h1>Komik Uji</h1>
<div class="eplister"><ul>
  <li><a href="/komik-uji-chapter-3/"><span>Chapter 3</span></a></li>
  <li><a href="/komik-uji-chapter-2-5/"><span>Chapter 2.5</span></a></li>
  <li><a href="/komik-uji-chapter-1/"><span>Chapter 1</span></a></li>
</ul></div>
<a href="/daftar-komik/">Daftar Komik</a>
</body></html>`;

const s1 = extractSeries(seriesTs, 'https://siikomik.net/komik/komik-uji/');
check('ts-reader: judul', s1.title, 'Komik Uji');
check('ts-reader: cover absolut', s1.coverUrl, 'https://siikomik.net/img/cover.jpg');
check(
  'ts-reader: chapter terurut naik',
  s1.chapters.map((c) => c.number),
  [1, 2.5, 3],
);
check('ts-reader: link non-chapter diabaikan', s1.chapters.length, 3);

// ── Fixture 2: halaman chapter dengan lazy-load + ikon kecil ──────────────
const chapterLazy = `
<html><body>
<img class="logo" src="/logo.png" width="120" height="40"/>
<div id="readerarea">
  <img data-src="https://cdn.example.com/ch1/001.jpg" src="data:image/gif;base64,R0lGOD"/>
  <img data-lazy-src="https://cdn.example.com/ch1/002.jpg"/>
  <img srcset="https://cdn.example.com/ch1/003.jpg 1x"/>
  <img src="/ads/banner.gif" class="ads" width="300" height="100"/>
</div>
</body></html>`;

const p1 = extractChapterPages(chapterLazy, 'https://siikomik.net/komik-uji-chapter-1/');
check('lazy-load: URL gambar terambil dari data-src/srcset', p1.imageUrls, [
  'https://cdn.example.com/ch1/001.jpg',
  'https://cdn.example.com/ch1/002.jpg',
  'https://cdn.example.com/ch1/003.jpg',
]);

// ── Fixture 3: daftar gambar sebagai JSON inline ──────────────────────────
const chapterJson = `
<html><body><script>
ts_reader.run({"sources":[{"source":"Utama","images":["https:\\/\\/cdn.example.com\\/x\\/1.jpg","https:\\/\\/cdn.example.com\\/x\\/2.jpg"]}]});
</script><div id="readerarea"></div></body></html>`;

const p2 = extractChapterPages(chapterJson, 'https://ngomik.cc/uji-chapter-1/');
check('inline JSON: dipakai lebih dulu daripada DOM', p2.imageUrls, [
  'https://cdn.example.com/x/1.jpg',
  'https://cdn.example.com/x/2.jpg',
]);
check('inline JSON: extractor dilaporkan', p2.extractor.includes('inline-json'), true);

// ── Fixture 4: heuristik untuk host tanpa preset ──────────────────────────
const chapterUnknown = `
<html><body><nav><img src="/i/1.png" width="24" height="24"/></nav>
<div class="content-baca">
  <p><img src="/pages/a.jpg"/></p>
  <p><img src="/pages/b.jpg"/></p>
  <p><img src="/pages/c.jpg"/></p>
</div></body></html>`;

const p3 = extractChapterPages(chapterUnknown, 'https://komiku.org/ch/uji-1/');
check('heuristik: container dengan gambar terbanyak dipilih', p3.imageUrls, [
  'https://komiku.org/pages/a.jpg',
  'https://komiku.org/pages/b.jpg',
  'https://komiku.org/pages/c.jpg',
]);

// ── Fixture 5: host yang dimatikan di selectors.json ─────────────────────
try {
  extractChapterPages('<html></html>', 'https://www.webtoons.com/id/uji/viewer');
  check('host disabled: harus melempar error', false, true);
} catch (error) {
  check('host disabled: ditolak dengan pesan jelas', error.status, 400);
}

// ── Fixture 6: preset tidak cocok -> mode ketat + filter slug seri ────────
// Meniru situs yang berganti tema: selector preset tidak menemukan apa pun,
// sehingga extractor memindai semua link. Widget "manga lain" tidak boleh ikut.
const seriesStrict = `
<html><head></head><body>
<h1>Judul Uji</h1>
<aside class="sidebar">
  <a href="/read/manga-lain/manga-lain-chapter-5">MangaONGCh 5Judul Lain26</a>
  <a href="/read/manga-lain-dua/manga-lain-dua-chapter-6">ManhwaONGCh 6Judul Lain Lagi67</a>
  <a href="/pustaka/">Daftar Manga</a>
</aside>
<div class="chapter-box">
  <a href="/read/judul-uji-remake/judul-uji-remake-chapter-30">29Chapter 30</a>
  <a href="/read/judul-uji-remake/judul-uji-remake-chapter-29">28Chapter 29</a>
  <a href="/read/judul-uji-remake/judul-uji-remake-chapter-28">27Chapter 28</a>
  <a href="/read/judul-uji-remake/judul-uji-remake-chapter-01">Mulai Baca</a>
</div>
</body></html>`;

const s2 = extractSeries(seriesStrict, 'https://contoh-tanpa-preset.test/manga/judul-uji-remake');
check(
  'mode ketat: chapter milik seri lain dibuang',
  s2.chapters.filter((c) => !c.url.includes('judul-uji-remake')).length,
  0,
);
check(
  'mode ketat: nomor chapter benar',
  s2.chapters.map((c) => c.number),
  [1, 28, 29, 30],
);
check('judul: badge angka di depan dibuang', s2.chapters.find((c) => c.number === 28).title, 'Chapter 28');
check('judul: tombol tanpa angka diganti nomor', s2.chapters.find((c) => c.number === 1).title, 'Chapter 1');

// ── Fixture 7: sisa chapter dipanen dari payload <script> ────────────────
const seriesPayload = `
<html><body>
<div class="chapter-box">
  <a href="/read/judul-uji/judul-uji-chapter-10">Chapter 10</a>
  <a href="/read/judul-uji/judul-uji-chapter-09">Chapter 9</a>
</div>
<script>self.__next_f.push([1,"{\\"title\\":\\"Chapter 8\\",\\"slug\\":\\"judul-uji-chapter-08\\"},{\\"title\\":\\"Chapter 7\\",\\"slug\\":\\"judul-uji-chapter-07\\"}"])</script>
</body></html>`;

const s3 = extractSeries(seriesPayload, 'https://contoh-payload.test/manga/judul-uji');
check(
  'payload: chapter yang tidak dirender ikut terambil',
  s3.chapters.map((c) => c.number),
  [7, 8, 9, 10],
);
check(
  'payload: URL dibentuk mengikuti pola link yang ada',
  s3.chapters.find((c) => c.number === 7).url,
  'https://contoh-payload.test/read/judul-uji/judul-uji-chapter-07',
);

console.log(failed === 0 ? '\n✅ Semua pemeriksaan extractor lolos' : `\n❌ ${failed} pemeriksaan gagal`);
process.exit(failed === 0 ? 0 : 1);

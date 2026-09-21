import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('naruread:sources');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Preset selector untuk tema pembaca komik yang umum dipakai. Satu extractor
 * generik + tabel selector jauh lebih mudah dirawat daripada satu scraper per
 * situs: kalau layout berubah, yang diperbaiki hanya baris selector.
 */
const PRESETS = {
  generic: {
    chapterList: ['#Daftar_Chapter a', '.chapter-list a', 'table.chapter a', 'ul li a'],
    reader: ['#Baca_Komik img', '.main-reading-area img', '#readerarea img', 'article img'],
    cover: ['#Informasi img', '.ims img', '.thumb img'],
  },
  'wp-manga': {
    chapterList: ['.wp-manga-chapter a', 'li.wp-manga-chapter > a', '.listing-chapters_wrap a'],
    reader: ['.reading-content img', '.page-break img', '.entry-content img'],
    cover: ['.summary_image img', '.tab-summary img', '.profile-manga img'],
  },
  'ts-reader': {
    chapterList: ['.eplister a', '#chapterlist a', '.lchx a'],
    reader: ['#readerarea img', '.rdminimal img'],
    cover: ['.thumb img', '.thumbook img', '.bigcontent img'],
  },
};

const FALLBACK = {
  chapterList: [],
  reader: [],
};

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf8'));
  } catch (error) {
    log.warn(`selectors.json tidak terbaca: ${error.message}`);
    return { hosts: {} };
  }
};

const baseHost = (hostname) => hostname.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');

/** Cari konfigurasi untuk sebuah URL: exact host -> domain induk -> fallback. */
export const resolveSourceConfig = (url) => {
  const { hosts } = loadConfig();
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const entry = hosts[hostname] ?? hosts[baseHost(hostname)] ?? null;

  if (entry?.disabled) {
    const error = new Error(
      entry.note || `Import otomatis dari ${hostname} dimatikan di selectors.json`,
    );
    error.status = 400;
    throw error;
  }

  const preset = entry?.preset ? PRESETS[entry.preset] : null;
  return {
    host: hostname,
    name: entry?.preset ?? 'heuristic',
    chapterList: entry?.chapterList ?? preset?.chapterList ?? FALLBACK.chapterList,
    reader: entry?.reader ?? preset?.reader ?? FALLBACK.reader,
    title: entry?.title,
    cover: entry?.cover ?? preset?.cover ?? [],
    description: entry?.description,
    // Halaman etalase punya tata letak sendiri yang tidak ada hubungannya
    // dengan halaman seri, jadi konfigurasinya dibiarkan apa adanya dan tidak
    // punya preset: situs yang belum didaftarkan memang tidak boleh dipindai.
    katalog: entry?.katalog ?? null,
    // Sama alasannya dengan katalog: host tanpa blok cari tidak ikut dicari,
    // bukan ditebak lewat ?s= — kiryuu membuktikan tebakan itu berbahaya karena
    // GET-nya mengabaikan kata kunci dan tetap mengembalikan judul populer.
    cari: entry?.cari ?? null,
  };
};

/**
 * Host yang punya blok katalog. Dibaca dari selectors.json setiap kali
 * dipanggil, sama seperti resolveSourceConfig, jadi sumber etalase baru cukup
 * ditambah dengan menyunting berkas itu.
 */
export const daftarHostKatalog = () =>
  Object.entries(loadConfig().hosts ?? {})
    .filter(([, entri]) => entri?.katalog && !entri.disabled)
    .map(([host]) => host.toLowerCase());

/** Host yang punya blok cari, dibaca ulang dari selectors.json seperti daftarHostKatalog. */
export const daftarHostCari = () =>
  Object.entries(loadConfig().hosts ?? {})
    .filter(([, entri]) => entri?.cari?.url && !entri.disabled)
    .map(([host]) => host.toLowerCase());

// ── Utilitas ekstraksi ────────────────────────────────────────────────────

const abs = (src, baseUrl) => {
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return null;
  }
};

// data-pagespeed-lazy-src: modul PageSpeed menaruh alamat asli gambar di sini
// dan mengisi src dengan satu GIF penahan yang sama untuk semua gambar. Diukur
// di etalase ngomik sebelum atribut ini dikenali: 23 dari 24 sampul jatuh ke
// GIF itu.
const IMG_ATTRS = ['data-src', 'data-lazy-src', 'data-pagespeed-lazy-src', 'data-original', 'data-cfsrc', 'src'];

const imageUrlFrom = (element, $, baseUrl) => {
  for (const attr of IMG_ATTRS) {
    const value = $(element).attr(attr);
    if (value && !value.startsWith('data:')) return abs(value.trim(), baseUrl);
  }
  const srcset = $(element).attr('srcset');
  if (srcset) {
    const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
    if (first) return abs(first, baseUrl);
  }
  return null;
};

const looksLikeContentImage = (element, $) => {
  const width = Number($(element).attr('width'));
  const height = Number($(element).attr('height'));
  if (Number.isFinite(width) && width > 0 && width < 200) return false;
  if (Number.isFinite(height) && height > 0 && height < 200) return false;
  const cls = `${$(element).attr('class') ?? ''} ${$(element).attr('id') ?? ''}`.toLowerCase();
  return !/(logo|avatar|icon|banner|ads?|thumb)/.test(cls);
};

const firstMatching = ($, selectors) => {
  for (const selector of selectors) {
    const found = $(selector);
    if (found.length > 0) return found;
  }
  return null;
};

/** Cari elemen dengan jumlah <img> terbanyak — pembaca komik hampir selalu itu. */
const densestImageContainer = ($) => {
  let best = null;
  let bestCount = 0;

  $('div, article, section, main').each((_index, element) => {
    const count = $(element).find('> img, > p > img, > div > img').length;
    if (count > bestCount) {
      best = element;
      bestCount = count;
    }
  });

  return bestCount >= 2 ? $(best).find('img') : $('img');
};

/**
 * Beberapa tema menaruh daftar gambar sebagai JSON di dalam <script>
 * (mis. ts_reader.run({...}) atau var chapter_images = [...]).
 * Mengambil dari sana lebih akurat daripada membaca DOM yang lazy-load.
 */
/**
 * Panen gambar dari payload React Server Components (Next.js modern).
 *
 * Situs seperti voratoon tidak menaruh halaman komik di tag <img> maupun JSON
 * inline biasa. URL-nya tertanam di dalam aliran `self.__next_f.push(...)`
 * dengan garis miring ter-escape (`https:\/\/...`), sehingga pencarian URL
 * biasa tidak menemukannya sama sekali — ekstraktor kita sempat melaporkan nol
 * gambar padahal halamannya sehat.
 *
 * Dijalankan sebagai jalan terakhir, setelah <img> dan JSON inline gagal.
 */
const imagesFromRscStream = (html, baseUrl) => {
  if (!html.includes('__next_f')) return [];

  // Normalkan escape tanpa regex: setiap "\/" menjadi "/".
  const normal = html.split(String.fromCharCode(92) + '/').join('/');
  const cocok = normal.match(/https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp|avif)/gi) ?? [];

  const hasil = [];
  for (const mentah of new Set(cocok)) {
    const url = abs(mentah, baseUrl);
    if (url && !url.endsWith('.svg')) hasil.push(url);
  }
  return hasil;
};

const imagesFromInlineJson = (html, baseUrl) => {
  const results = [];
  const scriptJson = [...html.matchAll(/"images"\s*:\s*(\[[^\]]*\])/g)];

  for (const match of scriptJson) {
    try {
      const list = JSON.parse(match[1].replace(/\\\//g, '/'));
      list.forEach((entry) => {
        const url = typeof entry === 'string' ? entry : entry?.url ?? entry?.src;
        if (url) {
          const resolved = abs(String(url), baseUrl);
          if (resolved) results.push(resolved);
        }
      });
    } catch {
      /* bukan JSON valid — lewati */
    }
    if (results.length > 0) break;
  }

  return results;
};

// ── API publik ────────────────────────────────────────────────────────────

const CHAPTER_HREF = /(chapter|chap|\bch\b|episode|\bep\b)[-_/ ]?\d/i;

/**
 * Nomor chapter hanya diambil kalau memang ada di teks/URL. Tidak ada fallback
 * ke nomor urut: link navigasi ("Daftar Manga", "javascript:void(0)") tidak boleh
 * lolos hanya karena posisinya di daftar.
 */
/**
 * Angka di belakang koma pada nomor chapter selalu pendek: 79.1, 85.5, sesekali
 * dua digit. Yang panjang bukan nomor chapter melainkan ID pos yang ditempelkan
 * situs ke URL-nya — "chapter-79-396515" pernah tersimpan sebagai Ch 79.396515
 * dan menyelipkan chapter itu ke urutan yang salah. Sisa digit yang tidak masuk
 * akal dibuang, bukan ikut disimpan.
 */
const rapikanNomor = (nilai) => {
  if (!Number.isFinite(nilai)) return null;
  const pecahan = String(nilai).split('.')[1];
  return pecahan && pecahan.length > 2 ? Math.trunc(nilai) : nilai;
};

const parseNumberFromChapter = (text, href) => {
  // URL didahulukan: teks link sering ditempeli jumlah view dan waktu rilis
  // ("Chapter 4875.9K5 hari lalu"), sedangkan URL selalu bersih.
  const dariUrl = href.match(/\/(?:chapter|chap|ch|episode|eps?)[-_/]?(\d+(?:[.-]\d+)?)(?:[/?#]|$)/i);
  if (dariUrl) return rapikanNomor(Number(dariUrl[1].replace('-', '.')));

  const marked = `${text} ${href}`.match(
    /(?:chapter|chap|ch|episode|eps?)[-_.\s/]*(\d+(?:[.,]\d+)?)/i,
  );
  if (marked) return rapikanNomor(Number(marked[1].replace(',', '.')));

  // Slug diakhiri angka: /komik-uji-73/ atau /komik-uji-10-5/
  const slug = href.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const tail = slug.match(/-(\d+(?:-\d+)?)$/);
  if (tail) return rapikanNomor(Number(tail[1].replace('-', '.')));

  // Teks link yang isinya nomor saja: "73" atau "10.5"
  const bare = text.trim().match(/^(\d+(?:[.,]\d+)?)$/);
  if (bare) return rapikanNomor(Number(bare[1].replace(',', '.')));

  return null;
};

const sameUrl = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** Slug seri dari URL halaman: /manga/<slug>/ -> "<slug>" */
const seriesSlugFrom = (pageUrl) => {
  try {
    const segments = new URL(pageUrl).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    return last.length >= 6 ? last.toLowerCase() : '';
  } catch {
    return '';
  }
};

/** Link chapter seri ini hampir selalu memuat slug serinya. */
const belongsToSeries = (url, seriesSlug) =>
  seriesSlug ? url.toLowerCase().includes(seriesSlug) : false;

/**
 * Kalau cukup banyak kandidat memuat slug seri, sisanya pasti milik seri lain
 * (widget "manga populer", rekomendasi, riwayat) dan dibuang. Situs yang URL
 * chapter-nya tidak memuat slug tetap aman karena filter ini tidak menyala.
 */
const keepSeriesChapters = (chapters) => {
  const valid = chapters.filter((chapter) => Number.isFinite(chapter.number));
  const owned = valid.filter((chapter) => chapter.sameSeries);
  return (owned.length >= 3 ? owned : valid).map(({ sameSeries, ...chapter }) => chapter);
};

/** Nomor sama dari beberapa link: ambil yang pertama muncul. */
const dedupeByNumber = (chapters) => {
  const byNumber = new Map();
  chapters.forEach((chapter) => {
    if (!byNumber.has(chapter.number)) byNumber.set(chapter.number, chapter);
  });
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
};

/**
 * Teks link sering berisi badge angka yang menempel pada labelnya
 * ("76Chapter 77"). Angka pendahulu itu dibuang supaya judulnya terbaca wajar.
 */
/**
 * Bersihkan judul chapter dari sisa antarmuka situs.
 *
 * Banyak situs menempelkan jumlah view dan waktu rilis tepat di sebelah judul
 * tanpa pemisah, sehingga teks tautannya terbaca seperti
 * "Chapter 2539.9K1 tahun lalu" — sebenarnya "Chapter 2" + "539.9K" + "1 tahun
 * lalu". Di voratoon 95 dari 96 judul tercemar seperti ini.
 *
 * `nomor` (kalau diketahui dari URL) dipakai sebagai jangkar: hanya ekor tepat
 * setelah nomor yang berupa angka atau hitungan view yang dibuang. Judul asli
 * seperti "Chapter 5 - Pertarungan" tidak tersentuh karena ekornya bukan angka.
 */
const cleanChapterTitle = (text, nomor = null) => {
  if (!text) return null;

  let cleaned = text
    .replace(/^\d+(?=\s*(?:chapter|chap|ch\b|episode|eps?\b))/i, '')
    // Waktu rilis relatif — tidak pernah menjadi bagian judul sungguhan.
    .replace(/\d+\s*(?:detik|menit|jam|hari|minggu|bulan|tahun)\s*(?:yang\s*)?lalu/gi, '')
    .replace(/\d+\s*(?:second|minute|hour|day|week|month|year)s?\s*ago/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (nomor !== null && Number.isFinite(nomor)) {
    const angka = String(nomor).replace('.', '\\.');
    const pola = new RegExp('^((?:chapter|chap|ch|episode|eps?)\\s*)?(' + angka + ')(.*)$', 'i');
    const cocok = cleaned.match(pola);
    if (cocok) {
      const ekor = (cocok[3] ?? '').trim();
      // Ekor yang seluruhnya angka atau hitungan view (mis. "539.9K") = sampah.
      if (/^\d+(?:\.\d+)?\s*[KMB]?$/i.test(ekor)) {
        cleaned = ((cocok[1] ?? 'Chapter ').trim() + ' ' + cocok[2]).trim();
      }
    }
  }

  return cleaned.slice(0, 120) || null;
};

/**
 * Situs berbasis Next.js/SPA sering hanya merender sebagian chapter sebagai
 * <a>, sementara daftar lengkapnya ikut terkirim sebagai JSON di dalam
 * <script> (payload hidrasi). Pola {"title":...,"slug":...} dipanen dari sana
 * lalu URL-nya dibentuk mengikuti pola link chapter yang sudah ada.
 */
const chaptersFromPayload = (html, known) => {
  const template = urlTemplateFrom(known);
  if (!template) return [];

  // Payload hidrasi menyimpan tanda kutip dalam bentuk ter-escape.
  const normalized = html.includes('\\"title\\"') ? html.split('\\"').join('"') : html;
  const pattern = /"title"\s*:\s*"([^"]{1,120})"\s*,\s*"slug"\s*:\s*"([^"]{1,200})"/g;
  const found = [];

  for (const match of normalized.matchAll(pattern)) {
    const [, title, slug] = match;
    if (!/chapter[-_ ]?\d/i.test(slug)) continue;
    const number = parseNumberFromChapter(title, slug);
    if (number === null || !Number.isFinite(number)) continue;
    found.push({ number, title: cleanChapterTitle(title, number), url: template(slug) });
  }

  return found;
};

/** Bentuk pembuat URL dari satu link chapter yang sudah diketahui. */
const urlTemplateFrom = (chapters) => {
  for (const chapter of chapters) {
    const trailingSlash = chapter.url.endsWith('/');
    const parts = chapter.url.replace(/\/+$/, '').split('/');
    const last = parts.pop();
    if (!/chapter[-_ ]?\d/i.test(last)) continue;
    const prefix = `${parts.join('/')}/`;
    return (slug) => `${prefix}${slug}${trailingSlash ? '/' : ''}`;
  }
  return null;
};

/**
 * Judul dari tombol navigasi ("Mulai Baca", "Chapter Terbaru") tidak memuat
 * angka sama sekali — diganti nomor chapter yang sebenarnya.
 */
const normalizeTitles = (chapters) =>
  chapters.map((chapter) => ({
    ...chapter,
    title: /\d/.test(chapter.title ?? '')
      ? chapter.title
      : `Chapter ${chapter.number}`,
  }));

// ── Metadata seri: sinopsis, genre, author, status ───────────────────────

/** Payload hidrasi menyimpan kutip ter-escape; dinormalkan sekali lalu dipakai ulang. */
const unescapePayload = (html) => (html.includes('\\"') ? html.split('\\"').join('"') : html);

const payloadString = (html, key) => {
  const match = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]{2,4000})"`, 'i'));
  return match ? match[1].split('\\n').join('\n').trim() : null;
};

/**
 * Ambil daftar nilai dari sebuah array di dalam payload JSON mentah.
 *
 * Dua bentuk ditemui di lapangan:
 *   sederhana : "genres":["Action","Fantasy"]
 *   berobjek  : "genres":[{"id":"..","createdAt":"..","data":{"name":"Action",
 *               "description":"Action genre from Komikcast"}}]
 *
 * Versi lama mengambil SETIAP token berkutip, sehingga pada bentuk berobjek
 * nama field, stempel waktu, dan teks deskripsi ikut terbaca sebagai genre —
 * satu komik voratoon menghasilkan 12 "genre" padahal aslinya hanya dua.
 */
const payloadArray = (html, key) => {
  const match = html.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]{0,4000})\\]`, 'i'));
  if (!match) return [];
  const isi = match[1];

  // Bentuk berobjek: hanya field nama yang merupakan genre sesungguhnya.
  const namaSaja = [...isi.matchAll(/"(?:name|title|slug)"\s*:\s*"([^"]{1,40})"/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (namaSaja.length > 0) return namaSaja;

  // Bentuk sederhana: ["Action","Fantasy"]
  return [...isi.matchAll(/"([^"]{1,40})"/g)].map((m) => m[1].trim()).filter(Boolean);
};

const jsonLd = ($) => {
  const blocks = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      /* abaikan blok yang tidak valid */
    }
  });
  return blocks;
};

/** Nilai di sebelah label seperti "Author:" / "Status:" pada tabel info. */
const labelValue = ($, pattern) => {
  let value = null;
  $('td, th, dt, dd, span, div, li, b, strong').each((_i, el) => {
    if (value) return;
    const node = $(el);
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (!pattern.test(text) || text.length > 40) return;

    const next = node.next().text().replace(/\s+/g, ' ').trim();
    if (next && next.length <= 80) {
      value = next;
      return;
    }
    const parentText = node.parent().text().replace(/\s+/g, ' ').trim();
    const stripped = parentText.replace(text, '').trim();
    if (stripped && stripped.length <= 80) value = stripped;
  });
  return value || null;
};

const cleanList = (values) => {
  const seen = new Set();
  const result = [];
  values
    .map((value) => String(value).replace(/\s+/g, ' ').trim())
    .filter((value) => value.length >= 2 && value.length <= 30)
    .filter((value) => !/^(genre|genres|tema|tipe|kategori)$/i.test(value))
    // Jaring pengaman untuk bentuk payload lain: nama field JSON dan stempel
    // waktu tidak pernah menjadi genre yang sah.
    .filter((value) => !/^(id|_id|uuid|createdAt|updatedAt|deletedAt|data|name|title|slug|type|status|order|__typename)$/i.test(value))
    .filter((value) => !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/.test(value))
    .forEach((value) => {
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(value);
      }
    });
  return result.slice(0, 12);
};

const normalizeStatus = (value) => {
  if (!value) return null;
  const text = value.toLowerCase();
  if (/complete|tamat|end/.test(text)) return 'Completed';
  if (/hiatus|pause/.test(text)) return 'Hiatus';
  if (/ongoing|berjalan|publishing/.test(text)) return 'Ongoing';
  return null;
};

/** Sinopsis dari heading "Sinopsis"/"Synopsis" beserta paragraf di bawahnya. */
const synopsisFromDom = ($) => {
  let found = null;
  $('h1, h2, h3, h4, strong, b').each((_i, el) => {
    if (found) return;
    const heading = $(el).text().replace(/\s+/g, ' ').trim();
    if (heading.length > 40 || !/sinopsis|synopsis|deskripsi/i.test(heading)) return;

    const parts = [];
    let cursor = $(el).parent().is('div, section, article') ? $(el) : $(el);
    cursor.nextAll('p, div').slice(0, 4).each((_j, sibling) => {
      const text = $(sibling).text().replace(/\s+/g, ' ').trim();
      if (text.length >= 40) parts.push(text);
    });
    const joined = parts.join('\n\n').trim();
    if (joined.length >= 60) found = joined;
  });
  return found;
};

/**
 * Sinopsis, genre, author, dan status. Diambil berlapis: payload JSON situs
 * (paling lengkap dan bersih) -> JSON-LD -> struktur halaman -> meta sosial.
 */
const extractMeta = (html, $) => {
  const payload = unescapePayload(html);
  const ld = jsonLd($);
  const ldNode = ld.find((node) => node?.description || node?.author || node?.genre) ?? {};

  const genres = cleanList([
    ...payloadArray(payload, 'genres'),
    ...String(payloadString(payload, 'genre') ?? '').split(','),
    ...String(ldNode.genre ?? '').split(','),
    ...$('a[href*="/genre"]')
      .map((_i, el) => $(el).text().trim())
      .get(),
    ...String(labelValue($, /^(genre|genres|tema)\s*:?$/i) ?? '').split(','),
  ]);

  /*
   * Sinopsis dari payload kadang membawa escape yang ter-encode dua kali:
   * voratoon mengirim urutan backslash + "r"/"n" mentah di tengah kalimat,
   * sehingga teks yang tersimpan memuat karakter yang tidak pernah dimaksudkan
   * untuk dibaca manusia. Dipulihkan jadi baris baru yang sebenarnya.
   *
   * Semua karakter khusus dibangun lewat String.fromCharCode, bukan escape
   * literal, supaya isinya tidak bisa rusak saat berkas ini disunting alat lain.
   */
  const bersihkanSinopsis = (teks) => {
    if (!teks) return null;
    const bs = String.fromCharCode(92);
    const nl = String.fromCharCode(10);
    const tab = String.fromCharCode(9);

    const hasil = String(teks)
      .split(new RegExp(bs + bs + '+[rn]', 'g')).join(nl)
      .split(new RegExp(bs + bs + '+t', 'g')).join(' ')
      .split(bs).join('')
      .split(new RegExp('[ ' + tab + ']+', 'g')).join(' ')
      .split(new RegExp(nl + '{3,}', 'g')).join(nl + nl)
      .split(nl).map((baris) => baris.trim()).join(nl)
      .trim();

    return hasil || null;
  };

  const description =
    payloadString(payload, 'synopsis') ||
    synopsisFromDom($) ||
    (typeof ldNode.description === 'string' && ldNode.description.length > 80 ? ldNode.description : null) ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null;

  const author =
    payloadString(payload, 'author') ||
    (typeof ldNode.author === 'object' ? ldNode.author?.name : ldNode.author) ||
    labelValue($, /^(author|penulis|pengarang)\s*:?$/i) ||
    null;

  const status =
    normalizeStatus(payloadString(payload, 'status')) ||
    normalizeStatus(labelValue($, /^status\s*:?$/i)) ||
    null;

  return {
    genres,
    description: bersihkanSinopsis(description)?.slice(0, 2000) ?? null,
    author: author ? String(author).slice(0, 80).trim() : null,
    status,
    artist: labelValue($, /^(artist|ilustrator)\s*:?$/i),
  };
};

/**
 * Dari sebuah halaman chapter, cari tautan balik ke halaman serinya.
 * Dipakai untuk komik lama yang diimpor sebelum URL seri ikut disimpan:
 * tanpa ini, pengawas tidak punya acuan untuk mencocokkan daftar chapter.
 *
 * Kandidat dinilai: harus terlihat seperti URL seri (/manga/, /komik/, /series/),
 * bukan URL chapter, dan slug-nya berbagi awalan dengan slug chapter.
 */
export const extractSeriesLink = (html, chapterUrl) => {
  const $ = cheerio.load(html);
  const chapterSlug = (() => {
    try {
      const segments = new URL(chapterUrl).pathname.split('/').filter(Boolean);
      return (segments[segments.length - 1] ?? '').toLowerCase();
    } catch {
      return '';
    }
  })();

  let best = null;
  let bestScore = 0;

  $('a[href]').each((_i, element) => {
    const href = $(element).attr('href');
    if (!href || /^(javascript|mailto|tel|#)/i.test(href.trim())) return;
    const url = abs(href, chapterUrl);
    if (!url || sameUrl(url, chapterUrl)) return;
    if (CHAPTER_HREF.test(url)) return; // itu link chapter lain

    const path = new URL(url).pathname.toLowerCase();
    let score = 0;
    if (/\/(manga|komik|series|comic|manhwa|manhua)\//.test(path)) score += 3;

    const slug = path.split('/').filter(Boolean).pop() ?? '';
    if (slug.length >= 6 && chapterSlug.startsWith(slug.slice(0, Math.min(slug.length, 20)))) score += 3;

    const teks = $(element).text().toLowerCase();
    if (/daftar chapter|all chapters|semua chapter|kembali|info komik/.test(teks)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  });

  return bestScore >= 3 ? best : null;
};

/**
 * Cari poster seri. Urutan: meta sosial (paling andal) -> JSON-LD ->
 * selector khusus tema -> gambar terbesar di paruh atas halaman.
 * Kalau semuanya gagal, cover diambil dari halaman pertama chapter (tanpa
 * jaringan) oleh coverService.
 */
const extractCover = ($, pageUrl, cfg) => {
  const metas = [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    'link[rel="image_src"]',
  ];
  for (const selector of metas) {
    const value = $(selector).attr('content') ?? $(selector).attr('href');
    if (!value?.trim()) continue;
    const url = abs(value.trim(), pageUrl);
    // Sebagian situs memakai kartu og yang digambar otomatis (/api/og?title=...)
    // — itu bukan poster serinya, jadi lanjut mencari kandidat lain.
    if (url && !/\/(api\/)?og(\?|\/|$)|\/og-image/i.test(url)) return url;
  }

  // JSON-LD: { "image": "..." } atau { "image": { "url": "..." } }
  const ld = $('script[type="application/ld+json"]').first().text();
  if (ld) {
    try {
      const parsed = JSON.parse(ld);
      const node = Array.isArray(parsed) ? parsed[0] : parsed;
      const image = node?.image?.url ?? node?.image?.[0] ?? node?.image;
      if (typeof image === 'string' && image.trim()) return abs(image.trim(), pageUrl);
    } catch {
      /* JSON-LD tidak valid — lanjut */
    }
  }

  const bySelector = firstMatching($, cfg.cover ?? []);
  if (bySelector?.length) {
    const url = imageUrlFrom(bySelector.first()[0], $, pageUrl);
    if (url) return url;
  }

  // Petunjuk kata: banyak situs menandai posternya lewat alt/class, dan tidak
  // mencantumkan width/height sama sekali sehingga penilaian luas gagal.
  let byHint = null;
  $('img').each((index, element) => {
    if (byHint || index > 60) return;
    const tanda = `${$(element).attr('alt') ?? ''} ${$(element).attr('class') ?? ''}`.toLowerCase();
    if (/cover|poster|sampul/.test(tanda)) byHint = element;
  });
  if (byHint) {
    const url = imageUrlFrom(byHint, $, pageUrl);
    if (url) return url;
  }

  // Terakhir: gambar dengan area terbesar berdasarkan atribut width/height.
  let best = null;
  let bestArea = 0;
  $('img').each((index, element) => {
    if (index > 40) return; // cukup lihat bagian atas halaman
    if (!looksLikeContentImage(element, $)) return;
    const area = (Number($(element).attr('width')) || 0) * (Number($(element).attr('height')) || 0);
    if (area > bestArea) {
      bestArea = area;
      best = element;
    }
  });

  return best ? imageUrlFrom(best, $, pageUrl) : null;
};

/** Ambil metadata seri + daftar chapter dari halaman seri. */
export const extractSeries = (html, pageUrl) => {
  const cfg = resolveSourceConfig(pageUrl);
  const $ = cheerio.load(html);

  const pick = (selectors, fallbackValue) => {
    if (!selectors) return fallbackValue;
    const found = firstMatching($, Array.isArray(selectors) ? selectors : [selectors]);
    return found?.first().text().trim() || fallbackValue;
  };

  // Nama situs pada judul dibuang berdasarkan host-nya, bukan dengan memotong
  // di setiap tanda hubung: banyak judul komik memang memuat " - " di
  // dalamnya, dan memotongnya buta akan memangkas judul aslinya.
  const labelSitus = (cfg.host ?? '').split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  const bersihkanJudul = (nilai) => {
    let judul = String(nilai ?? '')
      .replace(/^\s*(baca|read)\s+/i, '')
      .split(/\s+[|·—–]\s+/)[0]
      .replace(/\s+/g, ' ')
      .trim();

    if (labelSitus.length >= 4) {
      const ekor = judul.match(/^(.*?)\s+[-–—]\s+(.+)$/);
      const sisa = ekor?.[2]?.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (sisa && sisa === labelSitus) judul = ekor[1].trim();
    }
    return judul;
  };

  const title =
    pick(cfg.title, null) ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    new URL(pageUrl).pathname.split('/').filter(Boolean).pop();

  // Kalau selector preset tidak cocok satu pun (situs mengganti tema), kita
  // memindai SEMUA link — di mode itu penyaring pola chapter wajib menyala,
  // kalau tidak widget "manga lain" di sidebar ikut terjaring.
  const matched = firstMatching($, cfg.chapterList);
  const links = matched ?? $('a');
  const strict = !matched;

  const seriesSlug = seriesSlugFrom(pageUrl);
  const seen = new Set();
  const chapters = [];

  links.each((_index, element) => {
    const href = $(element).attr('href');
    if (!href || /^(javascript|mailto|tel|#)/i.test(href.trim())) return;

    const url = abs(href, pageUrl);
    if (!url || seen.has(url)) return;
    if (!/^https?:$/.test(new URL(url).protocol)) return;
    if (sameUrl(url, pageUrl)) return; // link ke halaman ini sendiri

    const text = $(element).text().replace(/\s+/g, ' ').trim();
    const number = parseNumberFromChapter(text, url);
    if (number === null || !Number.isFinite(number)) return;

    // Selector khusus host sudah cukup selektif; begitu kita memindai semua
    // link, tuntut polanya terlihat seperti link chapter.
    if ((strict || cfg.chapterList.length === 0) && !CHAPTER_HREF.test(`${text} ${url}`)) return;

    seen.add(url);
    chapters.push({ number, title: cleanChapterTitle(text, number), url, sameSeries: belongsToSeries(url, seriesSlug) });
  });

  const meta = extractMeta(html, $);

  return {
    source: cfg.host,
    extractor: cfg.name,
    title: bersihkanJudul(title),
    description: meta.description,
    genres: meta.genres,
    author: meta.author,
    artist: meta.artist,
    status: meta.status,
    coverUrl: extractCover($, pageUrl, cfg),
    chapters: normalizeTitles(
      dedupeByNumber([
        ...keepSeriesChapters(chapters),
        ...chaptersFromPayload(html, keepSeriesChapters(chapters)),
      ]),
    ),
  };
};

/**
 * Halaman sebuah chapter hampir selalu berasal dari satu folder yang sama di
 * CDN. Gambar yang menyendiri di folder lain biasanya bukan halaman komik —
 * mis. watermark situs (/cover/...) yang ikut terpasang di area pembaca.
 * Penyaringan hanya menyala kalau ada folder yang jelas mendominasi.
 */
const buangGambarAsing = (urls, nomorChapter = null) => {
  if (urls.length < 5) return urls;

  const folder = (url) => {
    try {
      const bagian = new URL(url).pathname.split('/');
      bagian.pop();
      return bagian.join('/');
    } catch {
      return '?';
    }
  };

  const hitung = new Map();
  urls.forEach((url) => hitung.set(folder(url), (hitung.get(folder(url)) ?? 0) + 1));

  /*
   * Kalau nomor chapternya diketahui dan ada folder yang DINAMAI menurut nomor
   * itu, folder itulah yang benar — berapa pun jumlah berkasnya.
   *
   * Aturan "folder terbanyak" saja tidak cukup dan pernah berbahaya: halaman
   * chapter voratoon ikut memuat prefetch chapter lain, sehingga membuka
   * Chapter 49 menghasilkan folder `094` sebagai yang terbanyak. Tanpa
   * pemeriksaan ini, isi Chapter 94 akan masuk ke Chapter 49 tanpa satu pun
   * error — kegagalan diam yang jauh lebih merepotkan daripada gagal terang.
   */
  if (nomorChapter !== null && Number.isFinite(nomorChapter)) {
    const bulat = Math.trunc(nomorChapter);
    const kandidat = [String(bulat), String(bulat).padStart(2, '0'), String(bulat).padStart(3, '0')];
    const cocok = [...hitung.keys()].filter((f) => {
      const akhir = f.split('/').pop() ?? '';
      // "049" atau "096-MIYHWHGDW8" sama-sama diterima; "0940" tidak.
      return kandidat.some((k) => akhir === k || akhir.startsWith(k + '-') || akhir.startsWith(k + '_'));
    });

    if (cocok.length > 0) {
      const terpilih = cocok.sort((a, b) => (hitung.get(b) ?? 0) - (hitung.get(a) ?? 0))[0];
      const hasil = urls.filter((url) => folder(url) === terpilih);
      if (hasil.length !== urls.length) {
        log.debug(
          `folder chapter ${bulat} dipakai (${hasil.length} gambar); ` +
            `${urls.length - hasil.length} gambar dari chapter/bagian lain dibuang`,
        );
      }
      return hasil;
    }
  }

  const [dominan, jumlah] = [...hitung.entries()].sort((a, b) => b[1] - a[1])[0];
  if (jumlah / urls.length < 0.7) return urls; // tidak ada yang dominan

  const hasil = urls.filter((url) => folder(url) === dominan);
  if (hasil.length !== urls.length) {
    log.debug(`${urls.length - hasil.length} gambar di luar folder chapter dibuang`);
  }
  return hasil;
};

/** Ambil daftar URL gambar dari satu halaman chapter. */
/**
 * Host cadangan yang diumumkan halaman itu sendiri.
 *
 * Komiku menaruh penukar host di atribut onerror tiap gambar:
 *   onerror="this.src=this.src.replace('image2.komiku.to','img.komiku.org')"
 * Untuk sebagian chapter, host utamanya benar-benar mati dan HANYA host
 * cadangan yang melayani berkasnya — jadi tanpa membaca peta ini, chapter
 * tersebut mustahil diunduh meski halamannya sehat.
 */
const petaHostCadangan = (html) => {
  const peta = {};
  const pola = /onerror\s*=\s*"[^"]*?\.replace\(\s*'([^']{3,80})'\s*,\s*'([^']{3,80})'\s*\)/gi;
  for (const cocok of html.matchAll(pola)) {
    const [, dari, ke] = cocok;
    if (dari !== ke) peta[dari] = ke;
  }
  return peta;
};

export const extractChapterPages = (html, pageUrl) => {
  const cfg = resolveSourceConfig(pageUrl);

  const hostFallbacks = petaHostCadangan(html);

  // Nomor chapter dibaca dari URL halaman ini. Dipakai untuk memilih folder
  // gambar yang benar saat halaman memuat gambar dari beberapa chapter.
  const nomorChapter = parseNumberFromChapter('', pageUrl);

  const fromJson = imagesFromInlineJson(html, pageUrl);
  if (fromJson.length >= 2) {
    return {
      extractor: `${cfg.name}+inline-json`,
      imageUrls: buangGambarAsing([...new Set(fromJson)], nomorChapter),
      hostFallbacks,
    };
  }

  const $ = cheerio.load(html);
  const images = firstMatching($, cfg.reader) ?? densestImageContainer($);
  const urls = [];

  images.each((_index, element) => {
    if (!looksLikeContentImage(element, $)) return;
    const url = imageUrlFrom(element, $, pageUrl);
    if (url && !url.endsWith('.svg')) urls.push(url);
  });

  if (urls.length >= 2) {
    return { extractor: cfg.name, imageUrls: buangGambarAsing([...new Set(urls)], nomorChapter), hostFallbacks };
  }

  // Jalan terakhir: aliran RSC. Situs Next.js modern tidak menaruh halaman
  // komik di DOM awal sama sekali.
  const fromRsc = imagesFromRscStream(html, pageUrl);
  if (fromRsc.length >= 2) {
    return {
      extractor: `${cfg.name}+rsc`,
      imageUrls: buangGambarAsing([...new Set(fromRsc)], nomorChapter),
      hostFallbacks,
    };
  }

  return { extractor: cfg.name, imageUrls: buangGambarAsing([...new Set(urls)], nomorChapter), hostFallbacks };
};

// ── Katalog: halaman etalase situs sumber ────────────────────────────────

/**
 * Etalase tidak pernah menulis tanggal absolut, hanya jarak waktu ("2 menit
 * lalu"), jadi tabel ini yang mengubahnya jadi menit. Bulan dan tahun ikut
 * didaftarkan walau nilainya kasar: seri yang lama tidak update lebih berguna
 * dilaporkan sebagai "sekitar sekian menit" daripada sebagai tidak diketahui.
 */
const MENIT_PER_SATUAN = {
  detik: 1 / 60,
  second: 1 / 60,
  menit: 1,
  minute: 1,
  jam: 60,
  hour: 60,
  hari: 1440,
  day: 1440,
  minggu: 10080,
  week: 10080,
  bulan: 43200,
  month: 43200,
  tahun: 525600,
  year: 525600,
};

const POLA_WAKTU = new RegExp(`(\\d+)\\s*(${Object.keys(MENIT_PER_SATUAN).join('|')})s?\\b`, 'i');

/**
 * "2 menit lalu" -> 2, "3 jam lalu" -> 180.
 *
 * Sengaja tidak menyentuh Date.now(): ekstraktor harus murni supaya hasilnya
 * sama kapan pun diuji, dan halaman yang sama boleh diurai ulang dari cache
 * tanpa waktunya ikut bergeser. Yang tahu kapan halaman diambil adalah
 * pemanggilnya, dan di sanalah waktu absolutnya dihitung.
 */
const menitLalu = (teks) => {
  if (!teks) return null;
  const cocok = teks.match(POLA_WAKTU);
  if (!cocok) return /baru saja|just now/i.test(teks) ? 0 : null;
  return Math.round(Number(cocok[1]) * MENIT_PER_SATUAN[cocok[2].toLowerCase()]);
};

// "Just now" wajib dikenali di sini, bukan hanya di menitLalu. Kiryuu menuliskannya
// untuk chapter yang baru diunggah; tanpa itu teksnya tidak dianggap waktu, jatuh
// ke peran genre, dan justru kartu yang paling segar tampil tanpa waktu dengan
// genre "Just now".
const berbauWaktu = (teks) => POLA_WAKTU.test(teks) || /\blalu\b|\bago\b|baru saja|just now/i.test(teks);

/**
 * Keterangan kartu berbentuk "<genre> · <waktu>" dengan pemisah titik tengah.
 * Urutannya tidak dijamin dan salah satunya sering hilang — kartu "Baru
 * Ditambahkan" di komiku hanya memuat genre — jadi yang menentukan peran tiap
 * potongan adalah isinya, bukan posisinya.
 */
const uraikanKeterangan = (teks) => {
  const potongan = String(teks ?? '')
    .split(/\s*[·•|]\s*/)
    .map((bagian) => bagian.trim())
    .filter(Boolean);

  const waktu = potongan.find(berbauWaktu) ?? null;
  return {
    genre: potongan.find((bagian) => bagian !== waktu) ?? null,
    updatedText: waktu,
  };
};

const rapikanTipe = (nilai) => {
  const teks = String(nilai ?? '').trim();
  if (!/^(manga|manhwa|manhua)$/i.test(teks)) return null;
  return teks[0].toUpperCase() + teks.slice(1).toLowerCase();
};

/**
 * Di komiku hanya kartu "Baru Ditambahkan" yang membawa atribut data-tipe;
 * kartu "Terbaru" tidak punya sama sekali. Untungnya alt sampulnya selalu
 * berbentuk "Baca <tipe> <judul>", jadi tipe masih bisa dipastikan tanpa
 * menebak-nebak dari judul — kata "Manga" di tengah judul tidak ikut terbaca
 * karena polanya dijangkar ke awal teks.
 */
const TIPE_DARI_ALT = /^\s*(?:baca|read)\s+(manga|manhwa|manhua)\b/i;

/**
 * Sampul yang benar ada di data-src (sudah ditangani imageUrlFrom). Kalau yang
 * tersisa hanya src, isinya gambar penahan lazy-load yang sama untuk semua
 * kartu — lebih baik kosong daripada seluruh etalase menampilkan satu gambar
 * abu-abu yang identik.
 */
// Penahan PageSpeed tidak bernama "lazy" — alamatnya /pagespeed_static/1.<hash>.gif —
// jadi pola nama saja tidak menangkapnya kalau atribut aslinya kebetulan hilang.
const SAMPUL_PENAHAN =
  /\/(lazy|placeholder|blank|no[-_]?image|default|nocover)[-_.\w]*\.(jpe?g|png|gif|webp|svg)|\/pagespeed_static\//i;

/**
 * Tiap situs menaruh tipe komik di tempat berbeda: komikindo dan ngomik di nama
 * kelas sebuah span kosong ("typeflag Manhwa"), kiryuu di alt ikon SVG
 * ("manhwa"), situs lain sebagai teks biasa. Ketiganya dicoba berurutan pada
 * elemen yang ditunjuk `katalog.tipe`, jadi situs berikutnya cukup menyebut
 * elemennya tanpa kode baru.
 */
const tipeDariPenanda = (el) => {
  if (!el?.length) return null;
  const kandidat = [el.text(), el.attr('alt'), ...String(el.attr('class') ?? '').split(/\s+/)];
  for (const nilai of kandidat) {
    const tipe = rapikanTipe(nilai);
    if (tipe) return tipe;
  }
  return null;
};

const teksDari = (kartu, selector) => {
  if (!selector) return null;
  return kartu.find(selector).first().text().replace(/\s+/g, ' ').trim() || null;
};

/**
 * `keterangan` boleh berupa daftar selector. Hasil cari komiku menaruh genre
 * (.tpe1_inf) dan waktu update (<p>) di dua elemen terpisah, sedangkan etalase
 * menaruh keduanya dalam satu teks "<genre> · <waktu>". Digabung dengan pemisah
 * yang sama, uraikanKeterangan tetap jadi satu-satunya pengurai peran.
 */
const teksKeterangan = (kartu, selector) => {
  const potongan = (Array.isArray(selector) ? selector : [selector])
    .map((satu) => teksDari(kartu, satu))
    .filter(Boolean);
  return potongan.length > 0 ? potongan.join(' · ') : null;
};

/**
 * Komiku menaruh tipe di dalam elemen genre ("<b>Manhwa</b> Aksi"), jadi tanpa
 * ini genre kartunya terbaca "Manhwa Aksi". Tipe sudah punya field sendiri.
 */
const lepasTipe = (genre, tipe) => {
  if (!genre || !tipe) return genre;
  const kata = genre.split(/\s+/);
  return kata[0].toLowerCase() === tipe.toLowerCase() ? kata.slice(1).join(' ') || null : genre;
};

const bacaKartuKatalog = ($, element, { kat, pageUrl, bagian }) => {
  const kartu = $(element);

  // Hasil cari komiku diambil dari api.komiku.org, tapi tautannya relatif dan
  // ditujukan ke komiku.org. Dijadikan absolut terhadap halaman yang diambil,
  // setiap kartu menunjuk https://api.komiku.org/manga/... — host yang tidak
  // melayani halaman seri, sehingga impor dan pencocokan koleksi sama-sama
  // gagal. `dasarTautan` menyebut alamat dasar yang benar.
  const dasar = (kat.dasarTautan && abs(kat.dasarTautan, pageUrl)) || pageUrl;

  const tautan = kartu.find(kat.tautanSeri ?? kat.judul).first();
  const href = tautan.attr('href');
  if (!href || /^(javascript|mailto|tel|#)/i.test(href.trim())) return null;

  const seriesUrl = abs(href.trim(), dasar);
  if (!seriesUrl || !/^https?:$/.test(new URL(seriesUrl).protocol)) return null;

  const slug = (new URL(seriesUrl).pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase();
  if (!slug) return null;

  const judulEl = kat.judul ? kartu.find(kat.judul).first() : tautan;
  const title =
    judulEl.text().replace(/\s+/g, ' ').trim() ||
    (judulEl.attr('title') ?? '').replace(TIPE_DARI_ALT, '').replace(/\s+/g, ' ').trim() ||
    null;
  if (!title) return null;

  const sampulEl = kat.sampul ? kartu.find(kat.sampul).first() : null;
  const sampul = sampulEl?.length ? imageUrlFrom(sampulEl[0], $, dasar) : null;
  const coverUrl = sampul && !SAMPUL_PENAHAN.test(sampul) ? sampul : null;

  const tipe =
    rapikanTipe(kat.tipeAttr ? kartu.attr(kat.tipeAttr) : null) ??
    tipeDariPenanda(kat.tipe ? kartu.find(kat.tipe).first() : null) ??
    (kat.tipeDariAlt ? rapikanTipe(sampulEl?.attr('alt')?.match(TIPE_DARI_ALT)?.[1]) : null);

  const keterangan = uraikanKeterangan(teksKeterangan(kartu, kat.keterangan));
  const genre = lepasTipe(keterangan.genre, tipe);
  const { updatedText } = keterangan;

  // Sebagian seri yang baru ditambahkan belum punya satu chapter pun, dan
  // kartunya memang tampil tanpa tautan chapter.
  let latestChapter = null;
  const chapterEl = kat.tautanChapter ? kartu.find(kat.tautanChapter).first() : null;
  const chapterHref = chapterEl?.attr('href');
  const chapterUrl = chapterHref ? abs(chapterHref.trim(), dasar) : null;
  if (chapterUrl) {
    // Pola nomor dari URL mensyaratkan "/chapter", sedangkan URL ngomik berbentuk
    // "-chapter-42/", jadi nomornya dibaca dari teks tautan. Di sana label dan
    // waktu rilis adalah dua span yang menempel tanpa spasi: "Ch. 4227 detik".
    // Diukur sebelum ini ada, 16 dari 24 kartu ngomik mengaku chapter di atas
    // 1500 — Ch. 154 tersimpan sebagai 15428, dan setiap komik di koleksi akan
    // tampak tertinggal ribuan chapter. `labelChapter` menunjuk span labelnya saja.
    const label = kat.labelChapter ? chapterEl.find(kat.labelChapter).first() : null;
    const teks = (label?.length ? label : chapterEl).text().replace(/\s+/g, ' ').trim();
    const number = parseNumberFromChapter(teks, chapterUrl);
    latestChapter = {
      number,
      title: cleanChapterTitle(teks, number) ?? (number === null ? null : `Chapter ${number}`),
      url: chapterUrl,
    };
  } else if (kat.teksChapter) {
    // Hasil cari ngomik menyebut chapter terbarunya sebagai teks biasa
    // ("Chapter 71"), bukan tautan. Nomornya tetap dibaca karena justru itu
    // dasar status "update"; URL-nya dibiarkan kosong, bukan ditebak dari pola
    // slug yang tidak dijamin sama untuk setiap seri.
    const teks = teksDari(kartu, kat.teksChapter);
    const number = teks ? parseNumberFromChapter(teks, '') : null;
    if (number !== null) {
      latestChapter = { number, title: cleanChapterTitle(teks, number) ?? `Chapter ${number}`, url: null };
    }
  }

  return {
    seriesUrl,
    slug,
    title,
    coverUrl,
    genre,
    tipe,
    bagian,
    updatedText,
    updatedMenitLalu: menitLalu(updatedText),
    latestChapter,
  };
};

/**
 * Satu seri bisa muncul di dua bagian sekaligus (baru ditambahkan sekaligus
 * baru update) — pada pengambilan uji, 5 dari 67 kartu begitu. Kartu kedua
 * tidak dijadikan item terpisah supaya seri yang sama tidak tampil dua kali,
 * tapi isinya tidak dibuang: field yang kosong di kartu pertama diisi dari
 * kartu kedua. Ini bukan kerapian belaka — di komiku hanya kartu "Baru
 * Ditambahkan" yang membawa data-tipe, sementara hanya kartu "Terbaru" yang
 * membawa waktu update.
 */
const lengkapiItem = (target, tambahan) => {
  Object.entries(tambahan).forEach(([kunci, nilai]) => {
    if (target[kunci] === null || target[kunci] === undefined) target[kunci] = nilai;
  });
};

const hostnameDari = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * Baca semua kartu di tiap bagian halaman. Dipakai bersama oleh etalase dan
 * pencarian, jadi perbaikan cara membaca kartu cukup dilakukan sekali.
 *
 * Bagian yang tidak menghasilkan kartu dilaporkan beserta tanda apakah
 * wadahnya masih ada: bagi pencarian, wadah kosong berarti kata kuncinya
 * memang tidak ditemukan, sedangkan wadah yang hilang berarti tata letaknya
 * sudah berubah.
 */
const panenKartu = ($, kat, pageUrl) => {
  const items = [];
  const terdaftar = new Map();
  const kosong = [];
  let cocok = 0;

  kat.bagian.forEach((bagian) => {
    const wadah = bagian.wadah ? $(bagian.wadah) : $.root();
    const kartu = wadah.find(kat.kartu);
    cocok += kartu.length;
    if (kartu.length === 0) {
      kosong.push({ label: `${bagian.nama} (${bagian.wadah ?? kat.kartu})`, wadahAda: wadah.length > 0 });
      return;
    }

    kartu.each((_index, element) => {
      const item = bacaKartuKatalog($, element, { kat, pageUrl, bagian: bagian.nama });
      if (!item) return;

      const kunci = item.seriesUrl.replace(/\/+$/, '').toLowerCase();
      const sudahAda = terdaftar.get(kunci);
      if (sudahAda) {
        lengkapiItem(sudahAda, item);
        return;
      }
      terdaftar.set(kunci, item);
      items.push(item);
    });
  });

  return { items, kosong, cocok };
};

/**
 * Baca halaman DAFTAR (etalase) sebuah situs sumber: kartu-kartu seri beserta
 * chapter terbarunya, bukan isi satu seri.
 *
 * Berbeda dari extractSeries yang boleh jatuh ke heuristik, di sini host yang
 * tidak punya blok "katalog" di selectors.json dibiarkan kosong. Memindai
 * semua <article> terdengar menolong, tapi halaman uji komiku punya 177
 * <article> sementara yang benar-benar kartu etalase hanya 67 — sisanya iklan,
 * berita, dan widget genre yang akan ikut terpanen sebagai "komik".
 */
export const extractKatalog = (html, pageUrl) => {
  const host = hostnameDari(pageUrl);

  let cfg;
  try {
    cfg = resolveSourceConfig(pageUrl);
  } catch (error) {
    return { source: host, extractor: null, items: [], warning: error.message };
  }

  const kat = cfg.katalog;
  if (!kat?.kartu || !Array.isArray(kat.bagian) || kat.bagian.length === 0) {
    return {
      source: host,
      extractor: null,
      items: [],
      warning:
        `Belum ada konfigurasi katalog untuk ${host}. Tambahkan hosts["${host}"].katalog ` +
        'di selectors.json berisi: nama, bagian [{ nama, wadah }], kartu, judul, ' +
        'tautanSeri, sampul, keterangan, dan tautanChapter.',
    };
  }

  const { items, kosong } = panenKartu(cheerio.load(html), kat, pageUrl);
  const bagianKosong = kosong.map((bagian) => bagian.label);

  let warning = null;
  if (items.length === 0) {
    warning =
      `Tidak ada kartu terbaca di ${host}: selector "${kat.kartu}" tidak menghasilkan item ` +
      `dengan tautan seri "${kat.tautanSeri ?? kat.judul ?? '(belum diisi)'}". ` +
      'Kemungkinan situs mengganti tema — perbaiki blok katalog di selectors.json.';
  } else if (bagianKosong.length > 0) {
    warning = `Bagian tanpa kartu: ${bagianKosong.join(', ')}. Selector wadahnya mungkin sudah berubah.`;
  }

  return {
    source: host,
    extractor: kat.nama ?? `${(host ?? 'sumber').split('.')[0]}-katalog`,
    items,
    warning,
  };
};

/**
 * Baca halaman HASIL CARI sebuah situs sumber memakai blok "cari" di
 * selectors.json. Kartunya dibaca dengan jalur yang sama dengan etalase.
 *
 * Nol kartu di sini lumrah — kata kuncinya memang tidak ada — jadi tidak
 * dijadikan peringatan begitu saja. Peringatan hanya muncul kalau ada bukti
 * tata letaknya berubah: wadah hasil hilang, atau penanda "tidak ada hasil"
 * yang seharusnya muncul juga tidak ada. Tanpa pembedaan itu, situs yang
 * mengganti tema akan tampak seperti situs yang tidak pernah punya judul apa pun.
 */
export const extractPencarian = (html, pageUrl) => {
  const host = hostnameDari(pageUrl);

  let cfg;
  try {
    cfg = resolveSourceConfig(pageUrl);
  } catch (error) {
    return { source: host, extractor: null, items: [], warning: error.message };
  }

  const cari = cfg.cari;
  if (!cari?.kartu) {
    return {
      source: host,
      extractor: null,
      items: [],
      warning:
        `Belum ada konfigurasi cari untuk ${host}. Tambahkan hosts["${host}"].cari di selectors.json ` +
        'berisi: url (dengan penanda {q}), kartu, judul, tautanSeri, dan sampul.',
    };
  }

  // Halaman hasil cari hampir selalu satu daftar saja, jadi bagian boleh
  // dilewati; tanpa wadah, kartu dicari di seluruh halaman.
  const bagian = Array.isArray(cari.bagian) && cari.bagian.length > 0 ? cari.bagian : [{ nama: 'cari' }];
  const $ = cheerio.load(html);
  const { items, kosong, cocok } = panenKartu($, { ...cari, bagian }, pageUrl);

  let warning = null;
  const wadahHilang = kosong.filter((satu) => !satu.wadahAda);
  if (wadahHilang.length > 0) {
    warning =
      `Wadah hasil cari tidak ditemukan di ${host}: ${wadahHilang.map((satu) => satu.label).join(', ')}. ` +
      'Kemungkinan situs mengganti tema — perbaiki blok cari di selectors.json.';
  } else if (items.length === 0 && cocok > 0) {
    // Kartunya ada, tapi tidak satu pun punya tautan seri atau judul yang
    // terbaca — pola tautan situsnya berubah (mis. /manga/ jadi /series/).
    // Tanpa ini hasilnya "0 judul" yang terbaca seperti judulnya memang tidak ada.
    warning =
      `${cocok} kartu hasil cari di ${host} cocok dengan selector "${cari.kartu}" tapi tidak satu pun terbaca. ` +
      'Kemungkinan pola tautan situs berubah — perbaiki blok cari di selectors.json.';
  } else if (items.length === 0 && cari.tandaKosong && $(cari.tandaKosong).length === 0) {
    warning =
      `Tidak ada kartu maupun penanda "tidak ada hasil" (${cari.tandaKosong}) di ${host}. ` +
      'Kemungkinan situs mengganti tema — perbaiki blok cari di selectors.json.';
  }

  return {
    source: host,
    extractor: cari.nama ?? `${(host ?? 'sumber').split('.')[0]}-cari`,
    items,
    warning,
  };
};

export default {
  resolveSourceConfig,
  daftarHostKatalog,
  daftarHostCari,
  extractSeries,
  extractChapterPages,
  extractKatalog,
  extractPencarian,
  PRESETS,
};

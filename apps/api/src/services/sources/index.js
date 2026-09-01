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
  };
};

// ── Utilitas ekstraksi ────────────────────────────────────────────────────

const abs = (src, baseUrl) => {
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return null;
  }
};

const IMG_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-cfsrc', 'src'];

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
const cleanChapterTitle = (text) => {
  if (!text) return null;
  const cleaned = text
    .replace(/^\d+(?=\s*(?:chapter|chap|ch|episode|eps?))/i, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    found.push({ number, title: cleanChapterTitle(title), url: template(slug) });
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

const payloadArray = (html, key) => {
  const match = html.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]{0,600})\\]`, 'i'));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]{1,40})"/g)].map((m) => m[1].trim()).filter(Boolean);
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
const extractMeta = (html, $, cfg) => {
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
    description: description ? description.slice(0, 2000) : null,
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
    chapters.push({ number, title: cleanChapterTitle(text), url, sameSeries: belongsToSeries(url, seriesSlug) });
  });

  const meta = extractMeta(html, $, cfg);

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
const buangGambarAsing = (urls) => {
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

  const fromJson = imagesFromInlineJson(html, pageUrl);
  if (fromJson.length >= 2) {
    return {
      extractor: `${cfg.name}+inline-json`,
      imageUrls: buangGambarAsing([...new Set(fromJson)]),
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

  return { extractor: cfg.name, imageUrls: buangGambarAsing([...new Set(urls)]), hostFallbacks };
};

export default { resolveSourceConfig, extractSeries, extractChapterPages, PRESETS };

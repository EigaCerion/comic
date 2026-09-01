import path from 'node:path';
import config from './config.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Resource tidak ditemukan') => new HttpError(404, message);

// 401: belum masuk. 403: sudah masuk tapi perannya tidak mengizinkan.
// Dibedakan supaya antarmuka bisa memilih antara "silakan login" dan
// "akun ini memang tidak berhak" — dua hal yang sangat berbeda bagi pengguna.
export const unauthorized = (message = 'Perlu login untuk melakukan ini') => new HttpError(401, message);
export const forbidden = (message = 'Akun ini tidak punya izin untuk itu') => new HttpError(403, message);

/** slug aman untuk dipakai sebagai nama folder */
export const slugify = (input) =>
  String(input)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';

/** chapter 1 -> "chapter-1", chapter 10.5 -> "chapter-10-5" */
export const chapterSlug = (chapterNumber) =>
  `chapter-${String(chapterNumber).replace(/\./g, '-')}`;

export const formatChapterNumber = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : String(n);
};

export const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

export const parseGenres = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((g) => String(g).trim()).filter(Boolean);
  const raw = String(value).trim();
  if (raw.startsWith('[')) {
    try {
      return parseGenres(JSON.parse(raw));
    } catch {
      /* jatuh ke split koma */
    }
  }
  return raw.split(',').map((g) => g.trim()).filter(Boolean);
};

/**
 * Validasi URL sumber sebelum di-download.
 *
 * Dua tingkat:
 *  - default: host wajib ada di ALLOWED_SOURCE_DOMAINS (dipakai untuk halaman
 *    HTML dan URL yang ditempel manual)
 *  - `anyPublicHost`: allowlist dilewati, dipakai untuk gambar yang
 *    direferensikan oleh halaman dari host yang sudah diizinkan — poster dan
 *    halaman komik hampir selalu diletakkan di CDN dengan domain berbeda.
 *
 * Penjagaan anti-SSRF (protokol, localhost, IP privat) berlaku di kedua kasus.
 */
/**
 * Apakah host ini benar-benar di internet publik?
 *
 * Diperketat setelah audit membuktikan SSRF: penjagaan lama hanya mengenali
 * "127.0.0.1" persis, padahal seluruh blok 127.x.x.x menunjuk mesin sendiri,
 * dan alamat bisa ditulis dalam bentuk desimal atau heksadesimal yang lolos
 * pencocokan teks biasa. Karena itu alamat diurai jadi angka, bukan dicocokkan
 * sebagai string.
 */
export const hostPublik = (hostname) => {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;

  // Nama khusus yang selalu menunjuk ke dalam.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host.endsWith('.internal') || host.endsWith('.home.arpa')) return false;

  // IPv6: loopback, link-local (fe80::), unique-local (fc00::/7).
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return false;
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return false;
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return false;
    // ::ffff:127.0.0.1 dan sejenisnya
    const tertanam = host.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (tertanam) return hostPublik(tertanam[1]);
    return true;
  }

  // IPv4 dalam bentuk apa pun: desimal bertitik, satu angka desimal, atau heks.
  let angka = null;
  const bertitik = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (bertitik) {
    const oktet = bertitik.slice(1).map(Number);
    if (oktet.some((o) => o > 255)) return false;
    angka = ((oktet[0] << 24) >>> 0) + (oktet[1] << 16) + (oktet[2] << 8) + oktet[3];
  } else if (/^\d+$/.test(host)) {
    angka = Number(host) >>> 0; // http://2130706433/ = 127.0.0.1
  } else if (/^0x[0-9a-f]+$/i.test(host)) {
    angka = parseInt(host, 16) >>> 0;
  }

  if (angka !== null) {
    const dalam = (a, b) => angka >= a && angka <= b;
    if (dalam(0x00000000, 0x00ffffff)) return false;        // 0.0.0.0/8
    if (dalam(0x7f000000, 0x7fffffff)) return false;        // 127.0.0.0/8 loopback
    if (dalam(0x0a000000, 0x0affffff)) return false;        // 10.0.0.0/8
    if (dalam(0xac100000, 0xac1fffff)) return false;        // 172.16.0.0/12
    if (dalam(0xc0a80000, 0xc0a8ffff)) return false;        // 192.168.0.0/16
    if (dalam(0xa9fe0000, 0xa9feffff)) return false;        // 169.254.0.0/16 link-local
    if (dalam(0x64400000, 0x647fffff)) return false;        // 100.64.0.0/10 CGNAT
    if (dalam(0xe0000000, 0xffffffff)) return false;        // multicast & reserved
    return true;
  }

  return true; // nama domain biasa
};

export const sanitizeSourceUrl = (url, { anyPublicHost = false } = {}) => {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase();
  if (!hostPublik(host)) return null;

  if (anyPublicHost && config.allowReferencedImageHosts) return parsed.toString();

  const allowed = config.allowedSourceDomains;
  if (allowed.length > 0) {
    const ok = allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!ok) return null;
  }
  return parsed.toString();
};

/**
 * Pastikan path hasil join masih di dalam baseDir (anti directory traversal).
 */
export const safeJoin = (baseDir, ...segments) => {
  const target = path.resolve(baseDir, ...segments);
  const base = path.resolve(baseDir);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw badRequest('Path tidak valid');
  }
  return target;
};

export const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|bmp|tiff|avif)$/;

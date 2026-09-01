import pLimit from 'p-limit';
import config from './config.js';
import { createLogger } from './logger.js';
import { hostPublik } from './validators.js';

const log = createLogger('naruread:http');

const lastRequestAt = new Map(); // "host:kind" -> waktu slot berikutnya
const hostLimiters = new Map(); // host -> p-limit untuk request gambar
const robotsCache = new Map(); // host -> { rules, fetchedAt }
const ROBOTS_TTL = 30 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Antre per host supaya server sumber tidak dibanjiri. Gambar dan halaman HTML
 * punya jatah terpisah: HTML jarang tapi sensitif (jeda panjang), gambar banyak
 * dan boleh paralel (jeda pendek).
 */
const throttle = async (host, kind) => {
  const delay = kind === 'image' ? config.worker.imageDelayMs : config.worker.requestDelayMs;
  if (delay <= 0) return;
  const key = `${host}:${kind}`;
  const previous = lastRequestAt.get(key) ?? 0;
  const slot = Math.max(previous, Date.now());
  lastRequestAt.set(key, slot + delay);
  const wait = slot - Date.now();
  if (wait > 0) await sleep(wait);
};

/** Batas request gambar yang berjalan bersamaan, per host. */
const imageLimiter = (host) => {
  if (!hostLimiters.has(host)) {
    hostLimiters.set(host, pLimit(Math.max(1, config.worker.imageConcurrency)));
  }
  return hostLimiters.get(host);
};

/** Parser robots.txt minimal: hanya Disallow/Allow untuk User-agent yang cocok. */
const parseRobots = (text) => {
  const groups = [];
  let current = null;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.split('#')[0].trim();
    if (!line) return;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'disallow' || key === 'allow') && current) {
      current.rules.push({ allow: key === 'allow', path: value });
    }
  });

  return groups;
};

const matchesPath = (rulePath, targetPath) => {
  if (rulePath === '') return false;
  const pattern = rulePath.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = pattern.endsWith('$') ? `^${pattern}` : `^${pattern}`;
  return new RegExp(anchored).test(targetPath);
};

const isAllowedByRobots = async (url) => {
  if (!config.worker.respectRobots) return { allowed: true, reason: 'robots diabaikan (RESPECT_ROBOTS=false)' };

  const target = new URL(url);
  const cached = robotsCache.get(target.host);
  let groups = cached?.rules;

  if (!cached || Date.now() - cached.fetchedAt > ROBOTS_TTL) {
    try {
      const res = await fetch(`${target.protocol}//${target.host}/robots.txt`, {
        headers: { 'User-Agent': config.worker.userAgent },
        signal: AbortSignal.timeout(8000),
      });
      groups = res.ok ? parseRobots(await res.text()) : [];
    } catch (error) {
      log.debug(`robots.txt ${target.host} tidak terbaca: ${error.message}`);
      groups = [];
    }
    robotsCache.set(target.host, { rules: groups, fetchedAt: Date.now() });
  }

  const ua = config.worker.userAgent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((agent) => agent !== '*' && ua.includes(agent))) ??
    groups.find((g) => g.agents.includes('*'));
  if (!group) return { allowed: true };

  const path = target.pathname + target.search;
  const matched = group.rules
    .filter((rule) => matchesPath(rule.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (matched && !matched.allow) {
    return { allowed: false, reason: `robots.txt melarang ${path} (Disallow: ${matched.path})` };
  }
  return { allowed: true };
};

/**
 * fetch dengan sopan: robots.txt, jeda per host, User-Agent jelas, timeout,
 * dan Referer (banyak CDN gambar komik menolak request tanpa referer).
 */
export const politeFetch = async (url, { referer, accept = '*/*', timeout, kind = 'html', signal } = {}) => {
  const { allowed, reason } = await isAllowedByRobots(url);
  if (!allowed) throw new Error(reason);

  const target = new URL(url);
  await throttle(target.host, kind);

  /**
   * Pengalihan diikuti MANUAL, dengan pemeriksaan tiap lompatan.
   *
   * Sebelumnya memakai redirect: 'follow', dan itu lubang SSRF yang terbukti:
   * penjagaan alamat internal hanya berlaku pada URL awal, sementara fetch
   * mengikuti pengalihan tanpa memeriksa tujuannya. Situs sumber yang disusupi
   * cukup mengalihkan satu URL gambar ke 127.0.0.1 atau 169.254.169.254, dan
   * isinya akan terambil lalu tersimpan sebagai halaman komik. Sekarang setiap
   * tujuan pengalihan wajib berupa host publik.
   */
  const MAKS_LOMPATAN = 5;
  let alamatKini = url;
  let res;

  for (let lompatan = 0; ; lompatan += 1) {
    const kini = new URL(alamatKini);
    res = await fetch(alamatKini, {
      headers: {
        'User-Agent': config.worker.userAgent,
        Accept: accept,
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
        ...(referer ? { Referer: referer } : { Referer: `${kini.protocol}//${kini.host}/` }),
      },
      redirect: 'manual',
      // Pemanggil boleh membawa signal sendiri (dipakai fetchImage untuk timeout
      // berbasis kemacetan, bukan berbasis total waktu unduh).
      signal: signal ?? AbortSignal.timeout(timeout ?? config.worker.timeout),
    });

    const lokasi = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!lokasi) break;

    if (lompatan >= MAKS_LOMPATAN) {
      throw new Error(`Terlalu banyak pengalihan (${MAKS_LOMPATAN}) mulai dari ${url}`);
    }

    const tujuan = new URL(lokasi, alamatKini);
    if (tujuan.protocol !== 'http:' && tujuan.protocol !== 'https:') {
      throw new Error(`Pengalihan ke skema yang tidak diizinkan: ${tujuan.protocol}`);
    }
    if (!hostPublik(tujuan.hostname)) {
      throw new Error(
        `Pengalihan ditolak: ${url} mengarah ke alamat internal (${tujuan.hostname}) — kemungkinan upaya SSRF`,
      );
    }

    // Host baru berarti jatah antrean dan jeda baru pula.
    if (tujuan.host !== kini.host) await throttle(tujuan.host, kind);
    alamatKini = tujuan.toString();
  }

  if (!res.ok) {
    const hint =
      res.status === 403 || res.status === 503
        ? ' (kemungkinan diblokir bot protection — situs ini perlu dibuka manual)'
        : '';
    throw new Error(`HTTP ${res.status} untuk ${url}${hint}`);
  }
  return res;
};

export const fetchHtml = async (url) => {
  const res = await politeFetch(url, { accept: 'text/html,application/xhtml+xml' });
  return { html: await res.text(), finalUrl: res.url || url };
};

const formatByte = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Unduh gambar dengan timeout berbasis KEMACETAN, bukan total waktu.
 *
 * Versi lama memakai satu AbortSignal.timeout(30 detik) untuk seluruh request.
 * Itu membunuh unduhan yang sebenarnya sehat: satu halaman webtoon berukuran
 * 7,9 MB butuh ~17 detik sendirian, dan jauh lebih lama saat 20 gambar diunduh
 * bersamaan. Akibatnya chapter yang sudah 99% selesai dibuang seluruhnya.
 *
 * Sekarang: batas waktu berlaku untuk koneksi/header, lalu di-reset setiap kali
 * ada potongan data masuk. Unduhan hanya dibatalkan kalau benar-benar berhenti
 * mengalir selama `stallTimeout`, atau melewati batas ukuran wajar.
 */
export const fetchImage = async (url, referer) =>
  imageLimiter(new URL(url).host)(async () => {
    const { timeout, stallTimeout, maxImageBytes } = config.worker;
    const kontrol = new AbortController();
    let jam = null;
    let macet = false;

    const pasangJam = (ms, alasan) => {
      clearTimeout(jam);
      jam = setTimeout(() => {
        macet = true;
        kontrol.abort(new Error(alasan));
      }, ms);
    };

    pasangJam(timeout, `tidak ada respons dalam ${Math.round(timeout / 1000)} detik`);

    try {
      const res = await politeFetch(url, {
        accept: 'image/*',
        referer,
        kind: 'image',
        signal: kontrol.signal,
      });

      // Sebagian CDN komik menyajikan gambar sebagai application/octet-stream,
      // atau tanpa Content-Type sama sekali. Menolak berdasarkan header saja
      // membuang berkas yang sebenarnya sah; yang benar-benar menentukan adalah
      // isi buffer, dan itu sudah diperiksa lewat magic byte saat kompresi.
      // Yang ditolak di sini hanya yang jelas bukan gambar: halaman error HTML.
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (/^text\/|html|json|xml/.test(type)) {
        throw new Error(`Bukan gambar (${type}): ${url}`);
      }

      // Tolak lebih awal kalau server sudah mengaku ukurannya di luar batas.
      const diakui = Number(res.headers.get('content-length'));
      if (Number.isFinite(diakui) && diakui > maxImageBytes) {
        throw new Error(`Gambar terlalu besar (${formatByte(diakui)}): ${url}`);
      }

      const potongan = [];
      let total = 0;
      const pembaca = res.body.getReader();
      pasangJam(stallTimeout, `unduhan mandek lebih dari ${Math.round(stallTimeout / 1000)} detik`);

      for (;;) {
        const { done, value } = await pembaca.read();
        if (done) break;
        potongan.push(value);
        total += value.length;
        if (total > maxImageBytes) {
          await pembaca.cancel();
          throw new Error(`Gambar terlalu besar (>${formatByte(maxImageBytes)}): ${url}`);
        }
        // Data masih mengalir — jam dimulai ulang, sebesar apa pun berkasnya.
        pasangJam(stallTimeout, `unduhan mandek lebih dari ${Math.round(stallTimeout / 1000)} detik`);
      }

      return Buffer.concat(potongan);
    } catch (error) {
      // Pesan bawaan ("The operation was aborted") tidak menjelaskan apa pun.
      if (macet) throw new Error(`${kontrol.signal.reason?.message ?? 'waktu habis'}: ${url}`);
      throw error;
    } finally {
      clearTimeout(jam);
    }
  });

export default { politeFetch, fetchHtml, fetchImage };

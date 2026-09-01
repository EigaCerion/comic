import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// apps/api
export const API_ROOT = path.resolve(__dirname, '../..');
// root repo (naruread-app)
export const REPO_ROOT = path.resolve(API_ROOT, '../..');

// .env lokal apps/api menang, lalu fallback ke .env root repo.
dotenv.config({ path: path.join(API_ROOT, '.env.local') });
dotenv.config({ path: path.join(API_ROOT, '.env') });
dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
};

export const DATA_DIR = path.resolve(API_ROOT, process.env.DATA_DIR || './data');

// Satu-satunya folder di luar DATA_DIR yang boleh dibaca API. Semua path import
// wajib berada di dalamnya — tanpa ini endpoint import jadi "baca file apa saja".
export const IMPORT_DIR = path.resolve(API_ROOT, process.env.IMPORT_DIR || './import');

export const config = {
  env: process.env.NODE_ENV || 'development',
  // API_PORT diprioritaskan: sebagian tool dev (mis. task runner) menyuntik PORT
  // untuk frontend, dan API tidak boleh ikut memakai port itu.
  port: num(process.env.API_PORT ?? process.env.PORT, 3000),

  dataDir: DATA_DIR,
  importDir: IMPORT_DIR,
  dbPath: path.join(DATA_DIR, 'comics.db'),
  comicsDir: path.join(DATA_DIR, 'comics'),
  cacheDir: path.join(DATA_DIR, 'cache'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  logsDir: path.join(API_ROOT, 'logs'),

  image: {
    format: process.env.IMAGE_FORMAT || 'webp',
    quality: num(process.env.IMAGE_QUALITY, 75),
    maxWidth: num(process.env.IMAGE_MAX_WIDTH, 1600),
    maxHeight: num(process.env.IMAGE_MAX_HEIGHT, 2560),
    concurrency: num(process.env.COMPRESSION_CONCURRENCY, 4),
    // effort & grayscale: diukur lewat `npm run bench:compress` — pada halaman
    // uji keduanya hanya menghemat 0,2-0,5pp tapi 2x lebih lambat, jadi default
    // dibiarkan murah. Naikkan sendiri kalau CPU sedang tidak dipakai.
    effort: num(process.env.IMAGE_EFFORT, 4),
    autoGrayscale: bool(process.env.IMAGE_AUTO_GRAYSCALE, false),
    // gambar yang sudah efisien disimpan apa adanya, tanpa re-encode
    passthrough: bool(process.env.IMAGE_PASSTHROUGH, true),
    passthroughBytesPerPixel: Number(process.env.IMAGE_PASSTHROUGH_BPP ?? 0.35),
  },

  worker: {
    enabled: bool(process.env.WORKER_ENABLED, true),
    // Jumlah "bot importir" yang menarik job dari antrian secara bersamaan.
    importers: num(process.env.IMPORTER_WORKERS, 5),
    // Jumlah "bot pengawas" yang memeriksa kelengkapan hasil import.
    supervisors: num(process.env.SUPERVISOR_WORKERS, 3),
    supervisorSweepMs: num(process.env.SUPERVISOR_SWEEP_MS, 5 * 60 * 1000),
    concurrency: num(process.env.DOWNLOAD_CONCURRENCY, 2),
    // Batas untuk fase koneksi/header. TIDAK membatasi lamanya unduhan body:
    // halaman webtoon bisa berukuran 8 MB dan butuh belasan detik walau sehat.
    timeout: num(process.env.DOWNLOAD_TIMEOUT, 30_000),
    // Batas "mandek": waktu maksimum TANPA data masuk. Selama byte masih
    // mengalir, unduhan besar dibiarkan selesai.
    stallTimeout: num(process.env.DOWNLOAD_STALL_TIMEOUT, 20_000),
    // Pengaman supaya satu berkas raksasa tidak menghabiskan memori.
    maxImageBytes: num(process.env.IMAGE_MAX_BYTES, 48 * 1024 * 1024),
    // Percobaan ulang per GAMBAR, bukan per chapter: satu gangguan sesaat tidak
    // boleh membuang chapter yang sudah 99% selesai.
    imageRetry: num(process.env.IMAGE_RETRY, 3),
    maxAttempts: num(process.env.DOWNLOAD_MAX_ATTEMPTS, 3),
    pollInterval: num(process.env.WORKER_POLL_INTERVAL, 1500),
    // Jeda minimum antar request ke host yang sama, plus kepatuhan robots.txt.
    // Halaman HTML dijeda lebih lama (jarang, dan itu yang dipantau situs);
    // gambar boleh lebih cepat dan paralel — itulah bagian yang jumlahnya ratusan.
    requestDelayMs: num(process.env.REQUEST_DELAY_MS, 750),
    imageDelayMs: num(process.env.IMAGE_REQUEST_DELAY_MS, 150),
    imageConcurrency: num(process.env.IMAGE_CONCURRENCY, 4),
    respectRobots: bool(process.env.RESPECT_ROBOTS, true),
    userAgent: process.env.USER_AGENT || 'NaruReader/0.1 (+local personal library)',
  },

  // Gambar (poster & halaman) hampir selalu dilayani CDN dengan domain lain.
  // Kalau halaman sumbernya sudah lolos allowlist, gambar yang dirujuknya ikut
  // diizinkan — penjagaan localhost/IP privat tetap berlaku.
  allowReferencedImageHosts: bool(process.env.ALLOW_REFERENCED_IMAGE_HOSTS, true),

  allowedSourceDomains: (process.env.ALLOWED_SOURCE_DOMAINS ??
    'komiku.org,komikpedia.net,webtoons.com,siikomik.net,ngomik.cc')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),

  // Batas upload manual
  upload: {
    maxFileSize: num(process.env.UPLOAD_MAX_FILE_SIZE, 25 * 1024 * 1024),
    maxPages: num(process.env.UPLOAD_MAX_PAGES, 400),
  },
};

export default config;

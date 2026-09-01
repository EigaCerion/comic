import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import config, { API_ROOT } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { getDb, initSchema } from './db/index.js';
import { HttpError } from './utils/validators.js';
import routes from './routes/index.js';
import { bacaSesi } from './middleware/auth.js';
import { siapkanSuperAdmin } from './services/authService.js';

const log = createLogger('naruread:api');

export const createApp = () => {
  // pastikan folder data ada sebelum apa pun menyentuhnya
  [config.dataDir, config.comicsDir, config.cacheDir, config.backupsDir].forEach((dir) =>
    fs.mkdirSync(dir, { recursive: true }),
  );
  initSchema(getDb());
  siapkanSuperAdmin(); // idempotent: hanya membuat kalau akunnya belum ada

  const app = express();

  app.use(
    helmet({
      // App lokal: gambar & dev server di origin lain harus tetap bisa memuat media.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );
  // credentials: true wajib ada — tanpa itu cookie sesi tidak ikut terkirim
  // saat frontend dijalankan dari dev server di port yang berbeda.
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, _res, next) => {
    log.debug(`${req.method} ${req.originalUrl}`);
    next();
  });

  // Menempelkan req.user bila ada sesi sah. Sengaja tidak menolak tamu:
  // membaca komik tetap terbuka tanpa akun.
  app.use(bacaSesi);

  /**
   * Gambar komik disajikan read-only — HANYA dari folder komik.
   *
   * Sebelumnya akarnya adalah DATA_DIR, dan itu lubang yang menghancurkan:
   * di dalam DATA_DIR ada comics.db, comics.db-wal, dan seluruh isi backups/.
   * Artinya siapa pun yang bisa menjangkau port ini dapat mengunduh database
   * lengkap tanpa login — termasuk tabel sessions, yang tokennya bisa langsung
   * dipasang sebagai cookie untuk menjadi super admin. Seluruh sistem login di
   * aplikasi ini bisa dilewati hanya dengan satu permintaan GET.
   *
   * Akarnya sekarang comicsDir. Semua URL yang dihasilkan aplikasi memang sudah
   * berbentuk /media/comics/... (dicek: 27 dari 27 cover dan semua halaman),
   * jadi tidak ada tautan yang putus — yang hilang hanya akses ke berkas yang
   * memang tidak pernah boleh disajikan.
   */
  app.use(
    '/media/comics',
    express.static(config.comicsDir, {
      index: false,
      dotfiles: 'deny',
      maxAge: '30d',
      immutable: true,
      setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'),
    }),
  );

  app.use('/api', routes);

  // Mode satu port: kalau frontend sudah di-build, sajikan dari sini juga.
  // Praktis untuk dibuka dari HP — cukup satu port yang perlu dijangkau.
  //
  // Keberadaan dist diperiksa per request, bukan sekali saat start: server
  // sering dinyalakan sebelum `npm run build` pertama, dan sebaliknya build
  // baru harus langsung tersaji tanpa perlu restart.
  const webDist = path.resolve(API_ROOT, '../web/dist');
  const indexHtml = path.join(webDist, 'index.html');

  app.use(express.static(webDist, { index: false, maxAge: '1h', fallthrough: true }));

  // SPA fallback: /read/12 dan /import harus tetap membuka index.html saat
  // di-refresh, tapi jangan menelan 404 dari /api atau /media.
  app.get(/^(?!\/(api|media)\/).*/, (req, res, next) => {
    if (req.method !== 'GET' || req.accepts('html') !== 'html') return next();
    if (!fs.existsSync(indexHtml)) return next();
    res.sendFile(indexHtml);
  });

  log.info(
    fs.existsSync(indexHtml)
      ? `frontend build disajikan dari ${webDist}`
      : `frontend build belum ada (${webDist}) — jalankan \`npm run build\`, tanpa perlu restart`,
  );

  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan', path: req.originalUrl });
  });

  // error handler terakhir
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: `Upload gagal: ${error.message}`, code: error.code });
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) log.error(error);
    else log.debug(`${status}: ${error.message}`);

    res.status(status).json({
      error: error.message || 'Terjadi kesalahan internal',
      ...(error.details ? { details: error.details } : {}),
    });
  });

  return app;
};

export default createApp;

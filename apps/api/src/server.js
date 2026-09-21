#!/usr/bin/env node
import http from 'node:http';
import config from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { closeDb } from './db/index.js';
import createApp from './app.js';
import { startWorker, stopWorker } from './jobs/downloadQueue.js';
import { startSupervisors, stopSupervisors } from './jobs/supervisorPool.js';
import { startMdns, stopMdns } from './services/connectService.js';

const log = createLogger('naruread:server');

/**
 * Apakah port ini sudah dilayani NaruReader juga?
 *
 * Memakai http.get dengan `agent: false` — bukan fetch — supaya tidak ada socket
 * keep-alive yang menggantung. Socket sisa dari undici membuat libuv assert
 * ("UV_HANDLE_CLOSING") kalau prosesnya langsung diakhiri setelah probe.
 */
const probeExistingApi = (port) =>
  new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', agent: false, timeout: 1500 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed?.service === 'naruread-api' ? parsed : null);
          } catch {
            resolve(null);
          }
        });
      },
    );

    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });

const start = () => {
  const app = createApp();

  const server = app.listen(config.port, () => {
    log.info(`API siap di http://localhost:${config.port}`);
    startMdns();
    log.info(`data dir: ${config.dataDir}`);
    if (config.worker.enabled) {
      startWorker();
      startSupervisors();
    } else {
      log.info('worker dimatikan (WORKER_ENABLED=false)');
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      log.error(`Port ${config.port} sudah dipakai proses lain.`);
      log.error(`  Lihat pemakainya : netstat -ano | findstr :${config.port}`);
      log.error('  Hentikan         : taskkill /PID <pid> /F');
      log.error('  Atau pakai port lain: API_PORT=3001 npm run start --workspace apps/api');
    } else {
      log.error(error);
    }
    process.exitCode = 1;
    server.close();
  });

  const shutdown = (signal) => {
    log.info(`${signal} diterima, menutup server...`);
    stopWorker();
    stopSupervisors();
    stopMdns();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };


  /*
   * Galat yang tidak tertangkap TIDAK BOLEH membuat proses hilang diam-diam.
   *
   * Di Node modern, unhandledRejection mematikan proses secara bawaan. Sebelum
   * ini tidak ada satu pun penangan, jadi satu janji yang gagal di jalur latar
   * — pekerja unduhan, sapuan pengawas, cek update — cukup untuk mematikan
   * server. Dan karena aplikasi kini diakses dari jaringan lain, pemiliknya
   * baru sadar saat halaman tidak mau terbuka dari jauh, tanpa petunjuk apa pun.
   *
   * Keduanya DICATAT dulu ke berkas, baru keluar dengan kode gagal supaya
   * penyebabnya bisa dilacak sesudahnya.
   */
  process.on('unhandledRejection', (alasan) => {
    log.error('janji gagal tanpa penangan — proses berhenti:', alasan);
    setTimeout(() => process.exit(1), 100).unref();
  });

  process.on('uncaughtException', (galat) => {
    log.error('galat tidak tertangkap — proses berhenti:', galat);
    setTimeout(() => process.exit(1), 100).unref();
  });

  ['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));
};

// Port bentrok adalah kejadian wajar (mis. `npm run dev` masih jalan), jadi
// diperiksa lebih dulu dan dilaporkan sebagai informasi, bukan stack trace.
const existing = await probeExistingApi(config.port);

if (existing) {
  log.info(`NaruReader lain sudah melayani port ${config.port} (uptime ${Math.round(existing.uptime)}s).`);
  log.info('Build frontend terbaru langsung dipakai proses itu — cukup reload di HP/browser.');
  log.info('Kalau ingin proses ini yang jalan: hentikan yang lama (Ctrl+C di terminalnya), lalu ulangi.');
  process.exitCode = 0; // biarkan proses berakhir sendiri, tanpa process.exit()
} else {
  start();
}

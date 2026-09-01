#!/usr/bin/env node
// Worker berdiri sendiri: `npm run start:worker`.
// Pakai ini kalau ingin proses download terpisah dari API (set WORKER_ENABLED=false
// di API supaya tidak ada dua worker memproses antrian yang sama).
import { createLogger } from './utils/logger.js';
import { getDb, initSchema, closeDb } from './db/index.js';
import { startWorker, stopWorker } from './jobs/downloadQueue.js';
import { startSupervisors, stopSupervisors } from './jobs/supervisorPool.js';

const log = createLogger('naruread:worker');

initSchema(getDb());
startWorker();
startSupervisors();
log.info('worker standalone jalan — Ctrl+C untuk berhenti');

// jaga proses tetap hidup
setInterval(() => {}, 1 << 30);

['SIGINT', 'SIGTERM'].forEach((signal) =>
  process.on(signal, () => {
    log.info(`${signal} diterima, worker berhenti`);
    stopWorker();
stopSupervisors();
    closeDb();
    process.exit(0);
  }),
);

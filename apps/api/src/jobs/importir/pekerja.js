/**
 * Putaran bot importir: ambil job berikutnya, kerjakan, ulangi.
 *
 * Yang diurus di sini hanya PENJADWALAN — berapa bot jalan bersamaan, kapan
 * ditengok lagi, dan job yang tertinggal berstatus 'downloading' saat proses
 * sebelumnya mati. Pengerjaan satu job ada di kerjakanJob.js.
 */
import config from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';
import { getDb } from '../../db/index.js';
import { claimNextJob, failJob } from '../../services/downloadService.js';
import { sedangBerhenti, setelBerhenti } from './keadaan.js';
import { processJob } from './kerjakanJob.js';

const log = createLogger('naruread:importir');

let timer = null;
let running = 0;

const tick = async () => {
  if (sedangBerhenti()) return;
  while (running < config.worker.importers) {
    const job = claimNextJob();
    if (!job) break;

    running += 1;
    log.debug(`job ${job.id} mulai (attempt ${job.attempts})`);

    processJob(job)
      .catch((error) => {
        const retryable = job.attempts < config.worker.maxAttempts;
        log.error(`job ${job.id} gagal (${retryable ? 'akan dicoba lagi' : 'menyerah'}):`, error);
        failJob(job.id, error.message, { retryable });
      })
      .finally(() => {
        running -= 1;
      });
  }
};

/** Job yang tertinggal status 'downloading' (mis. app crash) dikembalikan ke pending. */
const recoverStaleJobs = () => {
  const info = getDb()
    .prepare("UPDATE download_queue SET status = 'pending', progress = 0 WHERE status = 'downloading'")
    .run();
  if (info.changes > 0) log.info(`${info.changes} job dipulihkan ke pending`);
};

export const startWorker = () => {
  if (timer) return;
  setelBerhenti(false);
  recoverStaleJobs();
  timer = setInterval(() => {
    tick().catch((error) => log.error('tick error:', error));
  }, config.worker.pollInterval);
  timer.unref?.();
  log.info(
    `${config.worker.importers} bot importir aktif ` +
      `(${config.worker.imageConcurrency} gambar paralel per host)`,
  );
};

export const stopWorker = () => {
  setelBerhenti(true);
  if (timer) clearInterval(timer);
  timer = null;
};

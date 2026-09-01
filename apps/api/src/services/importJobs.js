import { createLogger } from '../utils/logger.js';

const log = createLogger('naruread:import-jobs');

/**
 * Registry job import di memori. Import lokal berjalan sekali jalan dan tidak
 * perlu bertahan setelah restart (file sumbernya masih ada), jadi tidak
 * dimasukkan ke tabel — beda dengan download_queue yang harus tahan mati listrik.
 */
const jobs = new Map();
const MAX_KEPT = 30;
let nextId = 1;

const prune = () => {
  if (jobs.size <= MAX_KEPT) return;
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => a.id - b.id);
  while (jobs.size > MAX_KEPT && finished.length) jobs.delete(finished.shift().id);
};

export const listImportJobs = () => [...jobs.values()].sort((a, b) => b.id - a.id).slice(0, MAX_KEPT);

export const getImportJob = (id) => jobs.get(Number(id)) ?? null;

/**
 * Jalankan pekerjaan import di background dan kembalikan job-nya segera,
 * supaya HTTP request tidak menggantung selama ratusan halaman dikompresi.
 */
export const runImportJob = ({ label, run }) => {
  const job = {
    id: nextId++,
    label,
    status: 'running',
    currentLabel: null,
    pagesDone: 0,
    pagesTotal: 0,
    chaptersDone: 0,
    comic: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  prune();

  const onProgress = (update) => {
    if (update.label !== undefined && update.label !== job.currentLabel) {
      if (job.currentLabel) job.chaptersDone += 1;
      job.currentLabel = update.label;
      job.pagesDone = 0;
    }
    if (update.pagesTotal !== undefined) job.pagesTotal = update.pagesTotal;
    if (update.pagesDone !== undefined) job.pagesDone = update.pagesDone;
  };

  Promise.resolve(run(onProgress))
    .then((result) => {
      job.status = 'completed';
      job.comic = result?.comic ?? null;
      job.chaptersDone = result?.chapters?.length ?? job.chaptersDone;
      job.currentLabel = null;
    })
    .catch((error) => {
      job.status = 'failed';
      job.error = error.message;
      log.error(`import job ${job.id} gagal:`, error);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });

  return job;
};

export default { runImportJob, listImportJobs, getImportJob };

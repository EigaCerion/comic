import path from 'node:path';
import pLimit from 'p-limit';
import { getDb } from '../db/index.js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchHtml, fetchImage } from '../utils/httpClient.js';
import { sanitizeSourceUrl } from '../utils/validators.js';
import { chapterDir, replacePages } from '../services/chapterService.js';
import { compressToFile, pageFilename } from '../services/compressionService.js';
import { extractChapterPages } from '../services/sources/index.js';
import { ensureCover } from '../services/coverService.js';
import { verifyPageFile } from '../services/auditService.js';
import { notifyChapterDone } from './supervisorPool.js';
import {
  claimNextJob,
  completeJob,
  failJob,
  updateJobProgress,
} from '../services/downloadService.js';

const log = createLogger('naruread:queue');

let timer = null;
let running = 0;
let stopped = false;

/** Job boleh membawa daftar gambar, atau hanya URL halaman chapter. */
const resolveImageUrls = async (job) => {
  const payload = JSON.parse(job.payload || '{}');
  if (payload.image_urls?.length) {
    return {
      urls: payload.image_urls,
      referer: payload.chapter_url,
      cadangan: payload.host_fallbacks ?? {},
    };
  }

  if (!payload.chapter_url) throw new Error('Job tanpa image_urls maupun chapter_url');

  const { html, finalUrl } = await fetchHtml(payload.chapter_url);
  const { imageUrls, extractor, hostFallbacks } = extractChapterPages(html, finalUrl);
  if (!imageUrls.length) {
    throw new Error(
      `Tidak ada gambar terdeteksi di ${payload.chapter_url} — perbaiki selector host ini di sources/selectors.json`,
    );
  }

  // URL ini berasal dari halaman yang sudah lolos allowlist, jadi CDN gambarnya
  // ikut dipercaya (localhost/IP privat tetap ditolak).
  const clean = imageUrls.map((url) => sanitizeSourceUrl(url, { anyPublicHost: true })).filter(Boolean);
  if (!clean.length) throw new Error('Semua URL gambar hasil ekstraksi tidak valid');

  // Simpan hasil ekstraksi supaya retry tidak perlu parse ulang dan UI tahu totalnya.
  getDb()
    .prepare('UPDATE download_queue SET payload = ? WHERE id = ?')
    .run(
      JSON.stringify({ ...payload, image_urls: clean, extractor, host_fallbacks: hostFallbacks ?? {} }),
      job.id,
    );

  log.debug(`job ${job.id}: ${clean.length} gambar via ${extractor}`);
  return { urls: clean, referer: payload.chapter_url, cadangan: hostFallbacks ?? {} };
};

const jeda = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Unduh satu halaman, dengan percobaan ulang untuk halaman itu saja.
 *
 * Sebelumnya satu gambar yang gagal langsung menggagalkan seluruh job, sehingga
 * chapter dengan 82 halaman dibuang gara-gara halaman ke-1 lambat — 81 berkas
 * lain sudah ada di disk tapi tidak pernah tercatat. Sekarang kegagalan sesaat
 * dicoba ulang di tempat, dan kalau tetap gagal pesannya menyebut nomor halaman
 * serta URL-nya supaya bisa langsung ditelusuri.
 */
/**
 * Daftar URL yang layak dicoba untuk satu halaman: URL aslinya lebih dulu, lalu
 * hasil penukaran host sesuai peta yang diumumkan halaman sumber.
 *
 * Ada chapter yang host utamanya benar-benar mati (semua variasi nama berkas
 * menjawab 404) sementara host cadangannya melayani berkas itu dengan normal.
 * Tanpa mencoba cadangan, chapter seperti itu jadi jalan buntu permanen.
 */
const daftarKandidat = (url, cadangan) => {
  const kandidat = [url];
  Object.entries(cadangan ?? {}).forEach(([dari, ke]) => {
    if (!url.includes(dari)) return;
    const alternatif = url.split(dari).join(ke);
    if (!kandidat.includes(alternatif)) kandidat.push(alternatif);
  });
  return kandidat;
};

/**
 * Unduh satu halaman, dengan percobaan ulang untuk halaman itu saja.
 *
 * Sebelumnya satu gambar yang gagal langsung menggagalkan seluruh job, sehingga
 * chapter dengan 82 halaman dibuang gara-gara halaman ke-1 lambat — 81 berkas
 * lain sudah ada di disk tapi tidak pernah tercatat. Sekarang kegagalan sesaat
 * dicoba ulang di tempat, dan kalau tetap gagal pesannya menyebut nomor halaman
 * serta URL-nya supaya bisa langsung ditelusuri.
 */
const unduhHalaman = async (url, referer, target, nomor, cadangan) => {
  const maksimal = Math.max(1, config.worker.imageRetry);
  const kandidat = daftarKandidat(url, cadangan);
  let terakhir = null;

  for (let percobaan = 1; percobaan <= maksimal; percobaan += 1) {
    for (const alamat of kandidat) {
      try {
        const buffer = await fetchImage(alamat, referer);
        const hasil = await compressToFile(buffer, target);
        if (alamat !== url) log.info(`halaman ${nomor}: dipakai host cadangan ${new URL(alamat).host}`);
        return hasil;
      } catch (error) {
        if (stopped) throw error;
        terakhir = error;
      }
    }
    if (percobaan < maksimal) {
      log.warn(`halaman ${nomor} gagal (percobaan ${percobaan}/${maksimal}): ${terakhir?.message}`);
      await jeda(1000 * percobaan); // beri napas ke server sumber
    }
  }

  const dicoba = kandidat.length > 1 ? ` (${kandidat.length} host dicoba)` : '';
  throw new Error(`Halaman ${nomor} gagal setelah ${maksimal} percobaan${dicoba} — ${terakhir?.message ?? 'sebab tidak diketahui'} (${url})`);
};

const processJob = async (job) => {
  const db = getDb();
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(job.chapter_id);
  const comic = db.prepare('SELECT slug FROM comics WHERE id = ?').get(job.comic_id);
  if (!chapter || !comic) throw new Error('Chapter atau komik sudah dihapus');

  const { urls, referer, cadangan } = await resolveImageUrls(job);

  const dir = chapterDir(comic.slug, chapter.slug);

  // Unduh + kompresi beberapa halaman sekaligus: unduhan halaman berikutnya
  // berjalan sementara halaman sekarang dikompresi. Batas per host tetap
  // dijaga di httpClient, jadi ini tidak membanjiri server sumber.
  const limit = pLimit(Math.max(1, config.worker.imageConcurrency));
  let done = 0;
  let dilanjutkan = 0;

  const results = await Promise.all(
    urls.map((url, index) =>
      limit(async () => {
        if (stopped) throw new Error('Worker dihentikan');
        const target = path.join(dir, pageFilename(index + 1));

        // Pemulihan setelah jaringan putus: halaman yang berkasnya sudah utuh
        // tidak diunduh ulang. Berkas ditulis atomik (.part -> rename), jadi
        // yang ada di disk pasti lengkap, bukan potongan.
        const existing = await verifyPageFile(target);
        if (existing.ok) {
          dilanjutkan += 1;
          done += 1;
          updateJobProgress(job.id, (done / urls.length) * 100);
          return {
            filename: path.basename(target),
            image_size: existing.size,
            original_size: null,
            compression_ratio: null,
            hash: null,
            page_number: index + 1,
          };
        }

        const result = await unduhHalaman(url, referer, target, index + 1, cadangan);
        done += 1;
        updateJobProgress(job.id, (done / urls.length) * 100);
        return { ...result, page_number: index + 1 };
      }),
    ),
  );

  const pages = results.sort((a, b) => a.page_number - b.page_number);

  replacePages(chapter.id, pages);
  await ensureCover(job.comic_id); // grid jangan sampai kosong tanpa poster
  completeJob(job.id);
  notifyChapterDone(job.comic_id); // serahkan ke bot pengawas untuk diperiksa

  const lanjut = dilanjutkan > 0 ? ` (${dilanjutkan} halaman dipakai ulang dari unduhan sebelumnya)` : '';
  log.info(`job ${job.id} selesai: ${pages.length} halaman -> ${comic.slug}/${chapter.slug}${lanjut}`);
};

const tick = async () => {
  if (stopped) return;
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
  stopped = false;
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
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
};

export default { startWorker, stopWorker };

import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { getDb } from '../db/index.js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchHtml, fetchImage } from '../utils/httpClient.js';
import { safeJoin, sanitizeSourceUrl } from '../utils/validators.js';
import { chapterDir, replacePages } from '../services/chapterService.js';
import { compressToFile, pageFilename } from '../services/compressionService.js';
import { extractChapterPages } from '@naruread/sumber';
import '../utils/sumberLogger.js';
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
  const paksaUlang = payload.paksa_ulang === true;
  if (payload.image_urls?.length) {
    return {
      urls: payload.image_urls,
      referer: payload.chapter_url,
      cadangan: payload.host_fallbacks ?? {},
      paksaUlang,
    };
  }

  if (!payload.chapter_url) throw new Error('Job tanpa image_urls maupun chapter_url');

  const { html, finalUrl } = await fetchHtml(payload.chapter_url);
  const { imageUrls, extractor, hostFallbacks } = extractChapterPages(html, finalUrl);
  if (!imageUrls.length) {
    throw new Error(
      `Tidak ada gambar terdeteksi di ${payload.chapter_url} — perbaiki selector host ini di packages/sumber/selectors.js`,
    );
  }

  // URL ini berasal dari halaman yang sudah lolos allowlist, jadi CDN gambarnya
  // ikut dipercaya (localhost/IP privat tetap ditolak).
  const clean = imageUrls.map((url) => sanitizeSourceUrl(url, { anyPublicHost: true })).filter(Boolean);
  if (!clean.length) throw new Error('Semua URL gambar hasil ekstraksi tidak valid');

  // Simpan hasil ekstraksi supaya retry tidak perlu parse ulang dan UI tahu totalnya.
  // Payload lama WAJIB ikut disebar: paksa_ulang ada di sana, dan kalau hilang
  // di sini, percobaan kedua sebuah penggantian akan diam-diam memakai ulang
  // berkas lama.
  getDb()
    .prepare('UPDATE download_queue SET payload = ? WHERE id = ?')
    .run(
      JSON.stringify({ ...payload, image_urls: clean, extractor, host_fallbacks: hostFallbacks ?? {} }),
      job.id,
    );

  log.debug(`job ${job.id}: ${clean.length} gambar via ${extractor}`);
  return { urls: clean, referer: payload.chapter_url, cadangan: hostFallbacks ?? {}, paksaUlang };
};

const jeda = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// Nama berkas halaman buatan compressToFile: 001.webp, atau 001.jpg/.avif/...
// saat byte aslinya disimpan apa adanya.
const POLA_BERKAS_HALAMAN = /^\d{3,}\.(webp|jpe?g|png|avif|gif)$/i;
const SUBFOLDER_GANTI = '.ganti';
const SUBFOLDER_LAMA = '.lama';

/**
 * Pasang halaman pengganti dengan cara yang bisa dipulihkan.
 *
 * Menimpa berkas satu per satu lalu baru memperbarui tabel pages meninggalkan
 * celah: kalau replacePages gagal (mis. database terkunci), folder sudah berisi
 * halaman baru sementara tabel masih mencatat daftar lama — pembaca melihat
 * separuh chapter dari situs baru disambung separuh dari situs lama. Karena itu
 * seluruh halaman lama dipindah ke subfolder .lama lebih dulu. Kalau pemasangan
 * atau pencatatan gagal, halaman baru dibuang dan halaman lama dikembalikan
 * utuh. Ini melindungi dari galat, bukan dari listrik padam; untuk kasus itu
 * .lama tetap tertinggal dan bisa dikembalikan manual.
 *
 * Seluruh halaman lama ikut dibuang saat berhasil, bukan hanya yang tertimpa:
 * sumber pengganti jarang punya jumlah halaman yang sama (69 lawan 35), dan
 * ekstensinya pun bisa beda — 032.jpg lama tidak boleh tertinggal di samping
 * 032.webp yang baru.
 */
const pasangHasilGanti = async (dir, dirGanti, chapterId, pages) => {
  const dirLama = path.join(dir, SUBFOLDER_LAMA);
  await fs.rm(dirLama, { recursive: true, force: true });
  await fs.mkdir(dirLama, { recursive: true });

  const lama = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((entri) => entri.isFile() && POLA_BERKAS_HALAMAN.test(entri.name))
    .map((entri) => entri.name);
  const dipindahkan = [];
  const dipasang = [];

  try {
    for (const nama of lama) {
      await fs.rename(path.join(dir, nama), path.join(dirLama, nama));
      dipindahkan.push(nama);
    }
    for (const page of pages) {
      await fs.rename(path.join(dirGanti, page.filename), path.join(dir, page.filename));
      dipasang.push(page.filename);
    }
    replacePages(chapterId, pages);
  } catch (error) {
    for (const nama of dipasang) await fs.rm(path.join(dir, nama), { force: true });
    for (const nama of dipindahkan) await fs.rename(path.join(dirLama, nama), path.join(dir, nama));
    await fs.rm(dirLama, { recursive: true, force: true });
    await fs.rm(dirGanti, { recursive: true, force: true });
    throw error;
  }
  return lama.length;
};

/**
 * Buang tulisan job yang chapternya dihapus di tengah unduhan. Folder hanya
 * dibuang kalau memang tidak ada lagi yang memilikinya: komik dengan slug yang
 * sama bisa saja sudah diimpor ulang sebelum job lama ini selesai.
 */
const buangSisaTerhapus = async (comicSlug, chapterSlug) => {
  const db = getDb();
  const chapterMasihDimiliki = db
    .prepare('SELECT 1 FROM chapters ch JOIN comics c ON c.id = ch.comic_id WHERE c.slug = ? AND ch.slug = ?')
    .get(comicSlug, chapterSlug);
  if (!chapterMasihDimiliki) await fs.rm(chapterDir(comicSlug, chapterSlug), { recursive: true, force: true });
  if (!db.prepare('SELECT 1 FROM comics WHERE slug = ?').get(comicSlug)) {
    await fs.rm(safeJoin(config.comicsDir, comicSlug), { recursive: true, force: true });
  }
};

const processJob = async (job) => {
  const db = getDb();
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(job.chapter_id);
  const comic = db.prepare('SELECT slug FROM comics WHERE id = ?').get(job.comic_id);
  if (!chapter || !comic) throw new Error('Chapter atau komik sudah dihapus');

  // Komik atau chapter bisa dihapus selagi job ini berjalan. Baris antreannya
  // ikut hilang lewat ON DELETE CASCADE, tapi halaman yang sedang diunduh tetap
  // ditulis — compressToFile membuat ulang foldernya — dan tertinggal sebagai
  // folder yatim yang tidak tercatat di mana pun. Begitulah 122 berkas komik
  // yang sudah dihapus pernah tertinggal di disk.
  const masihAda = () => Boolean(db.prepare('SELECT 1 FROM chapters WHERE id = ?').get(chapter.id));
  const galatDihapus = () => new Error('Chapter atau komik dihapus saat sedang diunduh');

  const { urls, referer, cadangan, paksaUlang } = await resolveImageUrls(job);

  const dir = chapterDir(comic.slug, chapter.slug);

  // Penggantian ditulis ke subfolder dulu, tidak langsung menimpa halaman lama.
  // Sumber pengganti hampir selalu memotong strip dengan cara lain, jadi kalau
  // unduhan putus di tengah, menimpa di tempat meninggalkan chapter campuran:
  // separuh halaman dari situs baru, sisanya dari situs lama, dengan alur yang
  // tidak lagi nyambung. Lewat subfolder, versi lama tetap utuh terbaca sampai
  // versi baru lengkap. Sisa percobaan yang gagal dibuang dulu karena isinya
  // bisa berasal dari permintaan ganti lain.
  const dirTulis = paksaUlang ? path.join(dir, SUBFOLDER_GANTI) : dir;
  if (paksaUlang) await fs.rm(dirTulis, { recursive: true, force: true });

  // Unduh + kompresi beberapa halaman sekaligus: unduhan halaman berikutnya
  // berjalan sementara halaman sekarang dikompresi. Batas per host tetap
  // dijaga di httpClient, jadi ini tidak membanjiri server sumber.
  const limit = pLimit(Math.max(1, config.worker.imageConcurrency));
  let done = 0;
  let dilanjutkan = 0;
  let gantiGagal = false;

  const tugas = urls.map((url, index) =>
    limit(async () => {
      if (stopped) throw new Error('Worker dihentikan');
      if (gantiGagal) throw new Error('Penggantian dihentikan karena halaman lain gagal');
      if (!masihAda()) throw galatDihapus();
      const target = path.join(dirTulis, pageFilename(index + 1));

      // Pemulihan setelah jaringan putus: halaman yang berkasnya sudah utuh
      // tidak diunduh ulang. Berkas ditulis atomik (.part -> rename), jadi
      // yang ada di disk pasti lengkap, bukan potongan. Penggantian justru
      // HARUS melewati ini: berkas yang ada adalah gambar rusak yang hendak
      // dibuang, dan memakainya ulang membuat job "selesai" tanpa mengganti apa pun.
      const existing = paksaUlang ? { ok: false } : await verifyPageFile(target);
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
  );

  let results;
  try {
    results = await Promise.all(tugas);
  } catch (error) {
    const dihapus = !masihAda();
    if (paksaUlang || dihapus) {
      // Sisa halaman penggantian yang gagal tidak perlu diunduh: percobaan
      // berikutnya mulai dari subfolder kosong, jadi hasilnya pasti dibuang.
      // Subfolder baru dihapus setelah tugas yang sedang berjalan selesai —
      // kalau dihapus lebih dulu, tugas itu menulisnya kembali. Hal yang sama
      // berlaku untuk chapter yang sudah dihapus.
      gantiGagal = true;
      await Promise.allSettled(tugas);
      if (paksaUlang) await fs.rm(dirTulis, { recursive: true, force: true });
      if (dihapus) await buangSisaTerhapus(comic.slug, chapter.slug);
    }
    throw error;
  }

  if (!masihAda()) {
    await buangSisaTerhapus(comic.slug, chapter.slug);
    throw galatDihapus();
  }

  const pages = results.sort((a, b) => a.page_number - b.page_number);

  let dibuang = 0;
  if (paksaUlang) {
    dibuang = await pasangHasilGanti(dir, dirTulis, chapter.id, pages);

    // Tautan baru baru ditulis sekarang, setelah halamannya benar-benar
    // terpasang dan tercatat (lihat enqueueChapterDownload). Penggantian lewat
    // daftar URL gambar saja tidak punya halaman chapter, jadi tautan lama tetap.
    if (referer) db.prepare('UPDATE chapters SET source_url = ? WHERE id = ?').run(referer, chapter.id);

    // Gagal membersihkan di sini hanya soal ruang disk — menggagalkan job
    // karenanya akan mengulang seluruh unduhan untuk chapter yang sudah benar.
    try {
      await fs.rm(path.join(dir, SUBFOLDER_LAMA), { recursive: true, force: true });
      await fs.rm(dirTulis, { recursive: true, force: true });
    } catch (error) {
      log.warn(`job ${job.id}: sisa versi lama gagal dibersihkan: ${error.message}`);
    }
  } else {
    replacePages(chapter.id, pages);
  }

  await ensureCover(job.comic_id); // grid jangan sampai kosong tanpa poster
  completeJob(job.id);
  notifyChapterDone(job.comic_id); // serahkan ke bot pengawas untuk diperiksa

  const lanjut = dilanjutkan > 0 ? ` (${dilanjutkan} halaman dipakai ulang dari unduhan sebelumnya)` : '';
  const ganti = paksaUlang ? ` (unduh ulang paksa, ${dibuang} berkas sisa versi lama dibuang)` : '';
  log.info(`job ${job.id} selesai: ${pages.length} halaman -> ${comic.slug}/${chapter.slug}${lanjut}${ganti}`);
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

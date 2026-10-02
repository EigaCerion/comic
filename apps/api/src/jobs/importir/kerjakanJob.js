/**
 * Mengerjakan SATU job antrean dari awal sampai tercatat: ambil daftar gambar,
 * unduh tiap halaman, pasang hasilnya, catat ke database, lapor ke pengawas.
 *
 * Inti bot importir. Sengaja satu fungsi panjang dan BUKAN dipecah lebih jauh:
 * urutan langkahnya adalah jaminan keutuhan data (berkas dulu, tabel kemudian,
 * katalog paling akhir), dan memecahnya jadi beberapa fungsi membuat urutan itu
 * bisa ditukar tanpa ada yang menyadarinya.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { getDb } from '../../db/index.js';
import config from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';
import { chapterDir, replacePages } from '../../services/chapterService.js';
import { pageFilename } from '../../services/compressionService.js';
import { ensureCover } from '../../services/coverService.js';
import { verifyPageFile } from '../../services/pengawas/berkasHalaman.js';
import { completeJob, updateJobProgress } from '../../services/downloadService.js';
import { notifyChapterDone } from '../pengawas/index.js';
import { resolveImageUrls } from './alamatGambar.js';
import { unduhHalaman } from './unduhHalaman.js';
import {
  SUBFOLDER_GANTI,
  SUBFOLDER_LAMA,
  buangSisaTerhapus,
  pasangHasilGanti,
} from './folderChapter.js';
import { sedangBerhenti } from './keadaan.js';

const log = createLogger('naruread:importir');

export const processJob = async (job) => {
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
      if (sedangBerhenti()) throw new Error('Worker dihentikan');
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

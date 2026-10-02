/**
 * Tindakan bot pengawas atas temuannya sendiri: antrekan perbaikannya.
 *
 * Dipisah dari pemeriksaan karena inilah satu-satunya bagian pengawas yang
 * MENULIS ke antrean unduh — dan karena itu satu-satunya yang bisa membuat bot
 * importir sibuk. Temuan berjenis 'gap' tidak punya chapter untuk diunduh, jadi
 * ia diserahkan ke sinkronSeri.js yang membaca ulang halaman seri sumbernya.
 */
import { getDb } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import { enqueueChapterDownload } from '../downloadService.js';
import { markQueued, openFindings } from './temuan.js';
import { resyncComic } from './sinkronSeri.js';

const log = createLogger('naruread:pengawas');

/**
 * Perbaiki temuan dengan membuat job baru untuk bot importir. Chapter rusak
 * diunduh ulang dari source_url-nya; nomor yang bolong butuh daftar chapter
 * dari halaman seri, jadi ditangani resyncComic().
 */
export const repairFindings = async (comicId = null) => {
  const findings = openFindings(comicId);
  const db = getDb();
  let queued = 0;
  let alreadyQueued = 0;
  let needSource = 0;
  let resynced = 0;

  // Nomor bolong tidak punya chapter/URL untuk diunduh ulang. Yang bisa
  // menyelesaikannya hanya daftar chapter dari halaman seri, jadi komiknya
  // dikumpulkan dulu lalu di-resync sekali per komik (bukan sekali per temuan).
  const perluResync = new Map();

  for (const finding of findings) {
    if (finding.kind === 'gap' || !finding.chapter_id) {
      perluResync.set(finding.comic_id, [...(perluResync.get(finding.comic_id) ?? []), finding.id]);
      continue;
    }
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(finding.chapter_id);
    if (!chapter?.source_url) {
      needSource += 1;
      continue;
    }
    try {
      enqueueChapterDownload({
        comicId: finding.comic_id,
        chapterNumber: chapter.chapter_number,
        chapterTitle: chapter.chapter_title,
        chapterUrl: chapter.source_url,
        priority: 5, // perbaikan didahulukan
      });
      markQueued(finding.id);
      queued += 1;
    } catch (error) {
      // Umumnya karena chapter itu sudah punya job aktif — bukan kegagalan,
      // tapi tetap dihitung supaya jumlah temuan dan tindakan selalu cocok.
      alreadyQueued += 1;
      markQueued(finding.id);
      log.debug(`chapter ${chapter.chapter_number} sudah ada di antrian: ${error.message}`);
    }
  }

  // Sekarang tangani nomor bolong: bandingkan dengan sumbernya lalu antrekan.
  for (const [comicId, findingIds] of perluResync) {
    try {
      const hasil = await resyncComic(comicId);
      if (hasil.error) {
        needSource += findingIds.length;
        log.debug(`resync komik ${comicId} dilewati: ${hasil.error}`);
        continue;
      }
      queued += hasil.diantre;
      resynced += 1;
      // Temuan ditandai queued hanya kalau chapter-nya benar-benar diantre.
      if (hasil.diantre > 0) findingIds.forEach((id) => markQueued(id));
      else needSource += findingIds.length;
    } catch (error) {
      needSource += findingIds.length;
      log.debug(`resync komik ${comicId} gagal: ${error.message}`);
    }
  }

  return {
    diperiksa: findings.length,
    diantre: queued,
    sudahDiantre: alreadyQueued,
    komikDiresync: resynced,
    butuhSumber: needSource,
  };
};

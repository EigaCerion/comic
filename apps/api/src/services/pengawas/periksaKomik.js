/**
 * Periksa SELURUH chapter sebuah komik, lalu cari nomor yang bolong.
 *
 * Satu tingkat di atas periksaChapter.js: ia yang memutuskan chapter mana saja
 * yang perlu dibaca ulang (lihat `full`), dan yang menutup temuan yang sudah
 * tidak berlaku lagi.
 */
import { getDb } from '../../db/index.js';
import { notFound } from '../../utils/validators.js';
import { auditChapter } from './periksaChapter.js';
import { findGaps } from './lubang.js';
import { resolveFindings, upsertFinding } from './temuan.js';

/** Audit seluruh chapter sebuah komik + deteksi nomor bolong. */
export const auditComic = async (comicId, { full = false } = {}) => {
  const db = getDb();
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  // Sapuan rutin hanya menyentuh chapter yang belum pernah diperiksa atau
  // berubah sejak pemeriksaan terakhir — koleksi besar tidak dipindai ulang.
  const chapters = db
    .prepare(
      full
        ? 'SELECT id FROM chapters WHERE comic_id = ? ORDER BY chapter_number'
        : `SELECT id FROM chapters
             WHERE comic_id = ?
               AND (audited_at IS NULL OR (downloaded_at IS NOT NULL AND audited_at < downloaded_at))
             ORDER BY chapter_number`,
    )
    .all(comicId);

  const results = [];
  for (const row of chapters) {
    const result = await auditChapter(row.id);
    results.push(result);

    // Chapter yang dilewati karena sedang dikerjakan importir BELUM diperiksa.
    // Menutup temuannya di sini sama dengan menyatakan lulus tanpa pemeriksaan.
    if (result.dilewati) continue;

    if (result.ok) {
      resolveFindings(comicId, result.number);
    } else {
      result.issues.forEach((issue) =>
        upsertFinding({
          comicId,
          chapterId: result.chapterId,
          chapterNumber: result.number,
          kind: issue.kind,
          detail: issue.detail,
        }),
      );
    }
  }

  const antreNumbers = new Set(
    db
      .prepare(
        `SELECT ch.chapter_number AS n
           FROM download_queue q JOIN chapters ch ON ch.id = q.chapter_id
          WHERE q.comic_id = ? AND q.status IN ('pending','downloading')`,
      )
      .all(comicId)
      .map((row) => row.n),
  );

  const gaps = findGaps(comicId).filter((number) => !antreNumbers.has(number));
  gaps.forEach((number) =>
    upsertFinding({
      comicId,
      chapterId: null,
      chapterNumber: number,
      kind: 'gap',
      detail: `chapter ${number} tidak ada di koleksi`,
    }),
  );

  return {
    comicId,
    slug: comic.slug,
    diperiksa: results.length,
    bermasalah: results.filter((result) => !result.ok).length,
    gaps,
  };
};

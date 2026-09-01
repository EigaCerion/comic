import fs from 'node:fs/promises';
import { getDb } from '../db/index.js';
import config from '../utils/config.js';
import { badRequest, chapterSlug, notFound, safeJoin } from '../utils/validators.js';
import { getComic, recountChapters, versionOf } from './comicService.js';

export const shapeChapter = (row, comicSlug) => {
  if (!row) return null;
  return {
    id: row.id,
    comicId: row.comic_id,
    number: row.chapter_number,
    title: row.chapter_title,
    slug: row.slug,
    totalPages: row.total_pages ?? 0,
    isDownloaded: Boolean(row.is_downloaded),
    fileSize: row.file_size ?? 0,
    sourceUrl: row.source_url,
    downloadedAt: row.downloaded_at,
    createdAt: row.created_at,
    lastPageRead: row.last_page_read ?? null,
    progressPercentage: row.progress_percentage ?? null,
    readAt: row.read_at ?? null,
    ...(comicSlug ? { comicSlug } : {}),
  };
};

/** Daftar chapter satu komik, plus progress baca per chapter. */
export const listChapters = (comicId, { order = 'asc' } = {}) => {
  const comic = getComic(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  const rows = getDb()
    .prepare(
      `SELECT ch.*, rp.last_page_read, rp.progress_percentage, rp.read_at
         FROM chapters ch
         LEFT JOIN reading_progress rp ON rp.chapter_id = ch.id
        WHERE ch.comic_id = ?
        ORDER BY ch.chapter_number ${order === 'desc' ? 'DESC' : 'ASC'}`,
    )
    .all(comic.id);

  return rows.map((row) => shapeChapter(row, comic.slug));
};

// Sama seperti cover: nama file halaman tetap (001.webp) padahal isinya bisa
// diganti saat chapter diunduh ulang, jadi URL-nya diberi penanda versi.
const pageUrl = (comicSlug, chapterSlugValue, filename, version) =>
  `/media/comics/${comicSlug}/chapters/${chapterSlugValue}/${filename}${version ? `?v=${version}` : ''}`;

/** Chapter + halaman + navigasi prev/next — dipakai halaman Reader. */
export const getChapterWithPages = (chapterId) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ch.*, rp.last_page_read, rp.progress_percentage, rp.read_at
         FROM chapters ch
         LEFT JOIN reading_progress rp ON rp.chapter_id = ch.id
        WHERE ch.id = ?`,
    )
    .get(chapterId);
  if (!row) throw notFound('Chapter tidak ditemukan');

  const comic = getComic(row.comic_id);
  const version = versionOf(row.downloaded_at);
  const pages = db
    .prepare('SELECT * FROM pages WHERE chapter_id = ? ORDER BY page_number ASC')
    .all(row.id)
    .map((page) => ({
      number: page.page_number,
      url: pageUrl(comic.slug, row.slug, page.image_filename, version),
      size: page.image_size,
    }));

  const neighbour = (comparator, order) =>
    db
      .prepare(
        `SELECT id, chapter_number, chapter_title FROM chapters
          WHERE comic_id = ? AND chapter_number ${comparator} ?
          ORDER BY chapter_number ${order} LIMIT 1`,
      )
      .get(row.comic_id, row.chapter_number);

  return {
    ...shapeChapter(row, comic.slug),
    comic,
    pages,
    prev: neighbour('<', 'DESC') ?? null,
    next: neighbour('>', 'ASC') ?? null,
  };
};

/**
 * Buat (atau ambil) chapter kosong. Dipakai upload manual & download queue.
 */
export const ensureChapter = ({ comicId, chapterNumber, chapterTitle, sourceUrl }) => {
  const db = getDb();
  const comic = getComic(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  const number = Number(chapterNumber);
  if (!Number.isFinite(number) || number < 0) throw badRequest('chapter_number tidak valid');

  const existing = db
    .prepare('SELECT * FROM chapters WHERE comic_id = ? AND chapter_number = ?')
    .get(comic.id, number);
  if (existing) {
    if (chapterTitle || sourceUrl) {
      db.prepare(
        `UPDATE chapters
            SET chapter_title = COALESCE(?, chapter_title),
                source_url = COALESCE(?, source_url)
          WHERE id = ?`,
      ).run(chapterTitle || null, sourceUrl || null, existing.id);
    }
    return { chapter: shapeChapter(db.prepare('SELECT * FROM chapters WHERE id = ?').get(existing.id), comic.slug), comic, created: false };
  }

  const info = db
    .prepare(
      `INSERT INTO chapters (comic_id, chapter_number, chapter_title, slug, source_url)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(comic.id, number, chapterTitle || null, chapterSlug(number), sourceUrl || null);

  recountChapters(comic.id);
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(info.lastInsertRowid);
  return { chapter: shapeChapter(chapter, comic.slug), comic, created: true };
};

/** Tulis daftar halaman hasil kompresi ke DB dan tandai chapter selesai. */
export const replacePages = (chapterId, pages) => {
  const db = getDb();
  const run = db.transaction((rows) => {
    db.prepare('DELETE FROM pages WHERE chapter_id = ?').run(chapterId);
    const insert = db.prepare(
      `INSERT INTO pages (chapter_id, page_number, image_filename, image_size, original_size, compression_ratio, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    let bytes = 0;
    rows.forEach((page) => {
      bytes += page.image_size ?? 0;
      insert.run(
        chapterId,
        page.page_number,
        page.filename,
        page.image_size ?? null,
        page.original_size ?? null,
        page.compression_ratio ?? null,
        page.hash ?? null,
      );
    });
    db.prepare(
      `UPDATE chapters
          SET total_pages = ?, file_size = ?, is_downloaded = 1, downloaded_at = datetime('now')
        WHERE id = ?`,
    ).run(rows.length, bytes, chapterId);
  });

  run(pages);
  return getChapterWithPages(chapterId);
};

export const chapterDir = (comicSlug, chapterSlugValue) =>
  safeJoin(config.comicsDir, comicSlug, 'chapters', chapterSlugValue);

export const deleteChapter = async (chapterId) => {
  const db = getDb();
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter) throw notFound('Chapter tidak ditemukan');
  const comic = getComic(chapter.comic_id);

  db.prepare('DELETE FROM chapters WHERE id = ?').run(chapter.id);
  recountChapters(chapter.comic_id);

  await fs.rm(chapterDir(comic.slug, chapter.slug), { recursive: true, force: true });
  return { id: chapter.id };
};

export default {
  listChapters,
  getChapterWithPages,
  ensureChapter,
  replacePages,
  deleteChapter,
  chapterDir,
  shapeChapter,
};

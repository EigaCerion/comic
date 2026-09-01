import { getDb } from '../db/index.js';
import { notFound } from '../utils/validators.js';
import { touchComic } from './comicService.js';

/** Simpan posisi baca terakhir (upsert per comic+chapter). */
export const saveProgress = ({ comicId, chapterId, lastPageRead }) => {
  const db = getDb();
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ? AND comic_id = ?').get(chapterId, comicId);
  if (!chapter) throw notFound('Chapter tidak ditemukan untuk komik ini');

  const page = Math.max(1, Number(lastPageRead) || 1);
  const percentage = chapter.total_pages > 0 ? Number(((page / chapter.total_pages) * 100).toFixed(2)) : 0;

  db.prepare(
    `INSERT INTO reading_progress (comic_id, chapter_id, last_page_read, progress_percentage, read_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(comic_id, chapter_id) DO UPDATE SET
       last_page_read = excluded.last_page_read,
       progress_percentage = excluded.progress_percentage,
       read_at = excluded.read_at`,
  ).run(comicId, chapterId, page, percentage);

  touchComic(comicId);
  return { comicId, chapterId, lastPageRead: page, progressPercentage: percentage };
};

export const getComicProgress = (comicId) =>
  getDb()
    .prepare(
      `SELECT chapter_id, last_page_read, progress_percentage, read_at
         FROM reading_progress WHERE comic_id = ? ORDER BY read_at DESC`,
    )
    .all(comicId)
    .map((row) => ({
      chapterId: row.chapter_id,
      lastPageRead: row.last_page_read,
      progressPercentage: row.progress_percentage,
      readAt: row.read_at,
    }));

export const listBookmarks = ({ comicId } = {}) => {
  const db = getDb();
  const rows = comicId
    ? db
        .prepare(
          `SELECT b.*, c.title AS comic_title, c.slug AS comic_slug, ch.chapter_number
             FROM bookmarks b
             JOIN comics c ON c.id = b.comic_id
             JOIN chapters ch ON ch.id = b.chapter_id
            WHERE b.comic_id = ? ORDER BY b.created_at DESC`,
        )
        .all(comicId)
    : db
        .prepare(
          `SELECT b.*, c.title AS comic_title, c.slug AS comic_slug, ch.chapter_number
             FROM bookmarks b
             JOIN comics c ON c.id = b.comic_id
             JOIN chapters ch ON ch.id = b.chapter_id
            ORDER BY b.created_at DESC LIMIT 200`,
        )
        .all();

  return rows.map((row) => ({
    id: row.id,
    comicId: row.comic_id,
    comicTitle: row.comic_title,
    comicSlug: row.comic_slug,
    chapterId: row.chapter_id,
    chapterNumber: row.chapter_number,
    pageNumber: row.page_number,
    note: row.note,
    createdAt: row.created_at,
  }));
};

export const addBookmark = ({ comicId, chapterId, pageNumber, note }) => {
  const db = getDb();
  const info = db
    .prepare('INSERT INTO bookmarks (comic_id, chapter_id, page_number, note) VALUES (?, ?, ?, ?)')
    .run(comicId, chapterId, pageNumber ?? null, note?.trim() || null);
  return listBookmarks({ comicId }).find((b) => b.id === Number(info.lastInsertRowid));
};

export const deleteBookmark = (id) => {
  const info = getDb().prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  if (info.changes === 0) throw notFound('Bookmark tidak ditemukan');
  return { id: Number(id) };
};

export default { saveProgress, getComicProgress, listBookmarks, addBookmark, deleteBookmark };

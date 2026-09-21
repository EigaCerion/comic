import { getDb } from '../db/index.js';
import { notFound } from '../utils/validators.js';
import { touchComic } from './comicService.js';

/*
 * Riwayat baca dan bookmark adalah DATA PRIBADI.
 *
 * Sebelumnya kedua tabel tidak punya kolom pemilik, sehingga isinya jadi kolam
 * bersama: satu uji membuktikan tamu tanpa akun bisa membuat (201) dan menghapus
 * (200) bookmark milik orang lain, dan bisa menimpa posisi baca siapa pun.
 * Selama aplikasi hanya hidup di Wi-Fi rumah dengan satu pemakai itu tidak
 * terasa; begitu ia punya nama tetap yang bisa dijangkau lintas jaringan, itu
 * jadi lubang yang nyata.
 *
 * Sekarang setiap fungsi WAJIB menerima userId, dan setiap query menyaring
 * dengannya — termasuk penghapusan, supaya id milik orang lain tidak bisa
 * dihapus hanya dengan menebak angkanya.
 */

const wajibPemilik = (userId) => {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    // Bukan galat pengguna melainkan kesalahan pemanggilan: rute yang lupa
    // meneruskan identitas. Digagalkan keras supaya tidak diam-diam menulis
    // baris tanpa pemilik seperti dulu.
    throw new Error('progressService dipanggil tanpa userId — rute wajib meneruskan req.user.id');
  }
  return id;
};

/** Simpan posisi baca terakhir (upsert per pemilik + comic + chapter). */
export const saveProgress = ({ userId, comicId, chapterId, lastPageRead }) => {
  const pemilik = wajibPemilik(userId);
  const db = getDb();
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ? AND comic_id = ?').get(chapterId, comicId);
  if (!chapter) throw notFound('Chapter tidak ditemukan untuk komik ini');

  const page = Math.max(1, Number(lastPageRead) || 1);
  const percentage = chapter.total_pages > 0 ? Number(((page / chapter.total_pages) * 100).toFixed(2)) : 0;

  db.prepare(
    `INSERT INTO reading_progress (user_id, comic_id, chapter_id, last_page_read, progress_percentage, read_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, comic_id, chapter_id) DO UPDATE SET
       last_page_read = excluded.last_page_read,
       progress_percentage = excluded.progress_percentage,
       read_at = excluded.read_at`,
  ).run(pemilik, comicId, chapterId, page, percentage);

  touchComic(comicId);
  return { comicId, chapterId, lastPageRead: page, progressPercentage: percentage };
};

export const getComicProgress = (comicId, userId) => {
  const pemilik = wajibPemilik(userId);
  return getDb()
    .prepare(
      `SELECT chapter_id, last_page_read, progress_percentage, read_at
         FROM reading_progress
        WHERE comic_id = ? AND user_id = ?
        ORDER BY read_at DESC`,
    )
    .all(comicId, pemilik)
    .map((row) => ({
      chapterId: row.chapter_id,
      lastPageRead: row.last_page_read,
      progressPercentage: row.progress_percentage,
      readAt: row.read_at,
    }));
};

export const listBookmarks = ({ comicId, userId } = {}) => {
  const pemilik = wajibPemilik(userId);
  const db = getDb();

  const dasar = `SELECT b.*, c.title AS comic_title, c.slug AS comic_slug, ch.chapter_number
                   FROM bookmarks b
                   JOIN comics c ON c.id = b.comic_id
                   JOIN chapters ch ON ch.id = b.chapter_id
                  WHERE b.user_id = ?`;

  const rows = comicId
    ? db.prepare(`${dasar} AND b.comic_id = ? ORDER BY b.created_at DESC`).all(pemilik, comicId)
    : db.prepare(`${dasar} ORDER BY b.created_at DESC LIMIT 200`).all(pemilik);

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

export const addBookmark = ({ userId, comicId, chapterId, pageNumber, note }) => {
  const pemilik = wajibPemilik(userId);
  const db = getDb();
  const info = db
    .prepare('INSERT INTO bookmarks (user_id, comic_id, chapter_id, page_number, note) VALUES (?, ?, ?, ?, ?)')
    .run(pemilik, comicId, chapterId, pageNumber ?? null, note?.trim() || null);
  return listBookmarks({ comicId, userId: pemilik }).find((b) => b.id === Number(info.lastInsertRowid));
};

export const deleteBookmark = (id, userId) => {
  const pemilik = wajibPemilik(userId);
  // Pemilik ikut jadi syarat, bukan hanya id. Tanpa itu, menebak angka id sudah
  // cukup untuk menghapus bookmark orang lain.
  const info = getDb().prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(id, pemilik);
  if (info.changes === 0) throw notFound('Bookmark tidak ditemukan');
  return { id: Number(id) };
};

export default { saveProgress, getComicProgress, listBookmarks, addBookmark, deleteBookmark };

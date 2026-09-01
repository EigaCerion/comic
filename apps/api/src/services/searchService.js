import { getDb } from '../db/index.js';
import { shapeComic } from './comicService.js';

/** "naruto shi" -> "naruto* shi*" (prefix match, aman untuk FTS5) */
const toFtsQuery = (raw) =>
  raw
    .replace(/["'^*:()-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token}"*`)
    .join(' ');

/**
 * Full-text search via FTS5, fallback ke LIKE kalau query terlalu pendek
 * atau FTS melempar error sintaks.
 */
export const searchComics = (query, limit = 20) => {
  const db = getDb();
  const q = String(query || '').trim();
  if (!q) return [];

  if (q.length >= 2) {
    try {
      const rows = db
        .prepare(
          `SELECT c.*, bm25(comics_fts) AS score
             FROM comics_fts
             JOIN comics c ON c.id = comics_fts.rowid
            WHERE comics_fts MATCH ?
            ORDER BY score
            LIMIT ?`,
        )
        .all(toFtsQuery(q), limit);
      if (rows.length) return rows.map(shapeComic);
    } catch {
      /* fallback ke LIKE di bawah */
    }
  }

  return db
    .prepare(
      `SELECT * FROM comics
        WHERE title LIKE ? OR author LIKE ? OR artist LIKE ?
        ORDER BY title COLLATE NOCASE ASC LIMIT ?`,
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, limit)
    .map(shapeComic);
};

/** Daftar genre unik + jumlah komik, untuk filter di halaman Browse. */
export const listGenres = () => {
  const rows = getDb().prepare('SELECT genres FROM comics WHERE genres IS NOT NULL').all();
  const counts = new Map();

  rows.forEach((row) => {
    let parsed = [];
    try {
      parsed = JSON.parse(row.genres);
    } catch {
      parsed = [];
    }
    parsed.forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
  });

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

/** Rebuild index FTS (dipakai setelah import besar / migrasi). */
export const rebuildSearchIndex = () => {
  getDb().prepare("INSERT INTO comics_fts(comics_fts) VALUES('rebuild')").run();
  return { ok: true };
};

export default { searchComics, listGenres, rebuildSearchIndex };

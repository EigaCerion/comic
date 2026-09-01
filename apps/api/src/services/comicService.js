import fs from 'node:fs/promises';
import { getDb } from '../db/index.js';
import config from '../utils/config.js';
import { badRequest, notFound, parseGenres, safeJoin, slugify } from '../utils/validators.js';

/**
 * URL media diberi penanda versi. Nama file cover selalu `cover.webp`, sementara
 * isinya bisa diganti (poster baru, cover dari halaman 1). Tanpa penanda ini,
 * browser menahan gambar lama sampai 30 hari karena /media dikirim `immutable`.
 */
const mediaUrl = (relPath, version) => {
  if (!relPath) return null;
  const url = `/media/${String(relPath).split('\\').join('/')}`;
  return version ? `${url}?v=${version}` : url;
};

/** Timestamp SQLite -> angka pendek untuk cache-busting. */
export const versionOf = (timestamp) => {
  if (!timestamp) return 0;
  const parsed = Date.parse(`${String(timestamp).replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
};

/** Bentuk row DB -> bentuk yang dipakai frontend */
export const shapeComic = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    author: row.author,
    artist: row.artist,
    genres: row.genres ? JSON.parse(row.genres) : [],
    source: row.source,
    status: row.status,
    rating: row.rating,
    totalChapters: row.total_chapters ?? 0,
    downloadedChapters: row.downloaded_chapters ?? undefined,
    coverUrl: mediaUrl(row.cover_image, versionOf(row.updated_at)),
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReadAt: row.last_read_at,
  };
};

const SORTS = {
  latest: 'c.updated_at DESC',
  created: 'c.created_at DESC',
  alphabetical: 'c.title COLLATE NOCASE ASC',
  rating: 'c.rating DESC NULLS LAST',
  chapters: 'c.total_chapters DESC',
  lastRead: 'c.last_read_at DESC NULLS LAST',
};

/** Daftar komik dengan filter + pagination (semua nilai di-bind, bukan di-interpolasi). */
export const listComics = ({
  page = 1,
  limit = 24,
  search = '',
  genre = '',
  status = '',
  favorite = false,
  sort = 'latest',
} = {}) => {
  const db = getDb();
  const where = [];
  const params = {};

  if (search.trim()) {
    where.push('(c.title LIKE :search OR c.author LIKE :search OR c.artist LIKE :search)');
    params.search = `%${search.trim()}%`;
  }
  if (genre.trim()) {
    where.push('c.genres LIKE :genre');
    params.genre = `%"${genre.trim()}"%`;
  }
  if (status.trim()) {
    where.push('c.status = :status');
    params.status = status.trim();
  }
  if (favorite) where.push('c.is_favorite = 1');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = SORTS[sort] ?? SORTS.latest;
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM comics c ${whereSql}`).get(params).n;

  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id AND ch.is_downloaded = 1)
                AS downloaded_chapters
         FROM comics c
         ${whereSql}
         ORDER BY ${orderSql}
         LIMIT :limit OFFSET :offset`,
    )
    .all({ ...params, limit, offset });

  return {
    items: rows.map(shapeComic),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
};

export const getComic = (idOrSlug) => {
  const db = getDb();
  const isNumeric = /^\d+$/.test(String(idOrSlug));
  const row = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id AND ch.is_downloaded = 1)
                AS downloaded_chapters
         FROM comics c
        WHERE ${isNumeric ? 'c.id = ?' : 'c.slug = ?'}`,
    )
    .get(isNumeric ? Number(idOrSlug) : String(idOrSlug));
  return shapeComic(row);
};

const uniqueSlug = (title, requested) => {
  const db = getDb();
  const base = slugify(requested || title);
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM comics WHERE slug = ?').get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
};

export const createComic = (input) => {
  const db = getDb();
  const title = String(input.title ?? '').trim();
  if (!title) throw badRequest('title wajib diisi');
  if (db.prepare('SELECT 1 FROM comics WHERE title = ?').get(title)) {
    throw badRequest(`Komik "${title}" sudah ada`);
  }

  const slug = uniqueSlug(title, input.slug);
  const info = db
    .prepare(
      `INSERT INTO comics (title, slug, description, cover_image, author, artist, genres, source, status, rating)
       VALUES (@title, @slug, @description, @cover_image, @author, @artist, @genres, @source, @status, @rating)`,
    )
    .run({
      title,
      slug,
      description: input.description?.trim() || null,
      cover_image: input.cover_image || null,
      author: input.author?.trim() || null,
      artist: input.artist?.trim() || null,
      genres: JSON.stringify(parseGenres(input.genres)),
      source: input.source?.trim() || 'manual',
      status: input.status?.trim() || 'Ongoing',
      rating: input.rating !== undefined && input.rating !== '' ? Number(input.rating) : null,
    });

  return getComic(info.lastInsertRowid);
};

const UPDATABLE = {
  title: 'title',
  description: 'description',
  author: 'author',
  artist: 'artist',
  status: 'status',
  rating: 'rating',
  source: 'source',
  cover_image: 'cover_image',
};

export const updateComic = (id, patch) => {
  const db = getDb();
  const existing = getComic(id);
  if (!existing) throw notFound('Komik tidak ditemukan');

  const sets = [];
  const params = { id: existing.id };

  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = :${key}`);
      params[key] = patch[key] === '' ? null : patch[key];
    }
  }
  if (patch.genres !== undefined) {
    sets.push('genres = :genres');
    params.genres = JSON.stringify(parseGenres(patch.genres));
  }
  if (patch.isFavorite !== undefined) {
    sets.push('is_favorite = :is_favorite');
    params.is_favorite = patch.isFavorite ? 1 : 0;
  }
  if (!sets.length) return existing;

  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE comics SET ${sets.join(', ')} WHERE id = :id`).run(params);
  return getComic(existing.id);
};

export const toggleFavorite = (id) => {
  const comic = getComic(id);
  if (!comic) throw notFound('Komik tidak ditemukan');
  return updateComic(comic.id, { isFavorite: !comic.isFavorite });
};

export const touchComic = (id) => {
  getDb().prepare("UPDATE comics SET last_read_at = datetime('now') WHERE id = ?").run(id);
};

export const recountChapters = (comicId) => {
  getDb()
    .prepare(
      `UPDATE comics
          SET total_chapters = (SELECT COUNT(*) FROM chapters WHERE comic_id = ?),
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(comicId, comicId);
};

/** Hapus komik + semua file gambarnya. */
export const deleteComic = async (id) => {
  const comic = getComic(id);
  if (!comic) throw notFound('Komik tidak ditemukan');

  getDb().prepare('DELETE FROM comics WHERE id = ?').run(comic.id);

  const dir = safeJoin(config.comicsDir, comic.slug);
  await fs.rm(dir, { recursive: true, force: true });

  return { id: comic.id, slug: comic.slug };
};

/** Untuk halaman Home: komik yang sedang dibaca. */
export const continueReading = (limit = 8) => {
  const rows = getDb()
    .prepare(
      `SELECT c.*, rp.last_page_read, rp.progress_percentage, rp.read_at,
              ch.id AS chapter_id, ch.chapter_number, ch.chapter_title, ch.total_pages
         FROM reading_progress rp
         JOIN comics c ON c.id = rp.comic_id
         JOIN chapters ch ON ch.id = rp.chapter_id
        WHERE rp.read_at = (SELECT MAX(read_at) FROM reading_progress WHERE comic_id = rp.comic_id)
        ORDER BY rp.read_at DESC
        LIMIT ?`,
    )
    .all(limit);

  return rows.map((row) => ({
    comic: shapeComic(row),
    chapter: {
      id: row.chapter_id,
      number: row.chapter_number,
      title: row.chapter_title,
      totalPages: row.total_pages,
    },
    lastPageRead: row.last_page_read,
    progressPercentage: row.progress_percentage,
    readAt: row.read_at,
  }));
};

export default {
  listComics,
  getComic,
  createComic,
  updateComic,
  deleteComic,
  toggleFavorite,
  touchComic,
  recountChapters,
  continueReading,
  shapeComic,
};

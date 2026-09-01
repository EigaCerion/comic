import { getDb } from '../db/index.js';
import { badRequest, notFound, sanitizeSourceUrl } from '../utils/validators.js';
import { ensureChapter } from './chapterService.js';
import { getComic } from './comicService.js';

const shapeJob = (row) => ({
  id: row.id,
  comicId: row.comic_id,
  comicTitle: row.comic_title,
  comicSlug: row.comic_slug,
  chapterId: row.chapter_id,
  chapterNumber: row.chapter_number,
  chapterTitle: row.chapter_title,
  status: row.status,
  priority: row.priority,
  progress: row.progress ?? 0,
  attempts: row.attempts ?? 0,
  totalPages: row.payload ? (JSON.parse(row.payload).image_urls?.length ?? 0) : 0,
  error: row.error,
  createdAt: row.created_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

const JOB_SELECT = `
  SELECT q.*, c.title AS comic_title, c.slug AS comic_slug,
         ch.chapter_number, ch.chapter_title
    FROM download_queue q
    JOIN comics c ON c.id = q.comic_id
    JOIN chapters ch ON ch.id = q.chapter_id`;

export const listJobs = ({ status = '' } = {}) => {
  const db = getDb();
  // Urutan penting: dengan ratusan job menunggu, LIMIT 200 berbasis id saja
  // membuat job yang SEDANG berjalan (id-nya lebih tua) terdorong keluar daftar
  // — antriannya jalan, tapi di layar tidak ada satu pun progress yang terlihat.
  const ORDER = `ORDER BY CASE q.status
                   WHEN 'downloading' THEN 0
                   WHEN 'failed' THEN 1
                   WHEN 'paused' THEN 2
                   WHEN 'pending' THEN 3
                   ELSE 4 END, q.id DESC
                 LIMIT 200`;

  const rows = status
    ? db.prepare(`${JOB_SELECT} WHERE q.status = ? ${ORDER}`).all(status)
    : db.prepare(`${JOB_SELECT} ${ORDER}`).all();

  const counts = db
    .prepare('SELECT status, COUNT(*) AS n FROM download_queue GROUP BY status')
    .all()
    .reduce((acc, row) => ({ ...acc, [row.status]: row.n }), {});

  return { items: rows.map(shapeJob), counts };
};

export const getJob = (id) => {
  const row = getDb().prepare(`${JOB_SELECT} WHERE q.id = ?`).get(id);
  return row ? shapeJob(row) : null;
};

/**
 * Tambah job download chapter. Dua bentuk payload:
 *  - `imageUrls`: daftar URL gambar yang sudah diketahui
 *  - `chapterUrl`: URL halaman chapter; worker yang mengekstrak daftar gambarnya
 *    saat job diproses (jadi import 100 chapter tidak perlu 100 request di depan)
 * Semua URL divalidasi terhadap allowlist domain (anti-SSRF).
 */
export const enqueueChapterDownload = ({
  comicId,
  chapterNumber,
  chapterTitle,
  imageUrls,
  chapterUrl,
  sourceUrl,
  priority = 0,
}) => {
  const db = getDb();
  const comic = getComic(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  const urls = Array.isArray(imageUrls) ? imageUrls : [];
  const safeChapterUrl = chapterUrl ? sanitizeSourceUrl(chapterUrl) : null;

  if (!urls.length && !safeChapterUrl) {
    if (chapterUrl) {
      throw badRequest('chapter_url ditolak: domain tidak ada di ALLOWED_SOURCE_DOMAINS');
    }
    throw badRequest('Butuh image_urls atau chapter_url');
  }

  const clean = [];
  const rejected = [];
  urls.forEach((url) => {
    const safe = sanitizeSourceUrl(url);
    if (safe) clean.push(safe);
    else rejected.push(url);
  });
  if (urls.length > 0 && clean.length === 0 && !safeChapterUrl) {
    throw badRequest('Semua URL ditolak: domain tidak ada di ALLOWED_SOURCE_DOMAINS', { rejected });
  }

  const { chapter } = ensureChapter({
    comicId: comic.id,
    chapterNumber,
    chapterTitle,
    sourceUrl: safeChapterUrl ?? sanitizeSourceUrl(sourceUrl) ?? null,
  });

  const active = db
    .prepare("SELECT id FROM download_queue WHERE chapter_id = ? AND status IN ('pending','downloading','paused')")
    .get(chapter.id);
  if (active) throw badRequest('Chapter ini sudah ada di antrian download');

  const payload = JSON.stringify({
    ...(clean.length ? { image_urls: clean } : {}),
    ...(safeChapterUrl ? { chapter_url: safeChapterUrl } : {}),
  });

  // Job lama yang gagal DIPAKAI ULANG, bukan ditinggalkan lalu ditambah baris
  // baru. Tanpa ini setiap penekanan Perbaikan/Resync menumpuk satu baris gagal
  // lagi untuk chapter yang sama — satu chapter pernah punya 43 job, dan dua job
  // yang jalan bersamaan saling menimpa berkas.
  const gagalSebelumnya = db
    .prepare("SELECT id FROM download_queue WHERE chapter_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1")
    .get(chapter.id);

  if (gagalSebelumnya) {
    db.prepare(
      `UPDATE download_queue
          SET status = 'pending', progress = 0, attempts = 0, error = NULL,
              priority = ?, payload = ?, started_at = NULL, completed_at = NULL
        WHERE id = ?`,
    ).run(Number(priority) || 0, payload, gagalSebelumnya.id);
    return { job: getJob(gagalSebelumnya.id), rejected };
  }

  const info = db
    .prepare(
      `INSERT INTO download_queue (comic_id, chapter_id, status, priority, payload)
       VALUES (?, ?, 'pending', ?, ?)`,
    )
    .run(comic.id, chapter.id, Number(priority) || 0, payload);

  return { job: getJob(info.lastInsertRowid), rejected };
};

export const retryJob = (id) => {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE download_queue
          SET status = 'pending', progress = 0, attempts = 0, error = NULL,
              started_at = NULL, completed_at = NULL
        WHERE id = ? AND status IN ('failed','paused')`,
    )
    .run(id);
  if (info.changes === 0) throw badRequest('Job tidak bisa di-retry (status bukan failed/paused)');
  return getJob(id);
};

export const cancelJob = (id) => {
  const info = getDb()
    .prepare("DELETE FROM download_queue WHERE id = ? AND status != 'downloading'").run(id);
  if (info.changes === 0) throw badRequest('Job sedang berjalan atau tidak ditemukan');
  return { id: Number(id) };
};

export const pauseQueue = () => {
  const info = getDb().prepare("UPDATE download_queue SET status = 'paused' WHERE status = 'pending'").run();
  return { paused: info.changes };
};

export const resumeQueue = () => {
  const info = getDb().prepare("UPDATE download_queue SET status = 'pending' WHERE status = 'paused'").run();
  return { resumed: info.changes };
};

export const clearFinished = () => {
  const info = getDb().prepare("DELETE FROM download_queue WHERE status IN ('completed','failed')").run();
  return { removed: info.changes };
};

/** Dipakai worker: ambil satu job pending dengan prioritas tertinggi (atomic). */
export const claimNextJob = () => {
  const db = getDb();
  const claim = db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM download_queue WHERE status = 'pending' ORDER BY priority DESC, id ASC LIMIT 1")
      .get();
    if (!row) return null;
    db.prepare(
      `UPDATE download_queue
          SET status = 'downloading', started_at = datetime('now'), attempts = attempts + 1, error = NULL
        WHERE id = ?`,
    ).run(row.id);
    return { ...row, attempts: (row.attempts ?? 0) + 1 };
  });
  return claim();
};

export const updateJobProgress = (id, progress) => {
  getDb().prepare('UPDATE download_queue SET progress = ? WHERE id = ?').run(Number(progress.toFixed(2)), id);
};

export const completeJob = (id) => {
  getDb()
    .prepare("UPDATE download_queue SET status = 'completed', progress = 100, completed_at = datetime('now') WHERE id = ?")
    .run(id);
};

export const failJob = (id, message, { retryable }) => {
  getDb()
    .prepare(
      // progress ikut direset saat job dikembalikan ke antrian: tanpa ini bar
      // progres masih menunjukkan sisa persentase percobaan sebelumnya.
      `UPDATE download_queue
          SET status = ?,
              error = ?,
              progress = CASE WHEN ? THEN 0 ELSE progress END,
              completed_at = CASE WHEN ? THEN NULL ELSE datetime('now') END
        WHERE id = ?`,
    )
    .run(
      retryable ? 'pending' : 'failed',
      String(message).slice(0, 500),
      retryable ? 1 : 0,
      retryable ? 1 : 0,
      id,
    );
};

export default {
  listJobs,
  getJob,
  enqueueChapterDownload,
  retryJob,
  cancelJob,
  pauseQueue,
  resumeQueue,
  clearFinished,
  claimNextJob,
  updateJobProgress,
  completeJob,
  failJob,
};

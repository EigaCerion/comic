/**
 * Buku catatan bot pengawas: tabel audit_findings.
 *
 * Satu temuan = satu masalah yang ditemukan pada satu chapter (berkas hilang,
 * berkas nol byte, jumlah halaman tidak cocok, nomor chapter bolong). Berkas
 * ini hanya mengurus PENCATATANNYA — yang menemukan ada di periksaChapter.js
 * dan periksaKomik.js, yang memperbaiki ada di perbaiki.js.
 *
 * Dipisah karena tiga pemakainya butuh bagian yang berbeda: pemeriksa hanya
 * menulis, pemperbaiki hanya membaca yang masih terbuka, dan layar Pengawas
 * hanya butuh ringkasannya.
 */
import { getDb } from '../../db/index.js';
import { notFound } from '../../utils/validators.js';

export const upsertFinding = ({ comicId, chapterId, chapterNumber, kind, detail }) => {
  getDb()
    .prepare(
      `INSERT INTO audit_findings (comic_id, chapter_id, chapter_number, kind, detail, status)
       VALUES (@comicId, @chapterId, @chapterNumber, @kind, @detail, 'open')
       ON CONFLICT(comic_id, chapter_number, kind) DO UPDATE SET
         detail = excluded.detail,
         chapter_id = excluded.chapter_id,
         status = CASE WHEN audit_findings.status = 'resolved' THEN 'open' ELSE audit_findings.status END,
         resolved_at = NULL`,
    )
    .run({
      comicId,
      chapterId: chapterId ?? null,
      chapterNumber: chapterNumber ?? null,
      kind,
      detail,
    });
};

export const resolveFindings = (comicId, chapterNumber) => {
  getDb()
    .prepare(
      `UPDATE audit_findings SET status = 'resolved', resolved_at = datetime('now')
        WHERE comic_id = ? AND chapter_number IS ? AND status != 'resolved'`,
    )
    .run(comicId, chapterNumber ?? null);
};

/**
 * Temuan dianggap masih perlu ditangani kalau statusnya 'open', ATAU sudah
 * 'queued' tapi job perbaikannya tidak lagi aktif (gagal permanen / dibatalkan).
 * Tanpa syarat kedua, satu job yang gagal membuat temuannya hilang selamanya
 * dari daftar dan tidak pernah diperbaiki lagi.
 */
const MASIH_TERBUKA = `(
  audit_findings.status = 'open'
  OR (
    audit_findings.status = 'queued'
    AND NOT EXISTS (
      SELECT 1 FROM download_queue q
       WHERE q.chapter_id = audit_findings.chapter_id
         AND q.status IN ('pending', 'downloading', 'paused')
    )
  )
)`;

export const openFindings = (comicId = null) => {
  const db = getDb();
  return comicId
    ? db
        .prepare(`SELECT * FROM audit_findings WHERE ${MASIH_TERBUKA} AND comic_id = ? ORDER BY id`)
        .all(comicId)
    : db.prepare(`SELECT * FROM audit_findings WHERE ${MASIH_TERBUKA} ORDER BY id LIMIT 500`).all();
};

export const markQueued = (id) => {
  getDb().prepare("UPDATE audit_findings SET status = 'queued' WHERE id = ?").run(id);
};

/**
 * Tutup satu temuan secara manual. Untuk kasus yang memang tidak bisa
 * diselesaikan sistem — mis. chapter yang hilang di semua sumber yang kita
 * punya — supaya daftar temuan tidak menyimpan pekerjaan yang mustahil.
 */
export const dismissFinding = (id, alasan) => {
  const info = getDb()
    .prepare(
      `UPDATE audit_findings
          SET status = 'resolved', resolved_at = datetime('now'),
              detail = COALESCE(?, detail) || ' (ditutup manual)'
        WHERE id = ? AND status != 'resolved'`,
    )
    .run(alasan ?? null, id);
  if (info.changes === 0) throw notFound('Temuan tidak ditemukan atau sudah ditutup');
  return { id, status: 'resolved' };
};

/** Ringkasan untuk UI. */
export const auditSummary = () => {
  const db = getDb();
  const perJenis = db
    .prepare(`SELECT kind, COUNT(*) AS jumlah FROM audit_findings WHERE ${MASIH_TERBUKA} GROUP BY kind`)
    .all();
  const terakhir = db
    .prepare(
      `SELECT f.*, c.title AS comic_title, c.slug AS comic_slug
         FROM audit_findings f JOIN comics c ON c.id = f.comic_id
        WHERE f.status != 'resolved'
        ORDER BY f.id DESC LIMIT 20`,
    )
    .all();
  const belumDiperiksa = db
    .prepare('SELECT COUNT(*) AS n FROM chapters WHERE is_downloaded = 1 AND audited_at IS NULL')
    .get().n;

  return {
    totalTerbuka: perJenis.reduce((sum, row) => sum + row.jumlah, 0),
    perJenis,
    belumDiperiksa,
    terakhir,
  };
};

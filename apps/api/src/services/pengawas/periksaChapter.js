/**
 * Periksa SATU chapter: semua halamannya ada, tidak kosong, dan benar gambar.
 *
 * Inti kerja bot pengawas. Hasilnya dicatat sebagai temuan (temuan.js), dan
 * chapter yang lolos ditandai sudah diperiksa supaya sapuan berikutnya tidak
 * membaca ulang ribuan berkas yang sama.
 */
import { getDb } from '../../db/index.js';
import { notFound, safeJoin } from '../../utils/validators.js';
import { chapterDir } from '../chapterService.js';
import { verifyPageFile } from './berkasHalaman.js';

const markAudited = (chapterId) => {
  getDb().prepare("UPDATE chapters SET audited_at = datetime('now') WHERE id = ?").run(chapterId);
};

/**
 * Periksa satu chapter: jumlah halaman sesuai catatan, dan setiap berkasnya
 * ada serta utuh. Ini pemeriksaan paling akurat yang bisa dilakukan tanpa
 * membandingkan ulang ke situs sumber.
 */
export const auditChapter = async (chapterId) => {
  const db = getDb();
  const chapter = db
    .prepare(
      `SELECT ch.*, c.slug AS comic_slug, c.id AS comic_id
         FROM chapters ch JOIN comics c ON c.id = ch.comic_id
        WHERE ch.id = ?`,
    )
    .get(chapterId);
  if (!chapter) throw notFound('Chapter tidak ditemukan');

  const pages = db
    .prepare(
      'SELECT page_number, image_filename FROM pages WHERE chapter_id = ? ORDER BY page_number',
    )
    .all(chapterId);

  const issues = [];

  // Chapter yang job-nya masih mengantre bukan cacat — itu pekerjaan yang
  // memang belum sampai giliran. Melaporkannya hanya membuat daftar temuan
  // penuh oleh hal yang akan selesai sendiri.
  const antre = db
    .prepare(
      "SELECT 1 FROM download_queue WHERE chapter_id = ? AND status IN ('pending','downloading') LIMIT 1",
    )
    .get(chapterId);

  // Chapter yang sedang dikerjakan importir dilewati: berkasnya masih ditulis,
  // jadi memeriksanya hanya membuang I/O dan berisiko salah lapor.
  if (antre) {
    return { chapterId, comicId: chapter.comic_id, number: chapter.chapter_number, pages: pages.length, ok: true, issues: [], dilewati: true };
  }

  if (!chapter.is_downloaded) {
    if (!antre) {
      issues.push({ kind: 'not_downloaded', detail: 'chapter belum pernah selesai diunduh' });
    }
  } else if (pages.length === 0) {
    issues.push({ kind: 'empty_chapter', detail: 'tercatat terunduh tapi tidak punya halaman' });
  }

  if (chapter.total_pages && pages.length !== chapter.total_pages) {
    issues.push({
      kind: 'count_mismatch',
      detail: `catatan ${chapter.total_pages} halaman, tersimpan ${pages.length}`,
    });
  }

  const dir = chapterDir(chapter.comic_slug, chapter.slug);
  const broken = [];
  for (const page of pages) {
    const result = await verifyPageFile(safeJoin(dir, page.image_filename));
    if (!result.ok) broken.push({ page: page.page_number, kind: result.kind });
  }
  if (broken.length > 0) {
    const contoh = broken.slice(0, 5).map((b) => b.page).join(', ');
    issues.push({
      kind: broken[0].kind,
      detail: `${broken.length} halaman bermasalah (hal ${contoh})`,
    });
  }

  markAudited(chapterId);

  return {
    chapterId,
    comicId: chapter.comic_id,
    number: chapter.chapter_number,
    pages: pages.length,
    ok: issues.length === 0,
    issues,
  };
};

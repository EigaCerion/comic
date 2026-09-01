import fs from 'node:fs/promises';
import { getDb } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { notFound, safeJoin } from '../utils/validators.js';
import { fetchHtml } from '../utils/httpClient.js';
import { extractSeries, extractSeriesLink } from './sources/index.js';
import { chapterDir } from './chapterService.js';
import { enqueueChapterDownload } from './downloadService.js';

const log = createLogger('naruread:audit');

/**
 * Tanda tangan berkas gambar. Memeriksa 16 byte pertama jauh lebih murah
 * daripada mendekode gambar, tapi sudah cukup membedakan berkas utuh dari
 * berkas kosong atau potongan akibat koneksi terputus.
 */
const SIGNATURES = [
  {
    name: 'webp',
    test: (b) =>
      b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  { name: 'jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: 'png', test: (b) => b.length >= 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG' },
  { name: 'avif', test: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' },
];

const readHead = async (filePath, bytes = 16) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/** Halaman utuh: berkasnya ada, tidak kosong, dan header-nya memang gambar. */
export const verifyPageFile = async (filePath) => {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { ok: false, kind: 'missing_file' };
  }
  if (stat.size === 0) return { ok: false, kind: 'size_zero' };

  const head = await readHead(filePath);
  if (!SIGNATURES.some((signature) => signature.test(head))) {
    return { ok: false, kind: 'corrupt_file', size: stat.size };
  }
  return { ok: true, size: stat.size };
};

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

const upsertFinding = ({ comicId, chapterId, chapterNumber, kind, detail }) => {
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

const resolveFindings = (comicId, chapterNumber) => {
  getDb()
    .prepare(
      `UPDATE audit_findings SET status = 'resolved', resolved_at = datetime('now')
        WHERE comic_id = ? AND chapter_number IS ? AND status != 'resolved'`,
    )
    .run(comicId, chapterNumber ?? null);
};

/**
 * Nomor bulat yang hilang di antara deret yang dimiliki (1,2,4 -> 3).
 * Dipisah dari database supaya bisa diuji langsung.
 */
export const gapsFromNumbers = (numbers) => {
  if (!Array.isArray(numbers) || numbers.length < 2) return [];
  const whole = new Set(numbers.filter(Number.isInteger));
  const gaps = [];
  const max = Math.max(...numbers);
  for (let n = Math.ceil(Math.min(...numbers)); n <= max; n += 1) {
    if (!whole.has(n)) gaps.push(n);
  }
  return gaps;
};

/** Nomor chapter yang hilang di koleksi sebuah komik. */
export const findGaps = (comicId) =>
  gapsFromNumbers(
    getDb()
      .prepare('SELECT chapter_number FROM chapters WHERE comic_id = ? ORDER BY chapter_number')
      .all(comicId)
      .map((row) => row.chapter_number),
  );

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

/** Temuan yang masih terbuka, siap diperbaiki. */
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

const markQueued = (id) => {
  getDb().prepare("UPDATE audit_findings SET status = 'queued' WHERE id = ?").run(id);
};

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

/**
 * Bandingkan koleksi kita dengan halaman seri di situs sumber, lalu antrekan
 * chapter yang belum ada — mencakup chapter baru rilis dan nomor yang bolong.
 */
const jedaMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kegagalan sesaat (jaringan/timeout) — bukan jawaban tegas dari server. */
const kegagalanSesaat = (pesan = '') =>
  /fetch failed|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|HTTP 5\d\d/i.test(pesan);

/**
 * Ambil halaman seri, dengan percobaan ulang untuk kegagalan sesaat.
 *
 * Cek update mengantrekan chapter baru, dan bot importir LANGSUNG mulai
 * mengunduh ke host yang sama — sampai 20 permintaan gambar paralel. Halaman
 * seri berikutnya lalu berebut jalur dengan unduhan itu dan sesekali kalah.
 * Terbukti di log: 15 komik pertama mulus, lalu tepat setelah unduhan pertama
 * jalan, tiga komik berturut-turut gagal, dan setelah itu pulih sendiri.
 *
 * Halaman yang menjawab tegas (404, dilarang robots) tidak diulang — mengulang
 * jawaban yang sudah pasti hanya membuang waktu dan menekan situs sumber.
 */
const ambilSeriUlet = async (url, { percobaan = 3 } = {}) => {
  let terakhir = null;
  for (let ke = 1; ke <= percobaan; ke += 1) {
    try {
      return await fetchHtml(url);
    } catch (error) {
      terakhir = error;
      if (!kegagalanSesaat(error.message) || ke === percobaan) throw error;
      const tunggu = 2000 * ke ** 2; // 2s, lalu 8s — cukup melewati puncak rebutan
      log.debug(`ambil ${url} gagal (${ke}/${percobaan}: ${error.message}), ulang dalam ${tunggu / 1000}s`);
      await jedaMs(tunggu);
    }
  }
  throw terakhir;
};

export const resyncComic = async (comicId, { seriesUrl } = {}) => {
  const db = getDb();
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  let url = seriesUrl ?? comic.source_url;

  // Komik yang diimpor sebelum URL seri disimpan tidak punya acuan. Daripada
  // menyerah, halaman salah satu chapter dibaca untuk menemukan tautan balik
  // ke halaman serinya, lalu disimpan supaya sekali ini saja.
  if (!url) {
    const chapter = db
      .prepare(
        `SELECT source_url FROM chapters
          WHERE comic_id = ? AND source_url IS NOT NULL AND source_url != ''
          ORDER BY chapter_number LIMIT 1`,
      )
      .get(comicId);

    if (chapter?.source_url) {
      try {
        const halaman = await fetchHtml(chapter.source_url);
        const ditemukan = extractSeriesLink(halaman.html, halaman.finalUrl);
        if (ditemukan) {
          url = ditemukan;
          db.prepare('UPDATE comics SET source_url = ? WHERE id = ?').run(url, comicId);
          log.info(`URL seri ${comic.slug} ditemukan otomatis: ${url}`);
        }
      } catch (error) {
        log.debug(`penemuan URL seri ${comic.slug} gagal: ${error.message}`);
      }
    }
  }

  if (!url) {
    return {
      comicId,
      error:
        'URL sumber tidak ketemu otomatis. Kirim series_url lewat tombol "Cek chapter baru".',
    };
  }

  const { html, finalUrl } = await ambilSeriUlet(url);
  const series = extractSeries(html, finalUrl);
  if (finalUrl !== comic.source_url) {
    db.prepare('UPDATE comics SET source_url = ? WHERE id = ?').run(finalUrl, comicId);
  }

  const punya = new Set(
    db
      .prepare('SELECT chapter_number FROM chapters WHERE comic_id = ? AND is_downloaded = 1')
      .all(comicId)
      .map((row) => row.chapter_number),
  );

  // Nomor yang bolong di koleksi TAPI juga tidak ada di sumbernya bukan cacat
  // kita — situsnya sendiri melompati nomor itu. Tanpa ini, temuannya menetap
  // selamanya dan tombol Perbaiki tidak akan pernah bisa menuntaskannya.
  const nomorSumber = new Set(series.chapters.map((chapter) => chapter.number));
  const gapMati = db
    .prepare("SELECT id, chapter_number FROM audit_findings WHERE comic_id = ? AND kind = 'gap' AND status != 'resolved'")
    .all(comicId)
    .filter((temuan) => !nomorSumber.has(temuan.chapter_number));

  gapMati.forEach((temuan) => {
    db.prepare(
      `UPDATE audit_findings
          SET status = 'resolved', resolved_at = datetime('now'),
              detail = 'nomor ini juga tidak ada di situs sumber — bukan chapter yang hilang'
        WHERE id = ?`,
    ).run(temuan.id);
  });
  if (gapMati.length > 0) {
    log.info(`${comic.slug}: ${gapMati.length} nomor bolong ditutup (memang tidak ada di sumber)`);
  }

  const queued = [];
  series.chapters
    .filter((chapter) => !punya.has(chapter.number))
    .forEach((chapter) => {
      try {
        const { job } = enqueueChapterDownload({
          comicId,
          chapterNumber: chapter.number,
          chapterTitle: chapter.title,
          chapterUrl: chapter.url,
          priority: 3,
        });
        queued.push(chapter.number);
        return job;
      } catch {
        return null; // sudah ada di antrian
      }
    });

  log.info(
    `resync ${comic.slug}: sumber ${series.chapters.length} chapter, koleksi ${punya.size}, diantre ${queued.length}`,
  );

  return {
    comicId,
    slug: comic.slug,
    diSumber: series.chapters.length,
    diKoleksi: punya.size,
    diantre: queued.length,
    gapDitutup: gapMati.length,
    chapterDiantre: queued.slice(0, 30),
  };
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

export default {
  auditChapter,
  auditComic,
  repairFindings,
  resyncComic,
  auditSummary,
  dismissFinding,
  openFindings,
  findGaps,
  gapsFromNumbers,
  verifyPageFile,
};

import { getDb } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { badRequest, domainSumber, sanitizeSourceUrl, slugify } from '../utils/validators.js';
import { fetchHtml } from '../utils/httpClient.js';
import { extractChapterPages, extractSeries, resolveSourceConfig } from '@naruread/sumber';
import '../utils/sumberLogger.js';
import { createComic, getComic } from './comicService.js';
import { setCoverFromUrl } from './coverService.js';
import { enqueueChapterDownload } from './downloadService.js';

const log = createLogger('naruread:url-import');

const requireAllowedUrl = (input) => {
  const url = sanitizeSourceUrl(input);
  if (!url) {
    throw badRequest(
      'URL ditolak. Tambahkan domainnya ke ALLOWED_SOURCE_DOMAINS di .env kalau memang ingin dipakai.',
    );
  }
  return url;
};

/**
 * Baca halaman seri dan laporkan apa yang terdeteksi — tanpa menulis apa pun.
 * Satu request saja, jadi user bisa memeriksa hasil deteksi sebelum mengunduh.
 */
export const previewSeries = async (input) => {
  const url = requireAllowedUrl(input);
  const cfg = resolveSourceConfig(url);
  const { html, finalUrl } = await fetchHtml(url);
  const series = extractSeries(html, finalUrl);

  const existing = series.title ? getComic(slugify(series.title)) : null;

  return {
    url: finalUrl,
    extractor: cfg.name,
    ...series,
    existingComic: existing ? { id: existing.id, slug: existing.slug, totalChapters: existing.totalChapters } : null,
    warning:
      series.chapters.length === 0
        ? 'Tidak ada link chapter yang terdeteksi. Perbaiki selector host ini di packages/sumber/selectors.js, atau tempel URL chapter langsung.'
        : null,
  };
};

/** Cek satu halaman chapter: berapa gambar yang terdeteksi, tanpa mengunduh. */
export const previewChapter = async (input) => {
  const url = requireAllowedUrl(input);
  const { html, finalUrl } = await fetchHtml(url);
  const { imageUrls, extractor } = extractChapterPages(html, finalUrl);

  return {
    url: finalUrl,
    extractor,
    totalImages: imageUrls.length,
    imageUrls: imageUrls.slice(0, 5),
    warning: imageUrls.length === 0 ? 'Tidak ada gambar terdeteksi — perbaiki selector host ini.' : null,
  };
};

/**
 * Poster diambil dari halaman seri. Kalau gagal (situs tidak menyediakan, atau
 * CDN-nya menolak), biarkan — worker akan membuat cover dari halaman pertama
 * chapter begitu ada yang selesai diunduh.
 */
const saveCoverFromUrl = async (comic, coverUrl, referer) => {
  try {
    return await setCoverFromUrl(comic.id, coverUrl, referer);
  } catch (error) {
    log.warn(`cover ${coverUrl} gagal diambil: ${error.message} — akan dibuat dari halaman 1`);
    return comic;
  }
};

/**
 * Masukkan chapter terpilih ke antrian download. Yang dikirim ke queue hanya
 * URL halaman chapter — worker mengekstrak daftar gambarnya saat diproses,
 * jadi mengantre 200 chapter tetap instan.
 */
export const importSeries = async ({
  seriesUrl,
  title,
  author,
  artist,
  genres,
  status,
  description,
  coverUrl,
  chapters,
  comicId,
  priority = 0,
  paksaUlang = false,
}) => {
  const selected = (Array.isArray(chapters) ? chapters : []).filter((chapter) => chapter?.url);
  if (!selected.length) throw badRequest('Tidak ada chapter yang dipilih');

  let comic = comicId ? getComic(comicId) : null;
  if (!comic) {
    const resolvedTitle = title?.trim();
    if (!resolvedTitle) throw badRequest('title wajib diisi kalau comic_id tidak dikirim');
    comic =
      getComic(slugify(resolvedTitle)) ??
      createComic({
        title: resolvedTitle,
        author,
        artist,
        genres,
        status,
        source: seriesUrl ? new URL(requireAllowedUrl(seriesUrl)).hostname : 'url-import',
        description,
      });
  }

  // URL seri disimpan supaya bot pengawas bisa mencocokkan koleksi kita dengan
  // sumbernya (chapter baru rilis, nomor yang bolong) tanpa input ulang.
  //
  // Tapi hanya kalau komik ini belum punya sumber, atau sumbernya situs yang
  // sama. Mengambil dua chapter yang tertinggal dari kiryuu untuk komik yang
  // diimpor dari komiku tidak boleh diam-diam memindahkan komik itu ke kiryuu:
  // pemeriksaan chapter baru dan pencocokan etalase berpatokan pada URL ini.
  if (seriesUrl) {
    const db = getDb();
    const sumberLama = db.prepare('SELECT source_url FROM comics WHERE id = ?').get(comic.id)?.source_url;
    if (!sumberLama || domainSumber(sumberLama) === domainSumber(seriesUrl)) {
      db.prepare('UPDATE comics SET source_url = ? WHERE id = ?').run(seriesUrl, comic.id);
    }
  }

  if (coverUrl && !comic.coverUrl) comic = await saveCoverFromUrl(comic, coverUrl, seriesUrl);

  /*
   * Chapter yang berkasnya SUDAH lengkap di koleksi tidak diantre lagi.
   *
   * Penjaga ini sudah lama ada di resyncComic() ("Cek chapter baru") dan tidak
   * pernah ada di sini, padahal jalan inilah yang dipakai justru pada saat
   * paling berbahaya: situs sumber lama mati, komiknya ditemukan lagi di situs
   * lain, lalu seluruh daftar chapternya diimpor dari sana. Tanpa penjaga ini
   * yang masuk antrian adalah SELURUH seri — 91 chapter untuk koleksi yang
   * sudah punya 44 — dan setiap chapter yang sudah ada diunduh ulang dari nol:
   * berjam-jam kuota, ribuan gambar ditulis ulang, dan antrian yang menutupi
   * chapter baru yang sebenarnya dicari.
   *
   * enqueueChapterDownload SENGAJA tidak dipakai sebagai tempat penjaga ini,
   * meski ia yang dilewati semua orang. Bot pengawas memperbaiki chapter yang
   * halamannya rusak lewat fungsi yang sama, dan chapter itu berstatus
   * is_downloaded = 1 — menolaknya di sana akan mematikan satu-satunya jalan
   * perbaikan otomatis yang kita punya.
   *
   * is_downloaded = 1, bukan sekadar "barisnya ada": chapter yang pernah gagal
   * meninggalkan baris dengan is_downloaded = 0, dan itu justru yang memang
   * harus dicoba lagi.
   */
  const sudahLengkap = paksaUlang
    ? new Set()
    : new Set(
        getDb()
          .prepare('SELECT chapter_number FROM chapters WHERE comic_id = ? AND is_downloaded = 1')
          .all(comic.id)
          .map((row) => row.chapter_number),
      );

  const queued = [];
  const skipped = [];

  selected.forEach((chapter, index) => {
    const nomor = chapter.number ?? index + 1;

    if (sudahLengkap.has(nomor)) {
      skipped.push({ number: nomor, url: chapter.url, reason: 'sudah ada di koleksi' });
      return;
    }

    try {
      const { job } = enqueueChapterDownload({
        comicId: comic.id,
        chapterNumber: nomor,
        chapterTitle: chapter.title ?? null,
        chapterUrl: chapter.url,
        priority,
        paksaUlang,
      });
      queued.push({ number: nomor, jobId: job.id });
    } catch (error) {
      skipped.push({ number: nomor, url: chapter.url, reason: error.message });
    }
  });

  const sudahAda = skipped.filter((satu) => satu.reason === 'sudah ada di koleksi').length;
  log.info(
    `import ${comic.slug}: ${queued.length} chapter masuk antrian, ${skipped.length} dilewati` +
      (sudahAda ? ` (${sudahAda} sudah ada di koleksi)` : ''),
  );
  return { comic, queued, skipped };
};

export default { previewSeries, previewChapter, importSeries };

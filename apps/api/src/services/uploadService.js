import path from 'node:path';
import config from '../utils/config.js';
import { badRequest, safeJoin } from '../utils/validators.js';
import { compressBatch, compressToFile, imageExtension, pageFilename } from './compressionService.js';
import { createComic, getComic, updateComic } from './comicService.js';
import { chapterDir, ensureChapter, replacePages } from './chapterService.js';

/** Urutkan file upload secara natural: 2.jpg sebelum 10.jpg */
const naturalSort = (a, b) =>
  a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: 'base' });

/** Simpan cover komik (dikompresi) dan kembalikan path relatif dari DATA_DIR. */
export const saveCover = async (comicSlug, file) => {
  const relPath = path.posix.join('comics', comicSlug, `cover.${imageExtension()}`);
  const outPath = safeJoin(config.dataDir, relPath);
  await compressToFile(file.buffer, outPath);
  return relPath;
};

/** Upload manual: buat komik baru (opsional dengan cover). */
export const uploadComic = async (fields, coverFile) => {
  const comic = createComic(fields);
  if (coverFile) {
    const coverPath = await saveCover(comic.slug, coverFile);
    return updateComic(comic.id, { cover_image: coverPath });
  }
  return comic;
};

/** Ganti cover komik yang sudah ada. */
export const replaceCover = async (comicId, coverFile) => {
  const comic = getComic(comicId);
  if (!comic) throw badRequest('Komik tidak ditemukan');
  const coverPath = await saveCover(comic.slug, coverFile);
  return updateComic(comic.id, { cover_image: coverPath });
};

/**
 * Upload manual satu chapter: kumpulan gambar -> dikompresi -> pages.
 * Halaman diurutkan dari nama file aslinya.
 */
export const uploadChapter = async ({ comicId, chapterNumber, chapterTitle }, files) => {
  if (!files?.length) throw badRequest('Minimal satu gambar halaman harus diunggah');
  if (files.length > config.upload.maxPages) {
    throw badRequest(`Maksimal ${config.upload.maxPages} halaman per chapter`);
  }

  const { chapter, comic } = ensureChapter({ comicId, chapterNumber, chapterTitle });
  const dir = chapterDir(comic.slug, chapter.slug);

  const sorted = [...files].sort(naturalSort);
  const jobs = sorted.map((file, index) => ({
    input: file.buffer,
    output: path.join(dir, pageFilename(index + 1)),
    meta: { page_number: index + 1 },
  }));

  const results = await compressBatch(jobs);
  const pages = results.sort((a, b) => a.page_number - b.page_number);

  return replacePages(chapter.id, pages);
};

export default { uploadComic, uploadChapter, replaceCover, saveCover };

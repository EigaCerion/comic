import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getDb } from '../db/index.js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { notFound, safeJoin, sanitizeSourceUrl } from '../utils/validators.js';
import { fetchImage } from '../utils/httpClient.js';
import { imageExtension } from './compressionService.js';
import { getComic, updateComic } from './comicService.js';

const log = createLogger('naruread:cover');

// Grid memakai rasio 2:3, jadi cover dinormalkan ke ukuran itu.
const COVER_WIDTH = 600;
const COVER_HEIGHT = 900;

const coverRelPath = (slug) => path.posix.join('comics', slug, `cover.${imageExtension()}`);

const writeCover = async (comic, buffer, { crop }) => {
  const relPath = coverRelPath(comic.slug);
  const outPath = safeJoin(config.dataDir, relPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(COVER_WIDTH, COVER_HEIGHT, {
      // Poster asli: muat seluruhnya. Dari halaman komik: ambil bagian atas,
      // di situlah judul dan panel pembuka berada.
      fit: crop ? 'cover' : 'inside',
      position: 'top',
      withoutEnlargement: !crop,
    })
    .webp({ quality: 82 })
    .toFile(outPath);

  return updateComic(comic.id, { cover_image: relPath });
};

/** Ambil poster dari URL (og:image / hasil deteksi). */
export const setCoverFromUrl = async (comicId, url, referer) => {
  const comic = getComic(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  // Poster biasanya di CDN (thumbnail.*, cdn.*), bukan di domain situsnya.
  const safe = sanitizeSourceUrl(url, { anyPublicHost: true });
  if (!safe) throw notFound('URL cover tidak valid atau menunjuk ke host internal');

  const buffer = await fetchImage(safe, referer);
  return writeCover(comic, buffer, { crop: false });
};

/**
 * Fallback tanpa jaringan: pakai halaman pertama chapter paling awal yang
 * sudah tersimpan. Selalu tersedia dan selalu relevan, jadi grid tidak pernah
 * kosong walau situs sumber tidak menyediakan poster.
 */
export const setCoverFromFirstPage = async (comicId) => {
  const comic = getComic(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  const page = getDb()
    .prepare(
      `SELECT p.image_filename, ch.slug AS chapter_slug
         FROM pages p
         JOIN chapters ch ON ch.id = p.chapter_id
        WHERE ch.comic_id = ? AND ch.is_downloaded = 1
        ORDER BY ch.chapter_number ASC, p.page_number ASC
        LIMIT 1`,
    )
    .get(comic.id);

  if (!page) throw notFound('Belum ada halaman tersimpan untuk dijadikan cover');

  const source = safeJoin(
    config.comicsDir,
    comic.slug,
    'chapters',
    page.chapter_slug,
    page.image_filename,
  );
  const buffer = await fs.readFile(source);
  const updated = await writeCover(comic, buffer, { crop: true });
  log.debug(`cover ${comic.slug} dibuat dari ${page.chapter_slug}/${page.image_filename}`);
  return updated;
};

/**
 * Dipanggil setiap kali sebuah chapter selesai ditulis: kalau komiknya masih
 * tanpa cover, buat satu dari halaman pertama. Gagal di sini tidak boleh
 * menggagalkan download/import.
 */
export const ensureCover = async (comicId) => {
  try {
    const comic = getComic(comicId);
    if (!comic || comic.coverUrl) return null;
    return await setCoverFromFirstPage(comicId);
  } catch (error) {
    log.debug(`cover otomatis dilewati: ${error.message}`);
    return null;
  }
};

export default { setCoverFromUrl, setCoverFromFirstPage, ensureCover };

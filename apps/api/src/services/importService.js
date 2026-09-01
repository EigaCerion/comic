import fs from 'node:fs/promises';
import path from 'node:path';
import StreamZip from 'node-stream-zip';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { badRequest, notFound, safeJoin, slugify } from '../utils/validators.js';
import { compressToFile, pageFilename } from './compressionService.js';
import { chapterDir, ensureChapter, replacePages } from './chapterService.js';
import { createComic, getComic } from './comicService.js';
import { ensureCover } from './coverService.js';

const log = createLogger('naruread:import');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);
const ARCHIVE_EXT = new Set(['.cbz', '.zip']);

const isImage = (name) => IMAGE_EXT.has(path.extname(name).toLowerCase());
const isArchive = (name) => ARCHIVE_EXT.has(path.extname(name).toLowerCase());

/** Urutan natural: "2.jpg" sebelum "10.jpg", "Chapter 9" sebelum "Chapter 10". */
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Hanya ekstensi yang dikenal yang boleh dibuang. `path.extname('Chapter 2.5')`
// mengembalikan '.5' — cukup untuk mengubah chapter 2.5 menjadi 2 kalau dipakai.
const KNOWN_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|cbz|cbr|zip|rar|pdf)$/i;
const stripExtension = (name) => name.replace(KNOWN_EXT, '');

/**
 * Ambil nomor chapter dari nama folder/file.
 * "Chapter 10.5" -> 10.5 · "ch-007" -> 7 · "Vol 2 Ch 13" -> 13 (angka terakhir)
 */
export const parseChapterNumber = (name, fallback) => {
  const cleaned = stripExtension(path.basename(name)).replace(/[_-]/g, ' ');
  const matches = [...cleaned.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1].replace(',', '.')));
  if (!matches.length) return fallback;
  // "Vol 2 Chapter 13" -> ambil angka setelah kata chapter/ch kalau ada
  const marked = cleaned.match(/(?:chapter|chap|ch|episode|ep)\s*\.?\s*(\d+(?:[.,]\d+)?)/i);
  if (marked) return Number(marked[1].replace(',', '.'));
  return matches[matches.length - 1] ?? fallback;
};

/** Bersihkan judul dari nama folder: "[Grup] Naruto (2024)" -> "Naruto" */
export const cleanTitle = (name) =>
  stripExtension(path.basename(name))
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || path.basename(name);

// ── Pemindaian ────────────────────────────────────────────────────────────

const readDir = async (dir) => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const scanFolderComic = async (dir) => {
  const entries = await readDir(dir);
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(natural);
  const looseImages = entries.filter((e) => e.isFile() && isImage(e.name)).map((e) => e.name);
  const chapters = [];

  if (subdirs.length > 0) {
    for (const [index, name] of subdirs.entries()) {
      const files = (await readDir(path.join(dir, name)))
        .filter((e) => e.isFile() && isImage(e.name))
        .map((e) => e.name);
      if (files.length === 0) continue;
      chapters.push({
        number: parseChapterNumber(name, index + 1),
        title: cleanTitle(name),
        source: name,
        pages: files.length,
      });
    }
  }

  // Gambar yang langsung di folder komik dianggap satu chapter.
  if (looseImages.length > 0) {
    chapters.push({
      number: parseChapterNumber(path.basename(dir), chapters.length + 1),
      title: null,
      source: '.',
      pages: looseImages.length,
    });
  }

  return chapters.sort((a, b) => a.number - b.number);
};

const scanArchive = async (filePath) => {
  const zip = new StreamZip.async({ file: filePath });
  try {
    const entries = Object.values(await zip.entries()).filter((e) => !e.isDirectory && isImage(e.name));
    if (entries.length === 0) return [];

    const groups = new Map();
    entries.forEach((entry) => {
      const dir = path.posix.dirname(entry.name.split('\\').join('/'));
      const key = dir === '.' ? '.' : dir;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    });

    const keys = [...groups.keys()].sort(natural);
    // Semua gambar di satu level -> arsip ini satu chapter.
    if (keys.length === 1) {
      return [{ number: parseChapterNumber(filePath, 1), title: null, source: keys[0], pages: groups.get(keys[0]) }];
    }
    return keys
      .map((key, index) => ({
        number: parseChapterNumber(key, index + 1),
        title: cleanTitle(key),
        source: key,
        pages: groups.get(key),
      }))
      .sort((a, b) => a.number - b.number);
  } finally {
    await zip.close();
  }
};

/**
 * Pindai IMPORT_DIR dan laporkan apa yang bisa diimpor — tanpa menulis apa pun.
 * Satu subfolder = satu komik; satu file .cbz/.zip = satu komik.
 */
export const scanImportDir = async (subPath = '') => {
  const root = subPath ? safeJoin(config.importDir, subPath) : config.importDir;
  const entries = await readDir(root);
  const candidates = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const chapters = await scanFolderComic(full);
      if (chapters.length === 0) continue;
      candidates.push({
        kind: 'folder',
        path: path.relative(config.importDir, full).split(path.sep).join('/'),
        title: cleanTitle(entry.name),
        chapters,
        totalPages: chapters.reduce((sum, c) => sum + c.pages, 0),
      });
    } else if (entry.isFile() && isArchive(entry.name)) {
      const chapters = await scanArchive(full);
      if (chapters.length === 0) continue;
      candidates.push({
        kind: 'archive',
        path: path.relative(config.importDir, full).split(path.sep).join('/'),
        title: cleanTitle(entry.name),
        chapters,
        totalPages: chapters.reduce((sum, c) => sum + c.pages, 0),
      });
    }
  }

  return {
    importDir: config.importDir,
    items: candidates.sort((a, b) => natural(a.title, b.title)),
  };
};

// ── Eksekusi import ───────────────────────────────────────────────────────

const findOrCreateComic = ({ title, author, genres, status, source }) => {
  const existing = getComic(slugify(title));
  if (existing) return existing;
  return createComic({
    title,
    author: author || null,
    genres: genres ?? [],
    status: status || 'Ongoing',
    source: source || 'import',
    description: null,
  });
};

/** Kompresi satu chapter dari daftar buffer/berkas, lalu tulis ke DB. */
const writeChapter = async ({ comic, number, title, images, onPage }) => {
  const { chapter } = ensureChapter({ comicId: comic.id, chapterNumber: number, chapterTitle: title });
  const dir = chapterDir(comic.slug, chapter.slug);
  const pages = [];

  for (const [index, image] of images.entries()) {
    const result = await compressToFile(image.data ?? image.file, path.join(dir, pageFilename(index + 1)));
    pages.push({ ...result, page_number: index + 1 });
    onPage?.(index + 1, images.length);
  }

  replacePages(chapter.id, pages);
  await ensureCover(comic.id); // import lokal tidak punya poster — ambil dari halaman 1
  return { chapterId: chapter.id, number, pages: pages.length };
};

const importFolder = async ({ item, comic, onProgress }) => {
  const root = safeJoin(config.importDir, item.path);
  const results = [];

  for (const chapter of item.chapters) {
    const dir = chapter.source === '.' ? root : path.join(root, chapter.source);
    const files = (await readDir(dir))
      .filter((e) => e.isFile() && isImage(e.name))
      .map((e) => e.name)
      .sort(natural);

    onProgress?.({ label: `${comic.title} — chapter ${chapter.number}`, pagesTotal: files.length });
    results.push(
      await writeChapter({
        comic,
        number: chapter.number,
        title: chapter.title,
        images: files.map((name) => ({ file: path.join(dir, name) })),
        onPage: (done, total) => onProgress?.({ pagesDone: done, pagesTotal: total }),
      }),
    );
  }

  return results;
};

const importArchive = async ({ item, comic, onProgress }) => {
  const filePath = safeJoin(config.importDir, item.path);
  const zip = new StreamZip.async({ file: filePath });
  const results = [];

  try {
    const entries = Object.values(await zip.entries()).filter((e) => !e.isDirectory && isImage(e.name));

    for (const chapter of item.chapters) {
      const inChapter = entries
        .filter((entry) => {
          const dir = path.posix.dirname(entry.name.split('\\').join('/'));
          return chapter.source === '.' ? dir === '.' : dir === chapter.source;
        })
        .sort((a, b) => natural(a.name, b.name));

      onProgress?.({ label: `${comic.title} — chapter ${chapter.number}`, pagesTotal: inChapter.length });

      const images = [];
      for (const entry of inChapter) {
        images.push({ data: await zip.entryData(entry.name) });
      }

      results.push(
        await writeChapter({
          comic,
          number: chapter.number,
          title: chapter.title,
          images,
          onPage: (done, total) => onProgress?.({ pagesDone: done, pagesTotal: total }),
        }),
      );
    }
  } finally {
    await zip.close();
  }

  return results;
};

/** Import satu kandidat hasil scan (folder atau arsip). */
export const importItem = async ({ itemPath, title, author, genres, status, onProgress }) => {
  const { items } = await scanImportDir();
  const item = items.find((candidate) => candidate.path === itemPath);
  if (!item) throw notFound(`"${itemPath}" tidak ada di folder import`);

  const comic = findOrCreateComic({
    title: title?.trim() || item.title,
    author,
    genres,
    status,
    source: item.kind === 'archive' ? 'import:cbz' : 'import:folder',
  });

  const chapters =
    item.kind === 'archive'
      ? await importArchive({ item, comic, onProgress })
      : await importFolder({ item, comic, onProgress });

  log.info(`import ${item.path} -> ${comic.slug}: ${chapters.length} chapter`);
  return { comic, chapters };
};

/** Import arsip yang diunggah lewat HTTP (buffer, tidak lewat IMPORT_DIR). */
export const importUploadedArchive = async ({ buffer, filename, title, author, genres, status, onProgress }) => {
  const tempPath = path.join(config.cacheDir, `import-${Date.now()}-${slugify(filename)}.zip`);
  await fs.mkdir(config.cacheDir, { recursive: true });
  await fs.writeFile(tempPath, buffer);

  try {
    const chapters = await scanArchive(tempPath);
    if (!chapters.length) throw badRequest('Arsip tidak berisi gambar yang dikenali');

    const comic = findOrCreateComic({
      title: title?.trim() || cleanTitle(filename),
      author,
      genres,
      status,
      source: 'import:cbz',
    });

    const zip = new StreamZip.async({ file: tempPath });
    const results = [];
    try {
      const entries = Object.values(await zip.entries()).filter((e) => !e.isDirectory && isImage(e.name));

      for (const chapter of chapters) {
        const inChapter = entries
          .filter((entry) => {
            const dir = path.posix.dirname(entry.name.split('\\').join('/'));
            return chapter.source === '.' ? dir === '.' : dir === chapter.source;
          })
          .sort((a, b) => natural(a.name, b.name));

        onProgress?.({ label: `${comic.title} — chapter ${chapter.number}`, pagesTotal: inChapter.length });

        const images = [];
        for (const entry of inChapter) {
          images.push({ data: await zip.entryData(entry.name) });
        }

        results.push(
          await writeChapter({
            comic,
            number: chapter.number,
            title: chapter.title,
            images,
            onPage: (done, total) => onProgress?.({ pagesDone: done, pagesTotal: total }),
          }),
        );
      }
    } finally {
      await zip.close();
    }

    return { comic, chapters: results };
  } finally {
    await fs.rm(tempPath, { force: true });
  }
};

export default { scanImportDir, importItem, importUploadedArchive, parseChapterNumber, cleanTitle };

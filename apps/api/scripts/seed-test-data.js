#!/usr/bin/env node
// Seed data uji: beberapa komik + chapter + halaman placeholder yang benar-benar
// dibuat sebagai gambar, jadi Reader bisa langsung dicoba tanpa download apa pun.
import path from 'node:path';
import sharp from 'sharp';
import config from '../src/utils/config.js';
import { getDb, initSchema, closeDb } from '../src/db/index.js';
import { createComic, getComic } from '../src/services/comicService.js';
import { ensureChapter, replacePages, chapterDir } from '../src/services/chapterService.js';
import { compressToFile, pageFilename, imageExtension } from '../src/services/compressionService.js';
import { safeJoin } from '../src/utils/validators.js';

const PALETTE = [
  { bg: '#1b6b2d', fg: '#f5f1e8' },
  { bg: '#ff7d00', fg: '#0f1419' },
  { bg: '#4169e1', fg: '#f5f1e8' },
  { bg: '#c41e3a', fg: '#f5f1e8' },
  { bg: '#0f1419', fg: '#ff7d00' },
];

const SEED = [
  { title: 'Kisah Rubah Ekor Sembilan', genres: ['Action', 'Shounen', 'Fantasy'], author: 'Studio Konoha', status: 'Ongoing', rating: 4.8, chapters: 3 },
  { title: 'Akademi Shinobi Muda', genres: ['Action', 'School', 'Comedy'], author: 'Iruka Sensei', status: 'Ongoing', rating: 4.2, chapters: 2 },
  { title: 'Legenda Sannin Legendaris', genres: ['Action', 'Drama'], author: 'Jiraiya', status: 'Completed', rating: 4.6, chapters: 2 },
  { title: 'Penjaga Gerbang Selatan', genres: ['Slice of Life', 'Comedy'], author: 'Izumo & Kotetsu', status: 'Hiatus', rating: 3.9, chapters: 1 },
];

const svgPage = ({ width, height, title, subtitle, pageLabel, palette }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="${palette.bg}"/>
  <rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none"
        stroke="${palette.fg}" stroke-width="6" stroke-opacity="0.35"/>
  <circle cx="${width / 2}" cy="${height * 0.34}" r="${width * 0.16}" fill="none"
          stroke="${palette.fg}" stroke-width="10" stroke-opacity="0.5"/>
  <text x="50%" y="${height * 0.56}" text-anchor="middle" font-family="Segoe UI, sans-serif"
        font-size="${Math.round(width * 0.07)}" font-weight="700" fill="${palette.fg}">${title}</text>
  <text x="50%" y="${height * 0.63}" text-anchor="middle" font-family="Segoe UI, sans-serif"
        font-size="${Math.round(width * 0.042)}" fill="${palette.fg}" fill-opacity="0.85">${subtitle}</text>
  <text x="50%" y="${height * 0.88}" text-anchor="middle" font-family="Segoe UI, sans-serif"
        font-size="${Math.round(width * 0.055)}" font-weight="700" fill="${palette.fg}" fill-opacity="0.9">${pageLabel}</text>
</svg>`;

const renderImage = async (svg, outPath) => {
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return compressToFile(buffer, outPath);
};

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

initSchema(getDb());
console.log('🌱 Membuat data uji...\n');

for (const [index, entry] of SEED.entries()) {
  const palette = PALETTE[index % PALETTE.length];
  let comic = getComic(entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

  if (!comic) {
    comic = createComic({
      title: entry.title,
      description: `Data uji NaruReader. ${entry.title} dipakai untuk mencoba grid, detail, dan reader tanpa perlu import dari sumber luar.`,
      author: entry.author,
      artist: entry.author,
      genres: entry.genres,
      status: entry.status,
      rating: entry.rating,
      source: 'seed',
    });
    console.log(`📗 ${comic.title} (id ${comic.id})`);
  } else {
    console.log(`📗 ${comic.title} (sudah ada, id ${comic.id})`);
  }

  // Cover
  const coverRel = path.posix.join('comics', comic.slug, `cover.${imageExtension()}`);
  await renderImage(
    svgPage({
      width: 800,
      height: 1200,
      title: escape(comic.title),
      subtitle: escape(entry.genres.join(' • ')),
      pageLabel: 'COVER',
      palette,
    }),
    safeJoin(config.dataDir, coverRel),
  );
  getDb().prepare('UPDATE comics SET cover_image = ? WHERE id = ?').run(coverRel, comic.id);

  // Chapters + pages
  for (let c = 1; c <= entry.chapters; c += 1) {
    const { chapter } = ensureChapter({
      comicId: comic.id,
      chapterNumber: c,
      chapterTitle: `Latihan ke-${c}`,
    });
    const dir = chapterDir(comic.slug, chapter.slug);
    const totalPages = 6;
    const pages = [];

    for (let p = 1; p <= totalPages; p += 1) {
      const result = await renderImage(
        svgPage({
          width: 1200,
          height: 1800,
          title: escape(comic.title),
          subtitle: `Chapter ${c}`,
          pageLabel: `${p} / ${totalPages}`,
          palette,
        }),
        path.join(dir, pageFilename(p)),
      );
      pages.push({ ...result, page_number: p });
    }

    replacePages(chapter.id, pages);
    console.log(`   └─ chapter ${c}: ${totalPages} halaman`);
  }
}

const summary = getDb()
  .prepare('SELECT (SELECT COUNT(*) FROM comics) AS comics, (SELECT COUNT(*) FROM chapters) AS chapters, (SELECT COUNT(*) FROM pages) AS pages')
  .get();

console.log(`\n✅ Selesai: ${summary.comics} komik, ${summary.chapters} chapter, ${summary.pages} halaman`);
console.log(`   gambar tersimpan di ${config.comicsDir}`);
closeDb();

import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { wajibKemampuan } from '../middleware/auth.js';
import { badRequest, notFound, parsePositiveInt } from '../utils/validators.js';
import comicService from '../services/comicService.js';
import coverService from '../services/coverService.js';
import chapterService from '../services/chapterService.js';
import progressService from '../services/progressService.js';

const router = Router();

// GET /api/comics — daftar + filter + pagination
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = comicService.listComics({
      page: parsePositiveInt(req.query.page, 1),
      limit: parsePositiveInt(req.query.limit, 24, { max: 100 }),
      search: String(req.query.search ?? ''),
      genre: String(req.query.genre ?? ''),
      status: String(req.query.status ?? ''),
      favorite: req.query.favorite === 'true',
      sort: String(req.query.sort ?? 'latest'),
    });
    res.json(result);
  }),
);

// GET /api/comics/continue — lanjut baca (untuk Home)
router.get(
  '/continue',
  asyncHandler(async (req, res) => {
    res.json({ items: comicService.continueReading(parsePositiveInt(req.query.limit, 8, { max: 24 })) });
  }),
);

// GET /api/comics/:idOrSlug
router.get(
  '/:idOrSlug',
  asyncHandler(async (req, res) => {
    const comic = comicService.getComic(req.params.idOrSlug);
    if (!comic) throw notFound('Komik tidak ditemukan');
    res.json(comic);
  }),
);

// GET /api/comics/:idOrSlug/chapters
router.get(
  '/:idOrSlug/chapters',
  asyncHandler(async (req, res) => {
    const comic = comicService.getComic(req.params.idOrSlug);
    if (!comic) throw notFound('Komik tidak ditemukan');
    res.json({ items: chapterService.listChapters(comic.id, { order: req.query.order === 'desc' ? 'desc' : 'asc' }) });
  }),
);

// GET /api/comics/:id/progress
router.get(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    res.json({ items: progressService.getComicProgress(Number(req.params.id)) });
  }),
);

// POST /api/comics — buat komik (metadata saja; cover via /api/uploads)
router.post(
  '/',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    res.status(201).json(comicService.createComic(req.body ?? {}));
  }),
);

// POST /api/comics/:id/chapters — daftarkan chapter kosong
router.post(
  '/:id/chapters',
  wajibKemampuan('unggah_chapter'),
  asyncHandler(async (req, res) => {
    const { chapter, created } = chapterService.ensureChapter({
      comicId: Number(req.params.id),
      chapterNumber: req.body?.chapter_number ?? req.body?.number,
      chapterTitle: req.body?.chapter_title ?? req.body?.title,
      sourceUrl: req.body?.source_url,
    });
    res.status(created ? 201 : 200).json(chapter);
  }),
);

// PATCH /api/comics/:id
router.patch(
  '/:id',
  wajibKemampuan('sunting_metadata'),
  asyncHandler(async (req, res) => {
    res.json(comicService.updateComic(Number(req.params.id), req.body ?? {}));
  }),
);

// POST /api/comics/:id/cover/from-page — poster dari halaman pertama (tanpa jaringan)
router.post(
  '/:id/cover/from-page',
  wajibKemampuan('sunting_metadata'),
  asyncHandler(async (req, res) => {
    res.json(await coverService.setCoverFromFirstPage(Number(req.params.id)));
  }),
);

// POST /api/comics/:id/cover/from-url — poster dari URL gambar
router.post(
  '/:id/cover/from-url',
  wajibKemampuan('sunting_metadata'),
  asyncHandler(async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!url) throw badRequest('url wajib diisi');
    res.json(await coverService.setCoverFromUrl(Number(req.params.id), url, req.body?.referer));
  }),
);

// POST /api/comics/:id/favorite — toggle
router.post(
  '/:id/favorite',
  asyncHandler(async (req, res) => {
    res.json(comicService.toggleFavorite(Number(req.params.id)));
  }),
);

// DELETE /api/comics/:id — hapus metadata + file gambar
router.delete(
  '/:id',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    res.json(await comicService.deleteComic(Number(req.params.id)));
  }),
);

export default router;

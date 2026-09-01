import { Router } from 'express';
import multer from 'multer';
import asyncHandler from '../utils/asyncHandler.js';
import config from '../utils/config.js';
import { badRequest, parseGenres } from '../utils/validators.js';
import importService from '../services/importService.js';
import urlImportService from '../services/urlImportService.js';
import { getImportJob, listImportJobs, runImportJob } from '../services/importJobs.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024, files: 1 },
});

// GET /api/imports/scan — lihat apa yang bisa diimpor dari IMPORT_DIR
router.get(
  '/scan',
  asyncHandler(async (req, res) => {
    res.json(await importService.scanImportDir(String(req.query.path ?? '')));
  }),
);

// POST /api/imports/local — import satu folder/arsip dari IMPORT_DIR
router.post(
  '/local',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const itemPath = String(body.path ?? '').trim();
    if (!itemPath) throw badRequest('path wajib diisi (ambil dari /api/imports/scan)');

    const job = runImportJob({
      label: body.title?.trim() || itemPath,
      run: (onProgress) =>
        importService.importItem({
          itemPath,
          title: body.title,
          author: body.author,
          genres: parseGenres(body.genres),
          status: body.status,
          onProgress,
        }),
    });

    res.status(202).json(job);
  }),
);

// POST /api/imports/archive — unggah satu file .cbz/.zip
router.post(
  '/archive',
  upload.single('archive'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('File arsip (.cbz/.zip) wajib diunggah');
    const body = req.body ?? {};

    const job = runImportJob({
      label: body.title?.trim() || req.file.originalname,
      run: (onProgress) =>
        importService.importUploadedArchive({
          buffer: req.file.buffer,
          filename: req.file.originalname,
          title: body.title,
          author: body.author,
          genres: parseGenres(body.genres),
          status: body.status,
          onProgress,
        }),
    });

    res.status(202).json(job);
  }),
);

// POST /api/imports/url/preview — deteksi seri dari URL (tidak menulis apa pun)
router.post(
  '/url/preview',
  asyncHandler(async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!url) throw badRequest('url wajib diisi');
    res.json(await urlImportService.previewSeries(url));
  }),
);

// POST /api/imports/url/chapter-preview — cek satu halaman chapter
router.post(
  '/url/chapter-preview',
  asyncHandler(async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!url) throw badRequest('url wajib diisi');
    res.json(await urlImportService.previewChapter(url));
  }),
);

// POST /api/imports/url — masukkan chapter terpilih ke antrian download
router.post(
  '/url',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const result = await urlImportService.importSeries({
      seriesUrl: body.series_url ?? body.seriesUrl,
      title: body.title,
      author: body.author,
      artist: body.artist,
      genres: parseGenres(body.genres),
      status: body.status,
      description: body.description,
      coverUrl: body.cover_url ?? body.coverUrl,
      comicId: body.comic_id ?? body.comicId,
      chapters: body.chapters,
      priority: body.priority,
    });
    res.status(202).json(result);
  }),
);

// GET /api/imports/jobs · /api/imports/jobs/:id
router.get('/jobs', asyncHandler(async (_req, res) => res.json({ items: listImportJobs() })));

router.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = getImportJob(req.params.id);
    if (!job) throw badRequest('Job import tidak ditemukan (mungkin sudah dibersihkan)');
    res.json(job);
  }),
);

// GET /api/imports/config — dipakai UI untuk menampilkan lokasi folder import
router.get('/config', (_req, res) => {
  res.json({ importDir: config.importDir, dataDir: config.dataDir });
});

export default router;

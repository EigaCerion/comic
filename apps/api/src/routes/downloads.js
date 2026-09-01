import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import downloadService from '../services/downloadService.js';

const router = Router();

// GET /api/downloads — antrian + ringkasan status
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(downloadService.listJobs({ status: String(req.query.status ?? '') }));
  }),
);

// POST /api/downloads — enqueue chapter dari URL halaman chapter ATAU daftar URL gambar
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const result = downloadService.enqueueChapterDownload({
      comicId: Number(body.comic_id ?? body.comicId),
      chapterNumber: body.chapter_number ?? body.chapterNumber,
      chapterTitle: body.chapter_title ?? body.chapterTitle,
      imageUrls: body.image_urls ?? body.imageUrls,
      // Tanpa baris ini, chapter_url yang dikirim UI diam-diam hilang dan
      // permintaan ditolak dengan pesan "butuh image_urls atau chapter_url".
      chapterUrl: body.chapter_url ?? body.chapterUrl,
      sourceUrl: body.source_url ?? body.sourceUrl,
      priority: body.priority,
    });
    res.status(201).json(result);
  }),
);

// POST /api/downloads/pause | resume | clear
router.post('/pause', asyncHandler(async (_req, res) => res.json(downloadService.pauseQueue())));
router.post('/resume', asyncHandler(async (_req, res) => res.json(downloadService.resumeQueue())));
router.post('/clear', asyncHandler(async (_req, res) => res.json(downloadService.clearFinished())));

// POST /api/downloads/:id/retry
router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    res.json(downloadService.retryJob(Number(req.params.id)));
  }),
);

// DELETE /api/downloads/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(downloadService.cancelJob(Number(req.params.id)));
  }),
);

export default router;

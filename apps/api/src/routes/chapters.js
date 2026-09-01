import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { wajibKemampuan } from '../middleware/auth.js';
import chapterService from '../services/chapterService.js';
import progressService from '../services/progressService.js';

const router = Router();

// GET /api/chapters/:id — chapter + halaman + navigasi prev/next
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(chapterService.getChapterWithPages(Number(req.params.id)));
  }),
);

// PUT /api/chapters/:id/progress — simpan posisi baca
router.put(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    const chapter = chapterService.getChapterWithPages(Number(req.params.id));
    res.json(
      progressService.saveProgress({
        comicId: chapter.comicId,
        chapterId: chapter.id,
        lastPageRead: req.body?.last_page_read ?? req.body?.lastPageRead ?? 1,
      }),
    );
  }),
);

// DELETE /api/chapters/:id — hapus chapter + file halamannya
router.delete(
  '/:id',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    res.json(await chapterService.deleteChapter(Number(req.params.id)));
  }),
);

export default router;

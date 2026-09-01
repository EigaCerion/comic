import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { badRequest } from '../utils/validators.js';
import progressService from '../services/progressService.js';

const router = Router();

// GET /api/bookmarks?comic_id=1
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const comicId = req.query.comic_id ? Number(req.query.comic_id) : undefined;
    res.json({ items: progressService.listBookmarks({ comicId }) });
  }),
);

// POST /api/bookmarks
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const comicId = Number(body.comic_id ?? body.comicId);
    const chapterId = Number(body.chapter_id ?? body.chapterId);
    if (!comicId || !chapterId) throw badRequest('comic_id dan chapter_id wajib diisi');

    res.status(201).json(
      progressService.addBookmark({
        comicId,
        chapterId,
        pageNumber: body.page_number ?? body.pageNumber,
        note: body.note,
      }),
    );
  }),
);

// DELETE /api/bookmarks/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(progressService.deleteBookmark(Number(req.params.id)));
  }),
);

export default router;

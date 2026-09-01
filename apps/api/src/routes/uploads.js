import { Router } from 'express';
import multer from 'multer';
import asyncHandler from '../utils/asyncHandler.js';
import config from '../utils/config.js';
import { badRequest, IMAGE_MIME } from '../utils/validators.js';
import uploadService from '../services/uploadService.js';

const router = Router();

// File ditahan di memori lalu langsung dikompresi Sharp — tidak ada file mentah
// yang menyentuh disk, jadi tidak perlu bersih-bersih temp.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSize, files: config.upload.maxPages },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME.test(file.mimetype)) {
      cb(badRequest(`Format file tidak didukung: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

// POST /api/uploads/comic — multipart: cover (file) + metadata (fields)
router.post(
  '/comic',
  upload.single('cover'),
  asyncHandler(async (req, res) => {
    const comic = await uploadService.uploadComic(req.body ?? {}, req.file);
    res.status(201).json(comic);
  }),
);

// POST /api/uploads/comic/:id/cover — ganti cover
router.post(
  '/comic/:id/cover',
  upload.single('cover'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('File cover wajib diunggah');
    res.json(await uploadService.replaceCover(Number(req.params.id), req.file));
  }),
);

// POST /api/uploads/chapter — multipart: pages[] + comic_id, chapter_number
router.post(
  '/chapter',
  upload.array('pages', config.upload.maxPages),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const chapter = await uploadService.uploadChapter(
      {
        comicId: Number(body.comic_id ?? body.comicId),
        chapterNumber: body.chapter_number ?? body.chapterNumber,
        chapterTitle: body.chapter_title ?? body.chapterTitle,
      },
      req.files,
    );
    res.status(201).json(chapter);
  }),
);

export default router;

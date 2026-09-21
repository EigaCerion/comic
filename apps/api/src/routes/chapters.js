import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { wajibKemampuan, wajibLogin } from '../middleware/auth.js';
import chapterService from '../services/chapterService.js';
import downloadService from '../services/downloadService.js';
import progressService from '../services/progressService.js';

const router = Router();

// GET /api/chapters/:id — chapter + halaman + navigasi prev/next
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Tamu boleh membaca; progres pribadinya kosong kalau belum masuk.
    res.json(chapterService.getChapterWithPages(Number(req.params.id), req.user?.id ?? null));
  }),
);

// PUT /api/chapters/:id/progress — simpan posisi baca
router.put(
  '/:id/progress',
  // Posisi baca adalah data pribadi. Dulu dibiarkan terbuka supaya tamu tetap
  // bisa melanjutkan bacaan, tapi tabelnya dipakai bersama semua akun: tamu
  // mana pun bisa menimpa posisi baca pemilik. Membaca tetap bebas tanpa akun;
  // yang butuh akun hanyalah MENYIMPAN posisinya.
  wajibLogin,
  asyncHandler(async (req, res) => {
    const chapter = chapterService.getChapterWithPages(Number(req.params.id), req.user.id);
    res.json(
      progressService.saveProgress({
        userId: req.user.id,
        comicId: chapter.comicId,
        chapterId: chapter.id,
        lastPageRead: req.body?.last_page_read ?? req.body?.lastPageRead ?? 1,
      }),
    );
  }),
);

// POST /api/chapters/:id/ganti — unduh ulang chapter ini dari tautan lain atau
// daftar URL gambar. Beda dengan hapus lalu impor ulang: baris chapter tetap
// sama, jadi posisi baca dan bookmark pembacanya tidak ikut hilang.
router.post(
  '/:id/ganti',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    res.status(202).json(
      downloadService.gantiChapter(Number(req.params.id), {
        chapterUrl: body.chapter_url ?? body.chapterUrl,
        imageUrls: body.image_urls ?? body.imageUrls,
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

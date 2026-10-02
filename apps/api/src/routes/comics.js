import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { wajibKemampuan, wajibLogin } from '../middleware/auth.js';
import { badRequest, notFound, parsePositiveInt } from '../utils/validators.js';
import comicService from '../services/comicService.js';
import coverService from '../services/coverService.js';
import chapterService from '../services/chapterService.js';
import progressService from '../services/progressService.js';
import sumberService from '../services/sumberService.js';

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
    // Tamu mendapat daftar kosong; riwayat baca terikat pemiliknya.
    res.json({
      items: comicService.continueReading(
        parsePositiveInt(req.query.limit, 8, { max: 24 }),
        req.user?.id ?? null,
      ),
    });
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
    // ?ringkas=1 — bentuk hemat untuk pemilih chapter di dalam reader, yang
    // hanya butuh nomor, judul, dan status baca. Daftar di halaman detail tetap
    // memakai bentuk lengkap karena ia menampilkan ukuran berkas dan sumbernya.
    const ringkas = req.query.ringkas === '1' || req.query.ringkas === 'true';
    const opsi = {
      order: req.query.order === 'desc' ? 'desc' : 'asc',
      userId: req.user?.id ?? null,
    };
    res.json({
      items: ringkas
        ? chapterService.listChapterRingkas(comic.id, opsi)
        : chapterService.listChapters(comic.id, opsi),
    });
  }),
);

// GET /api/comics/:id/progress
router.get(
  '/:id/progress',
  // Riwayat baca per komik adalah data pribadi — hanya pemiliknya yang berhak.
  wajibLogin,
  asyncHandler(async (req, res) => {
    res.json({ items: progressService.getComicProgress(Number(req.params.id), req.user.id) });
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
  // Favorit menulis ke tabel comics lewat updateComic — jalur PATCH ke fungsi
  // yang sama sudah dijaga `sunting_metadata`, jadi membiarkan pintu ini
  // terbuka membuat penjagaan itu bisa dilewati.
  wajibLogin,
  asyncHandler(async (req, res) => {
    res.json(comicService.toggleFavorite(Number(req.params.id)));
  }),
);

/*
 * ── Sumber komik ────────────────────────────────────────────────────────
 *
 * Alamat halaman seri komik ini di situs-situs sumber. Satu yang aktif (tercatat
 * di comics.source_url) dan sisanya cadangan; begitu yang aktif mati, "Cek
 * chapter baru" berpindah sendiri ke cadangan yang sudah disetujui.
 *
 * Seluruhnya di balik kelola_koleksi, sama seperti /imports dan /scout: yang
 * ditentukan di sini adalah dari situs mana berkas akan diunduh ke disk
 * pemiliknya.
 */

// GET /api/comics/:id/sumber — daftar sumber yang diketahui
router.get(
  '/:id/sumber',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    res.json(sumberService.daftarSumber(Number(req.params.id)));
  }),
);

// POST /api/comics/:id/sumber — tempel satu alamat sendiri (langsung siap pakai)
router.post(
  '/:id/sumber',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    const seriesUrl = String(req.body?.series_url ?? req.body?.seriesUrl ?? '').trim();
    if (!seriesUrl) throw badRequest('series_url wajib diisi');
    // Alamat yang diketik tangan TIDAK perlu persetujuan terpisah: mengetiknya
    // sudah persetujuan itu sendiri.
    sumberService.catatSumber({ comicId: Number(req.params.id), seriesUrl, status: 'siap' });
    res.status(201).json(sumberService.daftarSumber(Number(req.params.id)));
  }),
);

// POST /api/comics/:id/sumber/cari — cari komik ini di situs lain
router.post(
  '/:id/sumber/cari',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    res.json(await sumberService.cariSumberLain(Number(req.params.id)));
  }),
);

// POST /api/comics/:id/sumber/:sumberId/setujui — calon jadi sumber siap pakai
router.post(
  '/:id/sumber/:sumberId/setujui',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    res.json(
      sumberService.setujuiSumber({
        comicId: Number(req.params.id),
        id: Number(req.params.sumberId),
        pakaiSekarang: req.body?.pakai_sekarang === true || req.body?.pakaiSekarang === true,
      }),
    );
  }),
);

// DELETE /api/comics/:id/sumber/:sumberId
router.delete(
  '/:id/sumber/:sumberId',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (req, res) => {
    res.json(sumberService.hapusSumber({ comicId: Number(req.params.id), id: Number(req.params.sumberId) }));
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

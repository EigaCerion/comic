import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import auditService from '../services/auditService.js';
import resyncAllService from '../services/resyncAllService.js';
import { supervisorStatus } from '../jobs/supervisorPool.js';

const router = Router();

// GET /api/audit — status bot pengawas + ringkasan temuan
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ pengawas: supervisorStatus(), ...auditService.auditSummary() });
  }),
);

// POST /api/audit/comics/:id — periksa satu komik sekarang (full=1 memeriksa ulang semua)
router.post(
  '/comics/:id',
  asyncHandler(async (req, res) => {
    const full = req.query.full === '1' || req.body?.full === true;
    res.json(await auditService.auditComic(Number(req.params.id), { full }));
  }),
);

// POST /api/audit/comics/:id/resync — bandingkan dengan sumber, antrekan yang kurang
router.post(
  '/comics/:id/resync',
  asyncHandler(async (req, res) => {
    const seriesUrl = req.body?.series_url ?? req.body?.seriesUrl;
    res.json(await auditService.resyncComic(Number(req.params.id), { seriesUrl }));
  }),
);

// GET /api/audit/resync-all — kemajuan pemeriksaan seluruh koleksi
router.get(
  '/resync-all',
  asyncHandler(async (_req, res) => {
    res.json(resyncAllService.statusResyncSemua());
  }),
);

// POST /api/audit/resync-all — cek chapter baru untuk SEMUA komik, bergiliran.
// Kembali seketika; pemeriksaannya berjalan di latar dan dipantau lewat GET.
router.post(
  '/resync-all',
  asyncHandler(async (_req, res) => {
    res.json(resyncAllService.mulaiResyncSemua());
  }),
);

// POST /api/audit/resync-all/stop — berhenti setelah komik yang sedang jalan selesai
router.post(
  '/resync-all/stop',
  asyncHandler(async (_req, res) => {
    res.json(resyncAllService.hentikanResyncSemua());
  }),
);

// POST /api/audit/repair — antrekan ulang semua chapter bermasalah
router.post(
  '/repair',
  asyncHandler(async (req, res) => {
    const comicId = req.body?.comic_id ?? req.body?.comicId ?? null;
    res.json(await auditService.repairFindings(comicId ? Number(comicId) : null));
  }),
);

// GET /api/audit/findings — daftar temuan terbuka
router.get(
  '/findings',
  asyncHandler(async (req, res) => {
    const comicId = req.query.comic_id ? Number(req.query.comic_id) : null;
    res.json({ items: auditService.openFindings(comicId) });
  }),
);

// POST /api/audit/findings/:id/dismiss — tutup temuan secara manual
router.post(
  '/findings/:id/dismiss',
  asyncHandler(async (req, res) => {
    res.json(auditService.dismissFinding(Number(req.params.id), req.body?.alasan));
  }),
);

export default router;

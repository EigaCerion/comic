import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import interaksi from '../services/interaksiService.js';
import { wajibKemampuan, wajibLogin } from '../middleware/auth.js';
import { batasiAksi } from '../middleware/rateLimit.js';

const router = Router();
const idKomik = (req) => Number(req.params.id);

// ── Rating ────────────────────────────────────────────────────────────

// Terbuka untuk tamu: angka rata-rata bagian dari informasi komik. Kalau
// kebetulan sedang login, nilainya sendiri ikut dikirim supaya bintang yang
// pernah dipilih tampil terisi.
router.get(
  '/comics/:id/rating',
  asyncHandler(async (req, res) => res.json(interaksi.ringkasanRating(idKomik(req), req.user?.id ?? null))),
);

router.put(
  '/comics/:id/rating',
  wajibLogin,
  batasiAksi({ nama: 'memberi rating', maks: 30, jendelaMs: 5 * 60 * 1000 }),
  asyncHandler(async (req, res) =>
    res.json(interaksi.simpanRating(idKomik(req), req.user.id, req.body?.value)),
  ),
);

router.delete(
  '/comics/:id/rating',
  wajibLogin,
  asyncHandler(async (req, res) => res.json(interaksi.hapusRating(idKomik(req), req.user.id))),
);

// ── Komentar ──────────────────────────────────────────────────────────

router.get(
  '/comics/:id/comments',
  asyncHandler(async (req, res) =>
    res.json({ items: interaksi.daftarKomentar(idKomik(req), req.user ?? null) }),
  ),
);

router.post(
  '/comics/:id/comments',
  wajibLogin,
  batasiAksi({ nama: 'berkomentar', maks: 10, jendelaMs: 5 * 60 * 1000 }),
  asyncHandler(async (req, res) =>
    res.status(201).json(interaksi.tambahKomentar(idKomik(req), req.user, req.body?.body)),
  ),
);

router.delete(
  '/comments/:id',
  wajibLogin,
  asyncHandler(async (req, res) => res.json(interaksi.hapusKomentar(Number(req.params.id), req.user))),
);

// Moderasi: menyembunyikan dan memunculkan kembali.
router.post(
  '/comments/:id/hide',
  wajibKemampuan('moderasi_komentar'),
  asyncHandler(async (req, res) =>
    res.json(interaksi.sembunyikanKomentar(Number(req.params.id), req.user, req.body?.sembunyikan !== false)),
  ),
);

export default router;

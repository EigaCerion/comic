import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { HttpError, badRequest } from '../utils/validators.js';
import { batasiAksi } from '../middleware/rateLimit.js';
import scoutService from '../services/scoutService.js';

const router = Router();

const saringan = (sumber = {}) => ({
  status: String(sumber.status ?? 'semua'),
  bagian: String(sumber.bagian ?? 'semua'),
  q: String(sumber.q ?? ''),
});

const mintaHanyaBaru = (body) => body?.hanyaBaru === true || body?.hanya_baru === true;

// GET /api/scout — etalase situs sumber, sudah dicocokkan dengan koleksi.
// Menyegarkan dirinya sendiri kalau pindaian terakhir sudah lewat 15 menit;
// `?segar=0` melewati itu, dipakai saat panel di-poll atau saringan diubah —
// mengetik satu huruf di kotak cari tidak boleh berarti satu request ke situs sumber.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.segar !== '0') await scoutService.segarkanKalauBasi();
    res.json(scoutService.daftar(saringan(req.query)));
  }),
);

// GET /api/scout/cari?q= — cari judul di mesin pencari tiap situs sumber, untuk
// judul yang tidak sedang tampil di etalase. Hasilnya tidak disimpan.
//
// Dibatasi per akun: setiap kata yang belum ada di cache berarti satu
// permintaan ke tiap situs sumber, dan klien yang memicu pencarian pada
// ketikan bisa menembakkannya berkali-kali per detik.
router.get(
  '/cari',
  batasiAksi({ nama: 'mencari di sumber', maks: 20, jendelaMs: 60_000 }),
  asyncHandler(async (req, res) => {
    res.json(await scoutService.cariDiSumber({ q: req.query.q }));
  }),
);

// POST /api/scout/impor-url — impor hasil cari lewat URL serinya, karena hasil
// cari tidak punya baris scout_items untuk dirujuk lewat id. Bentuk jawabannya
// sama dengan /:id/import.
router.post(
  '/impor-url',
  asyncHandler(async (req, res) => {
    res
      .status(202)
      .json(await scoutService.imporDariUrl({ seriesUrl: req.body?.seriesUrl, hanyaBaru: mintaHanyaBaru(req.body) }));
  }),
);

// POST /api/scout/refresh — pindai sekarang, tanpa menunggu ambang basi.
// Body { host } memindai satu sumber saja; tanpa itu semua sumber dipindai.
//
// Ini permintaan yang eksplisit, jadi kegagalan TOTAL dibiarkan naik jadi error:
// pengguna yang menekan Segarkan berhak tahu kalau tidak satu situs pun bisa
// dihubungi. Kegagalan sebagian tidak — hasilnya dikirim di `penyegaran`, dan
// kartu dari situs yang berhasil tetap tampil.
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const diminta = req.body?.host ? String(req.body.host).trim().toLowerCase() : null;
    if (diminta && !scoutService.hostTerpindai().includes(diminta)) {
      throw badRequest(
        `Tidak ada konfigurasi katalog untuk ${diminta} di packages/sumber/selectors.js`,
      );
    }

    const penyegaran = await scoutService.segarkanSemua(diminta ? { hosts: [diminta] } : undefined);
    if (penyegaran.length > 0 && penyegaran.every((hasil) => hasil.galat)) {
      throw new HttpError(
        502,
        `Tidak ada sumber yang bisa dipindai: ${penyegaran.map((hasil) => `${hasil.host} (${hasil.galat})`).join('; ')}`,
      );
    }

    res.json({ ...scoutService.daftar(saringan({ ...req.query, ...req.body })), penyegaran });
  }),
);

// POST /api/scout/:id/import — masukkan satu kartu etalase ke koleksi.
// hanyaBaru: hanya chapter yang nomornya melebihi milik kita.
router.post(
  '/:id/import',
  asyncHandler(async (req, res) => {
    res.status(202).json(await scoutService.impor({ id: Number(req.params.id), hanyaBaru: mintaHanyaBaru(req.body) }));
  }),
);

export default router;

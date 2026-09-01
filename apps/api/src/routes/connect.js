import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import connectService, { MDNS_HOST, MDNS_ENABLED } from '../services/connectService.js';

const router = Router();

// GET /api/connect — alamat yang bisa dipakai perangkat lain
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ ...(await connectService.urlUtama()), mdnsHost: MDNS_ENABLED ? MDNS_HOST : null });
  }),
);

// GET /api/connect/qr — QR untuk dipindai dari HP (SVG, bisa langsung <img>)
router.get(
  '/qr',
  asyncHandler(async (req, res) => {
    // `terbaik` sudah mengurutkan: nama tetap > alamat overlay > alamat Wi-Fi.
    // Yang paling atas dipilih karena itu yang tetap berlaku setelah pindah
    // jaringan — QR lama tidak perlu dipindai ulang tiap ganti Wi-Fi.
    const { terbaik } = await connectService.urlUtama();
    const target = String(req.query.url ?? terbaik);
    const svg = await connectService.qrSvg(target);
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  }),
);

export default router;

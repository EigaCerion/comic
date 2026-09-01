import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import comics from './comics.js';
import chapters from './chapters.js';
import search from './search.js';
import downloads from './downloads.js';
import uploads from './uploads.js';
import imports from './imports.js';
import audit from './audit.js';
import connect from './connect.js';
import bookmarks from './bookmarks.js';
import stats from './stats.js';
import auth from './auth.js';
import users from './users.js';
import interaksi from './interaksi.js';
import { wajibKemampuan } from '../middleware/auth.js';

const router = Router();

// Dicatat sekali saat proses lahir. Dipakai halaman Pengaturan untuk menjawab
// pertanyaan yang selama ini tidak bisa dijawab dari layar: server ini hidup
// sejak kapan, dan apakah ia sempat mati tanpa ketahuan.
const MULAI_PADA = new Date().toISOString();

// Identitas satu masa hidup proses. Waktu mulai saja tidak cukup: dua kali
// restart dalam detik yang sama akan terlihat identik, dan justru restart
// beruntun itulah gejala yang perlu terbaca.
const ID_PROSES = randomUUID();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'naruread-api',
    version: '0.1.0',
    uptime: process.uptime(),
    mulaiPada: MULAI_PADA,
    idProses: ID_PROSES,
  });
});

// Terbuka untuk siapa pun — membaca komik tidak butuh akun. Penjagaan di
// dalamnya bersifat per-rute: GET bebas, perubahan data butuh izin.
router.use('/comics', comics);
router.use('/chapters', chapters);
router.use('/search', search);
router.use('/bookmarks', bookmarks);
router.use('/stats', stats);

// Seluruhnya operasional: mengelola koleksi, mengantre unduhan, memeriksa
// kelengkapan, dan melihat alamat jaringan. Dijaga di titik pemasangan supaya
// tidak ada satu pun rute di dalamnya yang lolos karena kelupaan.
router.use('/downloads', wajibKemampuan('kelola_koleksi'), downloads);
router.use('/imports', wajibKemampuan('kelola_koleksi'), imports);
router.use('/audit', wajibKemampuan('kelola_koleksi'), audit);
router.use('/connect', wajibKemampuan('kelola_koleksi'), connect);
router.use('/uploads', wajibKemampuan('unggah_chapter'), uploads);
router.use('/auth', auth);
router.use('/users', users);

// Rating & komentar: jalurnya /comics/:id/rating dan /comments/:id,
// jadi dipasang di akar /api, bukan di bawah salah satu router lain.
router.use('/', interaksi);

export default router;

import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import authService, { KEMAMPUAN, bolehkah } from '../services/authService.js';
import { NAMA_COOKIE, opsiCookie, wajibLogin } from '../middleware/auth.js';
import { batasiLogin, catatGagal, resetGagal } from '../middleware/rateLimit.js';
import { unauthorized } from '../utils/validators.js';

const router = Router();

/** Daftar kemampuan milik satu peran — dipakai UI untuk menyembunyikan menu. */
const kemampuanPeran = (peran) =>
  Object.keys(KEMAMPUAN).filter((nama) => bolehkah(peran, nama));

// POST /api/auth/login
router.post(
  '/login',
  batasiLogin,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body ?? {};
    let hasil;
    try {
      hasil = authService.login({
        username,
        password,
        userAgent: req.headers['user-agent'],
      });
    } catch (error) {
      // Kegagalan dihitung DI SINI, bukan di service: yang perlu dibatasi
      // adalah permintaan HTTP-nya, sementara service dipakai juga oleh jalur
      // internal (mis. verifikasi sandi lama) yang tidak boleh ikut mengunci.
      catatGagal(req);
      throw error;
    }
    resetGagal(req);
    res.cookie(NAMA_COOKIE, hasil.token, opsiCookie(hasil.kedaluwarsa));
    res.json({ user: hasil.user, kemampuan: kemampuanPeran(hasil.user.role) });
  }),
);

// POST /api/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    authService.hapusSesi(req.sesiToken);
    res.clearCookie(NAMA_COOKIE, { path: '/' });
    res.json({ keluar: true });
  }),
);

// GET /api/auth/me — dipanggil saat aplikasi dibuka. Tamu bukan error:
// membaca komik memang tidak butuh akun, jadi balasannya user: null.
router.get('/me', (req, res) => {
  res.json({
    user: req.user,
    kemampuan: req.user ? kemampuanPeran(req.user.role) : [],
  });
});

// POST /api/auth/register — pendaftaran mandiri, selalu sebagai reader.
// Peran lain hanya bisa dibuat super admin lewat /api/users.
router.post(
  '/register',
  batasiLogin,
  asyncHandler(async (req, res) => {
    const { username, password, displayName } = req.body ?? {};
    const user = authService.buatUser({ username, password, role: 'reader', displayName });
    const { token, kedaluwarsa } = authService.login({
      username: user.username,
      password,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(NAMA_COOKIE, token, opsiCookie(kedaluwarsa));
    res.status(201).json({ user, kemampuan: kemampuanPeran(user.role) });
  }),
);

// POST /api/auth/password — ganti sandi sendiri (wajib tahu sandi lama).
router.post(
  '/password',
  wajibLogin,
  asyncHandler(async (req, res) => {
    const { passwordLama, passwordBaru } = req.body ?? {};
    // Sandi lama tetap diminta walau sudah login: sesi yang tertinggal terbuka
    // di perangkat lain tidak boleh bisa mengambil alih akun.
    try {
      authService.login({ username: req.user.username, password: passwordLama });
    } catch {
      throw unauthorized('Kata sandi lama salah');
    }
    authService.ubahUser(req.user.id, { password: passwordBaru });
    res.clearCookie(NAMA_COOKIE, { path: '/' });
    res.json({ diubah: true, pesan: 'Kata sandi diganti. Semua sesi lama dikeluarkan, silakan masuk lagi.' });
  }),
);

export default router;

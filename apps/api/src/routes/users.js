import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import authService from '../services/authService.js';
import { wajibKemampuan } from '../middleware/auth.js';
import { badRequest } from '../utils/validators.js';

const router = Router();

// Seluruh berkas ini milik super admin. Dipasang sekali di sini, bukan
// diulang per rute — supaya tidak ada rute yang kelupaan dijaga.
router.use(wajibKemampuan('kelola_pengguna'));

// GET /api/users
router.get('/', asyncHandler(async (_req, res) => res.json({ items: authService.daftarUser() })));

// POST /api/users — buat akun dengan peran apa pun
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { username, password, role, displayName } = req.body ?? {};
    res.status(201).json(
      authService.buatUser({ username, password, role, displayName, createdBy: req.user.id }),
    );
  }),
);

// PATCH /api/users/:id — ubah peran, nama tampilan, status aktif, atau sandi
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { role, displayName, isActive, password } = req.body ?? {};

    // Menurunkan peran diri sendiri akan langsung mencabut akses ke halaman ini.
    // Dicegah di sini supaya tidak terjadi tanpa sengaja.
    if (id === req.user.id && role !== undefined && role !== req.user.role) {
      throw badRequest('Tidak bisa mengubah peran akun sendiri — minta super admin lain');
    }
    if (id === req.user.id && isActive === false) {
      throw badRequest('Tidak bisa menonaktifkan akun sendiri');
    }

    res.json(authService.ubahUser(id, { role, displayName, isActive, password }));
  }),
);

// DELETE /api/users/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw badRequest('Tidak bisa menghapus akun sendiri');
    res.json(authService.hapusUser(id));
  }),
);

export default router;

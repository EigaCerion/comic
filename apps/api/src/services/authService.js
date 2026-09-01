import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { badRequest, notFound } from '../utils/validators.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('naruread:auth');

/**
 * Peran dan kemampuannya.
 *
 * Membaca komik sengaja TIDAK ada di daftar ini — membaca tidak butuh akun
 * sama sekali. Akun hanya menambah kemampuan di atas itu.
 */
export const PERAN = ['super_admin', 'publisher', 'editor', 'author', 'reader'];

export const KEMAMPUAN = {
  // Hanya super admin yang boleh menyentuh akun orang lain.
  kelola_pengguna: ['super_admin'],
  // Menarik komik baru, mengantre unduhan, resync, audit, menghapus komik.
  kelola_koleksi: ['super_admin', 'publisher'],
  // Mengubah judul, sinopsis, genre, cover.
  sunting_metadata: ['super_admin', 'publisher', 'editor'],
  // Unggah chapter manual / impor berkas.
  unggah_chapter: ['super_admin', 'publisher', 'author'],
  // Menyembunyikan komentar yang tidak pantas.
  moderasi_komentar: ['super_admin', 'editor'],
  // Semua yang punya akun boleh menilai dan berkomentar.
  beri_rating: PERAN,
  komentar: PERAN,
};

export const bolehkah = (peran, kemampuan) =>
  Boolean(peran) && (KEMAMPUAN[kemampuan] ?? []).includes(peran);

// ── Kata sandi ────────────────────────────────────────────────────────

const PANJANG_KUNCI = 64;

/**
 * scrypt dari pustaka bawaan Node — bukan bcrypt.
 *
 * Alasannya praktis: bcrypt adalah modul native, dan pemasangan modul native
 * di mesin ini sudah pernah gagal karena gerbang allow-scripts npm. scrypt
 * setara untuk keperluan ini, sudah ada di Node, dan tidak menambah risiko
 * pemasangan sama sekali.
 */
export const hashSandi = (sandi) => {
  const salt = crypto.randomBytes(16);
  const kunci = crypto.scryptSync(String(sandi), salt, PANJANG_KUNCI);
  return `${salt.toString('hex')}:${kunci.toString('hex')}`;
};

export const cocokSandi = (sandi, tersimpan) => {
  const [saltHex, kunciHex] = String(tersimpan ?? '').split(':');
  if (!saltHex || !kunciHex) return false;
  try {
    const kunci = Buffer.from(kunciHex, 'hex');
    const uji = crypto.scryptSync(String(sandi), Buffer.from(saltHex, 'hex'), kunci.length);
    // Perbandingan waktu-tetap: mencegah penebakan lewat selisih waktu balasan.
    return crypto.timingSafeEqual(kunci, uji);
  } catch {
    return false;
  }
};

/** Syarat minimum sandi. Sengaja sederhana tapi bukan nol. */
const periksaSandi = (sandi) => {
  const nilai = String(sandi ?? '');
  if (nilai.length < 8) throw badRequest('Kata sandi minimal 8 karakter');
  return nilai;
};

const periksaUsername = (username) => {
  const nilai = String(username ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(nilai)) {
    throw badRequest('Username 3-32 karakter, hanya huruf, angka, titik, garis bawah, atau strip');
  }
  return nilai;
};

// ── Bentuk data yang boleh keluar ─────────────────────────────────────

/** password_hash TIDAK PERNAH ikut keluar dari sini. */
export const bentukUser = (row) =>
  row
    ? {
        id: row.id,
        username: row.username,
        role: row.role,
        displayName: row.display_name ?? row.username,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      }
    : null;

// ── Sesi ──────────────────────────────────────────────────────────────

const HARI = 24 * 60 * 60 * 1000;
export const UMUR_SESI_MS = 30 * HARI;

export const buatSesi = (userId, userAgent) => {
  const token = crypto.randomBytes(32).toString('hex');
  const kedaluwarsa = new Date(Date.now() + UMUR_SESI_MS).toISOString();
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)')
    .run(token, userId, kedaluwarsa, String(userAgent ?? '').slice(0, 200));
  return { token, kedaluwarsa };
};

/**
 * Cari pemilik token. Sesi kedaluwarsa dibuang saat ditemui, jadi tidak perlu
 * pekerjaan pembersihan terjadwal untuk pemakaian sekecil ini.
 */
export const userDariToken = (token) => {
  if (!token) return null;
  const db = getDb();
  const sesi = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!sesi) return null;

  if (new Date(sesi.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sesi.user_id);
  // Akun yang dinonaktifkan langsung kehilangan sesinya, tanpa perlu menunggu
  // kedaluwarsa — itulah gunanya sesi disimpan di server.
  if (!user || !user.is_active) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return bentukUser(user);
};

export const hapusSesi = (token) => {
  if (!token) return { keluar: false };
  const info = getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return { keluar: info.changes > 0 };
};

const hapusSemuaSesi = (userId) =>
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;

// ── Masuk ─────────────────────────────────────────────────────────────

export const login = ({ username, password, userAgent }) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '').trim());

  // Pesan yang sama untuk username salah maupun sandi salah: membedakannya
  // memberi tahu penebak bahwa sebuah username memang ada.
  const gagal = badRequest('Username atau kata sandi salah');
  if (!row) {
    // Tetap jalankan hashing sekali supaya lama balasan tidak membocorkan
    // apakah username-nya ada.
    cocokSandi(String(password ?? ''), hashSandi('pembanding'));
    throw gagal;
  }
  if (!row.is_active) throw badRequest('Akun ini dinonaktifkan');
  if (!cocokSandi(String(password ?? ''), row.password_hash)) throw gagal;

  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
  const { token, kedaluwarsa } = buatSesi(row.id, userAgent);
  log.info(`login: ${row.username} (${row.role})`);
  return { token, kedaluwarsa, user: bentukUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)) };
};

// ── Pengelolaan akun ──────────────────────────────────────────────────

export const daftarUser = () =>
  getDb()
    .prepare('SELECT * FROM users ORDER BY role, username COLLATE NOCASE')
    .all()
    .map(bentukUser);

export const buatUser = ({ username, password, role = 'reader', displayName, createdBy = null }) => {
  const nama = periksaUsername(username);
  const sandi = periksaSandi(password);
  if (!PERAN.includes(role)) throw badRequest(`Peran tidak dikenal: ${role}`);

  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(nama)) {
    throw badRequest(`Username "${nama}" sudah dipakai`);
  }

  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, display_name, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(nama, hashSandi(sandi), role, String(displayName ?? '').trim() || null, createdBy);

  log.info(`akun dibuat: ${nama} (${role})`);
  return bentukUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
};

export const ubahUser = (id, { role, displayName, isActive, password }) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) throw notFound('Akun tidak ditemukan');

  // Super admin terakhir tidak boleh diturunkan atau dimatikan — tanpa penjaga
  // ini, satu klik bisa membuat aplikasi kehilangan seluruh jalur pengelolaan.
  const menurunkan = role !== undefined && role !== 'super_admin';
  const mematikan = isActive !== undefined && !isActive;
  if (row.role === 'super_admin' && (menurunkan || mematikan)) {
    const sisa = db
      .prepare("SELECT COUNT(*) n FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?")
      .get(id).n;
    if (sisa === 0) throw badRequest('Ini satu-satunya super admin yang aktif — tidak bisa diturunkan atau dinonaktifkan');
  }

  if (role !== undefined) {
    if (!PERAN.includes(role)) throw badRequest(`Peran tidak dikenal: ${role}`);
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (displayName !== undefined) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(String(displayName).trim() || null, id);
  }
  if (isActive !== undefined) {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
    if (!isActive) hapusSemuaSesi(id); // nonaktif = langsung terlempar keluar
  }
  if (password !== undefined) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashSandi(periksaSandi(password)), id);
    hapusSemuaSesi(id); // ganti sandi mengusir semua sesi lama
  }

  return bentukUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
};

export const hapusUser = (id) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) throw notFound('Akun tidak ditemukan');
  if (row.role === 'super_admin') {
    const sisa = db
      .prepare("SELECT COUNT(*) n FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?")
      .get(id).n;
    if (sisa === 0) throw badRequest('Ini satu-satunya super admin yang aktif — tidak bisa dihapus');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  log.info(`akun dihapus: ${row.username}`);
  return { id: Number(id) };
};

/**
 * Siapkan super admin awal dari .env saat server menyala.
 *
 * Sandinya hanya dipakai saat akun belum ada; kalau akun sudah ada, nilai di
 * .env diabaikan supaya perubahan sandi lewat aplikasi tidak tertimpa balik
 * setiap restart.
 */
export const siapkanSuperAdmin = () => {
  const username = (process.env.SUPERADMIN_USERNAME || '').trim();
  const password = process.env.SUPERADMIN_PASSWORD || '';
  if (!username || !password) return null;

  const db = getDb();
  const ada = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (ada) {
    if (ada.role !== 'super_admin' || !ada.is_active) {
      db.prepare("UPDATE users SET role = 'super_admin', is_active = 1 WHERE id = ?").run(ada.id);
      log.info(`akun ${username} dikembalikan sebagai super admin aktif`);
    }
    return bentukUser(db.prepare('SELECT * FROM users WHERE id = ?').get(ada.id));
  }

  const user = buatUser({ username, password, role: 'super_admin', displayName: username });
  log.info(`super admin awal disiapkan: ${username}`);
  return user;
};

export default {
  PERAN,
  KEMAMPUAN,
  bolehkah,
  login,
  hapusSesi,
  userDariToken,
  daftarUser,
  buatUser,
  ubahUser,
  hapusUser,
  siapkanSuperAdmin,
  bentukUser,
  hashSandi,
  cocokSandi,
};

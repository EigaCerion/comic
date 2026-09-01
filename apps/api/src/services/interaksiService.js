import { getDb } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../utils/validators.js';
import { bolehkah } from './authService.js';

const BATAS_KOMENTAR = 2000;

/**
 * Rata-rata rating disimpan balik ke comics.rating.
 *
 * Kolom itu sudah dipakai kartu dan daftar komik sejak awal, jadi menghitung
 * ulang di sini membuat seluruh tampilan ikut benar tanpa satu pun query
 * tambahan saat menampilkan grid.
 */
const segarkanRataRata = (comicId) => {
  const db = getDb();
  const { rata } = db
    .prepare('SELECT AVG(value) AS rata FROM comic_ratings WHERE comic_id = ?')
    .get(comicId);
  db.prepare('UPDATE comics SET rating = ? WHERE id = ?').run(
    rata === null ? null : Number(rata.toFixed(2)),
    comicId,
  );
};

const pastikanKomik = (comicId) => {
  const komik = getDb().prepare('SELECT id FROM comics WHERE id = ?').get(comicId);
  if (!komik) throw notFound('Komik tidak ditemukan');
  return komik;
};

// ── Rating ────────────────────────────────────────────────────────────

export const ringkasanRating = (comicId, userId = null) => {
  pastikanKomik(comicId);
  const db = getDb();
  const agregat = db
    .prepare('SELECT AVG(value) AS rata, COUNT(*) AS jumlah FROM comic_ratings WHERE comic_id = ?')
    .get(comicId);

  // Sebaran 1-5 dipakai untuk menampilkan batang kecil di halaman detail:
  // rata-rata 4,0 dari dua nilai ekstrem sangat berbeda artinya dari 4,0 yang
  // datang dari sepuluh nilai yang seragam.
  const sebaran = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  db.prepare('SELECT value, COUNT(*) n FROM comic_ratings WHERE comic_id = ? GROUP BY value')
    .all(comicId)
    .forEach((row) => {
      sebaran[row.value] = row.n;
    });

  const milikSaya = userId
    ? db.prepare('SELECT value FROM comic_ratings WHERE comic_id = ? AND user_id = ?').get(comicId, userId)
    : null;

  return {
    rata: agregat.rata === null ? null : Number(agregat.rata.toFixed(2)),
    jumlah: agregat.jumlah,
    sebaran,
    milikSaya: milikSaya?.value ?? null,
  };
};

export const simpanRating = (comicId, userId, nilai) => {
  pastikanKomik(comicId);
  const angka = Number(nilai);
  if (!Number.isInteger(angka) || angka < 1 || angka > 5) {
    throw badRequest('Rating harus bilangan bulat 1 sampai 5');
  }

  // Satu pembaca satu nilai: menilai ulang berarti mengubah, bukan menambah.
  getDb()
    .prepare(
      `INSERT INTO comic_ratings (comic_id, user_id, value)
       VALUES (?, ?, ?)
       ON CONFLICT(comic_id, user_id) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now')`,
    )
    .run(comicId, userId, angka);

  segarkanRataRata(comicId);
  return ringkasanRating(comicId, userId);
};

export const hapusRating = (comicId, userId) => {
  pastikanKomik(comicId);
  getDb().prepare('DELETE FROM comic_ratings WHERE comic_id = ? AND user_id = ?').run(comicId, userId);
  segarkanRataRata(comicId);
  return ringkasanRating(comicId, userId);
};

// ── Komentar ──────────────────────────────────────────────────────────

const bentukKomentar = (row, peminta = null) => ({
  id: row.id,
  comicId: row.comic_id,
  body: row.is_hidden ? null : row.body,
  isHidden: Boolean(row.is_hidden),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  penulis: {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    role: row.role,
  },
  milikSaya: peminta ? row.user_id === peminta.id : false,
  bolehHapus: Boolean(
    peminta && (row.user_id === peminta.id || bolehkah(peminta.role, 'moderasi_komentar')),
  ),
  bolehSembunyikan: Boolean(peminta && bolehkah(peminta.role, 'moderasi_komentar')),
});

export const daftarKomentar = (comicId, peminta = null) => {
  pastikanKomik(comicId);
  const rows = getDb()
    .prepare(
      `SELECT k.*, u.username, u.display_name, u.role
         FROM comic_comments k
         JOIN users u ON u.id = k.user_id
        WHERE k.comic_id = ?
        ORDER BY k.created_at DESC
        LIMIT 200`,
    )
    .all(comicId);

  // Komentar tersembunyi tetap dikirim ke moderator (supaya bisa ditinjau),
  // tapi isinya dibuang untuk pembaca biasa — lihat bentukKomentar.
  const bolehLihatTersembunyi = peminta && bolehkah(peminta.role, 'moderasi_komentar');
  return rows
    .filter((row) => !row.is_hidden || bolehLihatTersembunyi || row.user_id === peminta?.id)
    .map((row) => {
      const bentuk = bentukKomentar(row, peminta);
      if (row.is_hidden && bolehLihatTersembunyi) bentuk.body = row.body;
      return bentuk;
    });
};

export const tambahKomentar = (comicId, user, isi) => {
  pastikanKomik(comicId);
  const teks = String(isi ?? '').trim();
  if (!teks) throw badRequest('Komentar tidak boleh kosong');
  if (teks.length > BATAS_KOMENTAR) {
    throw badRequest(`Komentar maksimal ${BATAS_KOMENTAR} karakter`);
  }

  const db = getDb();
  const info = db
    .prepare('INSERT INTO comic_comments (comic_id, user_id, body) VALUES (?, ?, ?)')
    .run(comicId, user.id, teks);

  const row = db
    .prepare(
      `SELECT k.*, u.username, u.display_name, u.role
         FROM comic_comments k JOIN users u ON u.id = k.user_id WHERE k.id = ?`,
    )
    .get(info.lastInsertRowid);
  return bentukKomentar(row, user);
};

export const hapusKomentar = (id, user) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM comic_comments WHERE id = ?').get(id);
  if (!row) throw notFound('Komentar tidak ditemukan');

  const miliknya = row.user_id === user.id;
  if (!miliknya && !bolehkah(user.role, 'moderasi_komentar')) {
    throw forbidden('Hanya penulisnya atau moderator yang bisa menghapus komentar ini');
  }
  db.prepare('DELETE FROM comic_comments WHERE id = ?').run(id);
  return { id: Number(id), dihapus: true };
};

/** Moderasi: disembunyikan, bukan dihapus — jejaknya tetap bisa ditinjau. */
export const sembunyikanKomentar = (id, user, sembunyikan = true) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM comic_comments WHERE id = ?').get(id);
  if (!row) throw notFound('Komentar tidak ditemukan');
  if (!bolehkah(user.role, 'moderasi_komentar')) {
    throw forbidden('Perlu izin moderasi komentar');
  }

  db.prepare('UPDATE comic_comments SET is_hidden = ?, hidden_by = ? WHERE id = ?').run(
    sembunyikan ? 1 : 0,
    sembunyikan ? user.id : null,
    id,
  );
  const baru = db
    .prepare(
      `SELECT k.*, u.username, u.display_name, u.role
         FROM comic_comments k JOIN users u ON u.id = k.user_id WHERE k.id = ?`,
    )
    .get(id);
  const bentuk = bentukKomentar(baru, user);
  bentuk.body = baru.body; // moderator tetap melihat isinya
  return bentuk;
};

export default {
  ringkasanRating,
  simpanRating,
  hapusRating,
  daftarKomentar,
  tambahKomentar,
  hapusKomentar,
  sembunyikanKomentar,
};

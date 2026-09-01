import { createLogger } from '../utils/logger.js';
import { HttpError } from '../utils/validators.js';

const log = createLogger('naruread:ratelimit');

/**
 * Pembatas percobaan login.
 *
 * Dipasang setelah audit menunjukkan 25 tebakan sandi bisa dikirim dalam 13
 * detik tanpa hambatan apa pun. Dua bahaya sekaligus di sana: penebakan sandi,
 * dan pemborosan CPU — scrypt sengaja lambat, jadi setiap percobaan gagal
 * menghabiskan tenaga server. Membanjirinya adalah cara mudah membuat aplikasi
 * ini berlutut tanpa perlu menebak sandi sama sekali.
 *
 * Disimpan di memori: aplikasi ini satu proses, dan hitungan yang hilang saat
 * restart bukan kerugian berarti dibanding menambah tabel dan tulisan disk di
 * jalur yang justru sedang diserang.
 */
const percobaan = new Map(); // kunci -> { gagal, sampai, terakhir }

const MAKS_GAGAL = 5;
const JEDA_DASAR_MS = 30 * 1000; // 30 detik, lalu berlipat
const JEDA_MAKS_MS = 15 * 60 * 1000; // dibatasi 15 menit
const UMUR_CATATAN_MS = 60 * 60 * 1000;

/** Buang catatan lama supaya Map tidak tumbuh tanpa batas. */
const bersihkan = () => {
  const batas = Date.now() - UMUR_CATATAN_MS;
  for (const [kunci, data] of percobaan) {
    if (data.terakhir < batas) percobaan.delete(kunci);
  }
};

const kunciDari = (req) => {
  // Digabung IP + username: satu penyerang tidak bisa mengunci akun orang lain
  // hanya dengan menebak dari alamat berbeda, dan satu alamat tidak bisa
  // menyapu banyak username tanpa terkena batas juga.
  const ip = req.ip || req.socket?.remoteAddress || 'tak-dikenal';
  const nama = String(req.body?.username ?? '').trim().toLowerCase();
  return `${ip}|${nama}`;
};

export const catatGagal = (req) => {
  const kunci = kunciDari(req);
  const data = percobaan.get(kunci) ?? { gagal: 0, sampai: 0, terakhir: 0 };
  data.gagal += 1;
  data.terakhir = Date.now();

  if (data.gagal >= MAKS_GAGAL) {
    const kelipatan = 2 ** (data.gagal - MAKS_GAGAL);
    data.sampai = Date.now() + Math.min(JEDA_DASAR_MS * kelipatan, JEDA_MAKS_MS);
    log.warn(`login diblokir sementara untuk ${kunci} (gagal ${data.gagal}x)`);
  }
  percobaan.set(kunci, data);
};

export const resetGagal = (req) => {
  percobaan.delete(kunciDari(req));
};

/** Menolak lebih awal kalau kunci ini sedang dalam masa tunggu. */
export const batasiLogin = (req, _res, next) => {
  if (percobaan.size > 500) bersihkan();

  const data = percobaan.get(kunciDari(req));
  if (data && data.sampai > Date.now()) {
    const detik = Math.ceil((data.sampai - Date.now()) / 1000);
    return next(
      new HttpError(429, `Terlalu banyak percobaan masuk. Coba lagi dalam ${detik} detik.`),
    );
  }
  return next();
};


// ── Pembatas aksi umum (komentar, rating) ────────────────────────────

const aksi = new Map(); // "nama|pemilik" -> { jumlah, mulai }

/**
 * Membatasi berapa kali satu akun boleh melakukan sebuah aksi dalam satu
 * jendela waktu.
 *
 * Berbeda dari pembatas login: di sini penggunanya sudah sah, jadi tujuannya
 * bukan menahan penyusup melainkan menahan penyalahgunaan — satu akun membanjiri
 * komentar sampai halaman detail tidak terpakai, atau menulis ribuan baris ke
 * database. Kunci memakai id akun, bukan IP, karena identitasnya sudah pasti.
 */
export const batasiAksi = ({ nama, maks, jendelaMs }) => (req, _res, next) => {
  const pemilik = req.user?.id ?? req.ip ?? 'tamu';
  const kunci = `${nama}|${pemilik}`;
  const sekarang = Date.now();
  const data = aksi.get(kunci);

  if (!data || sekarang - data.mulai > jendelaMs) {
    aksi.set(kunci, { jumlah: 1, mulai: sekarang });
    return next();
  }

  if (data.jumlah >= maks) {
    const detik = Math.ceil((data.mulai + jendelaMs - sekarang) / 1000);
    return next(
      new HttpError(429, `Terlalu cepat. Tunggu ${detik} detik sebelum ${nama} lagi.`),
    );
  }

  data.jumlah += 1;
  return next();
};

export default { batasiLogin, catatGagal, resetGagal, batasiAksi };

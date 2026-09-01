import { bolehkah, userDariToken } from '../services/authService.js';
import { forbidden, unauthorized } from '../utils/validators.js';

export const NAMA_COOKIE = 'naruread_sesi';

/**
 * Baca cookie tanpa pustaka tambahan.
 *
 * Hanya satu cookie yang dibutuhkan aplikasi ini, jadi menarik masuk
 * cookie-parser hanya untuk itu tidak sepadan.
 */
const bacaCookie = (header, nama) => {
  if (!header) return null;
  for (const bagian of String(header).split(';')) {
    const pisah = bagian.indexOf('=');
    if (pisah < 0) continue;
    if (bagian.slice(0, pisah).trim() !== nama) continue;
    try {
      return decodeURIComponent(bagian.slice(pisah + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Menempelkan req.user kalau ada sesi yang sah — TIDAK menolak siapa pun.
 *
 * Dipasang global karena membaca komik memang tidak butuh akun: sebagian besar
 * endpoint harus tetap melayani tamu, dan hanya perlu tahu "siapa ini" kalau
 * kebetulan sedang login (mis. untuk menandai rating miliknya sendiri).
 */
export const bacaSesi = (req, _res, next) => {
  const token = bacaCookie(req.headers.cookie, NAMA_COOKIE);
  req.sesiToken = token;
  req.user = token ? userDariToken(token) : null;
  next();
};

/** Wajib punya akun, peran apa pun. */
export const wajibLogin = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  return next();
};

/** Wajib punya kemampuan tertentu sesuai peran. */
export const wajibKemampuan = (kemampuan) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!bolehkah(req.user.role, kemampuan)) {
    return next(forbidden(`Perlu izin "${kemampuan}" — peran kamu: ${req.user.role}`));
  }
  return next();
};

/** Opsi cookie sesi. httpOnly: tidak bisa dibaca JavaScript halaman. */
export const opsiCookie = (kedaluwarsa) => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  expires: new Date(kedaluwarsa),
  // secure sengaja TIDAK dipasang: aplikasi ini dilayani lewat http di LAN,
  // dan cookie ber-flag secure tidak akan pernah terkirim di sana.
});

export default { bacaSesi, wajibLogin, wajibKemampuan, NAMA_COOKIE, opsiCookie };

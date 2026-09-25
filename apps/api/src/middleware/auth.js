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
 * Ambil token dari "Authorization: Bearer <token>".
 *
 * Aplikasi Android memuat UI-nya dari http://localhost di dalam WebView, sedang
 * servernya di http://192.168.x.x:3000. Itu dua origin yang berbeda, jadi
 * cookie sesi ber-sameSite=lax TIDAK PERNAH ikut terkirim ke sana — dan
 * melonggarkannya ke sameSite=none bukan jawabannya, karena browser hanya mau
 * menerima itu bersama flag secure, yang mustahil di LAN tanpa https.
 *
 * Yang dibawa persis token opaque yang sama yang sudah tersimpan di tabel
 * sessions, jadi tidak ada jalur kepercayaan baru yang dibuka di sini: hanya
 * cara mengangkutnya yang berbeda, dan pencabutannya tetap satu tempat.
 */
const bacaBearer = (header) => {
  const cocok = /^Bearer\s+(\S+)$/i.exec(String(header ?? '').trim());
  return cocok ? cocok[1] : null;
};

/**
 * Menempelkan req.user kalau ada sesi yang sah — TIDAK menolak siapa pun.
 *
 * Dipasang global karena membaca komik memang tidak butuh akun: sebagian besar
 * endpoint harus tetap melayani tamu, dan hanya perlu tahu "siapa ini" kalau
 * kebetulan sedang login (mis. untuk menandai rating miliknya sendiri).
 */
export const bacaSesi = (req, _res, next) => {
  // Cookie tetap didahulukan supaya browser sama sekali tidak berubah
  // perilakunya, tapi yang menentukan adalah sesi yang BENAR-BENAR terpecahkan,
  // bukan ada-tidaknya cookie. Dulu `??` bekerja pada NILAI cookie: begitu
  // header Cookie memuat naruread_sesi apa pun isinya, header Authorization
  // tidak pernah dilihat lagi. Build android sengaja juga dibuka di browser
  // desktop (lihat ASLI_NATIF di platform/index.js), dan di sana origin-nya
  // satu situs dengan server — port diabaikan cookie — sehingga cookie UI web
  // ikut terkirim bersama Bearer. Tiga akibatnya sudah diuji: cookie yang mati,
  // mis. sesudah ganti sandi memanggil hapusSemuaSesi, MEMBATALKAN Bearer yang
  // sah sehingga tiap rute berwajibLogin membalas 401; cookie milik akun lain
  // diam-diam mengambil alih permintaan aplikasi sehingga posisi baca mendarat
  // di akun yang salah; dan /auth/logout mencabut sesi cookie sambil
  // MEMBIARKAN sesi Bearer hidup, padahal apiSlice.js sudah membuang tokennya —
  // sesi yatim sampai kedaluwarsa 30 hari.
  //
  // req.sesiToken karena itu selalu menunjuk token yang sungguh melayani
  // permintaan ini: tanpa itu /auth/logout membalas "keluar" atas sesi yang
  // salah dan membiarkan yang benar hidup terus.
  const dariCookie = bacaCookie(req.headers.cookie, NAMA_COOKIE);
  const dariBearer = bacaBearer(req.headers.authorization);

  let token = dariCookie;
  let user = token ? userDariToken(token) : null;
  if (!user && dariBearer) {
    token = dariBearer;
    user = userDariToken(token);
  }

  req.sesiToken = token;
  req.user = user;
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

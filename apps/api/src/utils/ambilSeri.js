import { createLogger } from './logger.js';
import { fetchHtml } from './httpClient.js';

const log = createLogger('naruread:ambil-seri');

const jedaMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kegagalan SESAAT (jaringan/timeout) — bukan jawaban tegas dari server.
 *
 * Pembedaan ini yang menentukan apakah sebuah sumber layak dicoba lagi atau
 * layak dianggap mati: 404 dan 410 adalah jawaban, dan mengulanginya tiga kali
 * hanya membuang waktu; "fetch failed" bukan jawaban sama sekali.
 */
export const kegagalanSesaat = (pesan = '') =>
  /fetch failed|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|HTTP 5\d\d/i.test(pesan);

/**
 * Ambil halaman seri, dengan percobaan ulang untuk kegagalan sesaat.
 *
 * Cek update mengantrekan chapter baru, dan bot importir LANGSUNG mulai
 * mengunduh ke host yang sama — sampai 20 permintaan gambar paralel. Halaman
 * seri berikutnya lalu berebut jalur dengan unduhan itu dan sesekali kalah;
 * tanpa percobaan ulang, satu kekalahan sesaat terbaca sebagai "situsnya mati".
 *
 * Tinggal di utils, bukan di salah satu service, karena dua pemakainya saling
 * memanggil: auditService butuh ini untuk resync, sementara sumberService —
 * yang dipanggil auditService untuk memilih sumber mana yang dipakai — juga
 * membutuhkannya. Menaruhnya di salah satu dari keduanya berarti lingkaran
 * impor.
 */
export const ambilSeriUlet = async (url, { percobaan = 3 } = {}) => {
  let terakhir = null;
  for (let ke = 1; ke <= percobaan; ke += 1) {
    try {
      return await fetchHtml(url);
    } catch (error) {
      terakhir = error;
      if (!kegagalanSesaat(error.message) || ke === percobaan) throw error;
      const tunggu = 2000 * ke ** 2; // 2s, lalu 8s — cukup melewati puncak rebutan
      log.debug(`ambil ${url} gagal (${ke}/${percobaan}: ${error.message}), ulang dalam ${tunggu / 1000}s`);
      await jedaMs(tunggu);
    }
  }
  throw terakhir;
};

export default { ambilSeriUlet, kegagalanSesaat };

import { Router } from 'express';
import selectors from '@naruread/sumber/selectors.js';

const router = Router();

/**
 * GET /api/sumber/pola — tabel selector situs sumber apa adanya.
 *
 * Alasannya ada di aplikasi Android, bukan di sini: tabel yang dipakai HP ikut
 * dibekukan ke dalam APK, sehingga satu situs yang mengganti tema membuat
 * aplikasi berhenti membaca situs itu sampai ada rilis baru. Dengan rute ini,
 * server rumah yang tabelnya sudah diperbaiki bisa menyodorkannya, dan HP
 * memilih yang "versi"-nya lebih tinggi.
 *
 * Publik seperti /api/health, dan itu disengaja: justru orang yang BELUM punya
 * akun di server rumah — atau baru memindai QR-nya — yang membutuhkannya, dan
 * isinya sama sekali bukan rahasia. Tabel ini sudah tersalin utuh di dalam
 * setiap APK dan seluruhnya ada di repositori publik; menjaganya dengan token
 * hanya akan mengunci pembaruan justru dari perangkat yang paling perlu.
 *
 * Yang dikirim tabel MENTAH, tanpa dirapikan: yang membacanya adalah extractor
 * versi lain di seberang sana, dan setiap "perapihan" di sini adalah kesempatan
 * baru untuk membuat tabel yang sah jadi tidak terbaca di HP.
 */
router.get('/pola', (_req, res) => {
  // versi dibaca dari tabelnya sendiri, bukan disimpan terpisah, supaya tidak
  // ada dua angka yang bisa berbeda. Tabel tanpa versi diperlakukan sebagai 0:
  // HP akan menganggapnya lebih tua dari tabel bawaannya dan mengabaikannya —
  // jauh lebih aman daripada NaN yang lolos setiap perbandingan.
  res.json({ versi: Number(selectors.versi) || 0, pola: selectors });
});

export default router;

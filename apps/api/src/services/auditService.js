/**
 * Bot pengawas — pintu masuk tunggal.
 *
 * Isinya dulu 571 baris yang mengerjakan enam hal sekaligus: memeriksa berkas,
 * mencatat temuan, mencari nomor bolong, memeriksa chapter, memeriksa komik,
 * mengantre perbaikan, dan menyinkronkan daftar chapter dengan situs sumber.
 * Sekarang semuanya pindah ke services/pengawas/, satu berkas per pekerjaan:
 *
 *   berkasHalaman.js   satu berkas halaman — gambar utuh atau bukan?
 *                      Tanpa database, tanpa jaringan, bisa diuji langsung.
 *   temuan.js          buku catatan: tabel audit_findings (tulis, baca, tutup)
 *   lubang.js          nomor chapter yang bolong di koleksi
 *   periksaChapter.js  satu chapter: semua halamannya ada dan benar?
 *   periksaKomik.js    seluruh chapter sebuah komik + deteksi nomor bolong
 *   perbaiki.js        antrekan perbaikan atas temuan yang masih terbuka
 *   sinkronSeri.js     bandingkan koleksi dengan halaman seri di situs sumber
 *
 * Urutan ketergantungannya satu arah dan tidak boleh melingkar:
 *
 *   berkasHalaman ─┐
 *   temuan ────────┼─→ periksaChapter ─→ periksaKomik
 *   lubang ────────┘                      │
 *   temuan ────────────→ perbaiki ─→ sinkronSeri
 *
 * ── Kenapa berkas ini tetap ada ───────────────────────────────────────────
 *
 * routes/audit.js dan services/resyncAllService.js sudah mengimpor dari sini,
 * dan nama-nama yang mereka pakai adalah kontrak. Berkas ini meneruskannya apa
 * adanya, jadi pemecahan di atas tidak menyentuh satu pun pemanggil.
 *
 * Untuk kode BARU, impor langsung dari berkas yang dibutuhkan — lebih jelas apa
 * yang sebenarnya dipakai, dan tidak ikut menyeret enam modul lain.
 */
export { verifyPageFile } from './pengawas/berkasHalaman.js';
export { auditChapter } from './pengawas/periksaChapter.js';
export { auditComic } from './pengawas/periksaKomik.js';
export { findGaps, gapsFromNumbers } from './pengawas/lubang.js';
export { auditSummary, dismissFinding, openFindings } from './pengawas/temuan.js';
export { repairFindings } from './pengawas/perbaiki.js';
export { resyncComic } from './pengawas/sinkronSeri.js';

import { verifyPageFile } from './pengawas/berkasHalaman.js';
import { auditChapter } from './pengawas/periksaChapter.js';
import { auditComic } from './pengawas/periksaKomik.js';
import { findGaps, gapsFromNumbers } from './pengawas/lubang.js';
import { auditSummary, dismissFinding, openFindings } from './pengawas/temuan.js';
import { repairFindings } from './pengawas/perbaiki.js';
import { resyncComic } from './pengawas/sinkronSeri.js';

export default {
  auditChapter,
  auditComic,
  repairFindings,
  resyncComic,
  auditSummary,
  dismissFinding,
  openFindings,
  findGaps,
  gapsFromNumbers,
  verifyPageFile,
};

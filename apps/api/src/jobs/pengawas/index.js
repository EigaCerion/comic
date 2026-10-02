import { notifyChapterDone, startSupervisors, stopSupervisors, supervisorStatus } from './pekerja.js';

/**
 * Bot pengawas — pintu masuk tunggal.
 *
 * Bentuknya sengaja dibuat kembar dengan jobs/importir/: satu folder per bot,
 * satu berkas index.js sebagai pintunya, dan penjadwalnya di pekerja.js. Siapa
 * pun yang sudah paham salah satunya langsung paham yang lain.
 *
 *   pekerja.js   antrean di memori + penjadwalnya: berapa bot jalan bersamaan,
 *                komik mana yang diperiksa berikutnya, kapan disapu lagi
 *
 * PEMERIKSAANNYA sendiri tidak ada di folder ini — ia ada di
 * services/pengawas/ (periksa berkas, catat temuan, antrekan perbaikan).
 * Pembagiannya: jobs/ mengurus KAPAN sesuatu dikerjakan, services/ mengurus
 * APA yang dikerjakan. Itu sebabnya services/pengawas/ bisa diuji tanpa
 * menyalakan satu bot pun (apps/api/scripts/test-audit.js).
 */
export { notifyChapterDone, startSupervisors, stopSupervisors, supervisorStatus };
export default { startSupervisors, stopSupervisors, notifyChapterDone, supervisorStatus };

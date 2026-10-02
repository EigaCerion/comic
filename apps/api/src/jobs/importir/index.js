import { startWorker, stopWorker } from './pekerja.js';

/**
 * Bot importir — pintu masuk tunggal.
 *
 * Isinya dulu satu berkas 373 baris (jobs/downloadQueue.js) yang mengerjakan
 * lima hal sekaligus. Sekarang satu berkas per pekerjaan:
 *
 *   alamatGambar.js   dari sebuah job, hasilkan daftar URL gambar
 *   unduhHalaman.js   unduh SATU gambar, dengan ulangan dan host cadangan
 *   folderChapter.js  pasang halaman pengganti; bersihkan sisa folder terhapus
 *   kerjakanJob.js    kerjakan satu job dari awal sampai tercatat
 *   pekerja.js        putaran penjadwalnya: berapa bot, kapan ditengok lagi
 *
 * Ketergantungannya satu arah:
 *   alamatGambar ─┐
 *   unduhHalaman ─┼─→ kerjakanJob ─→ pekerja
 *   folderChapter ┘
 */
export { startWorker, stopWorker };
export default { startWorker, stopWorker };

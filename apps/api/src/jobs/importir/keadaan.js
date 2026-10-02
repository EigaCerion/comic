/**
 * Satu bendera "bot sedang dihentikan", dipakai bersama tiga modul importir.
 *
 * Dulu ini `let stopped` biasa di dalam satu berkas raksasa, dan setiap bagian
 * membacanya begitu saja. Begitu berkas itu dipecah, variabel modul tidak lagi
 * bisa dilihat tetangganya — dan kalau dibiarkan jadi salinan per modul,
 * menekan "hentikan" hanya akan menghentikan penjadwalnya sementara unduhan
 * yang sedang berjalan terus menulis berkas sampai selesai.
 *
 * Dibuat sebagai fungsi, bukan variabel yang diekspor langsung: nilai yang
 * diekspor dari modul ES bersifat live binding untuk pembacanya, tapi hanya
 * pemiliknya yang boleh menulisinya — dan mencampuradukkan keduanya adalah
 * sumber kebingungan yang tidak sebanding dengan dua baris ini.
 */
let berhenti = false;

/** Apakah bot importir sedang dalam keadaan dihentikan? */
export const sedangBerhenti = () => berhenti;

/** Hanya pekerja.js yang memanggil ini — lewat startWorker/stopWorker. */
export const setelBerhenti = (nilai) => {
  berhenti = nilai === true;
};

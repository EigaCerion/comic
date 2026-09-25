import { useEffect } from 'react';
import { ASLI_NATIF } from './index.js';
import { lepasLayar, tahanLayar } from './jagaLayar.js';

/**
 * Penyesuaian perangkat selama reader terbuka: status bar disembunyikan dan
 * layar dijaga tetap menyala.
 *
 * Layar mati saat membaca adalah masalah nyata di HP, bukan kenyamanan:
 * pembaca komik bisa diam belasan menit di satu halaman panjang tanpa menyentuh
 * layar, dan Android menganggapnya menganggur. Status bar disembunyikan karena
 * strip komik memakai seluruh tinggi (100dvh) — dengan status bar tetap tampil,
 * setiap halaman kehilangan pita di atasnya.
 *
 * Dipasang sebagai komponen supaya Reader cukup menulis
 * `{IS_APP && <ModeBacaNatif />}`; pada build web baris itu runtuh jadi false.
 */
export const ModeBacaNatif = () => {
  useEffect(() => {
    if (!ASLI_NATIF) return undefined;

    // Reader bisa ditutup sebelum import() plugin selesai (chapter dibuka lalu
    // langsung ditekan kembali). Penanda ini mencegah status bar disembunyikan
    // SESUDAH orangnya keluar — kondisi yang tidak akan pernah dipulihkan
    // karena pembersihannya sudah telanjur berjalan.
    let masihDibaca = true;

    const masuk = async () => {
      try {
        const { StatusBar } = await import('@capacitor/status-bar');
        if (masihDibaca) await StatusBar.hide();
      } catch {
        /* perangkat tanpa StatusBar: bukan alasan untuk gagal membaca */
      }
    };

    const keluar = async () => {
      try {
        const { StatusBar } = await import('@capacitor/status-bar');
        await StatusBar.show();
      } catch {
        /* diabaikan */
      }
    };

    masuk();
    // Penjaga layar lewat penghitung bersama, bukan plugin langsung: antrean
    // unduh memegangnya juga, dan yang selesai duluan tidak boleh mematikan
    // penjaga milik yang lain. Dipanggil serempak di sini dan di pembersihan
    // supaya pasangannya tetap tepat kalau reader ditutup sebelum masuk()
    // selesai.
    tahanLayar();

    return () => {
      masihDibaca = false;
      keluar();
      lepasLayar();
    };
  }, []);

  return null;
};

export default ModeBacaNatif;

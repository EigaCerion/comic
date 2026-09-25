import { useEffect } from 'react';
import { catatPosisi } from './posisiBaca.js';

/**
 * Pencatat posisi baca versi aplikasi: selalu ke penyimpanan HP dulu, ke server
 * belakangan.
 *
 * Di web posisi baca disimpan lewat mutation RTK Query dan boleh gagal begitu
 * saja. Di HP itu tidak cukup — chapter yang sudah disimpan tetap terbaca
 * sampai habis tanpa server sama sekali, dan seluruh riwayat perjalanan itu
 * akan hilang kalau satu-satunya penyimpanan adalah PUT yang gagal.
 *
 * Jeda 800 ms-nya menyalin jeda yang sudah dipakai jalur web: menyimpan tiap
 * peristiwa gulir berarti satu penulisan penyimpanan per frame.
 */
export const PosisiBacaApp = ({ chapterId, comicId, halaman }) => {
  useEffect(() => {
    if (!chapterId || !halaman) return undefined;
    const jam = setTimeout(() => {
      catatPosisi({ chapterId, comicId, halaman });
    }, 800);
    return () => clearTimeout(jam);
  }, [chapterId, comicId, halaman]);

  return null;
};

export default PosisiBacaApp;

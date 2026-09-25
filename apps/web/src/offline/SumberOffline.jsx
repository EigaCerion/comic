import { useEffect, useRef } from 'react';
import { bebaskanHalaman, rakitChapterLokal } from './bacaLokal.js';
import { useIndeksOffline } from './penyimpanan.js';

/**
 * Menyodorkan salinan lokal sebuah chapter ke Reader — tanpa merender apa pun.
 *
 * Ditulis sebagai komponen, bukan hook, karena hook harus dipanggil tanpa
 * syarat: satu `useChapterLokal()` di Reader akan menyeret seluruh lapisan
 * offline (dan lewat itu, plugin Capacitor) ke bundel web yang tidak pernah
 * memakainya. Sebagai komponen ia cukup ditulis `{IS_APP && <SumberOffline …/>}`
 * dan Rollup membuangnya berikut seluruh cabang modulnya.
 *
 * Hasilnya dikirim lewat onHasil — yang harus stabil, jadi Reader memberikan
 * setter useState-nya langsung.
 */
export const SumberOffline = ({ chapterId, onHasil }) => {
  // Hanya status chapter INI yang dipantau, bukan seluruh katalog. Kalau
  // katalognya yang dipantau, setiap chapter lain yang selesai diunduh di latar
  // akan menyusun ulang chapter yang sedang dibaca — dan Reader menganggap
  // susunan baru itu sebagai chapter yang baru dibuka, lalu melompat ke posisi
  // baca tersimpan di tengah orangnya membaca.
  const tersimpan = Boolean(useIndeksOffline().chapter[Number(chapterId)]);
  const terakhir = useRef(null);

  useEffect(() => {
    let dibuang = false;

    rakitChapterLokal(chapterId).then((hasil) => {
      if (dibuang) {
        bebaskanHalaman(hasil.halaman);
        return;
      }
      bebaskanHalaman(terakhir.current);
      terakhir.current = hasil.halaman;
      onHasil(hasil);
    });

    return () => {
      dibuang = true;
    };
  }, [chapterId, tersimpan, onHasil]);

  // Blob URL di browser desktop menahan seluruh isi gambar di memori sampai
  // dilepas. Satu chapter webtoon 40 halaman cukup untuk membuat tab ini berat
  // setelah beberapa kali pindah chapter.
  useEffect(
    () => () => {
      bebaskanHalaman(terakhir.current);
      terakhir.current = null;
    },
    [],
  );

  return null;
};

export default SumberOffline;

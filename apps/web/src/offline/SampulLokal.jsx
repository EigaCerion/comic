import { useEffect, useState } from 'react';
import { bebaskanUrl, urlLokal } from './penyimpanan.js';

/**
 * Sampul komik yang dibaca dari penyimpanan HP, bukan dari server.
 *
 * Dipakai dua layar (rak /offline dan baris "Tersimpan di HP" di beranda), dan
 * itu sebabnya ia berdiri sendiri: melepas blob URL adalah bagian yang paling
 * mudah terlupakan saat kode seperti ini disalin, dan yang terlupa tidak pernah
 * terlihat sebagai bug — hanya sebagai aplikasi yang makin berat setelah
 * beberapa kali berpindah layar.
 *
 * `sampul` berbentuk "<chapterId>/<namaBerkas>", persis seperti yang disimpan di
 * katalog: sampul ikut diunduh ke dalam folder tiap chapter supaya menghapus satu
 * chapter tetap jadi operasi tunggal.
 */
export const SampulLokal = ({ sampul, judul, className = 'aspect-[2/3] w-14 flex-none rounded-lg' }) => {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let dibuang = false;
    let dipegang = null;

    if (!sampul) return undefined;
    const [chapterId, nama] = sampul.split('/');
    urlLokal(chapterId, nama).then((hasil) => {
      if (dibuang) {
        bebaskanUrl(hasil);
        return;
      }
      dipegang = hasil;
      setUrl(hasil);
    });

    return () => {
      dibuang = true;
      bebaskanUrl(dipegang);
    };
  }, [sampul]);

  if (!url) {
    return <div className={`${className} flex items-center justify-center bg-leaf/10 text-xl`}>🍥</div>;
  }

  return <img src={url} alt={`Cover ${judul}`} className={`${className} object-cover`} />;
};

export default SampulLokal;

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { urlMedia } from './server.js';

/**
 * Ubin sampul untuk layar HP — dipakai beranda dan halaman Jelajahi.
 *
 * Dipisah dari ComicCard, bukan dipakai ulang darinya, karena keduanya menjawab
 * pertanyaan yang berbeda. ComicCard adalah kartu grid layar lebar: judul dua
 * baris, jumlah chapter, status unduhan, waktu baca terakhir — semuanya muat
 * karena kartunya selebar 170px ke atas. Di kolom selebar 105px, metadata yang
 * sama terpotong jadi deretan elipsis dan ubinnya berhenti memberi informasi
 * apa pun selain sampul.
 *
 * Jadi yang di sini sengaja menyisakan satu hal saja selain sampul: judulnya.
 * Sisanya ada di halaman detail, satu ketukan jauhnya.
 */

/**
 * Sampul dengan penahan kalau gambarnya tidak sampai.
 *
 * Penangkap onError-nya bukan kehati-hatian berlebihan: sampul datang dari
 * koleksi lokal MAUPUN CDN situs sumber, dan yang kedua sesekali menolak
 * permintaan yang datang dari origin lain. Tanpa penahan ini yang tersisa
 * adalah ikon gambar rusak bawaan browser di tengah deretan sampul.
 */
export const Sampul = ({ komik, className = '' }) => {
  const [gagal, setGagal] = useState(false);
  const alamat = komik?.coverUrl ? urlMedia(komik.coverUrl) : null;

  if (!alamat || gagal) {
    return (
      <div className={`flex items-center justify-center bg-surface-soft text-2xl ${className}`} aria-hidden="true">
        🍥
      </div>
    );
  }

  return (
    <img
      src={alamat}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setGagal(true)}
    />
  );
};

/**
 * Satu ubin komik.
 *
 * @param {object}      komik
 * @param {number|null} kemajuan  persen baca; ditempel sebagai bilah tipis di
 *                                KAKI sampul, bukan baris sendiri di bawah
 *                                judul — di ubin selebar 116px, satu baris
 *                                tambahan mendorong judulnya keluar.
 * @param {string|null} lanjutKe  tujuan ketukan; tanpa ini ke halaman detail.
 * @param {string}      lebar     kelas lebar. Baris mendatar memakai lebar
 *                                tetap supaya ubinnya terpotong rapi di tepi
 *                                layar; grid memakai 'w-full'.
 */
export const Ubin = ({ komik, kemajuan = null, lanjutKe = null, lebar = 'w-[116px] flex-none' }) => (
  <Link to={lanjutKe ?? `/comic/${komik.slug}`} className={lebar}>
    <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-soft">
      <Sampul komik={komik} className="h-full w-full object-cover" />
      {kemajuan != null && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-night/50">
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, kemajuan))}%` }} />
        </div>
      )}
    </div>
    <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug">{komik.title}</p>
  </Link>
);

export default Ubin;

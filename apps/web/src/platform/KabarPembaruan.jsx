import { useState } from 'react';
import { usePembaruan } from './pembaruan.js';

/**
 * Kabar "ada versi baru", dipasang tepat di bawah TopBar.
 *
 * Kartu di Pengaturan saja tidak cukup: halaman itu dibuka orang ketika ia
 * sudah CURIGA ada yang perlu disetel. Aplikasi hasil sideload tidak punya toko
 * yang mengetuk dari luar, jadi kalau kabarnya hanya ada di sana, versi yang
 * sudah dirilis akan berminggu-minggu tidak terpasang di HP siapa pun.
 *
 * Seperti PitaOffline, ia duduk di dalam aliran halaman dan bukan overlay
 * melayang: yang melayang menutupi TopBar selama tampil, dan ini bukan kabar
 * darurat — ia boleh menunggu digulir. Warnanya jingga aksen aplikasi, bukan
 * merah: pita merah di tempat yang sama berarti "server rumah tidak
 * terjangkau", dan dua kabar berbeda dengan warna sama akan dibaca sebagai satu
 * masalah yang sama.
 */
export const KabarPembaruan = () => {
  const { tampilkanKabar, versiRilis, urlUnduh, catatan, namaRilis, abaikanPembaruan } = usePembaruan();
  const [catatanTerbuka, setCatatanTerbuka] = useState(false);

  if (!tampilkanKabar) return null;

  return (
    <div role="status" className="gutter-app bg-naruto/10 py-2 text-xs text-naruto">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">NaruReader {versiRilis}</span> sudah tersedia
          {namaRilis ? ` — ${namaRilis}` : ''}.
        </span>

        {/* Lihat penjelasan panjang di KartuPembaruan.jsx: <a> biasa, karena
            navigasi ke host luar diserahkan jembatan Capacitor ke Android lewat
            Intent.ACTION_VIEW. Pemasangan APK-nya tetap urusan Android. */}
        <a href={urlUnduh} target="_blank" rel="noreferrer" className="flex-none font-semibold underline">
          Unduh
        </a>
        <button type="button" className="flex-none font-semibold underline" onClick={() => abaikanPembaruan()}>
          Nanti
        </button>
      </div>

      {catatan && (
        <div className="mt-2">
          <button
            type="button"
            className="font-semibold underline opacity-70"
            onClick={() => setCatatanTerbuka((buka) => !buka)}
          >
            {catatanTerbuka ? 'Sembunyikan catatan rilis' : 'Apa yang berubah?'}
          </button>
          {/* Teks dari internet, ditampilkan sebagai TEKS. Catatan rilis GitHub
              ditulis dalam Markdown, dan menerjemahkannya jadi HTML di sini
              berarti menaruh tulisan orang lain ke dalam DOM aplikasi.
              whitespace-pre-line menjaga pergantian barisnya tetap terbaca —
              pre-line, bukan pre-wrap, supaya indentasi Markdown tidak ikut
              melebarkan pita ini di layar sempit. */}
          {catatanTerbuka && (
            <p className="mt-2 max-h-96 overflow-y-auto whitespace-pre-line opacity-70">{catatan}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default KabarPembaruan;

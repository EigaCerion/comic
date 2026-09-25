import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatBytes, formatChapterNumber } from '../utils/format.js';
import { komikTersimpan, useIndeksOffline } from './penyimpanan.js';
import { posisiLokal } from './posisiBaca.js';
import SampulLokal from './SampulLokal.jsx';

/**
 * Baris "Tersimpan di HP" di beranda — hanya build Android.
 *
 * Kenapa ini perlu ada: beranda seluruhnya digerakkan API (komik terbaru,
 * favorit, lanjut baca), jadi komik yang sudah dibawa ke HP tidak pernah
 * muncul di sana. Akibatnya bukan sekadar kurang lengkap. Saat server rumah
 * tidak terjangkau — yaitu SATU-SATUNYA keadaan yang membuat orang menyimpan
 * chapter ke HP — layar pertama aplikasi menulis "Perpustakaan masih kosong"
 * kepada orang yang komiknya justru ada di dalam HP-nya.
 *
 * Ditulis sebagai komponen sendiri, bukan sebagai potongan di dalam Home.jsx,
 * karena alasan yang sama dengan SumberOffline: Home.jsx ikut ke bundel web, dan
 * satu impor statis ke lapisan offline dari sana akan menyeret plugin Capacitor
 * ke bundel yang tidak pernah memakainya. Dipakai sebagai `{IS_APP && <RakBeranda/>}`,
 * ungkapannya runtuh jadi false dan Rollup membuang berkas ini beserta cabangnya.
 *
 * Yang ditampilkan: chapter yang paling pantas dilanjutkan per komik, bukan
 * chapter pertama — titik lanjut baca dibaca dari simpanan lokal (posisiLokal),
 * yang tetap benar tanpa server.
 */

/**
 * Chapter yang akan dibuka saat kartunya diketuk.
 *
 * Aturannya: chapter tersimpan terakhir yang sudah pernah dibaca dan BELUM
 * tamat; kalau semua sudah tamat, chapter tersimpan berikutnya sesudahnya; kalau
 * belum ada yang pernah dibaca sama sekali, yang bernomor terkecil.
 */
const chapterLanjut = (chapter = []) => {
  if (chapter.length === 0) return null;

  const dibaca = chapter
    .map((entri) => ({ entri, posisi: posisiLokal(entri.id) }))
    .filter((satu) => satu.posisi?.halaman);
  if (dibaca.length === 0) return chapter[0];

  // Yang paling baru dibaca, bukan yang bernomor terbesar: chapter lama yang
  // ditambal belakangan tidak boleh mengklaim titik lanjut baca.
  const terakhir = dibaca.reduce((pilih, satu) =>
    String(satu.posisi.readAt ?? '') > String(pilih.posisi.readAt ?? '') ? satu : pilih,
  );

  const tamat = terakhir.posisi.halaman >= (terakhir.entri.jumlahHalaman ?? Infinity);
  if (!tamat) return terakhir.entri;

  const urut = chapter.findIndex((entri) => entri.id === terakhir.entri.id);
  return chapter[urut + 1] ?? terakhir.entri;
};

export const RakBeranda = () => {
  const indeks = useIndeksOffline();
  const daftar = useMemo(() => komikTersimpan(indeks), [indeks]);

  if (daftar.length === 0) return null;

  const bytes = daftar.reduce((jumlah, komik) => jumlah + (komik.bytes ?? 0), 0);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="section-title">
          <span aria-hidden="true">📲</span>
          Tersimpan di HP
          <span className="ml-2 text-xs font-normal opacity-60">{formatBytes(bytes)}</span>
        </h2>
        <Link to="/offline" className="flex-none text-xs font-semibold text-naruto hover:underline">
          Kelola
        </Link>
      </div>

      {/* Baris mendatar yang bisa digulir, bukan grid: bagian ini tidak boleh
          mendorong "Lanjut baca" dan "Baru diperbarui" jauh ke bawah hanya karena
          ada 20 komik tersimpan. */}
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {daftar.map((komik) => {
          const lanjut = chapterLanjut(komik.chapter);
          return (
            <li key={komik.id} className="w-28 flex-none snap-start sm:w-32">
              <Link
                to={lanjut ? `/read/${lanjut.id}` : '/offline'}
                className="block"
                title={
                  lanjut
                    ? `${komik.judul} — Ch ${formatChapterNumber(lanjut.nomor)}`
                    : komik.judul
                }
              >
                <SampulLokal
                  sampul={komik.sampul}
                  judul={komik.judul}
                  className="aspect-[2/3] w-full rounded-xl"
                />
                <p className="mt-1.5 truncate text-xs font-semibold">{komik.judul}</p>
                <p className="truncate text-[11px] opacity-60">
                  {lanjut ? `Ch ${formatChapterNumber(lanjut.nomor)} · ` : ''}
                  {komik.chapter.length} chapter
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default RakBeranda;

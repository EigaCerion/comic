import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ambilSeri } from '../sumber/ambil.js';
import { siapkanPola } from '../sumber/pola.js';
import { EmptyState, Spinner } from '../components/Common/index.jsx';
import { formatChapterNumber } from '../utils/format.js';

/**
 * Satu seri di situs sumber, dibaca langsung oleh HP: sampul, sinopsis, genre,
 * dan daftar chapternya.
 *
 * Alamat serinya datang lewat query `?url=`, bukan lewat segmen jalur. Alasannya
 * sederhana dan sudah terbukti mahal di tempat lain: alamat seri memuat garis
 * miring, titik dua, dan tanda tanya, dan menyelipkannya sebagai segmen jalur
 * berarti setiap kali router harus menebak di mana alamat itu berakhir.
 *
 * Halaman ini BELUM mengunduh apa pun. Tiap baris chapter sudah menyediakan
 * tempat untuk tombol simpan (`aksi`), tapi yang mengisinya adalah milestone
 * unduhan — bentuk barisnya dipastikan sekarang supaya penambahan itu nanti
 * tidak perlu membongkar tata letaknya.
 */

const labelSumber = (host) => {
  const potongan = String(host ?? '').toLowerCase().replace(/^www\./, '').split('.');
  const nama = potongan.length > 2 ? potongan[potongan.length - 2] : potongan[0];
  return nama ? nama[0].toUpperCase() + nama.slice(1) : 'Sumber';
};

/**
 * Satu baris chapter.
 *
 * `aksi` adalah satu-satunya alasan komponen ini dipisah: milestone unduhan
 * menaruh tombol simpan di sana, dan baris ini sudah menyediakan ruangnya
 * dengan lebar tetap supaya judul chapter yang panjang tidak mendorong tombol
 * keluar layar begitu tombolnya muncul.
 */
const BarisChapter = ({ chapter, aksi = null }) => (
  <li className="flex min-w-0 items-center gap-3 border-b border-paper-line px-3 py-2 last:border-b-0 dark:border-night-line">
    <span className="w-16 flex-none text-xs font-bold tabular-nums">
      {chapter.nomor == null ? '—' : formatChapterNumber(chapter.nomor)}
    </span>
    <span className="min-w-0 flex-1 truncate text-sm" title={chapter.judul ?? ''}>
      {chapter.judul || `Chapter ${chapter.nomor ?? '?'}`}
    </span>
    {aksi ? <span className="flex-none">{aksi}</span> : null}
  </li>
);

/**
 * Sampul seri, dengan penahan kalau gambarnya tidak sampai.
 *
 * Sama alasannya dengan sampul kartu di layar Sumber, dan terbukti di layar:
 * sampul datang langsung dari CDN situs sumber, dan sebagian menolak permintaan
 * yang datang dari origin lain. Tanpa penangkap onError, yang tersisa adalah
 * kotak 2/3 yang benar-benar kosong — terbaca seperti halaman yang gagal dimuat,
 * padahal judul, sinopsis, dan seluruh daftar chapternya ada di sebelahnya.
 */
const SampulSeri = ({ seri }) => {
  const [gagal, setGagal] = useState(false);

  if (!seri.coverUrl || gagal) {
    return <div className="flex h-full w-full items-center justify-center text-3xl">🍥</div>;
  }

  return (
    <img
      src={seri.coverUrl}
      alt={`Sampul ${seri.title}`}
      className="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setGagal(true)}
    />
  );
};

export const SumberSeri = () => {
  const [params] = useSearchParams();
  const alamat = params.get('url') ?? '';

  const [seri, setSeri] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);

  const muat = useCallback(async () => {
    if (!alamat) return;
    setMemuat(true);
    setGalat(null);
    try {
      // Tabel pola disiapkan lebih dulu di sini juga, bukan hanya di layar
      // Sumber: halaman ini bisa dibuka langsung dari riwayat atau tombol Back
      // tanpa pernah melewati layar itu, dan membacanya dengan selector lama
      // menghasilkan "0 chapter" yang menuduh situsnya.
      await siapkanPola();
      setSeri(await ambilSeri(alamat));
    } catch (error) {
      setGalat(error?.message ?? 'Halaman seri gagal dibaca');
    } finally {
      setMemuat(false);
    }
  }, [alamat]);

  useEffect(() => {
    muat();
  }, [muat]);

  /*
   * Chapter diurutkan dari yang terbaru dan dibentuk ulang seperlunya di sini.
   *
   * `kunci` dipakai sebagai key React dan memakai URL-nya, bukan nomornya:
   * sebagian situs menerbitkan dua tautan bernomor sama (chapter ulang, atau
   * versi berwarna), dan key kembar membuat React memperbarui baris yang salah.
   * Milestone unduhan butuh persis trio yang sama — nomor, judul, dan URL — jadi
   * bentuk ini yang dipertahankan.
   */
  const chapters = useMemo(() => {
    const mentah = Array.isArray(seri?.chapters) ? seri.chapters : [];
    return mentah
      .map((chapter) => ({
        kunci: chapter.url,
        nomor: Number.isFinite(chapter.number) ? chapter.number : null,
        judul: chapter.title ?? null,
        url: chapter.url,
      }))
      .sort((a, b) => (b.nomor ?? -Infinity) - (a.nomor ?? -Infinity));
  }, [seri]);

  if (!alamat) {
    return (
      <EmptyState
        icon="🧭"
        title="Alamat seri tidak disebut"
        description="Halaman ini dibuka dari kartu di layar Situs Sumber."
        action={
          <Link to="/sumber" className="btn-accent">
            Ke Situs Sumber
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Link to="/sumber" className="text-xs text-night/60 hover:text-naruto dark:text-paper/60">
        ← Situs Sumber
      </Link>

      {memuat && !seri && <Spinner label="Membaca halaman seri…" />}

      {galat && !memuat && (
        <div className="card border-danger/40 px-6 py-8 text-center">
          <p className="text-sm font-semibold text-danger">Halaman seri gagal dibaca</p>
          {/* Pesannya sudah memuat status HTTP-nya kalau ada (lihat GalatSumber
              di sumber/ambil.js), dan itu yang membedakan "situs mati" dari
              "serinya sudah dihapus" — dua hal yang menuntut tindakan berbeda. */}
          <p className="mt-2 break-words text-xs text-night/60 dark:text-paper/60">{galat}</p>
          <p className="mt-2 break-all text-[11px] text-night/40 dark:text-paper/40">{alamat}</p>
          <button type="button" className="btn-ghost mt-4" onClick={muat}>
            Coba lagi
          </button>
        </div>
      )}

      {seri && (
        <>
          <div className="card flex flex-col gap-4 p-4 sm:flex-row">
            <div className="aspect-[2/3] w-32 flex-none overflow-hidden rounded-xl bg-paper-line dark:bg-night-line">
              <SampulSeri seri={seri} />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-black leading-snug">{seri.title}</h1>
              <p className="mt-1 text-[11px] text-night/50 dark:text-paper/50">
                {[labelSumber(seri.source), seri.status, seri.author, seri.artist].filter(Boolean).join(' · ')}
              </p>

              {seri.genres?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {seri.genres.map((genre) => (
                    <span key={genre} className="chip px-2 py-0.5 text-[11px]">
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {seri.description && (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-night/70 dark:text-paper/70">
                  {seri.description}
                </p>
              )}
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="section-title">
                <span aria-hidden="true">📚</span> Chapter
                <span className="ml-2 text-xs font-normal opacity-60">{chapters.length}</span>
              </h2>
              <button type="button" className="btn-ghost flex-none px-3 py-1 text-xs" onClick={muat} disabled={memuat}>
                {memuat ? 'Memuat…' : 'Muat ulang'}
              </button>
            </div>

            {chapters.length === 0 ? (
              <EmptyState
                icon="🍃"
                title="Tidak ada chapter yang terbaca"
                description="Halamannya terbuka, tapi tidak satu pun tautan chapter dikenali. Kemungkinan situsnya berganti tema."
              />
            ) : (
              <ul className="card overflow-hidden p-0">
                {chapters.map((chapter) => (
                  <BarisChapter key={chapter.kunci} chapter={chapter} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default SumberSeri;

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { EmptyState } from '../components/Common/index.jsx';
import { useTerhubung } from '../platform/terhubung.js';
import { showToast } from '../store/slices/uiSlice.js';
import {
  bebaskanUrl,
  hapusChapterTersimpan,
  hapusKomikTersimpan,
  komikTersimpan,
  totalBytesTersimpan,
  urlLokal,
  useIndeksOffline,
} from '../offline/penyimpanan.js';
import { batalkanUnduhan, kosongkanAntrean } from '../offline/unduh.js';
import { formatBytes, formatChapterNumber, formatRelativeTime } from '../utils/format.js';

/**
 * Rak komik yang benar-benar ada di HP ini.
 *
 * Halaman ini adalah satu-satunya layar yang masih berarti saat server rumah
 * mati, jadi ia tidak boleh menyentuh API sama sekali — judul, nomor chapter,
 * ukuran, dan bahkan gambar sampulnya dibaca dari penyimpanan sendiri. Itu pula
 * alasan sampul ikut diunduh saat chapter disimpan.
 */

const SampulLokal = ({ komik }) => {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let dibuang = false;
    let dipegang = null;

    if (!komik.sampul) return undefined;
    const [chapterId, nama] = komik.sampul.split('/');
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
  }, [komik.sampul]);

  if (!url) {
    return (
      <div className="flex aspect-[2/3] w-14 flex-none items-center justify-center rounded-lg bg-leaf/10 text-xl">
        🍥
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Cover ${komik.judul}`}
      className="aspect-[2/3] w-14 flex-none rounded-lg object-cover"
    />
  );
};

const KartuUnduhan = () => {
  const unduhan = useSelector((state) => state.unduhan);
  if (!unduhan.sedang && unduhan.antre.length === 0 && !unduhan.galat) return null;

  const sedang = unduhan.sedang;
  const menunggu = unduhan.antre.filter((item) => item.chapterId !== sedang?.chapterId);

  return (
    <section className="card mb-5 p-5">
      <h2 className="section-title mb-4">
        <span aria-hidden="true">⬇️</span>
        Sedang disimpan
      </h2>

      {sedang ? (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{sedang.judulKomik}</p>
            <p className="text-xs opacity-60">
              Chapter {formatChapterNumber(sedang.nomor)} · {unduhan.selesai}/{unduhan.total || '…'}{' '}
              halaman
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost flex-none px-2 py-1 text-xs text-danger"
            onClick={() => batalkanUnduhan(sedang.chapterId)}
          >
            Batalkan
          </button>
        </div>
      ) : (
        <p className="text-sm opacity-60">Tidak ada unduhan berjalan.</p>
      )}

      {menunggu.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs opacity-60">
            {menunggu.length} chapter menunggu giliran
          </p>
          <button type="button" className="btn-ghost flex-none px-2 py-1 text-xs" onClick={kosongkanAntrean}>
            Kosongkan antrean
          </button>
        </div>
      )}

      {/* Antrean yang tertahan bukan kegagalan: chapternya masih di sana dan
          lanjut sendiri. Yang perlu diketahui orangnya hanyalah kenapa diam. */}
      {unduhan.tertahan && (
        <p className="mt-4 rounded-xl bg-shinobi/10 px-3 py-2 text-xs text-shinobi" role="status">
          Menunggu server rumah terjangkau lagi — antrean lanjut sendiri begitu tersambung. (
          {unduhan.tertahan.pesan})
        </p>
      )}

      {unduhan.galat && (
        <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
          Chapter terakhir gagal disimpan: {unduhan.galat.pesan}
        </p>
      )}
    </section>
  );
};

export const Offline = () => {
  const dispatch = useDispatch();
  const indeks = useIndeksOffline();
  const { terhubung, sedangMemeriksa } = useTerhubung();

  const daftar = useMemo(() => komikTersimpan(indeks), [indeks]);
  const total = useMemo(() => totalBytesTersimpan(indeks), [indeks]);

  const hapusKomik = async (komik) => {
    if (!window.confirm(`Hapus semua chapter "${komik.judul}" dari HP? Berkasnya dihapus permanen.`))
      return;
    await hapusKomikTersimpan(komik.id);
    dispatch(showToast({ message: `"${komik.judul}" dihapus dari HP` }));
  };

  const hapusChapter = async (entri) => {
    const nomor = formatChapterNumber(entri.nomor);
    if (!window.confirm(`Hapus Chapter ${nomor} dari HP?`)) return;
    await hapusChapterTersimpan(entri.id);
    dispatch(showToast({ message: `Chapter ${nomor} dihapus dari HP` }));
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="min-w-0 flex-1 text-2xl font-black">Tersimpan di HP</h1>
        <span className="chip flex-none">{formatBytes(total)}</span>
      </div>

      {/* Alasan halaman ini tampil sendiri saat server mati perlu dikatakan,
          bukan disimpulkan sendiri dari rak yang tiba-tiba lebih pendek. */}
      {!terhubung && !sedangMemeriksa && (
        <p className="mb-5 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="status">
          Server rumah tidak terjangkau. Yang ada di halaman ini tetap bisa dibaca; sisanya menunggu
          sampai HP kembali ke Wi-Fi yang sama.
        </p>
      )}

      <KartuUnduhan />

      {daftar.length === 0 ? (
        <EmptyState
          icon="📴"
          title="Belum ada yang disimpan"
          description="Buka sebuah komik lalu tekan Simpan pada chapter yang ingin dibawa. Chapter tersimpan bisa dibaca tanpa server sama sekali."
          action={
            <Link to="/browse" className="btn-accent">
              Jelajahi koleksi
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {daftar.map((komik) => (
            <section key={komik.id} className="card p-4">
              <div className="flex items-center gap-3">
                <SampulLokal komik={komik} />
                <div className="min-w-0 flex-1">
                  <Link to={`/comic/${komik.slug}`} className="block truncate text-sm font-bold">
                    {komik.judul}
                  </Link>
                  <p className="text-xs opacity-60">
                    {komik.chapter.length} chapter · {formatBytes(komik.bytes)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost flex-none px-2 py-1 text-xs text-danger"
                  onClick={() => hapusKomik(komik)}
                  aria-label={`Hapus semua chapter ${komik.judul} dari HP`}
                >
                  Hapus semua
                </button>
              </div>

              <ul className="mt-3 flex flex-col gap-1">
                {komik.chapter.map((entri) => (
                  <li key={entri.id} className="flex items-center gap-2">
                    <Link
                      to={`/read/${entri.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1 hover:bg-night-soft"
                    >
                      <span className="flex-none font-mono text-xs opacity-60">
                        Ch {formatChapterNumber(entri.nomor)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {entri.judul || `${entri.jumlahHalaman} halaman`}
                      </span>
                      <span className="flex-none text-[11px] opacity-50">
                        {formatBytes(entri.bytes)}
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="btn-ghost flex-none px-2 py-1 text-xs text-danger"
                      onClick={() => hapusChapter(entri)}
                      aria-label={`Hapus chapter ${formatChapterNumber(entri.nomor)} dari HP`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>

              <p className="mt-2 text-[11px] opacity-40">
                Terakhir disimpan {formatRelativeTime(komik.disimpanPada)}
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default Offline;

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { EmptyState } from '../components/Common/index.jsx';
import { useTerhubung } from '../platform/terhubung.js';
import { showToast } from '../store/slices/uiSlice.js';
import {
  hapusChapterTersimpan,
  hapusKomikTersimpan,
  komikTersimpan,
  totalBytesTersimpan,
  useIndeksOffline,
} from '../offline/penyimpanan.js';
import SampulLokal from '../offline/SampulLokal.jsx';
import { batalkanUnduhan, kosongkanAntrean } from '../offline/unduh.js';
import { formatBytes, formatChapterNumber, formatRelativeTime } from '../utils/format.js';
import Ikon from '../components/Common/Ikon.jsx';

/**
 * Rak komik yang benar-benar ada di HP ini.
 *
 * Halaman ini adalah satu-satunya layar yang masih berarti saat server rumah
 * mati, jadi ia tidak boleh menyentuh API sama sekali — judul, nomor chapter,
 * ukuran, dan bahkan gambar sampulnya dibaca dari penyimpanan sendiri. Itu pula
 * alasan sampul ikut diunduh saat chapter disimpan.
 */

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
        <p className="mt-4 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent" role="status">
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

/** Berapa chapter yang ditampilkan sebelum tombol "tampilkan semua". */
const BATAS_TAMPIL = 25;

/**
 * Satu komik di rak, TERLIPAT secara bawaan.
 *
 * Dulu tiap komik merender seluruh chapternya sekaligus. Untuk koleksi yang
 * sehat itu berarti ribuan baris sekaligus di layar 360px — satu komik 180
 * chapter saja sudah membuat halaman ini mustahil digulir sampai komik kedua,
 * dan React harus menjaga seluruh baris itu hidup walau tak satu pun terlihat.
 *
 * Satu yang terbuka pada satu waktu, seperti pemilih chapter di reader: dua
 * daftar panjang terbuka berjauhan membuat tombol hapus mudah ditekan pada
 * komik yang salah.
 */
const RakKomik = ({ komik, terbuka, onToggle, onHapusKomik, onHapusChapter }) => {
  const [semua, setSemua] = useState(false);
  const tampil = semua ? komik.chapter : komik.chapter.slice(0, BATAS_TAMPIL);
  const sisa = komik.chapter.length - tampil.length;

  return (
    <section className="card overflow-hidden">
      {/* Seluruh baris kepala jadi sasaran ketuk, bukan ikon panahnya saja:
          di 360px panah 16px adalah sasaran yang paling sering meleset. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={terbuka}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors active:bg-surface-soft"
      >
        <SampulLokal sampul={komik.sampul} judul={komik.judul} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-bold leading-snug">{komik.judul}</span>
          <span className="mt-0.5 block text-xs text-txt-2">
            {komik.chapter.length} chapter · {formatBytes(komik.bytes)}
          </span>
        </span>
        <span className={`flex-none text-txt-2 transition-transform ${terbuka ? 'rotate-180' : ''}`}>
          <Ikon nama="chevron" />
        </span>
      </button>

      {terbuka && (
        <div className="border-t border-line px-3 pb-3">
          {/*
            Komik sumber mengantar ke halaman SERINYA di situs asal, bukan ke
            /comic/:slug. Halaman itu hidup dari koleksi server rumah, dan komik
            yang diunduh langsung ke HP memang tidak pernah ada di sana. Halaman
            serinya jauh lebih berguna: di situlah chapter berikutnya dipilih.
          */}
          <Link
            to={
              komik.sumber?.urlSeri
                ? `/sumber/seri?url=${encodeURIComponent(komik.sumber.urlSeri)}`
                : `/comic/${komik.slug}`
            }
            className="mt-3 flex items-center gap-2 text-xs font-semibold text-primary"
          >
            Buka halaman komik →
          </Link>

          <ul className="mt-2 flex flex-col">
            {tampil.map((entri) => (
              <li key={entri.id} className="flex items-center gap-1 border-b border-line last:border-0">
                <Link
                  to={`/read/${entri.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-2 active:bg-surface-soft"
                >
                  <span className="flex-none font-mono text-xs text-txt-2">
                    Ch {formatChapterNumber(entri.nomor)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {entri.judul || `${entri.jumlahHalaman} halaman`}
                  </span>
                  <span className="flex-none text-[11px] text-txt-2">{formatBytes(entri.bytes)}</span>
                </Link>
                <button
                  type="button"
                  className="flex-none rounded-lg px-2 py-2 text-danger active:bg-surface-soft"
                  onClick={() => onHapusChapter(entri)}
                  aria-label={`Hapus chapter ${formatChapterNumber(entri.nomor)} dari HP`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {sisa > 0 && (
            <button type="button" className="btn-ghost mt-2 w-full py-1.5 text-xs" onClick={() => setSemua(true)}>
              Tampilkan {sisa} chapter lainnya
            </button>
          )}

          {/* Hapus-semua dipindah KE DALAM panel, jauh dari judul. Dulu ia duduk
              tepat di sebelah judul di baris yang sama — tombol penghapus
              permanen, selebar jempol, di tempat yang disentuh orang saat
              hendak membuka komiknya. */}
          <button
            type="button"
            className="btn-ghost mt-3 w-full py-1.5 text-xs text-danger"
            onClick={onHapusKomik}
          >
            Hapus semua chapter komik ini
          </button>

          <p className="mt-2 text-center text-[11px] text-txt-2">
            Terakhir disimpan {formatRelativeTime(komik.disimpanPada)}
          </p>
        </div>
      )}
    </section>
  );
};

export const Offline = () => {
  const dispatch = useDispatch();
  const indeks = useIndeksOffline();
  const { terhubung, sedangMemeriksa } = useTerhubung();

  const [terbuka, setTerbuka] = useState(null);

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
        <div className="flex flex-col gap-2.5">
          {daftar.map((komik) => (
            <RakKomik
              key={komik.id}
              komik={komik}
              terbuka={terbuka === komik.id}
              onToggle={() => setTerbuka((kini) => (kini === komik.id ? null : komik.id))}
              onHapusKomik={() => hapusKomik(komik)}
              onHapusChapter={hapusChapter}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Offline;

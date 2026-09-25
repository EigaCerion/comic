import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { formatBytes, formatChapterNumber } from '../utils/format.js';
import { showToast } from '../store/slices/uiSlice.js';
import { statusUnduh } from '../store/slices/unduhanSlice.js';
import { hapusChapterTersimpan, useIndeksOffline } from './penyimpanan.js';
import { antrekanChapter, batalkanUnduhan } from './unduh.js';

/**
 * Tombol "simpan ke HP" di halaman detail komik — hanya build Android.
 *
 * Yang bisa disimpan HANYA chapter yang berkasnya sudah ada di server. Chapter
 * yang masih mengantre di sisi server terlihat sama saja di daftar ini, dan
 * menawarkan tombol simpan untuknya berarti menjanjikan sesuatu yang pasti
 * berakhir dengan "chapter ini belum punya halaman" — kegagalan yang terjadi
 * beberapa detik kemudian, jauh dari tombol yang ditekan.
 */

const bisaDisimpan = (chapter) => chapter.isDownloaded && chapter.totalPages > 0;

const antrian = (comic, chapter) => ({
  chapterId: chapter.id,
  comicId: comic.id,
  nomor: chapter.number,
  judulKomik: comic.title,
  slugKomik: comic.slug,
});

export const TombolSimpanChapter = ({ comic, chapter }) => {
  const dispatch = useDispatch();
  const indeks = useIndeksOffline();
  const status = useSelector((state) => statusUnduh(state.unduhan, chapter.id));

  if (!bisaDisimpan(chapter)) return null;

  const tersimpan = Boolean(indeks.chapter[chapter.id]);
  const nomor = formatChapterNumber(chapter.number);

  if (status?.keadaan === 'mengunduh') {
    return (
      <button
        type="button"
        className="btn-ghost px-2 py-1 font-mono text-xs text-naruto"
        onClick={() => batalkanUnduhan(chapter.id)}
        aria-label={`Batalkan unduhan chapter ${nomor}`}
        title="Ketuk untuk membatalkan"
      >
        {status.selesai}/{status.total || '…'}
      </button>
    );
  }

  if (status?.keadaan === 'antre') {
    return (
      <button
        type="button"
        className="btn-ghost px-2 py-1 text-xs"
        onClick={() => batalkanUnduhan(chapter.id)}
        aria-label={`Keluarkan chapter ${nomor} dari antrean`}
        title="Ketuk untuk mengeluarkan dari antrean"
      >
        Antre
      </button>
    );
  }

  if (tersimpan) {
    const hapus = async () => {
      if (!window.confirm(`Hapus Chapter ${nomor} dari penyimpanan HP?`)) return;
      await hapusChapterTersimpan(chapter.id);
      dispatch(showToast({ message: `Chapter ${nomor} dihapus dari HP` }));
    };
    return (
      <button
        type="button"
        className="btn-ghost px-2 py-1 text-xs text-leaf-light"
        onClick={hapus}
        aria-label={`Hapus chapter ${nomor} dari penyimpanan HP`}
        title="Tersimpan di HP — ketuk untuk menghapus"
      >
        ✓ Di HP
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost px-2 py-1 text-xs"
      onClick={() => antrekanChapter(antrian(comic, chapter))}
      aria-label={`Simpan chapter ${nomor} ke HP`}
      title="Simpan supaya bisa dibaca tanpa server"
    >
      ⬇ Simpan
    </button>
  );
};

const BANYAK = 10;

/**
 * Simpan sekaligus dari titik lanjut baca.
 *
 * Dimulai dari chapter yang akan dibaca berikutnya, bukan dari chapter pertama:
 * yang menyiapkan bekal perjalanan hampir selalu ingin melanjutkan, dan sepuluh
 * chapter pertama sebuah komik 700 chapter adalah bagian yang paling sudah
 * dibaca.
 */
export const TombolSimpanMassal = ({ comic, chapters, mulaiDari }) => {
  const dispatch = useDispatch();
  const indeks = useIndeksOffline();

  const berurutan = chapters.filter(bisaDisimpan).sort((a, b) => a.number - b.number);
  const awal = mulaiDari ? berurutan.findIndex((chapter) => chapter.id === mulaiDari.id) : 0;
  const calon = berurutan
    .slice(Math.max(awal, 0))
    .filter((chapter) => !indeks.chapter[chapter.id])
    .slice(0, BANYAK);

  const punya = Object.values(indeks.chapter).filter((entri) => entri.comicId === comic.id);
  const bytes = punya.reduce((jumlah, entri) => jumlah + (entri.bytes ?? 0), 0);

  const simpan = () => {
    if (calon.length === 0) {
      dispatch(showToast({ message: 'Semua chapter berikutnya sudah ada di HP' }));
      return;
    }
    antrekanChapter(calon.map((chapter) => antrian(comic, chapter)));
    dispatch(
      showToast({
        message: `${calon.length} chapter mulai Ch ${formatChapterNumber(calon[0].number)} masuk antrean`,
      }),
    );
  };

  return (
    <>
      <button type="button" className="btn-ghost" onClick={simpan} disabled={calon.length === 0}>
        📲 Simpan {BANYAK} chapter berikutnya
      </button>
      {punya.length > 0 && (
        <Link to="/offline" className="btn-ghost">
          {punya.length} di HP · {formatBytes(bytes)}
        </Link>
      )}
    </>
  );
};

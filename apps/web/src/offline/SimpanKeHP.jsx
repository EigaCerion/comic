import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { formatBytes, formatChapterNumber } from '../utils/format.js';
import { showToast } from '../store/slices/uiSlice.js';
import { statusUnduh } from '../store/slices/unduhanSlice.js';
import { hapusChapterTersimpan, useIndeksOffline } from './penyimpanan.js';
import { antrekanChapter, batalkanUnduhan } from './unduh.js';
import { bisaDisimpan, daftarLayak, dalamRentang, pisahkanCalon, rentangCepat } from './pilihRentang.js';

/**
 * Tombol "simpan ke HP" di halaman detail komik — hanya build Android.
 *
 * Yang bisa disimpan HANYA chapter yang berkasnya sudah ada di server. Chapter
 * yang masih mengantre di sisi server terlihat sama saja di daftar ini, dan
 * menawarkan tombol simpan untuknya berarti menjanjikan sesuatu yang pasti
 * berakhir dengan "chapter ini belum punya halaman" — kegagalan yang terjadi
 * beberapa detik kemudian, jauh dari tombol yang ditekan.
 */

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

/** Pilihan jumlah pada tombol cepat, dihitung dari titik lanjut baca. */
const CEPAT = [5, 10, 25];

/**
 * Tombol pembuka panel simpan massal, plus pintasan ke rak simpanan.
 *
 * Panelnya sendiri TIDAK dirender di sini. Ia dibuka oleh ComicDetail di bawah
 * baris tombol, mengikuti jalan yang sudah dipakai Edit info dan Download via
 * URL: baris itu `flex flex-wrap`, dan panel selebar penuh yang disisipkan di
 * tengahnya akan memotong baris tombol jadi dua — tombol sebelum panel di baris
 * pertama, sisanya terlempar ke bawah panel.
 */
export const TombolSimpanMassal = ({ comic, chapters, terbuka, saatKetuk }) => {
  const indeks = useIndeksOffline();

  const adaYangBisa = chapters.some(bisaDisimpan);
  const punya = Object.values(indeks.chapter).filter((entri) => entri.comicId === comic.id);
  const bytes = punya.reduce((jumlah, entri) => jumlah + (entri.bytes ?? 0), 0);

  return (
    <>
      <button
        type="button"
        className="btn-ghost"
        onClick={saatKetuk}
        disabled={!adaYangBisa}
        aria-expanded={terbuka}
        title={adaYangBisa ? 'Pilih chapter yang dibawa ke HP' : 'Belum ada chapter yang berkasnya siap di server'}
      >
        📲 Simpan ke HP
      </button>
      {punya.length > 0 && (
        <Link to="/offline" className="btn-ghost">
          {punya.length} di HP · {formatBytes(bytes)}
        </Link>
      )}
    </>
  );
};

/**
 * Panel pemilih chapter yang dibawa ke HP.
 *
 * Dulu tombolnya mengunci sepuluh chapter berikutnya dan tidak ada cara lain.
 * Angka itu benar untuk satu kebiasaan saja (bekal perjalanan singkat) dan
 * salah untuk sisanya: yang mau menuntaskan komik tamat 40 chapter harus
 * menekannya empat kali, dan yang cuma butuh satu chapter tertentu di tengah
 * tidak punya jalan sama sekali selain mencarinya di daftar dan menekan simpan
 * satu-satu.
 *
 * Yang dipilih adalah RENTANG NOMOR, bukan daftar centang. Alasannya bentuk
 * datanya: koleksi di sini rutin berisi 700+ chapter, dan memilih "Ch 300-360"
 * lewat centang berarti 60 ketukan pada daftar yang harus digulir dulu. Tombol
 * cepat di atasnya hanya mengisi rentang itu, jadi keduanya satu mekanisme.
 *
 * Batasnya tetap sama dengan sebelumnya: hanya chapter yang berkasnya SUDAH ada
 * di server yang bisa disimpan (bisaDisimpan), dan yang sudah ada di HP dilewati
 * tanpa dihitung.
 */
export const PanelSimpanKeHP = ({ comic, chapters, mulaiDari, onClose }) => {
  const dispatch = useDispatch();
  const indeks = useIndeksOffline();

  const berurutan = useMemo(() => daftarLayak(chapters), [chapters]);

  const terendah = berurutan.length > 0 ? berurutan[0].number : 0;
  const tertinggi = berurutan.length > 0 ? berurutan[berurutan.length - 1].number : 0;

  /*
   * Rentang awal dimulai dari titik lanjut baca, bukan dari chapter pertama:
   * yang menyiapkan bekal hampir selalu ingin melanjutkan, dan sepuluh chapter
   * pertama sebuah komik 700 chapter adalah bagian yang paling sudah dibaca.
   * Kalau titik itu tidak ada (belum pernah dibaca), yang dipakai chapter
   * terendah yang tersedia.
   */
  const awalBawaan = mulaiDari && Number.isFinite(mulaiDari.number) ? mulaiDari.number : terendah;
  const [dari, setDari] = useState(String(awalBawaan));
  const [sampai, setSampai] = useState(String(tertinggi));

  const angka = (teks, cadangan) => {
    const nilai = Number.parseFloat(teks);
    return Number.isFinite(nilai) ? nilai : cadangan;
  };

  const batasBawah = angka(dari, terendah);
  const batasAtas = angka(sampai, tertinggi);

  // Dalam rentang, dan belum ada di HP. Dua hitungan dipisah supaya panel bisa
  // menyebut alasan ketika hasilnya nol: rentang yang memang kosong berbeda dari
  // rentang yang seluruh isinya sudah tersimpan, dan keduanya menuntut tindakan
  // berbeda dari orang yang melihatnya.
  const dalam = dalamRentang(berurutan, batasBawah, batasAtas);
  const { calon, sudahAda } = pisahkanCalon(dalam, (chapter) => Boolean(indeks.chapter[chapter.id]));

  const isiCepat = (jumlah) => {
    const rentang = rentangCepat(berurutan, awalBawaan, jumlah);
    if (!rentang) return;
    setDari(String(rentang.dari));
    setSampai(String(rentang.sampai));
  };

  const simpan = () => {
    if (calon.length === 0) return;
    antrekanChapter(calon.map((chapter) => antrian(comic, chapter)));
    dispatch(
      showToast({
        message: `${calon.length} chapter mulai Ch ${formatChapterNumber(calon[0].number)} masuk antrean`,
      }),
    );
    onClose?.();
  };

  if (berurutan.length === 0) {
    return (
      <div className="card mt-4 p-4 text-sm text-night/60 dark:text-paper/60">
        Belum ada chapter yang berkasnya siap di server, jadi belum ada yang bisa dibawa ke HP.
      </div>
    );
  }

  return (
    <div className="card mt-4 space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">📲 Simpan ke HP</h3>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>
          Tutup
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mikro flex-none">Cepat</span>
        {CEPAT.filter((jumlah) => jumlah < berurutan.length).map((jumlah) => (
          <button key={jumlah} type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => isiCepat(jumlah)}>
            {jumlah} berikutnya
          </button>
        ))}
        <button
          type="button"
          className="btn-ghost px-2.5 py-1 text-xs"
          onClick={() => {
            setDari(String(terendah));
            setSampai(String(tertinggi));
          }}
        >
          Semua ({berurutan.length})
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-none text-xs">
          <span className="label-mikro block">Dari Ch</span>
          <input
            type="number"
            step="any"
            className="input mt-1 w-24 tabular-nums"
            value={dari}
            min={terendah}
            max={tertinggi}
            onChange={(event) => setDari(event.target.value)}
          />
        </label>
        <label className="flex-none text-xs">
          <span className="label-mikro block">Sampai Ch</span>
          <input
            type="number"
            step="any"
            className="input mt-1 w-24 tabular-nums"
            value={sampai}
            min={terendah}
            max={tertinggi}
            onChange={(event) => setSampai(event.target.value)}
          />
        </label>
        <span className="flex-none pb-2 text-[11px] text-night/50 dark:text-paper/50">
          tersedia Ch {formatChapterNumber(terendah)}–{formatChapterNumber(tertinggi)}
        </span>
      </div>

      <p className="text-xs text-night/60 dark:text-paper/60">
        {calon.length > 0
          ? `${calon.length} chapter akan disimpan${sudahAda > 0 ? ` · ${sudahAda} sudah ada di HP, dilewati` : ''}`
          : dalam.length === 0
            ? 'Tidak ada chapter yang berkasnya siap di rentang itu'
            : `Seluruh ${dalam.length} chapter di rentang itu sudah ada di HP`}
      </p>

      <button type="button" className="btn-accent w-full sm:w-auto" onClick={simpan} disabled={calon.length === 0}>
        ⬇ Simpan {calon.length > 0 ? `${calon.length} chapter` : ''}
      </button>
    </div>
  );
};

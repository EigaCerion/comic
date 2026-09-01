import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useAddCommentMutation,
  useDeleteCommentMutation,
  useGetCommentsQuery,
  useGetRatingQuery,
  useHapusRatingMutation,
  useHideCommentMutation,
  useSetRatingMutation,
} from '../../api/apiSlice.js';
import { showToast } from '../../store/slices/uiSlice.js';
import { formatRelativeTime } from '../../utils/format.js';
import { useAuth } from '../../hooks/useAuth.js';

const BATAS = 2000;

const Bintang = ({ terisi, ...props }) => (
  <button
    type="button"
    className={`text-2xl leading-none transition-transform hover:scale-110 disabled:hover:scale-100 ${
      terisi ? 'text-naruto' : 'text-night/20 dark:text-paper/20'
    }`}
    {...props}
  >
    ★
  </button>
);

const KartuRating = ({ comicId }) => {
  const dispatch = useDispatch();
  const { sudahMasuk } = useAuth();
  const { data } = useGetRatingQuery(comicId);
  const [simpan] = useSetRatingMutation();
  const [hapus] = useHapusRatingMutation();
  const [layang, setLayang] = useState(0);

  if (!data) return null;

  const milikSaya = data.milikSaya ?? 0;
  const ditampilkan = layang || milikSaya;
  const maks = Math.max(1, ...Object.values(data.sebaran));

  const beri = async (nilai) => {
    try {
      // Menekan bintang yang sama = membatalkan penilaian.
      if (nilai === milikSaya) {
        await hapus(comicId).unwrap();
        dispatch(showToast({ message: 'Rating kamu dihapus' }));
      } else {
        await simpan({ comicId, value: nilai }).unwrap();
        dispatch(showToast({ message: `Kamu memberi ${nilai} bintang` }));
      }
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal menyimpan rating' }));
    }
  };

  return (
    <div className="card p-5">
      <h2 className="section-title mb-4">
        <span aria-hidden="true">⭐</span>
        Rating
      </h2>

      <div className="flex flex-wrap items-end gap-5">
        <div>
          <p className="text-4xl font-black leading-none">
            {data.rata === null ? '—' : data.rata.toFixed(1)}
          </p>
          <p className="label-mikro mt-1">
            {data.jumlah === 0 ? 'belum dinilai' : `dari ${data.jumlah} penilai`}
          </p>
        </div>

        <div className="min-w-[9rem] flex-1">
          {[5, 4, 3, 2, 1].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <span className="w-3 text-[11px] opacity-50">{n}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-night/10 dark:bg-paper/10">
                <div
                  className="h-full rounded-full bg-naruto/70"
                  style={{ width: `${(data.sebaran[n] / maks) * 100}%` }}
                />
              </div>
              <span className="w-5 text-right text-[11px] opacity-50">{data.sebaran[n]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-paper-line pt-4 dark:border-night-line">
        {sudahMasuk ? (
          <>
            <p className="label-mikro mb-2">
              {milikSaya ? 'Penilaian kamu — tekan lagi untuk membatalkan' : 'Beri penilaian'}
            </p>
            <div className="flex gap-1" onMouseLeave={() => setLayang(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Bintang
                  key={n}
                  terisi={n <= ditampilkan}
                  onClick={() => beri(n)}
                  onMouseEnter={() => setLayang(n)}
                  aria-label={`Beri ${n} bintang`}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm opacity-60">
            <Link to="/login" className="font-semibold text-naruto hover:underline">
              Masuk
            </Link>{' '}
            untuk memberi rating. Membaca tetap bebas tanpa akun.
          </p>
        )}
      </div>
    </div>
  );
};

const Komentar = ({ komentar, comicId }) => {
  const dispatch = useDispatch();
  const [hapus] = useDeleteCommentMutation();
  const [sembunyikan] = useHideCommentMutation();

  const jalankan = async (aksi, pesan) => {
    try {
      await aksi().unwrap();
      dispatch(showToast({ message: pesan }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal' }));
    }
  };

  return (
    <li className={`border-b border-paper-line py-3 last:border-0 dark:border-night-line ${komentar.isHidden ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-bold">{komentar.penulis.displayName}</span>
        {komentar.penulis.role !== 'reader' && (
          <span className="chip text-[10px]">{komentar.penulis.role.replace('_', ' ')}</span>
        )}
        <span className="text-xs opacity-40">{formatRelativeTime(komentar.createdAt)}</span>
        {komentar.isHidden && <span className="chip text-[10px] text-danger">disembunyikan</span>}
      </div>

      <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed opacity-90">
        {komentar.body ?? '(komentar ini disembunyikan moderator)'}
      </p>

      {(komentar.bolehHapus || komentar.bolehSembunyikan) && (
        <div className="mt-2 flex gap-2">
          {komentar.bolehSembunyikan && (
            <button
              type="button"
              className="text-[11px] font-semibold opacity-60 hover:text-naruto hover:opacity-100"
              onClick={() =>
                jalankan(
                  () => sembunyikan({ id: komentar.id, comicId, sembunyikan: !komentar.isHidden }),
                  komentar.isHidden ? 'Komentar ditampilkan lagi' : 'Komentar disembunyikan',
                )
              }
            >
              {komentar.isHidden ? 'Tampilkan' : 'Sembunyikan'}
            </button>
          )}
          {komentar.bolehHapus && (
            <button
              type="button"
              className="text-[11px] font-semibold text-danger opacity-70 hover:opacity-100"
              onClick={() => {
                if (!window.confirm('Hapus komentar ini secara permanen?')) return;
                jalankan(() => hapus({ id: komentar.id, comicId }), 'Komentar dihapus');
              }}
            >
              Hapus
            </button>
          )}
        </div>
      )}
    </li>
  );
};

const KartuKomentar = ({ comicId }) => {
  const dispatch = useDispatch();
  const { sudahMasuk } = useAuth();
  const { data, isLoading } = useGetCommentsQuery(comicId);
  const [tambah, { isLoading: sedangKirim }] = useAddCommentMutation();
  const [isi, setIsi] = useState('');

  const items = data?.items ?? [];

  const kirim = async (event) => {
    event.preventDefault();
    const teks = isi.trim();
    if (!teks) return;
    try {
      await tambah({ comicId, body: teks }).unwrap();
      setIsi('');
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal mengirim komentar' }));
    }
  };

  return (
    <div className="card p-5">
      <h2 className="section-title mb-4">
        <span aria-hidden="true">💬</span>
        Komentar {items.length > 0 && <span className="opacity-40">({items.length})</span>}
      </h2>

      {sudahMasuk ? (
        <form onSubmit={kirim}>
          <textarea
            className="input min-h-[5rem] resize-y"
            placeholder="Tulis pendapatmu tentang komik ini…"
            value={isi}
            maxLength={BATAS}
            onChange={(e) => setIsi(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="label-mikro">
              {isi.length}/{BATAS}
            </span>
            <button type="submit" className="btn-accent py-1.5 text-xs" disabled={sedangKirim || !isi.trim()}>
              {sedangKirim ? 'Mengirim…' : 'Kirim komentar'}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm opacity-60">
          <Link to="/login" className="font-semibold text-naruto hover:underline">
            Masuk
          </Link>{' '}
          untuk ikut berkomentar.
        </p>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm opacity-50">Memuat komentar…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm opacity-50">Belum ada komentar. Jadilah yang pertama.</p>
      ) : (
        <ul className="mt-4">
          {items.map((k) => (
            <Komentar key={k.id} komentar={k} comicId={comicId} />
          ))}
        </ul>
      )}
    </div>
  );
};

export const RatingKomentar = ({ comicId }) => (
  <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
    <KartuRating comicId={comicId} />
    <KartuKomentar comicId={comicId} />
  </section>
);

export default RatingKomentar;

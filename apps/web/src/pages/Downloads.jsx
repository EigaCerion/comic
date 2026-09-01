import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useCancelDownloadMutation,
  useGetAuditQuery,
  useDismissFindingMutation,
  useRepairAuditMutation,
  useClearQueueMutation,
  useGetDownloadsQuery,
  useGetResyncAllQuery,
  useStartResyncAllMutation,
  useStopResyncAllMutation,
  usePauseQueueMutation,
  useResumeQueueMutation,
  useRetryDownloadMutation,
} from '../api/apiSlice.js';
import { EmptyState, ErrorState, ProgressBar, Spinner } from '../components/Common/index.jsx';
import { showToast } from '../store/slices/uiSlice.js';
import { formatChapterNumber, formatRelativeTime, jobStatusLabel } from '../utils/format.js';

const STATUS_STYLE = {
  pending: 'text-night/60 dark:text-paper/60',
  downloading: 'text-naruto',
  completed: 'text-leaf-light',
  failed: 'text-danger',
  paused: 'text-shinobi',
};

const KIND_LABEL = {
  missing_file: 'berkas hilang',
  size_zero: 'berkas kosong',
  corrupt_file: 'berkas rusak',
  count_mismatch: 'jumlah halaman tidak cocok',
  not_downloaded: 'belum terunduh',
  empty_chapter: 'chapter kosong',
  gap: 'nomor bolong',
};

/** Ringkasan kerja bot pengawas beserta temuannya. */
const LABEL_HASIL = {
  'ada-baru': { ikon: '🆕', kelas: 'text-naruto' },
  terkini: { ikon: '✓', kelas: 'text-night/45 dark:text-paper/45' },
  'tanpa-sumber': { ikon: '?', kelas: 'text-night/60 dark:text-paper/60' },
  gagal: { ikon: '!', kelas: 'text-danger' },
};

/**
 * Cek update seluruh koleksi lewat satu tombol.
 *
 * Sebelumnya satu-satunya cara mengecek chapter baru adalah membuka detail tiap
 * komik lalu menekan "Cek chapter baru" — 27 kali untuk koleksi sebesar ini.
 * Pemeriksaannya berjalan di server secara bergiliran, jadi kartu ini hanya
 * memantau: ia ikut mengambil status saat ada yang berjalan, dan diam saat
 * tidak, supaya tidak ada polling sia-sia.
 */
const CekUpdateCard = () => {
  const dispatch = useDispatch();
  const [berjalanTerakhir, setBerjalanTerakhir] = useState(false);
  const { data } = useGetResyncAllQuery(undefined, {
    pollingInterval: berjalanTerakhir ? 1500 : 0,
  });
  const [mulai, { isLoading: sedangMemulai }] = useStartResyncAllMutation();
  const [hentikan] = useStopResyncAllMutation();

  const berjalan = data?.berjalan ?? false;
  useEffect(() => {
    setBerjalanTerakhir(berjalan);
  }, [berjalan]);

  const jalankan = async () => {
    try {
      const hasil = await mulai().unwrap();
      setBerjalanTerakhir(true);
      dispatch(
        showToast({
          message: hasil.dimulai
            ? `Mengecek ${hasil.total} komik satu per satu…`
            : 'Pemeriksaan sudah berjalan',
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal memulai pemeriksaan' }));
    }
  };

  const stop = async () => {
    try {
      await hentikan().unwrap();
      dispatch(showToast({ message: 'Berhenti setelah komik yang sedang dicek selesai' }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal menghentikan' }));
    }
  };

  const perhatian = data?.perhatian ?? [];
  const adaBaru = perhatian.filter((x) => x.status === 'ada-baru');
  const bermasalah = perhatian.filter((x) => x.status === 'gagal' || x.status === 'tanpa-sumber');
  const ringkasan = data?.ringkasan;
  const persen = data?.total ? (data.diproses / data.total) * 100 : 0;

  // "27 dari 500" tidak memberi tahu apa pun tanpa perkiraan sisa waktu.
  const sisa = data?.sisaDetik;
  const perkiraan =
    sisa == null ? '' : sisa < 90 ? ` · sisa ~${sisa} detik` : ` · sisa ~${Math.round(sisa / 60)} menit`;

  return (
    <section className="card mb-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">
            <span aria-hidden="true">🔄</span> Cek update semua komik
          </h2>
          <p className="mt-1 text-xs text-night/55 dark:text-paper/55">
            {berjalan
              ? `Mengecek ${data.diproses + 1} dari ${data.total}${perkiraan}${data.sekarang ? ` · ${data.sekarang}` : ''}`
              : data?.selesaiPada
                ? `Terakhir: ${data.diproses} komik dicek · ${ringkasan?.adaBaru ?? 0} punya chapter baru · ${data.totalDiantre} chapter diantre`
                : 'Bandingkan seluruh koleksi dengan situs sumbernya, lalu antrekan chapter yang belum ada.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {berjalan ? (
            <button type="button" className="btn-ghost" onClick={stop}>
              ✕ Hentikan
            </button>
          ) : (
            <button type="button" className="btn-accent" onClick={jalankan} disabled={sedangMemulai}>
              {sedangMemulai ? 'Memulai…' : '🔄 Cek update semua'}
            </button>
          )}
        </div>
      </div>

      {berjalan && (
        <div className="mt-3">
          <ProgressBar value={persen} />
        </div>
      )}

      {adaBaru.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {adaBaru.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <span className={LABEL_HASIL['ada-baru'].kelas} aria-hidden="true">
                {LABEL_HASIL['ada-baru'].ikon}
              </span>
              <Link to={`/comic/${item.slug}`} className="font-semibold hover:underline">
                {item.title}
              </Link>
              <span className="text-night/55 dark:text-paper/55">
                {item.diantre} chapter baru diantre
                {item.diSumber ? ` (sumber ${item.diSumber}, koleksi ${item.diKoleksi})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data?.perhatianLain > 0 && (
        <p className="mt-2 text-xs text-night/45 dark:text-paper/45">
          +{data.perhatianLain} komik lain punya pembaruan — semuanya sudah masuk antrian di bawah.
        </p>
      )}

      {bermasalah.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-night/55 dark:text-paper/55">
            {(ringkasan?.gagal ?? 0) + (ringkasan?.tanpaSumber ?? 0)} komik tidak bisa dicek
          </summary>
          <ul className="mt-2 space-y-1">
            {bermasalah.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span className={LABEL_HASIL[item.status].kelas} aria-hidden="true">
                  {LABEL_HASIL[item.status].ikon}
                </span>
                <span>
                  <Link to={`/comic/${item.slug}`} className="font-semibold hover:underline">
                    {item.title}
                  </Link>{' '}
                  <span className="text-night/55 dark:text-paper/55">{item.pesan}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

const SupervisorCard = () => {
  const dispatch = useDispatch();
  const { data } = useGetAuditQuery(undefined, { pollingInterval: 5000 });
  const [repair, { isLoading: isRepairing }] = useRepairAuditMutation();
  const [dismiss] = useDismissFindingMutation();

  const abaikan = async (temuan) => {
    try {
      await dismiss({ id: temuan.id }).unwrap();
      dispatch(showToast({ message: `Temuan ch ${temuan.chapter_number} ditutup` }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal menutup temuan' }));
    }
  };

  if (!data) return null;
  const { pengawas } = data;

  const perbaiki = async () => {
    try {
      const hasil = await repair().unwrap();
      dispatch(
        showToast({
          message: `${hasil.diantre} chapter diantre ke bot importir · ${hasil.sudahDiantre} sudah di antrian${
            hasil.komikDiresync ? ` · ${hasil.komikDiresync} komik dicocokkan ke sumber` : ''
          }${hasil.butuhSumber ? ` · ${hasil.butuhSumber} tanpa URL sumber` : ''}`,
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Perbaikan gagal' }));
    }
  };

  return (
    <section className="card mb-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">
            <span aria-hidden="true">🛡️</span> Bot pengawas
          </h2>
          <p className="mt-1 text-xs opacity-60">
            {pengawas.bot} bot · {pengawas.sedangMemeriksa} sedang memeriksa · {pengawas.antre} antre ·{' '}
            {pengawas.diperiksa} chapter diperiksa sesi ini
            {data.belumDiperiksa > 0 && ` · ${data.belumDiperiksa} belum diperiksa`}
          </p>
        </div>
        {data.totalTerbuka > 0 && (
          <button type="button" className="btn-accent" onClick={perbaiki} disabled={isRepairing}>
            {isRepairing ? 'Mengantre…' : `Perbaiki ${data.totalTerbuka} temuan`}
          </button>
        )}
      </div>

      {data.totalTerbuka === 0 ? (
        <p className="mt-3 text-sm text-leaf-light">Semua chapter yang diperiksa lengkap.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.perJenis.map((jenis) => (
              <span key={jenis.kind} className="chip">
                {KIND_LABEL[jenis.kind] ?? jenis.kind}: {jenis.jumlah}
              </span>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-xs opacity-70">
            {data.terakhir.slice(0, 5).map((temuan) => (
              <li key={temuan.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <Link to={`/comic/${temuan.comic_slug}`} className="hover:text-naruto">
                    {temuan.comic_title}
                  </Link>{' '}
                  · ch {temuan.chapter_number} · {temuan.detail}
                </span>
                <Link
                  to={`/comic/${temuan.comic_slug}`}
                  className="flex-none text-naruto hover:underline"
                  title="Buka komiknya untuk menambal lewat URL manual"
                >
                  isi manual
                </Link>
                <button
                  type="button"
                  className="flex-none opacity-60 hover:opacity-100"
                  onClick={() => abaikan(temuan)}
                  title="Tutup temuan ini — untuk yang memang tidak bisa diperbaiki"
                >
                  abaikan
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export const Downloads = () => {
  const dispatch = useDispatch();
  const query = useGetDownloadsQuery('', { pollingInterval: 2000 });
  const [retry] = useRetryDownloadMutation();
  const [cancel] = useCancelDownloadMutation();
  const [pause] = usePauseQueueMutation();
  const [resume] = useResumeQueueMutation();
  const [clear] = useClearQueueMutation();

  const items = query.data?.items ?? [];
  const counts = query.data?.counts ?? {};

  const act = async (action, args, message) => {
    try {
      await action(args).unwrap();
      if (message) dispatch(showToast({ message }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Aksi gagal' }));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Manajer Unduhan</h1>
          <p className="text-sm text-night/50 dark:text-paper/50">
            {Object.entries(counts)
              .map(([status, n]) => `${jobStatusLabel[status] ?? status}: ${n}`)
              .join(' · ') || 'Antrian kosong'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => act(pause, undefined, 'Antrian dijeda')}>
            ⏸ Jeda semua
          </button>
          <button type="button" className="btn-ghost" onClick={() => act(resume, undefined, 'Antrian dilanjutkan')}>
            ▶ Lanjutkan
          </button>
          <button type="button" className="btn-ghost" onClick={() => act(clear, undefined, 'Riwayat dibersihkan')}>
            🧹 Bersihkan selesai/gagal
          </button>
        </div>
      </div>

      <div className="mt-5">
        <CekUpdateCard />
        <SupervisorCard />

        {query.isLoading && <Spinner />}
        {query.isError && <ErrorState error={query.error} onRetry={query.refetch} />}

        {!query.isLoading && items.length === 0 && (
          <EmptyState
            icon="📥"
            title="Belum ada unduhan"
            description="Buka detail komik lalu pilih “Download via URL” untuk memasukkan chapter ke antrian. Worker memproses antrian di background."
          />
        )}

        <ul className="flex flex-col gap-2">
          {items.map((job) => (
            <li key={job.id} className="card flex flex-wrap items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                {/* Di HP judul dan chapter dipecah dua baris. Saat keduanya dijejalkan
                    dalam satu baris ber-`truncate` selebar ~210px, nomor chapternya
                    terpotong habis — padahal justru itu yang dicari orang di halaman
                    unduhan. Mulai sm keduanya kembali menyatu dalam satu baris. */}
                <p className="text-sm font-semibold sm:truncate">
                  <Link to={`/comic/${job.comicSlug}`} className="block truncate hover:text-naruto sm:inline">
                    {job.comicTitle}
                  </Link>
                  <span className="block truncate opacity-60 sm:inline">
                    <span className="hidden sm:inline"> · </span>
                    Ch {formatChapterNumber(job.chapterNumber)}
                    {job.chapterTitle ? ` — ${job.chapterTitle}` : ''}
                  </span>
                </p>
                <p className={`text-xs font-semibold ${STATUS_STYLE[job.status] ?? ''}`}>
                  {jobStatusLabel[job.status] ?? job.status}
                  {job.totalPages > 0 && ` · ${job.totalPages} halaman`}
                  {job.attempts > 1 && ` · attempt ${job.attempts}`}
                  {` · ${formatRelativeTime(job.createdAt)}`}
                </p>
                {job.error && <p className="mt-1 text-xs text-danger">{job.error}</p>}
                {(job.status === 'downloading' || job.progress > 0) && (
                  <ProgressBar value={job.progress} className="mt-2" />
                )}
              </div>

              <div className="flex flex-none gap-2">
                {(job.status === 'failed' || job.status === 'paused') && (
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => act(retry, job.id, 'Job dicoba ulang')}
                  >
                    ↻ Retry
                  </button>
                )}
                {job.status !== 'downloading' && (
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => act(cancel, job.id, 'Job dihapus dari antrian')}
                  >
                    ✕ Hapus
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Downloads;

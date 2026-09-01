import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useDeleteComicMutation,
  useEnqueueDownloadMutation,
  useGetChaptersQuery,
  useGetComicQuery,
  useSetCoverFromPageMutation,
  useToggleFavoriteMutation,
  useUpdateComicMutation,
  useAuditComicMutation,
  useResyncComicMutation,
} from '../api/apiSlice.js';
import { ErrorState, ProgressBar, Spinner } from '../components/Common/index.jsx';
import { RatingKomentar } from '../components/Interaksi/RatingKomentar.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { showToast } from '../store/slices/uiSlice.js';
import { formatBytes, formatChapterNumber, formatRelativeTime, statusColor } from '../utils/format.js';

const DownloadForm = ({ comicId, onDone }) => {
  const dispatch = useDispatch();
  const [enqueue, { isLoading }] = useEnqueueDownloadMutation();
  const [form, setForm] = useState({ chapterNumber: '', chapterTitle: '', chapterUrl: '', urls: '' });

  const submit = async (event) => {
    event.preventDefault();
    const imageUrls = form.urls
      .split(/\s+/)
      .map((url) => url.trim())
      .filter(Boolean);

    try {
      // Dua cara: tempel URL halaman chapter (bot yang mencari gambarnya), atau
      // tempel daftar URL gambar langsung kalau halamannya tidak bisa dibaca.
      const result = await enqueue({
        comic_id: comicId,
        chapter_number: form.chapterNumber,
        chapter_title: form.chapterTitle || null,
        ...(form.chapterUrl.trim() ? { chapter_url: form.chapterUrl.trim() } : {}),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      }).unwrap();

      const rejected = result.rejected?.length ?? 0;
      dispatch(
        showToast({
          message: `Chapter masuk antrian${rejected ? ` (${rejected} URL ditolak allowlist)` : ''}`,
        }),
      );
      setForm({ chapterNumber: '', chapterTitle: '', chapterUrl: '', urls: '' });
      onDone?.();
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal menambah ke antrian' }));
    }
  };

  return (
    <form onSubmit={submit} className="card mt-3 space-y-3 p-5">
      <p className="text-sm font-bold">Tambah chapter ke antrian download</p>
      <p className="text-xs text-night/50 dark:text-paper/50">
        Isi <b>salah satu</b>: URL halaman chapter (bot yang mencari gambarnya), atau daftar URL
        gambar kalau halaman itu tidak bisa dibaca. Berguna juga untuk menambal chapter yang hilang
        memakai sumber lain. Semua URL divalidasi terhadap allowlist domain di <code>.env</code>.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase opacity-60">Nomor chapter *</span>
          <input
            className="input"
            type="number"
            step="0.1"
            required
            value={form.chapterNumber}
            onChange={(event) => setForm({ ...form, chapterNumber: event.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase opacity-60">Judul chapter</span>
          <input
            className="input"
            value={form.chapterTitle}
            onChange={(event) => setForm({ ...form, chapterTitle: event.target.value })}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase opacity-60">
          URL halaman chapter
        </span>
        <input
          className="input font-mono text-xs"
          placeholder="https://contoh.com/judul-chapter-97/"
          value={form.chapterUrl}
          onChange={(event) => setForm({ ...form, chapterUrl: event.target.value })}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase opacity-60">
          atau URL gambar (satu per baris)
        </span>
        <textarea
          className="input h-28 font-mono text-xs"
          placeholder={'https://contoh.com/ch1/001.jpg\nhttps://contoh.com/ch1/002.jpg'}
          value={form.urls}
          onChange={(event) => setForm({ ...form, urls: event.target.value })}
        />
      </label>
      <button type="submit" className="btn-primary" disabled={isLoading}>
        {isLoading ? 'Menambahkan…' : 'Masukkan antrian'}
      </button>
    </form>
  );
};

const STATUSES = ['Ongoing', 'Completed', 'Hiatus'];

const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-60">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[11px] opacity-50">{hint}</span>}
  </label>
);

/**
 * Ubah metadata komik yang sudah diimpor. Berguna untuk merapikan hasil
 * deteksi otomatis dan mengelompokkan koleksi lewat genre.
 */
const EditMetadataForm = ({ comic, onClose }) => {
  const dispatch = useDispatch();
  const [updateComic, { isLoading }] = useUpdateComicMutation();
  const [form, setForm] = useState({
    title: comic.title ?? '',
    author: comic.author ?? '',
    artist: comic.artist ?? '',
    status: comic.status ?? 'Ongoing',
    rating: comic.rating ?? '',
    genres: (comic.genres ?? []).join(', '),
    description: comic.description ?? '',
  });

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    try {
      await updateComic({
        comicId: comic.id,
        title: form.title.trim(),
        author: form.author.trim(),
        artist: form.artist.trim(),
        status: form.status,
        rating: form.rating === '' ? null : Number(form.rating),
        genres: form.genres,
        description: form.description.trim(),
      }).unwrap();
      dispatch(showToast({ message: 'Info komik diperbarui' }));
      onClose();
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal menyimpan perubahan' }));
    }
  };

  return (
    <form onSubmit={submit} className="card mt-3 space-y-4 p-5">
      <h2 className="section-title">
        <span aria-hidden="true">✏️</span> Edit info komik
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Judul">
          <input className="input" value={form.title} onChange={set('title')} required />
        </Field>
        <Field label="Genre" hint="Pisahkan dengan koma — dipakai untuk filter di halaman Jelajahi">
          <input className="input" value={form.genres} onChange={set('genres')} placeholder="Action, Fantasy" />
        </Field>
        <Field label="Author">
          <input className="input" value={form.author} onChange={set('author')} />
        </Field>
        <Field label="Artist">
          <input className="input" value={form.artist} onChange={set('artist')} />
        </Field>
        <Field label="Status">
          <select className="input" value={form.status} onChange={set('status')}>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rating" hint="0 – 5, kosongkan kalau tidak dipakai">
          <input className="input" type="number" min="0" max="5" step="0.1" value={form.rating} onChange={set('rating')} />
        </Field>
      </div>

      <Field label="Sinopsis">
        <textarea className="input h-36" value={form.description} onChange={set('description')} />
      </Field>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? 'Menyimpan…' : 'Simpan perubahan'}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Batal
        </button>
      </div>
    </form>
  );
};

export const ComicDetail = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [order, setOrder] = useState('asc');
  const [showDownloadForm, setShowDownloadForm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const comicQuery = useGetComicQuery(slug);
  const comic = comicQuery.data;
  const chaptersQuery = useGetChaptersQuery({ comicId: comic?.id, order }, { skip: !comic?.id });

  // Tombol pengelolaan disembunyikan dari yang tidak berhak. Server tetap
  // memeriksa izinnya sendiri — ini semata supaya antarmuka tidak menawarkan
  // aksi yang pasti ditolak.
  const { bisa } = useAuth();

  const [toggleFavorite] = useToggleFavoriteMutation();
  const [deleteComic, { isLoading: isDeleting }] = useDeleteComicMutation();
  const [setCoverFromPage, { isLoading: isMakingCover }] = useSetCoverFromPageMutation();
  const [auditComic, { isLoading: isAuditing }] = useAuditComicMutation();
  const [resyncComic, { isLoading: isResyncing }] = useResyncComicMutation();

  const periksaKelengkapan = async () => {
    try {
      const hasil = await auditComic({ comicId: comic.id, full: true }).unwrap();
      dispatch(
        showToast({
          message: `${hasil.diperiksa} chapter diperiksa · ${hasil.bermasalah} bermasalah · ${hasil.gaps.length} nomor bolong`,
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Pemeriksaan gagal' }));
    }
  };

  const cekChapterBaru = async () => {
    try {
      const hasil = await resyncComic({ comicId: comic.id }).unwrap();
      dispatch(
        showToast({
          type: hasil.error ? 'error' : 'success',
          message:
            hasil.error ??
            `Sumber punya ${hasil.diSumber} chapter, koleksi ${hasil.diKoleksi} — ${hasil.diantre} diantre`,
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Resync gagal' }));
    }
  };

  const makeCoverFromPage = async () => {
    try {
      await setCoverFromPage(comic.id).unwrap();
      dispatch(showToast({ message: 'Cover diperbarui dari halaman pertama' }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal membuat cover' }));
    }
  };

  if (comicQuery.isLoading) return <Spinner label="Memuat detail komik…" />;
  if (comicQuery.isError) return <ErrorState error={comicQuery.error} onRetry={comicQuery.refetch} />;
  if (!comic) return null;

  const chapters = chaptersQuery.data?.items ?? [];
  const readable = chapters.filter((chapter) => chapter.isDownloaded && chapter.totalPages > 0);
  // Urutan untuk logika "lanjut baca" sengaja dihitung sendiri, tidak memakai
  // urutan tampilan. Dulu keduanya sama, sehingga menekan "Terbaru dulu ↓"
  // diam-diam membuat tombol melompat ke chapter paling akhir.
  const berurutan = [...readable].sort((a, b) => a.number - b.number);

  // Titik lanjut = chapter yang PALING BARU dibaca. Aturan lama memakai
  // "chapter paling awal yang belum 100%", dan itu selalu meleset: halaman
  // terakhir tidak pernah tercatat, jadi chapter yang sudah tamat berhenti di
  // ~98% dan tombol melempar pembaca kembali ke Ch 1.
  const terakhirDibaca = berurutan
    .filter((chapter) => chapter.readAt)
    .sort((a, b) => new Date(b.readAt) - new Date(a.readAt))[0];

  // Toleransi satu halaman: data lama tidak pernah menyentuh halaman terakhir,
  // jadi 64 dari 65 halaman tetap harus dihitung tamat.
  const sudahTamat = (chapter) =>
    chapter && (chapter.lastPageRead ?? 0) >= (chapter.totalPages ?? 0) - 1;

  const lanjutKe = (() => {
    if (!terakhirDibaca) return berurutan[0]; // belum pernah dibaca
    if (!sudahTamat(terakhirDibaca)) return terakhirDibaca; // lanjutkan di tempat
    const posisi = berurutan.findIndex((chapter) => chapter.id === terakhirDibaca.id);
    return berurutan[posisi + 1] ?? terakhirDibaca; // tamat -> chapter berikutnya
  })();

  const remove = async () => {
    if (!window.confirm(`Hapus "${comic.title}" beserta semua gambarnya? Tindakan ini permanen.`)) return;
    try {
      await deleteComic(comic.id).unwrap();
      dispatch(showToast({ message: `"${comic.title}" dihapus` }));
      navigate('/browse');
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal menghapus komik' }));
    }
  };

  return (
    <div>
      <div className="card flex flex-col gap-5 p-5 sm:flex-row">
        <div className="w-full flex-none sm:w-52">
          {comic.coverUrl ? (
            <img
              src={comic.coverUrl}
              alt={`Cover ${comic.title}`}
              className="w-full rounded-lg object-cover shadow-scroll"
            />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center rounded-lg bg-leaf/10 text-5xl">
              🍥
            </div>
          )}

          {bisa('sunting_metadata') && (
            <button
              type="button"
              className="btn-ghost mt-2 w-full text-xs"
              onClick={makeCoverFromPage}
              disabled={isMakingCover}
              title="Ambil poster dari halaman pertama chapter paling awal"
            >
              {isMakingCover ? 'Membuat…' : comic.coverUrl ? '🖼️ Ganti cover dari halaman 1' : '🖼️ Buat cover dari halaman 1'}
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${statusColor(comic.status)}`}>{comic.status ?? 'Ongoing'}</span>
            {comic.rating ? <span className="chip">⭐ {comic.rating}</span> : null}
            <span className="chip">{comic.totalChapters} chapter</span>
            {comic.source && <span className="chip">sumber: {comic.source}</span>}
          </div>

          <h1 className="mt-3 text-2xl font-black leading-tight">{comic.title}</h1>
          <p className="mt-1 text-sm text-night/60 dark:text-paper/60">
            {comic.author ?? 'Tanpa author'}
            {comic.artist && comic.artist !== comic.author ? ` · art: ${comic.artist}` : ''}
          </p>

          {comic.genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {comic.genres.map((genre) => (
                <Link key={genre} to={`/browse?genre=${encodeURIComponent(genre)}`} className="chip hover:border-naruto">
                  {genre}
                </Link>
              ))}
            </div>
          )}

          {comic.description && (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-night/70 dark:text-paper/70">
              {comic.description}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {lanjutKe ? (
              <Link to={`/read/${lanjutKe.id}`} className="btn-accent">
                {terakhirDibaca ? 'Lanjut baca' : 'Mulai baca'} · Ch{' '}
                {formatChapterNumber(lanjutKe.number)}
              </Link>
            ) : (
              <span className="btn-ghost cursor-default opacity-60">Belum ada chapter tersimpan</span>
            )}
            <button type="button" className="btn-ghost" onClick={() => toggleFavorite(comic.id)}>
              {comic.isFavorite ? '★ Favorit' : '☆ Favoritkan'}
            </button>
            {bisa('unggah_chapter') && (
              <Link to={`/upload?comic=${comic.id}`} className="btn-ghost">
                📤 Upload chapter
              </Link>
            )}
            {bisa('kelola_koleksi') && (
              <button type="button" className="btn-ghost" onClick={() => setShowDownloadForm((v) => !v)}>
                📥 Download via URL
              </button>
            )}
            {bisa('sunting_metadata') && (
              <button type="button" className="btn-ghost" onClick={() => setShowEdit((v) => !v)}>
                ✏️ Edit info
              </button>
            )}
            {bisa('kelola_koleksi') && (
              <button type="button" className="btn-ghost" onClick={cekChapterBaru} disabled={isResyncing}>
                {isResyncing ? 'Mengecek…' : '🔄 Cek chapter baru'}
              </button>
            )}
            {bisa('kelola_koleksi') && (
              <button type="button" className="btn-ghost" onClick={periksaKelengkapan} disabled={isAuditing}>
                {isAuditing ? 'Memeriksa…' : '🛡️ Periksa kelengkapan'}
              </button>
            )}
            {bisa('kelola_koleksi') && (
              <button type="button" className="btn-danger ml-auto" onClick={remove} disabled={isDeleting}>
                Hapus
              </button>
            )}
          </div>
        </div>
      </div>

      {showEdit && <EditMetadataForm comic={comic} onClose={() => setShowEdit(false)} />}

      {showDownloadForm && <DownloadForm comicId={comic.id} onDone={() => setShowDownloadForm(false)} />}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">
            <span aria-hidden="true">📄</span> Daftar Chapter
          </h2>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setOrder((value) => (value === 'asc' ? 'desc' : 'asc'))}
          >
            {order === 'asc' ? 'Terlama dulu ↑' : 'Terbaru dulu ↓'}
          </button>
        </div>

        {chaptersQuery.isLoading && <Spinner />}

        {chapters.length === 0 && !chaptersQuery.isLoading && (
          <p className="card px-4 py-8 text-center text-sm text-night/60 dark:text-paper/60">
            Belum ada chapter. Tambahkan lewat upload manual atau antrian download.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {chapters.map((chapter) => {
            const disabled = !chapter.isDownloaded || chapter.totalPages === 0;
            const Wrapper = disabled ? 'div' : Link;
            const wrapperProps = disabled ? {} : { to: `/read/${chapter.id}` };

            return (
              <li key={chapter.id}>
                <Wrapper
                  {...wrapperProps}
                  className={`card flex items-center gap-4 px-4 py-3 ${
                    disabled ? 'opacity-60' : 'hover:shadow-scroll'
                  }`}
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-leaf/10 text-sm font-bold">
                    {formatChapterNumber(chapter.number)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {chapter.title || `Chapter ${formatChapterNumber(chapter.number)}`}
                    </p>
                    <p className="text-xs text-night/50 dark:text-paper/50">
                      {chapter.isDownloaded
                        ? `${chapter.totalPages} halaman · ${formatBytes(chapter.fileSize)}`
                        : 'Belum diunduh'}
                      {chapter.readAt && ` · dibaca ${formatRelativeTime(chapter.readAt)}`}
                    </p>
                    {chapter.progressPercentage > 0 && (
                      <ProgressBar value={chapter.progressPercentage} className="mt-2" />
                    )}
                  </div>
                  <span className="flex-none text-xs opacity-60">{disabled ? '⏳' : '›'}</span>
                </Wrapper>
              </li>
            );
          })}
        </ul>
      </section>

      <RatingKomentar comicId={comic.id} />
    </div>
  );
};

export default ComicDetail;

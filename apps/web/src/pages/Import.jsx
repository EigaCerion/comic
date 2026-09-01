import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useGetImportConfigQuery,
  useGetImportJobsQuery,
  useImportArchiveMutation,
  useImportFromUrlMutation,
  useImportLocalMutation,
  usePreviewChapterUrlMutation,
  usePreviewSeriesMutation,
  useScanImportQuery,
} from '../api/apiSlice.js';
import { ErrorState, ProgressBar, Spinner } from '../components/Common/index.jsx';
import { showToast } from '../store/slices/uiSlice.js';
import { formatChapterNumber } from '../utils/format.js';

const Field = ({ label, children, hint }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-60">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[11px] opacity-50">{hint}</span>}
  </label>
);

// ── Tab 1: folder & arsip lokal ───────────────────────────────────────────

const LocalImport = () => {
  const dispatch = useDispatch();
  const { data: importConfig } = useGetImportConfigQuery();
  const scan = useScanImportQuery(undefined, { pollingInterval: 15000 });
  const jobs = useGetImportJobsQuery(undefined, { pollingInterval: 1500 });
  const [importLocal] = useImportLocalMutation();
  const [importArchive, { isLoading: isUploading }] = useImportArchiveMutation();
  const [archive, setArchive] = useState(null);

  const start = async (item) => {
    try {
      await importLocal({ path: item.path, title: item.title }).unwrap();
      dispatch(showToast({ message: `Import "${item.title}" dimulai` }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Import gagal' }));
    }
  };

  const uploadArchive = async (event) => {
    event.preventDefault();
    if (!archive) return;
    const data = new FormData();
    data.append('archive', archive);
    try {
      await importArchive(data).unwrap();
      dispatch(showToast({ message: `Import "${archive.name}" dimulai` }));
      setArchive(null);
      event.target.reset();
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Upload arsip gagal' }));
    }
  };

  const items = scan.data?.items ?? [];
  const activeJobs = (jobs.data?.items ?? []).filter((job) => job.status === 'running');
  const doneJobs = (jobs.data?.items ?? []).filter((job) => job.status !== 'running');

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="section-title mb-4">
          <span aria-hidden="true">📂</span> Folder import
        </h2>
        <p className="text-sm text-night/60 dark:text-paper/60">
          Taruh folder komik atau file <code>.cbz</code>/<code>.zip</code> di{' '}
          <code className="break-all">{importConfig?.importDir ?? 'apps/api/import'}</code>, lalu klik
          Segarkan. Satu subfolder = satu komik; subfolder di dalamnya = chapter.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => scan.refetch()}>
            ↻ Segarkan
          </button>
        </div>

        <div className="mt-4">
          {scan.isLoading && <Spinner label="Memindai…" />}
          {scan.isError && <ErrorState error={scan.error} onRetry={scan.refetch} />}

          {!scan.isLoading && items.length === 0 && (
            <p className="rounded-lg border border-dashed border-paper-line px-4 py-8 text-center text-sm opacity-60 dark:border-night-line">
              Belum ada yang terdeteksi di folder import.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.path}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-paper-line px-4 py-3 dark:border-night-line"
              >
                <span aria-hidden="true">{item.kind === 'archive' ? '🗜️' : '📁'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="text-xs opacity-60">
                    {item.chapters.length} chapter · {item.totalPages} halaman ·{' '}
                    <span className="font-mono">{item.path}</span>
                  </p>
                  <p className="mt-1 text-[11px] opacity-50">
                    Chapter: {item.chapters.map((c) => formatChapterNumber(c.number)).join(', ')}
                  </p>
                </div>
                <button type="button" className="btn-primary" onClick={() => start(item)}>
                  Import
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-4">
          <span aria-hidden="true">🗜️</span> Unggah arsip langsung
        </h2>
        <form onSubmit={uploadArchive} className="space-y-3">
          <Field label="File .cbz / .zip" hint="Maksimum 512 MB per arsip">
            <input
              className="input"
              type="file"
              accept=".cbz,.zip,application/zip"
              onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
            />
          </Field>
          <button type="submit" className="btn-primary" disabled={!archive || isUploading}>
            {isUploading ? 'Mengunggah…' : 'Import arsip'}
          </button>
        </form>
      </section>

      {(activeJobs.length > 0 || doneJobs.length > 0) && (
        <section className="card p-5">
          <h2 className="section-title mb-4">
            <span aria-hidden="true">⚙️</span> Proses import
          </h2>
          <ul className="space-y-3">
            {activeJobs.map((job) => (
              <li key={job.id}>
                <p className="text-sm font-semibold">{job.label}</p>
                <p className="text-xs opacity-60">
                  {job.currentLabel ?? 'menyiapkan…'} · {job.pagesDone}/{job.pagesTotal} halaman ·{' '}
                  {job.chaptersDone} chapter selesai
                </p>
                <ProgressBar
                  className="mt-1"
                  value={job.pagesTotal ? (job.pagesDone / job.pagesTotal) * 100 : 0}
                />
              </li>
            ))}
            {doneJobs.map((job) => (
              <li key={job.id} className="text-sm">
                <span className={job.status === 'completed' ? 'text-leaf-light' : 'text-danger'}>
                  {job.status === 'completed' ? '✓' : '✕'}
                </span>{' '}
                {job.label} — {job.chaptersDone} chapter
                {job.comic && (
                  <Link to={`/comic/${job.comic.slug}`} className="ml-2 text-naruto hover:underline">
                    buka
                  </Link>
                )}
                {job.error && <span className="ml-2 text-xs text-danger">{job.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

// ── Tab 2: import dari URL ────────────────────────────────────────────────

const UrlImport = () => {
  const dispatch = useDispatch();
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [preview, { data: series, isLoading: isPreviewing, error: previewError, reset }] =
    usePreviewSeriesMutation();
  const [previewChapter, { data: chapterPreview, isLoading: isCheckingChapter }] =
    usePreviewChapterUrlMutation();
  const [importFromUrl, { isLoading: isQueueing }] = useImportFromUrlMutation();

  const runPreview = async (event) => {
    event.preventDefault();
    reset();
    setSelected(new Set());
    try {
      const result = await preview(url.trim()).unwrap();
      setSelected(new Set(result.chapters.map((chapter) => chapter.url)));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal membaca halaman' }));
    }
  };

  const toggle = (chapterUrl) => {
    const next = new Set(selected);
    if (next.has(chapterUrl)) next.delete(chapterUrl);
    else next.add(chapterUrl);
    setSelected(next);
  };

  const queueSelected = async () => {
    const chapters = (series?.chapters ?? []).filter((chapter) => selected.has(chapter.url));
    try {
      const result = await importFromUrl({
        series_url: series.url,
        title: series.title,
        cover_url: series.coverUrl,
        author: series.author,
        artist: series.artist,
        status: series.status,
        genres: series.genres,
        description: series.description,
        chapters,
      }).unwrap();
      dispatch(
        showToast({
          message: `${result.queued.length} chapter masuk antrian${
            result.skipped.length ? ` · ${result.skipped.length} dilewati` : ''
          }`,
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal mengantre chapter' }));
    }
  };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="section-title mb-4">
          <span aria-hidden="true">🔗</span> Baca halaman seri
        </h2>
        <p className="text-sm text-night/60 dark:text-paper/60">
          Tempel URL halaman daftar chapter. Host-nya harus ada di{' '}
          <code>ALLOWED_SOURCE_DOMAINS</code>, dan <code>robots.txt</code> situs dihormati kecuali
          kamu mematikan <code>RESPECT_ROBOTS</code>.
        </p>

        <form onSubmit={runPreview} className="mt-3 flex flex-wrap gap-2">
          <input
            className="input flex-1"
            type="url"
            required
            placeholder="https://contoh.com/komik/judul/"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={isPreviewing}>
            {isPreviewing ? 'Membaca…' : 'Deteksi'}
          </button>
        </form>

        {previewError && <ErrorState error={previewError} />}
      </section>

      {series && (
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{series.title || '(judul tidak terdeteksi)'}</h2>
              <p className="text-xs opacity-60">
                sumber: {series.source} · extractor: {series.extractor} · {series.chapters.length} chapter
                terdeteksi
              </p>
              {series.existingComic && (
                <p className="mt-1 text-xs text-shinobi">
                  Sudah ada di library ({series.existingComic.totalChapters} chapter) — chapter yang
                  sama tidak akan diduplikasi.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setSelected(new Set(series.chapters.map((c) => c.url)))}>
                Pilih semua
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSelected(new Set())}>
                Kosongkan
              </button>
              <button type="button" className="btn-accent" onClick={queueSelected} disabled={isQueueing || selected.size === 0}>
                {isQueueing ? 'Mengantre…' : `Unduh ${selected.size} chapter`}
              </button>
            </div>
          </div>

          {(series.genres?.length > 0 || series.description) && (
            <div className="mt-3 border-t border-paper-line pt-3 dark:border-night-line">
              {series.genres?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {series.genres.map((genre) => (
                    <span key={genre} className="chip">
                      {genre}
                    </span>
                  ))}
                </div>
              )}
              {(series.author || series.status) && (
                <p className="mt-2 text-xs opacity-60">
                  {series.author ?? 'author tidak terdeteksi'}
                  {series.status ? ` · ${series.status}` : ''}
                </p>
              )}
              {series.description && (
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed opacity-70">
                  {series.description}
                </p>
              )}
              <p className="mt-2 text-[11px] opacity-40">
                Semua metadata ini ikut tersimpan, dan bisa diubah lagi di halaman detail komik.
              </p>
            </div>
          )}

          {series.warning && (
            <p className="mt-3 rounded-lg border border-danger/40 px-3 py-2 text-xs text-danger">
              {series.warning}
            </p>
          )}

          <ul className="mt-4 max-h-96 space-y-1 overflow-y-auto pr-1">
            {series.chapters.map((chapter) => (
              <li
                key={chapter.url}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-paper dark:hover:bg-night-soft"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-naruto"
                  checked={selected.has(chapter.url)}
                  onChange={() => toggle(chapter.url)}
                />
                <span className="w-14 flex-none font-mono text-xs opacity-70">
                  {formatChapterNumber(chapter.number)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{chapter.title || chapter.url}</span>
                <button
                  type="button"
                  className="flex-none text-xs text-naruto hover:underline"
                  onClick={() => previewChapter(chapter.url)}
                  disabled={isCheckingChapter}
                >
                  cek gambar
                </button>
              </li>
            ))}
          </ul>

          {chapterPreview && (
            <div className="mt-4 rounded-lg border border-paper-line px-3 py-2 text-xs dark:border-night-line">
              <p className="font-semibold">
                {chapterPreview.totalImages} gambar terdeteksi ({chapterPreview.extractor})
              </p>
              <ul className="mt-1 space-y-0.5 font-mono opacity-60">
                {chapterPreview.imageUrls.map((imageUrl) => (
                  <li key={imageUrl} className="truncate">
                    {imageUrl}
                  </li>
                ))}
              </ul>
              {chapterPreview.warning && <p className="mt-1 text-danger">{chapterPreview.warning}</p>}
            </div>
          )}

          <p className="mt-4 text-xs opacity-50">
            Chapter yang diantre diproses oleh worker download —{' '}
            <Link to="/downloads" className="text-naruto hover:underline">
              lihat progresnya
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
};

// ── Halaman ───────────────────────────────────────────────────────────────

export const Import = () => {
  const [tab, setTab] = useState('local');

  return (
    <div>
      <h1 className="text-2xl font-black">Import Komik</h1>
      <p className="mt-1 text-sm text-night/50 dark:text-paper/50">
        Dua jalur: dari file yang sudah ada di disk, atau dari URL situs yang diizinkan.
      </p>

      <div className="mt-5 flex overflow-hidden rounded-lg border border-paper-line dark:border-night-line">
        {[
          { value: 'local', label: '📂 Folder & CBZ' },
          { value: 'url', label: '🔗 Dari URL' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setTab(option.value)}
            className={`flex-1 px-4 py-2 text-sm font-semibold transition ${
              tab === option.value ? 'bg-leaf text-paper' : 'hover:bg-paper dark:hover:bg-night-soft'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-5">{tab === 'local' ? <LocalImport /> : <UrlImport />}</div>
    </div>
  );
};

export default Import;

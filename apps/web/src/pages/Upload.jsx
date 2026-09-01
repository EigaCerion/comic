import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useGetComicsQuery,
  useUploadChapterMutation,
  useUploadComicMutation,
} from '../api/apiSlice.js';
import { showToast } from '../store/slices/uiSlice.js';
import { formatBytes } from '../utils/format.js';

const Field = ({ label, children, hint, required }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-60">
      {label}
      {required && ' *'}
    </span>
    {children}
    {hint && <span className="mt-1 block text-[11px] opacity-50">{hint}</span>}
  </label>
);

const ComicForm = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [uploadComic, { isLoading }] = useUploadComicMutation();
  const [cover, setCover] = useState(null);
  const [form, setForm] = useState({
    title: '',
    author: '',
    artist: '',
    genres: '',
    status: 'Ongoing',
    rating: '',
    description: '',
  });

  const submit = async (event) => {
    event.preventDefault();
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => value !== '' && data.append(key, value));
    data.append('source', 'manual');
    if (cover) data.append('cover', cover);

    try {
      const comic = await uploadComic(data).unwrap();
      dispatch(showToast({ message: `"${comic.title}" ditambahkan` }));
      navigate(`/comic/${comic.slug}`);
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal menambah komik' }));
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="section-title">
        <span aria-hidden="true">📗</span> Komik baru
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Judul" required>
          <input
            className="input"
            required
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="Author">
          <input
            className="input"
            value={form.author}
            onChange={(event) => setForm({ ...form, author: event.target.value })}
          />
        </Field>
        <Field label="Artist">
          <input
            className="input"
            value={form.artist}
            onChange={(event) => setForm({ ...form, artist: event.target.value })}
          />
        </Field>
        <Field label="Genre" hint="Pisahkan dengan koma: Action, Fantasy">
          <input
            className="input"
            value={form.genres}
            onChange={(event) => setForm({ ...form, genres: event.target.value })}
          />
        </Field>
        <Field label="Status">
          <select
            className="input"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
          >
            {['Ongoing', 'Completed', 'Hiatus'].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rating" hint="0 – 5">
          <input
            className="input"
            type="number"
            min="0"
            max="5"
            step="0.1"
            value={form.rating}
            onChange={(event) => setForm({ ...form, rating: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Deskripsi">
        <textarea
          className="input h-24"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </Field>

      <Field label="Cover" hint="Otomatis dikompresi ke WebP">
        <input
          className="input"
          type="file"
          accept="image/*"
          onChange={(event) => setCover(event.target.files?.[0] ?? null)}
        />
      </Field>

      <button type="submit" className="btn-primary" disabled={isLoading}>
        {isLoading ? 'Menyimpan…' : 'Simpan komik'}
      </button>
    </form>
  );
};

const ChapterForm = ({ defaultComicId }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data: comicsData } = useGetComicsQuery({ limit: 100, sort: 'alphabetical' });
  const [uploadChapter, { isLoading }] = useUploadChapterMutation();
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({
    comicId: defaultComicId ?? '',
    chapterNumber: '',
    chapterTitle: '',
  });

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  const submit = async (event) => {
    event.preventDefault();
    if (!files.length) {
      dispatch(showToast({ type: 'error', message: 'Pilih gambar halaman dulu' }));
      return;
    }

    const data = new FormData();
    data.append('comic_id', form.comicId);
    data.append('chapter_number', form.chapterNumber);
    if (form.chapterTitle) data.append('chapter_title', form.chapterTitle);
    files.forEach((file) => data.append('pages', file));

    try {
      const chapter = await uploadChapter(data).unwrap();
      dispatch(showToast({ message: `Chapter ${chapter.number} tersimpan (${chapter.totalPages} halaman)` }));
      setFiles([]);
      setForm({ ...form, chapterNumber: '', chapterTitle: '' });
      navigate(`/read/${chapter.id}`);
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal upload chapter' }));
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="section-title">
        <span aria-hidden="true">📄</span> Chapter baru
      </h2>

      <Field label="Komik" required>
        <select
          className="input"
          required
          value={form.comicId}
          onChange={(event) => setForm({ ...form, comicId: event.target.value })}
        >
          <option value="">Pilih komik…</option>
          {(comicsData?.items ?? []).map((comic) => (
            <option key={comic.id} value={comic.id}>
              {comic.title}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nomor chapter" required hint="Boleh desimal, mis. 10.5">
          <input
            className="input"
            type="number"
            step="0.1"
            required
            value={form.chapterNumber}
            onChange={(event) => setForm({ ...form, chapterNumber: event.target.value })}
          />
        </Field>
        <Field label="Judul chapter">
          <input
            className="input"
            value={form.chapterTitle}
            onChange={(event) => setForm({ ...form, chapterTitle: event.target.value })}
          />
        </Field>
      </div>

      <Field
        label="Gambar halaman"
        required
        hint="Urutan halaman diambil dari nama file (001.jpg, 002.jpg, …). Semua gambar dikompresi ke WebP."
      >
        <input
          className="input"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => setFiles([...(event.target.files ?? [])])}
        />
      </Field>

      {files.length > 0 && (
        <p className="text-xs opacity-60">
          {files.length} file dipilih · {formatBytes(totalSize)} sebelum kompresi
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={isLoading}>
        {isLoading ? 'Mengompresi & menyimpan…' : 'Upload chapter'}
      </button>
    </form>
  );
};

export const Upload = () => {
  const [params] = useSearchParams();
  const defaultComicId = params.get('comic') ?? '';
  const [tab, setTab] = useState(defaultComicId ? 'chapter' : 'comic');

  return (
    <div>
      <h1 className="text-2xl font-black">Upload Manual</h1>
      <p className="mt-1 text-sm text-night/50 dark:text-paper/50">
        Tambahkan komik dari file lokal. Gambar dikompresi di server sebelum disimpan.
      </p>

      <div className="mt-5 flex overflow-hidden rounded-lg border border-paper-line dark:border-night-line">
        {[
          { value: 'comic', label: '📗 Komik baru' },
          { value: 'chapter', label: '📄 Chapter baru' },
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

      <div className="mt-5 max-w-3xl">
        {tab === 'comic' ? <ComicForm /> : <ChapterForm defaultComicId={defaultComicId} />}
      </div>
    </div>
  );
};

export default Upload;

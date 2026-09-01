import { useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useGetComicsQuery, useGetGenresQuery } from '../api/apiSlice.js';
import ComicGrid from '../components/ComicList/ComicGrid.jsx';
import { EmptyState, ErrorState, Spinner } from '../components/Common/index.jsx';
import { setViewMode } from '../store/slices/uiSlice.js';

const SORTS = [
  { value: 'latest', label: 'Terbaru diperbarui' },
  { value: 'created', label: 'Baru ditambahkan' },
  { value: 'alphabetical', label: 'A → Z' },
  { value: 'rating', label: 'Rating tertinggi' },
  { value: 'chapters', label: 'Chapter terbanyak' },
  { value: 'lastRead', label: 'Terakhir dibaca' },
];

const STATUSES = ['', 'Ongoing', 'Completed', 'Hiatus'];

export const Browse = () => {
  const dispatch = useDispatch();
  const viewMode = useSelector((state) => state.ui.viewMode);
  const [params, setParams] = useSearchParams();

  const page = Number(params.get('page') ?? 1);
  const search = params.get('search') ?? '';
  const genre = params.get('genre') ?? '';
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'latest';
  const favorite = params.get('favorite') === 'true';

  const { data: genresData } = useGetGenresQuery();
  const query = useGetComicsQuery({ page, limit: 24, search, genre, status, sort, favorite });

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === null || value === undefined || value === false) next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const pagination = query.data?.pagination;
  const items = query.data?.items ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">{favorite ? 'Favorit' : 'Jelajahi'}</h1>
          <p className="text-sm text-night/50 dark:text-paper/50">
            {pagination ? `${pagination.total} komik` : 'Memuat…'}
            {search && ` · hasil untuk “${search}”`}
          </p>
        </div>

        <div className="flex overflow-hidden rounded-lg border border-paper-line dark:border-night-line">
          {['grid', 'list'].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => dispatch(setViewMode(mode))}
              className={`px-3 py-1.5 text-xs font-semibold capitalize transition ${
                viewMode === mode
                  ? 'bg-leaf text-paper'
                  : 'hover:bg-paper dark:hover:bg-night-soft'
              }`}
            >
              {mode === 'grid' ? '▦ Grid' : '☰ List'}
            </button>
          ))}
        </div>
      </div>

      <div className="card mt-5 grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-60">Genre</span>
          <select className="input" value={genre} onChange={(event) => setParam('genre', event.target.value)}>
            <option value="">Semua genre</option>
            {(genresData?.items ?? []).map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} ({item.count})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-60">Status</span>
          <select className="input" value={status} onChange={(event) => setParam('status', event.target.value)}>
            {STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value || 'Semua status'}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide opacity-60">Urutkan</span>
          <select className="input" value={sort} onChange={(event) => setParam('sort', event.target.value)}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-naruto"
            checked={favorite}
            onChange={(event) => setParam('favorite', event.target.checked)}
          />
          <span className="text-sm">Hanya favorit</span>
        </label>
      </div>

      <div className="mt-5">
        {query.isLoading && <Spinner />}
        {query.isError && <ErrorState error={query.error} onRetry={query.refetch} />}

        {!query.isLoading && items.length === 0 && !query.isError && (
          <EmptyState
            icon="🔍"
            title="Tidak ada komik yang cocok"
            description="Coba hapus sebagian filter, atau tambahkan komik baru lewat upload manual."
          />
        )}

        {items.length > 0 && <ComicGrid comics={items} viewMode={viewMode} />}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn-ghost"
            disabled={page <= 1}
            onClick={() => setParam('page', page - 1)}
          >
            ← Sebelumnya
          </button>
          <span className="text-sm">
            Halaman {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={page >= pagination.totalPages}
            onClick={() => setParam('page', page + 1)}
          >
            Berikutnya →
          </button>
        </div>
      )}
    </div>
  );
};

export default Browse;

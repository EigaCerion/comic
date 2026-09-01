import { Link } from 'react-router-dom';
import {
  useGetComicsQuery,
  useGetContinueReadingQuery,
  useGetStatsQuery,
} from '../api/apiSlice.js';
import { ComicCard } from '../components/ComicList/ComicCard.jsx';
import { EmptyState, ErrorState, Spinner } from '../components/Common/index.jsx';
import { formatBytes } from '../utils/format.js';

const Hero = ({ stats }) => (
  <section className="relative overflow-hidden rounded-2xl border border-paper-line bg-gradient-to-br from-leaf via-leaf-dark to-night px-6 py-10 text-paper dark:border-night-line">
    <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full border-8 border-naruto/30" aria-hidden="true" />
    <div className="absolute -bottom-16 right-24 h-56 w-56 rounded-full border-8 border-paper/10" aria-hidden="true" />

    <div className="relative max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-naruto">Hidden Leaf Library</p>
      <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">
        Koleksi komikmu, tersimpan lokal dan siap dibaca.
      </h1>
      <p className="mt-3 max-w-xl text-sm text-paper/80">
        Semua halaman dikompresi ke WebP kualitas HD, jadi ribuan chapter tetap ringan di disk. Tanpa
        akun, tanpa tracking.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/browse" className="btn-accent">
          Jelajahi koleksi
        </Link>
        <Link to="/upload" className="btn-ghost border-paper/30 text-paper hover:bg-paper/10">
          Upload manual
        </Link>
      </div>

      {stats && (
        <dl className="mt-7 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {[
            { label: 'Komik', value: stats.library.comics },
            { label: 'Chapter', value: stats.library.chapters },
            { label: 'Halaman', value: stats.library.pages },
            { label: 'Storage', value: formatBytes(stats.storage.totalBytes) },
          ].map((item) => (
            <div key={item.label}>
              <dt className="text-[11px] uppercase tracking-wider text-paper/60">{item.label}</dt>
              <dd className="text-xl font-bold">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  </section>
);

const Row = ({ title, icon, action, children }) => (
  <section className="mt-8">
    <div className="mb-3 flex items-end justify-between">
      <h2 className="section-title">
        <span aria-hidden="true">{icon}</span>
        {title}
      </h2>
      {action}
    </div>
    {children}
  </section>
);

export const Home = () => {
  const { data: stats } = useGetStatsQuery();
  const continueQuery = useGetContinueReadingQuery(6);
  const latestQuery = useGetComicsQuery({ limit: 12, sort: 'latest' });
  const favoritesQuery = useGetComicsQuery({ limit: 6, favorite: true });

  const isEmptyLibrary =
    !latestQuery.isLoading && (latestQuery.data?.pagination?.total ?? 0) === 0;

  return (
    <div>
      <Hero stats={stats} />

      {isEmptyLibrary && (
        <div className="mt-8">
          <EmptyState
            icon="📚"
            title="Perpustakaan masih kosong"
            description="Tambahkan komik lewat upload manual, atau jalankan `npm run seed:test-data` di apps/api untuk mengisi data contoh."
            action={
              <Link to="/upload" className="btn-primary mt-2">
                Tambah komik pertama
              </Link>
            }
          />
        </div>
      )}

      {continueQuery.data?.items?.length > 0 && (
        <Row title="Lanjut baca" icon="📖">
          <div className="grid-komik">
            {continueQuery.data.items.map((entry) => (
              <ComicCard key={entry.comic.id} comic={entry.comic} progress={entry} />
            ))}
          </div>
        </Row>
      )}

      {favoritesQuery.data?.items?.length > 0 && (
        <Row
          title="Favorit"
          icon="⭐"
          action={
            <Link to="/browse?favorite=true" className="text-xs font-semibold text-naruto hover:underline">
              Lihat semua
            </Link>
          }
        >
          <div className="grid-komik">
            {favoritesQuery.data.items.map((comic) => (
              <ComicCard key={comic.id} comic={comic} />
            ))}
          </div>
        </Row>
      )}

      {!isEmptyLibrary && (
        <Row
          title="Baru diperbarui"
          icon="🍃"
          action={
            <Link to="/browse" className="text-xs font-semibold text-naruto hover:underline">
              Jelajahi
            </Link>
          }
        >
          {latestQuery.isLoading && <Spinner />}
          {latestQuery.isError && <ErrorState error={latestQuery.error} onRetry={latestQuery.refetch} />}
          <div className="grid-komik">
            {(latestQuery.data?.items ?? []).map((comic) => (
              <ComicCard key={comic.id} comic={comic} />
            ))}
          </div>
        </Row>
      )}
    </div>
  );
};

export default Home;

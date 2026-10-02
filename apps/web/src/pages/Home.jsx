import { Link } from 'react-router-dom';
import {
  useGetComicsQuery,
  useGetContinueReadingQuery,
  useGetStatsQuery,
} from '../api/apiSlice.js';
import { ComicCard } from '../components/ComicList/ComicCard.jsx';
import { EmptyState, ErrorState, Spinner } from '../components/Common/index.jsx';
import { formatBytes } from '../utils/format.js';
import { IS_APP } from '../platform/index.js';
import RakBeranda from '../offline/RakBeranda.jsx';

const Hero = ({ stats }) => (
  /* Hijau Konoha diganti lavender aksi utama. Gradiennya sengaja pendek — dua
     nada yang berdekatan, bukan sapuan lintas warna — karena spesifikasinya
     menahan gradient dan karena blok ini duduk tepat di atas deretan sampul
     komik yang justru harus jadi satu-satunya hal berwarna kuat di layar.

     Seluruh tulisan dan garis hiasnya memakai token `primary-on`, bukan `paper`:
     lavender tema terang menuntut tinta putih, lavender tema gelap menuntut
     tinta gelap, dan `paper` hanya benar untuk salah satunya. */
  <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary-hover px-6 py-10 text-primary-on">
    <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full border-8 border-primary-on/20" aria-hidden="true" />
    <div className="absolute -bottom-16 right-24 h-56 w-56 rounded-full border-8 border-primary-on/10" aria-hidden="true" />

    <div className="relative max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-primary-on/70">Hidden Leaf Library</p>
      <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">
        Koleksi komikmu, tersimpan lokal dan siap dibaca.
      </h1>
      <p className="mt-3 max-w-xl text-sm text-primary-on/80">
        Semua halaman dikompresi ke WebP kualitas HD, jadi ribuan chapter tetap ringan di disk. Tanpa
        akun, tanpa tracking.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {/* Tombol utama di dalam blok lavender tidak boleh ikut lavender — ia
            akan lenyap. Dibalik: permukaan terang di atas warna, cara yang sama
            dipakai tombol ajakan di hampir semua hero. */}
        <Link to="/browse" className="btn bg-surface text-txt hover:bg-surface-soft">
          Jelajahi koleksi
        </Link>
        <Link to="/upload" className="btn border border-primary-on/30 text-primary-on hover:bg-primary-on/10">
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
              <dt className="text-[11px] uppercase tracking-wider text-primary-on/60">{item.label}</dt>
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

  /*
   * `!isError` ikut disyaratkan, dan itu memperbaiki keluhan yang paling
   * menyesatkan di aplikasi ini: server rumah tidak terjangkau berarti data-nya
   * undefined, `total ?? 0` jadi 0, dan beranda mengumumkan "Perpustakaan masih
   * kosong" kepada orang yang koleksinya utuh — bahkan kepada orang yang chapter
   * tersimpannya ada di HP-nya sendiri.
   *
   * Efek sampingnya justru yang diinginkan: dengan gerbang ini terbuka, baris
   * "Baru diperbarui" di bawah kini sempat merender ErrorState-nya sendiri
   * berikut tombol coba lagi. Sebelumnya EmptyState selalu menang lebih dulu,
   * sehingga ErrorState itu tidak pernah terlihat sekali pun.
   */
  const isEmptyLibrary =
    !latestQuery.isLoading && !latestQuery.isError && (latestQuery.data?.pagination?.total ?? 0) === 0;

  return (
    <div>
      <Hero stats={stats} />

      {/* Build android saja: komik yang benar-benar ada di HP ini. Ditaruh paling
          atas karena ia satu-satunya bagian beranda yang tetap berarti saat
          server rumah mati. */}
      {IS_APP && <RakBeranda />}

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
            <Link to="/browse?favorite=true" className="text-xs font-semibold text-primary hover:underline">
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
            <Link to="/browse" className="text-xs font-semibold text-primary hover:underline">
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

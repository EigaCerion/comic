import { EmptyState, ErrorState, Spinner } from '../components/Common/index.jsx';
import { Ubin } from './UbinKomik.jsx';

/**
 * Halaman Jelajahi khusus build Android.
 *
 * Susunan web memakai kartu penyaring berisi tiga <select> dan satu kotak
 * centang dalam grid empat kolom. Di layar lebar itu satu baris rapi; di 360px
 * ia runtuh jadi tumpukan setinggi hampir satu layar penuh — sehingga yang
 * pertama terlihat saat membuka Jelajahi adalah formulir, bukan satu pun komik.
 *
 * Di sini penyaringnya jadi chip yang digeser mendatar: dua baris setinggi
 * 32px, dan pilihan yang sedang aktif selalu terbaca tanpa membuka apa pun.
 * Urutan tetap <select> karena ia enam pilihan yang jarang diganti — enam chip
 * memakan satu baris penuh untuk sesuatu yang disentuh sekali sebulan.
 *
 * Gridnya tiga kolom, bukan dua. Dua kolom di 360px menghasilkan sampul selebar
 * 165px — sedikit lebih besar daripada yang dibutuhkan untuk mengenali sebuah
 * sampul, dan hanya empat judul muat sebelum lipatan. Tiga kolom memuat
 * sembilan, dan mengenali sampul komik di 105px masih mudah.
 *
 * DATA-nya sama persis dengan jalur web — seluruh query dan penyetel filter
 * diteruskan dari Browse.jsx. Yang berbeda tata letaknya saja.
 */

const Cip = ({ aktif, onClick, anak }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={aktif}
    className={[
      'flex-none rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
      aktif ? 'border-primary bg-primary text-primary-on' : 'border-line bg-surface-soft text-txt-2',
    ].join(' ')}
  >
    {anak}
  </button>
);

export const JelajahiApp = ({ judul, pagination, items, query, genres, filter, setParam, sorts, statuses }) => (
  <div>
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-black">{judul}</h1>
        <p className="truncate text-xs text-txt-2">
          {pagination ? `${pagination.total} komik` : 'Memuat…'}
          {filter.search && ` · “${filter.search}”`}
        </p>
      </div>

      {/* Urutan tetap select: enam pilihan, jarang diganti, dan sebagai chip ia
          akan memakan satu baris penuh untuk sesuatu yang disentuh sekali
          sebulan. Lebarnya dibatasi supaya label panjang tidak mendorong judul
          halaman keluar. */}
      <select
        className="input max-w-[44%] flex-none py-1.5 text-xs"
        value={filter.sort}
        onChange={(event) => setParam('sort', event.target.value)}
        aria-label="Urutkan"
      >
        {sorts.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>

    {/* Baris pertama: favorit dan status. Keduanya di satu baris karena
        sama-sama pendek dan sama-sama sering dipakai bersamaan. */}
    <div className="geser-x tepi-layar mt-4 py-0.5">
      <Cip aktif={filter.favorite} onClick={() => setParam('favorite', !filter.favorite)} anak="★ Favorit" />
      {statuses.map((nilai) => (
        <Cip
          key={nilai || 'semua'}
          aktif={filter.status === nilai}
          onClick={() => setParam('status', nilai)}
          anak={nilai || 'Semua status'}
        />
      ))}
    </div>

    {/* Baris kedua: genre. Jumlahnya belasan, jadi ia butuh barisnya sendiri. */}
    {(genres ?? []).length > 0 && (
      <div className="geser-x tepi-layar mt-2 py-0.5">
        <Cip aktif={filter.genre === ''} onClick={() => setParam('genre', '')} anak="Semua genre" />
        {genres.map((item) => (
          <Cip
            key={item.name}
            aktif={filter.genre === item.name}
            onClick={() => setParam('genre', item.name)}
            anak={`${item.name} ${item.count}`}
          />
        ))}
      </div>
    )}

    <div className="mt-5">
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorState error={query.error} onRetry={query.refetch} />}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState
          icon="🔍"
          title="Tidak ada komik yang cocok"
          description="Coba lepas sebagian penyaring di atas."
        />
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-4">
          {items.map((komik) => (
            <Ubin key={komik.id} komik={komik} lebar="w-full" />
          ))}
        </div>
      )}
    </div>

    {pagination && pagination.totalPages > 1 && (
      // Tombolnya dibuat selebar separuh layar, bukan sekadar teks berpanah:
      // ini satu-satunya kendali di halaman ini yang ditekan sambil menggenggam
      // HP dengan satu tangan, dan sasaran sentuh kecil di tepi bawah adalah
      // yang paling sering meleset.
      <div className="mt-6 flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost flex-1"
          disabled={filter.page <= 1}
          onClick={() => setParam('page', filter.page - 1)}
        >
          ← Sebelumnya
        </button>
        <span className="flex-none px-1 text-xs tabular-nums text-txt-2">
          {pagination.page}/{pagination.totalPages}
        </span>
        <button
          type="button"
          className="btn-ghost flex-1"
          disabled={filter.page >= pagination.totalPages}
          onClick={() => setParam('page', filter.page + 1)}
        >
          Berikutnya →
        </button>
      </div>
    )}
  </div>
);

export default JelajahiApp;

import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  useGetBookmarksQuery,
  useGetConnectQuery,
  useGetStatsQuery,
  useHealthQuery,
} from '../api/apiSlice.js';
import { ErrorState, Spinner } from '../components/Common/index.jsx';
import { setTheme, setViewMode } from '../store/slices/uiSlice.js';
import { setFit, setMode } from '../store/slices/readerSlice.js';
import { formatBytes, formatDurasi, formatRelativeTime } from '../utils/format.js';

const Card = ({ title, icon, children }) => (
  <section className="card p-5">
    <h2 className="section-title mb-4">
      <span aria-hidden="true">{icon}</span>
      {title}
    </h2>
    {children}
  </section>
);

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between border-b border-paper-line py-2 text-sm last:border-0 dark:border-night-line">
    <span className="opacity-60">{label}</span>
    <span className="font-mono font-semibold">{value}</span>
  </div>
);

const Choice = ({ label, value, options, onChange }) => (
  <div className="mb-4">
    <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">{label}</p>
    <div className="flex overflow-hidden rounded-lg border border-paper-line dark:border-night-line">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex-1 px-3 py-1.5 text-xs font-semibold transition ${
            value === option.value ? 'bg-leaf text-paper' : 'hover:bg-paper dark:hover:bg-night-soft'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

/**
 * Sambungkan perangkat lain tanpa menyalin alamat: pindai QR dari layar ini,
 * atau ketik nama tetapnya. IP boleh berganti tiap pindah Wi-Fi — QR selalu
 * dibuat dari alamat yang berlaku saat ini.
 */
/**
 * Penanda status server.
 *
 * Dibuat setelah server dua kali berhenti diam-diam: dari layar tidak ada
 * apa pun yang membedakan "server hidup" dari "server mati tapi halaman ini
 * masih menampilkan data lama dari cache". Kartu ini di-poll terus, jadi tab
 * yang dibiarkan terbuka akan berubah merah begitu servernya berhenti.
 */
const StatusServerCard = () => {
  const health = useHealthQuery(undefined, { pollingInterval: 10_000 });
  const idAwal = useRef(null);
  const [pernahRestart, setPernahRestart] = useState(false);

  const idProses = health.data?.idProses;

  // Waktu mulai saja tidak cukup untuk mendeteksi restart beruntun, jadi yang
  // dibandingkan adalah identitas prosesnya.
  useEffect(() => {
    if (!idProses) return;
    if (idAwal.current === null) {
      idAwal.current = idProses;
      return;
    }
    if (idAwal.current !== idProses) {
      idAwal.current = idProses;
      setPernahRestart(true);
    }
  }, [idProses]);

  const belumTahu = health.isLoading && !health.data;
  const mati = health.isError;

  // Dihitung dari waktu mulai, bukan dari angka uptime di respons terakhir —
  // angka itu langsung basi begitu poll berikutnya belum datang.
  const mulai = health.data?.mulaiPada ? new Date(health.data.mulaiPada) : null;
  const berjalanDetik = mulai ? (Date.now() - mulai.getTime()) / 1000 : null;

  const nada = mati
    ? { titik: 'bg-rose-500', teks: 'text-rose-500', label: 'Tidak menjawab' }
    : belumTahu
      ? { titik: 'bg-night/30 dark:bg-paper/30', teks: 'opacity-60', label: 'Memeriksa…' }
      : { titik: 'bg-emerald-500', teks: 'text-emerald-500', label: 'Hidup' };

  return (
    <Card title="Status server" icon="🩺">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 flex-none rounded-full ${nada.titik}`} aria-hidden="true" />
        <span className={`text-sm font-bold ${nada.teks}`}>{nada.label}</span>
      </div>

      {mati ? (
        <div className="mt-3 text-sm">
          <p className="opacity-70">
            Server tidak menjawab. Perangkat lain juga tidak akan bisa membukanya sampai server
            dijalankan lagi.
          </p>
          <p className="mt-2 text-xs opacity-50">
            Terakhir terlihat hidup:{' '}
            {health.fulfilledTimeStamp
              ? formatRelativeTime(new Date(health.fulfilledTimeStamp).toISOString())
              : 'belum pernah sejak halaman ini dibuka'}
          </p>
          <p className="mt-2 text-xs opacity-50">
            Nyalakan ulang lewat <code>NaruReader.bat</code>.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <Row
            label="Hidup sejak"
            value={mulai ? mulai.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
          />
          <Row label="Sudah berjalan" value={berjalanDetik === null ? '—' : formatDurasi(berjalanDetik)} />
          <Row label="Versi API" value={health.data?.version ?? '—'} />
        </div>
      )}

      {pernahRestart && !mati && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Server sempat mati dan hidup lagi sejak halaman ini dibuka. Kalau ini terjadi berulang,
          unduhan yang sedang berjalan ikut terputus tiap kali.
        </p>
      )}
    </Card>
  );
};

const ConnectCard = () => {
  const { data } = useGetConnectQuery();
  if (!data) return null;

  return (
    <Card title="Sambungkan perangkat" icon="📱">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <img
          src="/api/connect/qr"
          alt="QR untuk membuka NaruReader di perangkat lain"
          className="h-40 w-40 flex-none rounded-lg bg-white p-2"
        />
        <div className="min-w-0 flex-1 text-sm">
          <p className="opacity-70">Pindai dengan kamera HP, atau ketik alamatnya langsung:</p>

          {/* Alamat dipisah menurut daya tahannya terhadap pindah jaringan.
              Menampilkan semuanya sebagai daftar rata membuat orang menyalin
              alamat Wi-Fi lalu bingung kenapa mati begitu ganti jaringan. */}
          <ul className="mt-3 space-y-2.5">
            {data.nama && (
              <li>
                <p className="font-mono text-xs font-semibold text-naruto">{data.nama}</p>
                <p className="label-mikro mt-0.5">Nama tetap · berlaku di jaringan mana pun</p>
              </li>
            )}
            {data.overlay && (
              <li>
                <p className="truncate font-mono text-xs">{data.overlay}</p>
                <p className="label-mikro mt-0.5">
                  Lewat {data.overlayInterface ?? 'overlay'} · tahan pindah jaringan
                </p>
              </li>
            )}
            {data.lan && (
              <li>
                <p className="truncate font-mono text-xs">{data.lan}</p>
                <p className="label-mikro mt-0.5">
                  {data.interfaceUtama ?? 'Wi-Fi'} · hanya di jaringan yang sama
                </p>
              </li>
            )}
          </ul>

          {!data.nama && !data.overlay && (
            <p className="mt-3 text-xs opacity-50">
              Baru ada alamat Wi-Fi, jadi angkanya berubah tiap pindah jaringan dan QR perlu
              dipindai ulang. Untuk nama tetap yang tahan berpindah jaringan, isi{' '}
              <code>NAMA_HOST</code> di <code>apps/api/.env</code>.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};

export const Settings = () => {
  const dispatch = useDispatch();
  const { theme, viewMode } = useSelector((state) => state.ui);
  const { mode, fit } = useSelector((state) => state.reader);

  const statsQuery = useGetStatsQuery();
  const bookmarks = useGetBookmarksQuery(undefined);
  const stats = statsQuery.data;

  const savedPercent =
    stats?.compression?.originalBytes > 0
      ? (1 - stats.compression.compressedBytes / stats.compression.originalBytes) * 100
      : 0;

  return (
    <div>
      <h1 className="text-2xl font-black">Pengaturan</h1>
      <p className="mt-1 text-sm text-night/50 dark:text-paper/50">
        Preferensi tampilan disimpan di browser; angka storage dibaca langsung dari folder data.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <StatusServerCard />

        <ConnectCard />

        <Card title="Tampilan" icon="🎨">
          <Choice
            label="Tema"
            value={theme}
            onChange={(value) => dispatch(setTheme(value))}
            options={[
              { value: 'light', label: '☀️ Terang' },
              { value: 'dark', label: '🌙 Gelap' },
            ]}
          />
          <Choice
            label="Tampilan koleksi"
            value={viewMode}
            onChange={(value) => dispatch(setViewMode(value))}
            options={[
              { value: 'grid', label: '▦ Grid' },
              { value: 'list', label: '☰ List' },
            ]}
          />
        </Card>

        <Card title="Preferensi baca" icon="📖">
          <Choice
            label="Mode default"
            value={mode}
            onChange={(value) => dispatch(setMode(value))}
            options={[
              { value: 'scroll', label: 'Scroll' },
              { value: 'single', label: 'Per halaman' },
            ]}
          />
          <Choice
            label="Fit gambar"
            value={fit}
            onChange={(value) => dispatch(setFit(value))}
            options={[
              { value: 'width', label: 'Lebar' },
              { value: 'height', label: 'Tinggi' },
              { value: 'original', label: 'Zoom' },
            ]}
          />
        </Card>

        <Card title="Storage" icon="💾">
          {statsQuery.isLoading && <Spinner label="Menghitung…" />}
          {statsQuery.isError && <ErrorState error={statsQuery.error} onRetry={statsQuery.refetch} />}
          {stats && (
            <>
              <Row label="Folder data" value={stats.storage.dataDir} />
              <Row label="Database" value={formatBytes(stats.storage.databaseBytes)} />
              <Row label="Gambar komik" value={formatBytes(stats.storage.imagesBytes)} />
              <Row label="Cache" value={formatBytes(stats.storage.cacheBytes)} />
              <Row label="Total" value={formatBytes(stats.storage.totalBytes)} />
              <Row
                label="RAM bebas"
                value={`${formatBytes(stats.system.freeMemoryBytes)} / ${formatBytes(
                  stats.system.totalMemoryBytes,
                )}`}
              />
            </>
          )}
        </Card>

        <Card title="Kompresi" icon="🗜️">
          {stats && (
            <>
              <Row label="Sebelum" value={formatBytes(stats.compression.originalBytes)} />
              <Row label="Sesudah" value={formatBytes(stats.compression.compressedBytes)} />
              <Row label="Hemat" value={`${savedPercent.toFixed(1)}%`} />
              <Row label="Target dokumentasi" value="70 – 80%" />
              <p className="mt-3 text-xs opacity-50">
                Atur kualitas & resolusi maksimum lewat <code>IMAGE_QUALITY</code>,{' '}
                <code>IMAGE_MAX_WIDTH</code> di <code>.env</code>.
              </p>
            </>
          )}
        </Card>

        <Card title="Library" icon="📚">
          {stats && (
            <>
              <Row label="Komik" value={stats.library.comics} />
              <Row label="Favorit" value={stats.library.favorites} />
              <Row label="Chapter" value={stats.library.chapters} />
              <Row label="Chapter tersimpan" value={stats.library.downloaded_chapters} />
              <Row label="Halaman" value={stats.library.pages} />
              <Row label="Bookmark" value={stats.library.bookmarks} />
              <Row label="Antrian aktif" value={stats.library.queue_active} />
            </>
          )}
        </Card>

        <Card title="Sistem" icon="🧪">
          {stats && (
            <>
              <Row label="Node" value={stats.system.nodeVersion} />
              <Row label="Platform" value={stats.system.platform} />
            </>
          )}
          <p className="mt-3 text-xs opacity-50">
            Backup database: <code>npm run backup:db</code> · statistik CLI: <code>npm run stats:db</code>
          </p>
        </Card>

        <Card title="Bookmark terakhir" icon="🔖">
          {(bookmarks.data?.items ?? []).length === 0 ? (
            <p className="text-sm opacity-60">Belum ada bookmark.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {bookmarks.data.items.slice(0, 8).map((bookmark) => (
                <li key={bookmark.id} className="flex items-center justify-between gap-3">
                  {/* min-w-0 wajib: tanpa itu flex item menolak mengecil di bawah
                      min-content, dan min-content teks ber-`truncate` (nowrap)
                      adalah SELURUH kalimat — jadi truncate-nya tidak pernah aktif
                      dan kartunya melar sampai 616px di layar 375px. */}
                  <span className="min-w-0 truncate">
                    {bookmark.comicTitle} · Ch {bookmark.chapterNumber} hal {bookmark.pageNumber}
                  </span>
                  <span className="flex-none text-xs opacity-50">
                    {formatRelativeTime(bookmark.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Settings;

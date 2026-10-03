import { Link } from 'react-router-dom';
import { Sampul, Ubin } from './UbinKomik.jsx';
import { ErrorState, Spinner } from '../components/Common/index.jsx';
import RakBeranda from '../offline/RakBeranda.jsx';
import { formatRelativeTime } from '../utils/format.js';

/**
 * Beranda khusus build Android.
 *
 * Beranda web menyusun semuanya sebagai grid kartu seragam. Itu benar untuk
 * layar lebar, dan salah untuk layar 360px: satu grid dua kolom hanya memuat
 * empat kartu sebelum lipatan, jadi seluruh koleksi terasa seperti satu daftar
 * panjang tanpa penekanan — tidak ada yang menonjol, tidak ada yang mengundang.
 *
 * Susunan di sini memakai pola yang sudah jadi kebiasaan aplikasi komik di
 * ponsel, dan tiap pilihannya punya alasan:
 *
 *   Sorotan        satu judul per layar, digeser mendatar. Sampul komik adalah
 *                  satu-satunya hal berwarna kuat di aplikasi ini (lihat
 *                  spesifikasi palet), jadi di HP ia pantas mendapat ruang
 *                  penuh — bukan diperkecil jadi ubin 150px.
 *   Baris mendatar lebih banyak judul terlihat per tinggi layar daripada grid,
 *                  dan ubin yang terpotong di tepi kanan adalah isyarat "masih
 *                  ada lagi" yang tidak dimiliki grid.
 *   Peringkat      daftar bernomor untuk "Baru diperbarui": di layar sempit,
 *                  baris mendatar berisi judul + metadata jauh lebih terbaca
 *                  daripada ubin yang judulnya terpotong dua baris.
 *
 * DATA-nya sama persis dengan beranda web — seluruh query diteruskan dari
 * Home.jsx, bukan diminta ulang di sini. Tata letaknya yang berbeda, bukan
 * beban servernya.
 */

/* ── Sorotan ────────────────────────────────────────────────────────────── */

/**
 * Kepala beranda: sampul besar yang digeser satu per satu.
 *
 * Kerudung gelap hanya di sepertiga bawah, bukan menutup seluruh sampul. Itu
 * batas yang diminta spesifikasi — judulnya harus terbaca di atas gambar apa
 * pun, tapi artwork-nya tidak boleh ditutupi lapisan warna.
 */
const Sorotan = ({ komik }) => {
  if (!komik?.length) return null;

  return (
    <section className="tepi-layar mb-7">
      <div className="geser-x">
        {komik.map((satu) => (
          <Link
            key={satu.id}
            to={`/comic/${satu.slug}`}
            className="relative aspect-[3/4] w-[78vw] max-w-[320px] flex-none overflow-hidden rounded-2xl bg-surface-soft"
          >
            <Sampul komik={satu} className="h-full w-full object-cover" />

            {/* Kerudung dari bawah: pekat di kaki, hilang sebelum sepertiga
                atas. Tanpa ini, judul putih di atas sampul berlatar terang
                tidak terbaca sama sekali. */}
            <div
              className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-night via-night/70 to-transparent"
              aria-hidden="true"
            />

            <div className="absolute inset-x-0 bottom-0 p-4">
              <p className="line-clamp-2 text-base font-black leading-tight text-paper">{satu.title}</p>
              <p className="mt-1 text-[11px] text-paper/70">
                {satu.totalChapters} chapter
                {satu.updatedAt ? ` · ${formatRelativeTime(satu.updatedAt)}` : ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};

/* ── Bagian ─────────────────────────────────────────────────────────────── */

const Bagian = ({ judul, ikon, aksi, children }) => (
  <section className="mb-7">
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="section-title text-base">
        <span aria-hidden="true">{ikon}</span>
        {judul}
      </h2>
      {aksi}
    </div>
    {children}
  </section>
);

const TautanLihat = ({ to, anak = 'Lihat semua' }) => (
  <Link to={to} className="flex-none text-xs font-semibold text-primary">
    {anak}
  </Link>
);

/* ── Daftar berperingkat ────────────────────────────────────────────────── */

const BarisPeringkat = ({ komik, nomor }) => (
  <Link
    to={`/comic/${komik.slug}`}
    className="flex items-center gap-3 rounded-xl py-2 transition-colors active:bg-surface-soft"
  >
    {/* Angka peringkat dibuat besar dan tipis, bukan lencana berisi: ia penanda
        urutan, bukan sesuatu yang bisa ditekan. */}
    <span className="w-6 flex-none text-center text-lg font-black tabular-nums text-txt-2/60">{nomor}</span>
    <Sampul komik={komik} className="h-16 w-11 flex-none rounded-lg object-cover" />
    <span className="min-w-0 flex-1">
      <span className="line-clamp-1 text-sm font-bold">{komik.title}</span>
      <span className="mt-0.5 line-clamp-1 text-[11px] text-txt-2">
        {komik.totalChapters} chapter
        {komik.updatedAt ? ` · ${formatRelativeTime(komik.updatedAt)}` : ''}
      </span>
    </span>
  </Link>
);

/* ── Beranda ────────────────────────────────────────────────────────────── */

export const BerandaApp = ({ continueQuery, latestQuery, favoritesQuery, kosong }) => {
  const terbaru = latestQuery.data?.items ?? [];
  const lanjut = continueQuery.data?.items ?? [];
  const favorit = favoritesQuery.data?.items ?? [];

  return (
    <div>
      {/* Sorotan mengambil dari daftar yang SAMA dengan "Baru diperbarui" di
          bawah, lalu daftar itu melewatinya. Tanpa pelewatan itu, lima judul
          teratas muncul dua kali di satu layar. */}
      <Sorotan komik={terbaru.slice(0, 5)} />

      {/* Komik yang benar-benar ada di HP ini. Tetap paling atas setelah
          sorotan: ia satu-satunya bagian yang masih berarti saat server rumah
          mati. */}
      <RakBeranda />

      {lanjut.length > 0 && (
        <Bagian judul="Lanjut baca" ikon="📖">
          <div className="geser-x tepi-layar">
            {lanjut.map((entri) => (
              <Ubin
                key={entri.comic.id}
                komik={entri.comic}
                kemajuan={entri.progressPercentage ?? 0}
                lanjutKe={entri.chapter?.id ? `/read/${entri.chapter.id}` : null}
              />
            ))}
          </div>
        </Bagian>
      )}

      {favorit.length > 0 && (
        <Bagian judul="Favorit" ikon="⭐" aksi={<TautanLihat to="/browse?favorite=true" />}>
          <div className="geser-x tepi-layar">
            {favorit.map((komik) => (
              <Ubin key={komik.id} komik={komik} />
            ))}
          </div>
        </Bagian>
      )}

      {!kosong && (
        <Bagian judul="Baru diperbarui" ikon="🍃" aksi={<TautanLihat to="/browse" anak="Jelajahi" />}>
          {latestQuery.isLoading && <Spinner />}
          {latestQuery.isError && <ErrorState error={latestQuery.error} onRetry={latestQuery.refetch} />}
          <div className="divide-y divide-line">
            {terbaru.slice(5).map((komik, i) => (
              <BarisPeringkat key={komik.id} komik={komik} nomor={i + 1} />
            ))}
          </div>
        </Bagian>
      )}
    </div>
  );
};

export default BerandaApp;

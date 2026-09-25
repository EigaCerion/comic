import { Link, useLocation } from 'react-router-dom';
import { mandiri } from '../platform/index.js';
import { useTerhubung } from '../platform/terhubung.js';

/**
 * Dua tempat aplikasi ini harus mengaku sedang tanpa server.
 *
 * Di web pertanyaannya tidak pernah ada: halaman dan API satu origin, jadi
 * "server mati" berarti halamannya pun tidak termuat. Di HP aplikasinya tetap
 * tampil rapi sambil setiap permintaan gagal, dan tanpa kalimat yang menyebut
 * jaringan, yang terbaca adalah "koleksiku hilang".
 */

/**
 * Pita di dalam aliran halaman, dipasang tepat di bawah TopBar.
 *
 * Sengaja BUKAN overlay melayang seperti spanduk di cangkang aplikasi: yang
 * melayang menutupi TopBar selama ia tampil, dan di jaringan yang putus-nyambung
 * ia berkedip di atas tombol yang sedang hendak ditekan. Reader tetap memakai
 * spanduk melayang karena di sana tidak ada aliran halaman untuk ditumpangi.
 */
export const PitaOffline = () => {
  const lokasi = useLocation();
  const { terhubung, sedangMemeriksa, periksaUlang } = useTerhubung();

  if (terhubung || sedangMemeriksa) return null;
  // Halaman /offline sudah menjelaskan keadaannya sendiri, dengan kalimat yang
  // lebih tepat untuk tempat itu.
  //
  // Layar mandiri dikecualikan karena di sana kalimatnya justru terbalik:
  // /sumber sedang memuat judul segar langsung dari internet, dan menggantungi
  // layar itu dengan "hanya yang tersimpan di HP yang bisa dibuka" — lengkap
  // dengan tautan yang mengajak pergi — menyuruh orangnya meninggalkan
  // satu-satunya layar yang sedang bekerja. Predikatnya dipinjam dari platform,
  // bukan disalin: dua daftar jalur yang terpisah akan berbeda diam-diam begitu
  // salah satunya ditambah.
  if (lokasi.pathname === '/offline' || mandiri(lokasi.pathname)) return null;

  return (
    <div role="status" className="gutter-app flex items-center gap-3 bg-danger/10 py-2 text-xs text-danger">
      <span className="min-w-0 flex-1">Server rumah tidak terjangkau — hanya yang tersimpan di HP yang bisa dibuka.</span>
      <Link to="/offline" className="flex-none font-semibold underline">
        Lihat simpanan
      </Link>
      <button type="button" className="flex-none font-semibold underline" onClick={() => periksaUlang()}>
        Coba lagi
      </button>
    </div>
  );
};

/**
 * Baris penjelasan di dalam ErrorState untuk build Android.
 *
 * Pesan bawaannya menyarankan memeriksa API di localhost:3000 — kalimat yang
 * ditulis untuk orang yang sedang duduk di depan servernya. Di HP itu bukan
 * saran, cuma teka-teki. Selama server masih terjangkau, pesan asli dari server
 * tetap yang ditampilkan: itu justru yang berguna (403, chapter dihapus, dan
 * sejenisnya).
 */
export const PenjelasanGagal = ({ error }) => {
  const { terhubung, sedangMemeriksa } = useTerhubung();

  if (terhubung || sedangMemeriksa) {
    return (
      <p className="mt-2 text-xs text-night/60 dark:text-paper/60">
        {error?.data?.error ?? 'Server menolak permintaan ini.'}
      </p>
    );
  }

  return (
    <>
      <p className="mt-2 text-xs text-night/60 dark:text-paper/60">
        Server rumah tidak terjangkau. Pastikan HP ada di Wi-Fi yang sama dan server menyala.
      </p>
      <Link to="/offline" className="btn-ghost mt-4">
        Buka komik tersimpan
      </Link>
    </>
  );
};

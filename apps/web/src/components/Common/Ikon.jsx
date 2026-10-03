/**
 * Ikon antarmuka — SVG sebaris, satu berat garis, mengikuti warna teks.
 *
 * ── Kenapa bukan emoji ────────────────────────────────────────────────────
 *
 * Navigasi sebelumnya memakai emoji (🏠 🗺️ ⭐ …) ditambah satu glif teks (☰),
 * dan campuran itu tidak bisa dirapikan: emoji dilukis font sistem, jadi
 * bentuk, berat garis, dan warnanya berbeda di tiap perangkat — dan warnanya
 * TIDAK bisa diikutkan tema. Di bilah tab, ikon berwarna penuh berdampingan
 * dengan satu garis hitam-putih terbaca sebagai kesalahan, bukan gaya.
 *
 * SVG sebaris menyelesaikan ketiganya sekaligus: `stroke="currentColor"`
 * membuatnya mewarisi warna tab aktif/non-aktif, beratnya satu angka untuk
 * semua, dan ukurannya ikut kelas Tailwind biasa.
 *
 * Seluruh bentuk di bawah digambar sendiri — garis sederhana, bukan jiplakan
 * ikon berlisensi.
 *
 * ── Cara pakai ────────────────────────────────────────────────────────────
 *
 *   <Ikon nama="beranda" className="h-5 w-5" />
 *
 * `nama` yang tidak dikenal menghasilkan null, bukan kotak kosong atau galat:
 * menu yang ikonnya salah ketik tetap bisa ditekan, hanya tanpa ikon.
 */

const JALUR = {
  beranda: (
    <>
      <path d="M3.5 10.8 12 3.5l8.5 7.3" />
      <path d="M6 9.8V20h12V9.8" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  jelajahi: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.4 8.6 13.6 14l-5 1.8 1.8-5.4z" />
    </>
  ),
  favorit: <path d="M12 3.8l2.5 5.3 5.8.8-4.2 4 1 5.8-5.1-2.8-5.1 2.8 1-5.8-4.2-4 5.8-.8z" />,
  tersimpan: (
    <>
      <rect x="5.5" y="3" width="13" height="18" rx="2" />
      <path d="M12 8v6" />
      <path d="M9.6 11.6 12 14l2.4-2.4" />
    </>
  ),
  sumber: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.3 2.6 2.3 14.4 0 17" />
      <path d="M12 3.5c-2.3 2.6-2.3 14.4 0 17" />
    </>
  ),
  unduhan: (
    <>
      <path d="M12 3.5v9.5" />
      <path d="M8.6 9.6 12 13l3.4-3.4" />
      <path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  scout: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2" />
    </>
  ),
  impor: (
    <>
      <path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z" />
      <path d="M4 7.6 12 12l8-4.4" />
      <path d="M12 12v8.8" />
    </>
  ),
  unggah: (
    <>
      <path d="M12 20.5V11" />
      <path d="M8.6 14.4 12 11l3.4 3.4" />
      <path d="M4.5 9V5.5A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5V9" />
    </>
  ),
  akun: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15.8 5.8a3.2 3.2 0 0 1 0 5.4" />
      <path d="M17 14.9c2 .6 3.5 2.3 3.5 4.6" />
    </>
  ),
  pengaturan: (
    <>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5" />
      <path d="M18.7 5.3 17.1 6.9M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  lainnya: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
};

export const Ikon = ({ nama, className = 'h-5 w-5' }) => {
  const jalur = JALUR[nama];
  if (!jalur) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {jalur}
    </svg>
  );
};

export default Ikon;

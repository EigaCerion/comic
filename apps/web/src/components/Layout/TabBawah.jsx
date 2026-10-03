import { NavLink } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toggleSidebar } from '../../store/slices/uiSlice.js';
import { useIndeksOffline } from '../../offline/penyimpanan.js';
import Ikon from '../Common/Ikon.jsx';

/**
 * Bilah tab bawah — hanya ada di build Android.
 *
 * Laci samping adalah pola WEB: di layar HP ia menuntut dua ketukan untuk
 * setiap perpindahan (buka laci, pilih menu) dan tombolnya duduk di pojok
 * kiri atas — sudut terjauh dari ibu jari. Aplikasi komik di ponsel hampir
 * seluruhnya memakai tab bawah, dan alasannya bukan selera: di situlah tangan
 * memegang.
 *
 * ── Kenapa hanya LIMA, dan kenapa yang kelima sebuah laci ─────────────────
 *
 * Menu lengkapnya ada sebelas. Memaksa sebelas ke dalam bilah selebar 360px
 * menghasilkan sasaran sentuh selebar 32px — di bawah batas yang bisa diketuk
 * tanpa meleset. Jadi empat tujuan yang paling sering dibuka duduk di sini,
 * dan sisanya tetap di laci yang SUDAH ADA (Sidebar.jsx), dibuka tab kelima.
 *
 * Lacinya dipakai ulang apa adanya, bukan ditulis ulang sebagai lembar
 * tersendiri: ia sudah memegang penyaringan menu per izin, lencana jumlah
 * unduhan, dan blok akun. Dua daftar menu yang harus dijaga sinkron adalah dua
 * daftar yang suatu hari akan berbeda diam-diam.
 *
 * ── Yang membuatnya terasa aplikasi, bukan situs ──────────────────────────
 *
 * Tab aktif ditandai warna DAN label tebal, bukan blok latar: blok latar di
 * bilah setinggi 56px memakan hampir seluruh tingginya dan membuat bilahnya
 * terasa berat. Jarak bawahnya mengikuti --aman-bawah supaya tidak tertimpa
 * bilah gestur Android.
 */

const TAB = [
  { to: '/', label: 'Beranda', ikon: 'beranda', end: true },
  { to: '/browse', label: 'Jelajahi', ikon: 'jelajahi' },
  { to: '/sumber', label: 'Sumber', ikon: 'sumber' },
  { to: '/offline', label: 'Tersimpan', ikon: 'tersimpan', lencana: 'offline' },
];

const kelasTab = ({ isActive }) =>
  [
    'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5',
    'text-[10px] transition-colors',
    isActive ? 'font-bold text-primary' : 'font-medium text-txt-2',
  ].join(' ');

export const TabBawah = () => {
  const dispatch = useDispatch();
  const sidebarOpen = useSelector((state) => state.ui.sidebarOpen);

  // Jumlah komik tersimpan, bukan chapter: angka chapter bisa ratusan dan
  // lencana tiga digit di bilah 360px mendorong labelnya keluar.
  const indeks = useIndeksOffline();
  const jumlahKomik = Object.keys(indeks.komik ?? {}).length;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[var(--aman-bawah)] lg:hidden"
      aria-label="Navigasi utama"
    >
      <div className="flex items-stretch">
        {TAB.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={kelasTab}>
            <span className="relative" aria-hidden="true">
              <Ikon nama={tab.ikon} className="h-6 w-6" />
              {tab.lencana === 'offline' && jumlahKomik > 0 && (
                <span className="absolute -right-2 -top-1 min-w-[15px] rounded-full bg-primary px-1 text-[9px] font-bold leading-[15px] text-primary-on">
                  {jumlahKomik > 99 ? '99+' : jumlahKomik}
                </span>
              )}
            </span>
            <span className="max-w-full truncate">{tab.label}</span>
          </NavLink>
        ))}

        {/* Tab kelima bukan rute — ia membuka laci yang sama dengan tombol menu
            di TopBar. Ditandai aktif saat lacinya terbuka supaya tidak terlihat
            seperti tombol yang tidak merespons. */}
        <button
          type="button"
          onClick={() => dispatch(toggleSidebar())}
          aria-expanded={sidebarOpen}
          className={[
            'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5',
            'text-[10px] transition-colors',
            sidebarOpen ? 'font-bold text-primary' : 'font-medium text-txt-2',
          ].join(' ')}
        >
          <Ikon nama="lainnya" className="h-6 w-6" />
          <span>Lainnya</span>
        </button>
      </div>
    </nav>
  );
};

export default TabBawah;

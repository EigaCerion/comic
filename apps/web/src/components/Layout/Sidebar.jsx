import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { closeSidebar } from '../../store/slices/uiSlice.js';
import { useGetDownloadsQuery, useLogoutMutation } from '../../api/apiSlice.js';
import { useAuth } from '../../hooks/useAuth.js';

const NAV = [
  { to: '/', label: 'Beranda', icon: '🏠', end: true },
  { to: '/browse', label: 'Jelajahi', icon: '🗺️' },
  { to: '/browse?favorite=true', label: 'Favorit', icon: '⭐' },
  { to: '/downloads', label: 'Unduhan', icon: '📥', badge: 'downloads', butuh: 'kelola_koleksi' },
  { to: '/import', label: 'Import', icon: '📦', butuh: 'kelola_koleksi' },
  { to: '/upload', label: 'Upload Manual', icon: '📤', butuh: 'unggah_chapter' },
  { to: '/users', label: 'Kelola Akun', icon: '👥', butuh: 'kelola_pengguna' },
  { to: '/settings', label: 'Pengaturan', icon: '⚙️' },
];

// Catatan: `butuh` hanya menyembunyikan menu yang toh akan ditolak server.
// Ini kenyamanan tampilan, BUKAN pengamanan — izin sesungguhnya diperiksa
// server pada tiap permintaan, jadi menu yang bocor pun tidak memberi akses.

// Item aktif ditandai permukaan bercahaya tipis plus batang aksen di kiri,
// bukan blok warna pekat. Di layar gelap, blok pekat menarik perhatian lebih
// kuat daripada isi halamannya sendiri.
const linkClass = ({ isActive }) =>
  [
    'relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
    'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2',
    'before:rounded-full before:transition-all',
    isActive
      ? 'bg-naruto/10 text-naruto before:bg-naruto before:opacity-100'
      : [
          'text-night/70 hover:bg-night/[0.04] hover:text-night',
          'dark:text-paper/65 dark:hover:bg-paper/[0.05] dark:hover:text-paper',
          'before:opacity-0',
        ].join(' '),
  ].join(' ');

export const Sidebar = () => {
  const dispatch = useDispatch();
  const sidebarOpen = useSelector((state) => state.ui.sidebarOpen);
  // Sidebar terpasang di SEMUA halaman, jadi polling di sini adalah beban yang
  // dibayar terus-menerus — termasuk saat menggulir grid beranda. Padahal
  // datanya cuma dipakai untuk satu angka lencana. Jadi: cepat hanya selagi ada
  // unduhan berjalan, santai saat menganggur, dan berhenti sama sekali saat
  // jendelanya tidak dilihat.
  const { user, bisa, sudahMasuk } = useAuth();
  const [logout] = useLogoutMutation();

  const [jedaPoll, setJedaPoll] = useState(30_000);
  const { data: downloads } = useGetDownloadsQuery('', {
    pollingInterval: jedaPoll,
    skipPollingIfUnfocused: true,
    // Tanpa ini, pembaca biasa memicu 403 berulang setiap siklus polling.
    skip: !bisa('kelola_koleksi'),
  });

  const activeJobs = (downloads?.counts?.pending ?? 0) + (downloads?.counts?.downloading ?? 0);

  useEffect(() => {
    setJedaPoll(activeJobs > 0 ? 5_000 : 30_000);
  }, [activeJobs]);

  const menu = NAV.filter((item) => !item.butuh || bisa(item.butuh));

  return (
    <>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Tutup menu"
          className="fixed inset-0 z-30 bg-night/60 lg:hidden"
          onClick={() => dispatch(closeSidebar())}
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col gap-6 border-r border-paper-line',
          'bg-paper-soft px-4 py-5 transition-transform',
          'dark:border-night-line dark:bg-night-soft',
          // Desktop: menempel di layar, bukan meregang setinggi halaman.
          //
          // `lg:static` dulu mengembalikan aside ke aliran flex, dan karena
          // align-items default stretch, tingginya dipaksa = tinggi HALAMAN
          // (terukur 1692px di viewport 720px). Akibatnya seluruh navigasi
          // tergulir hilang begitu pengguna menelusuri koleksi ke bawah.
          //
          // `self-start` membuat tingginya kembali mengikuti isi (syarat agar
          // sticky punya arti), `h-screen` mengisi tepat setinggi layar, dan
          // `inset-y-auto left-auto` melepas paksaan `inset-y-0 left-0` milik
          // mode drawer di HP.
          //
          // Blur dihapus: sidebar berada DI SAMPING konten, tidak menimpanya,
          // jadi yang tersaring hanya latar sendiri — biaya tiap frame tanpa
          // hasil yang bisa dilihat.
          'lg:sticky lg:inset-y-auto lg:left-auto lg:top-0 lg:h-screen lg:self-start',
          // `max-lg:` — transform penyembunyi drawer HANYA berlaku di bawah 1024px.
          //
          // Sebelumnya dipakai `-translate-x-full` polos dan diandalkan bahwa
          // `lg:translate-x-0` akan menimpanya di desktop. Ternyata tidak: kelas
          // lg itu tidak sampai ke CSS hasil build, dan sidebar desktop terdorong
          // -256px ke luar layar sementara kolomnya tetap menyisakan ruang kosong.
          // Membatasi ruang lingkupnya jauh lebih aman daripada mengandalkan
          // urutan menang-kalah antar utilitas.
          sidebarOpen ? 'translate-x-0' : 'max-lg:-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-naruto text-lg font-black text-night shadow-glow">
            忍
          </span>
          <div>
            <p className="font-display text-lg font-black leading-none">NaruReader</p>
            <p className="label-mikro">Hidden Leaf Library</p>
          </div>
        </div>

        {/* min-h-0 wajib: di flex column, item default tidak boleh menyusut di
            bawah tinggi kontennya, sehingga blok akun di bawah terdorong
            keluar layar saat menu lebih panjang dari viewport — terjadi di
            HP mode landscape dan di laptop dengan zoom 150%. Yang bergulir
            hanya daftar menu; merek dan blok akun tetap di tempatnya. */}
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
          {menu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={linkClass}
              onClick={() => dispatch(closeSidebar())}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge === 'downloads' && activeJobs > 0 && (
                <span className="rounded-full bg-naruto px-2 py-0.5 text-[11px] font-bold text-night">
                  {activeJobs}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {sudahMasuk ? (
          <div className="border-t border-paper-line pt-3 dark:border-night-line">
            <p className="truncate text-sm font-semibold">{user.displayName}</p>
            <p className="label-mikro mt-0.5">{user.role.replace('_', ' ')}</p>
            <button type="button" className="btn-ghost mt-2 w-full py-1 text-xs" onClick={() => logout()}>
              Keluar
            </button>
          </div>
        ) : (
          <div className="border-t border-paper-line pt-3 dark:border-night-line">
            <p className="text-[11px] leading-relaxed text-night/40 dark:text-paper/40">
              Membaca bebas tanpa akun. Masuk untuk memberi rating dan berkomentar.
            </p>
            <NavLink to="/login" className="btn-accent mt-2 w-full py-1 text-xs">
              Masuk
            </NavLink>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;

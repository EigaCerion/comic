import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import { IS_APP } from '../../platform/index.js';
import { PitaOffline } from '../../offline/KabarLuring.jsx';
import KabarPembaruan from '../../platform/KabarPembaruan.jsx';
import { dismissToast } from '../../store/slices/uiSlice.js';

/*
 * Versi di footer dibaca dari define vite (__VERSI_APL__ = "version" di
 * apps/web/package.json), bukan ditulis ulang sebagai teks.
 *
 * Dulu di sini tertulis "v0.1.0" apa adanya, dan angka itu tidak berhubungan
 * dengan apa pun: naikkan apps/web/package.json sekali saja, dan APK-nya
 * berversi baru, nama berkas rilisnya berversi baru, kartu Pengaturan menyebut
 * yang baru — sementara footer di SETIAP halaman aplikasi yang sama masih
 * menyebut yang lama. Orang yang melaporkan masalah lalu menyebut versi yang
 * salah, dan pertanyaan "kamu pakai versi berapa" jadi tidak bisa dipercaya.
 *
 * typeof dipakai seperti di platform/pembaruan.js: define-nya aktif di kedua
 * mode build, tapi berkas ini tidak perlu meledak kalau suatu hari dibundel
 * tanpa define itu.
 */
const VERSI = typeof __VERSI_APL__ === 'string' ? __VERSI_APL__ : null;

const Toast = () => {
  const dispatch = useDispatch();
  const toast = useSelector((state) => state.ui.toast);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => dispatch(dismissToast()), 4000);
    return () => clearTimeout(timer);
  }, [toast, dispatch]);

  if (!toast) return null;

  return (
    <div
      role="status"
      className={[
        // aman-bawah-jarak: toast melayang dari tepi bawah layar, dan di HP
        // tepi itu ditempati bilah navigasi/gestur.
        'aman-bawah-jarak fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-scroll animate-slide-up',
        toast.type === 'error' ? 'bg-danger text-white' : 'bg-leaf text-white',
      ].join(' ')}
    >
      {toast.message}
    </div>
  );
};

export const AppLayout = () => (
  <div className="app-bg flex min-h-full">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar />
      {/* Build android saja: pita "tanpa server" duduk di aliran halaman supaya
          ia mendorong isi ke bawah, bukan menutupi TopBar. */}
      {IS_APP && (
        <>
          <PitaOffline />
          {/* Di tempat yang sama dengan pita "tanpa server": kabar versi baru
              yang hanya ada di halaman Pengaturan tidak pernah terlihat orang
              yang tidak sedang mencari setelan. */}
          <KabarPembaruan />
        </>
      )}
      {/* max-w-7xl baru menggigit di viewport >= 1536, karena kolom ini sudah
          dipersempit 256px oleh sidebar. Dipertahankan sebagai pagar sadar
          untuk monitor sangat lebar, bukan karena ia aktif di layar biasa. */}
      <main className="gutter-app mx-auto w-full max-w-7xl flex-1 py-6 lg:py-8 animate-fade-in">
        <Outlet />
      </main>
      {/* Elemen terakhir dalam aliran halaman, jadi ia yang menyediakan ruang
          untuk bilah navigasi/gestur di HP (--aman-bawah, theme.css). */}
      <footer className="gutter-app border-t border-paper-line pb-[calc(1rem_+_var(--aman-bawah))] pt-4 text-center text-xs text-night/40 dark:border-night-line dark:text-paper/40">
        NaruReader{VERSI ? ` v${VERSI}` : ''} — Phase 1 MVP · dibuat untuk koleksi lokal
      </footer>
    </div>
    <Toast />
  </div>
);

export default AppLayout;

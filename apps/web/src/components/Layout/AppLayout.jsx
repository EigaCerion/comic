import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import { dismissToast } from '../../store/slices/uiSlice.js';

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
        'fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-scroll animate-slide-up',
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
      {/* max-w-7xl baru menggigit di viewport >= 1536, karena kolom ini sudah
          dipersempit 256px oleh sidebar. Dipertahankan sebagai pagar sadar
          untuk monitor sangat lebar, bukan karena ia aktif di layar biasa. */}
      <main className="gutter-app mx-auto w-full max-w-7xl flex-1 py-6 lg:py-8 animate-fade-in">
        <Outlet />
      </main>
      <footer className="gutter-app border-t border-paper-line py-4 text-center text-xs text-night/40 dark:border-night-line dark:text-paper/40">
        NaruReader v0.1.0 — Phase 1 MVP · dibuat untuk koleksi lokal
      </footer>
    </div>
    <Toast />
  </div>
);

export default AppLayout;

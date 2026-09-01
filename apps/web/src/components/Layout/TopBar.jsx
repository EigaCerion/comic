import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toggleSidebar, toggleTheme } from '../../store/slices/uiSlice.js';
import { useSearchQuery } from '../../api/apiSlice.js';
import { DebouncedInput } from '../Common/index.jsx';
import { useAuth } from '../../hooks/useAuth.js';

export const TopBar = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const theme = useSelector((state) => state.ui.theme);
  const { bisa } = useAuth();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const { data, isFetching } = useSearchQuery(query, { skip: query.trim().length < 2 });
  const suggestions = data?.items ?? [];
  const showSuggestions = focused && query.trim().length >= 2;

  const submit = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    navigate(`/browse?search=${encodeURIComponent(query.trim())}`);
    setFocused(false);
  };

  // Token permukaan disamakan dengan sidebar (night-soft). Sebelumnya header
  // memakai `night` sementara sidebar `night-soft` — dua material berbeda yang
  // bersentuhan tepat di x=256.
  return (
    <header className="sticky top-0 z-20 border-b border-paper-line bg-paper-soft dark:border-night-line dark:bg-night-soft/95 lg:bg-paper-soft/80 lg:backdrop-blur-xl dark:lg:bg-night-soft/80">
      {/* gutter + max-w yang sama dengan <main> supaya tepi kiri kotak pencarian
          sejajar dengan tepi kiri konten, dan tetap sejajar di monitor lebar. */}
      <div className="gutter-app mx-auto flex h-16 w-full max-w-7xl items-center gap-3">
        <button
          type="button"
          className="btn-ghost px-2 py-1 lg:hidden"
          onClick={() => dispatch(toggleSidebar())}
          aria-label="Buka menu"
        >
          ☰
        </button>

        <form onSubmit={submit} className="relative flex-1 max-w-xl">
          <DebouncedInput
            className="input pl-9"
            placeholder="Cari komik, author…"
            value={query}
            onChange={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            aria-label="Cari komik"
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-60">
            🔍
          </span>

          {showSuggestions && (
            <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-xl border border-paper-line bg-paper-soft shadow-scroll animate-slide-up dark:border-night-line dark:bg-night-card">
              {isFetching && suggestions.length === 0 && (
                <p className="px-4 py-3 text-sm text-night/60 dark:text-paper/60">Mencari…</p>
              )}
              {!isFetching && suggestions.length === 0 && (
                <p className="px-4 py-3 text-sm text-night/60 dark:text-paper/60">
                  Tidak ada hasil untuk “{query}”
                </p>
              )}
              {suggestions.slice(0, 6).map((comic) => (
                <Link
                  key={comic.id}
                  to={`/comic/${comic.slug}`}
                  className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-paper dark:hover:bg-night-soft"
                  onClick={() => setFocused(false)}
                >
                  {comic.coverUrl ? (
                    <img src={comic.coverUrl} alt="" className="h-12 w-9 rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-12 w-9 items-center justify-center rounded bg-paper-line dark:bg-night-line">
                      📖
                    </span>
                  )}
                  <span className="flex-1">
                    <span className="block font-medium">{comic.title}</span>
                    <span className="block text-xs text-night/50 dark:text-paper/50">
                      {comic.author ?? 'Tanpa author'} · {comic.totalChapters} chapter
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </form>

        {/* ml-auto menyerap sisa ruang: tanpa ini, ~200px ruang kosong jatuh
            SETELAH tombol terakhir sehingga kontrol kanan mengambang di tengah
            alih-alih menempel ke tepi. */}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            className="btn-ghost px-3"
            onClick={() => dispatch(toggleTheme())}
            aria-label={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
            title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Disamakan dengan penyaringan menu di sidebar: sebelumnya CTA ini
              tampil untuk semua orang termasuk tamu yang belum masuk, padahal
              menu "Upload Manual" yang menuju halaman sama sudah disembunyikan.
              Dua elemen chrome bersebelahan memberi jawaban berbeda. */}
          {bisa('unggah_chapter') && (
            <Link to="/upload" className="btn-accent hidden sm:inline-flex">
              + Tambah Komik
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;

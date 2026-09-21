import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatChapterNumber } from '../../utils/format.js';
import ReaderSettings from './ReaderSettings.jsx';

export const ReaderHeader = ({ chapter, comic, onBukaDaftar }) => (
  <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-night-line bg-night px-4 py-2 text-paper lg:bg-night/90 lg:backdrop-blur">
    <Link to={`/comic/${comic.slug}`} className="btn-ghost border-night-line px-2 py-1 text-paper" title="Kembali">
      ←
    </Link>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-bold">{comic.title}</p>
      {/* Baris nomor chapter dijadikan tombol, bukan menambah ikon baru: di
          situlah mata sudah mencari tahu "aku di chapter berapa", jadi di situ
          pula tempat paling wajar untuk berpindah chapter. */}
      <button
        type="button"
        onClick={onBukaDaftar}
        title="Pilih chapter (C)"
        className="flex w-full min-w-0 items-center gap-1 text-left text-xs text-paper/50 transition-colors hover:text-naruto"
      >
        <span className="truncate">
          Chapter {formatChapterNumber(chapter.number)}
          {chapter.title ? ` — ${chapter.title}` : ''}
        </span>
        <span aria-hidden="true" className="flex-none">
          ▾
        </span>
      </button>
    </div>
  </header>
);

export const ReaderFooter = ({
  currentPage,
  totalPages,
  chapterNumber,
  onPrev,
  onNext,
  onBookmark,
  onBukaDaftar,
  prevChapterTo,
  nextChapterTo,
  isBookmarking,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <footer className="sticky bottom-0 z-20 border-t border-night-line bg-night px-4 py-2 text-paper lg:bg-night/90 lg:backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-2">
        <button type="button" className="btn-ghost border-night-line px-3 text-paper" onClick={onPrev}>
          ◄ <span className="hidden sm:inline">Prev</span>
        </button>

        <div className="flex-1 text-center">
          <p className="font-mono text-sm">
            {currentPage} / {totalPages}
          </p>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-night-line">
            <div
              className="h-full bg-naruto transition-[width]"
              style={{ width: `${totalPages ? (currentPage / totalPages) * 100 : 0}%` }}
            />
          </div>
        </div>

        <button type="button" className="btn-ghost border-night-line px-3 text-paper" onClick={onNext}>
          <span className="hidden sm:inline">Next</span> ►
        </button>

        <button
          type="button"
          className="btn-ghost border-night-line px-3 text-paper"
          onClick={onBookmark}
          disabled={isBookmarking}
          title="Bookmark halaman ini"
        >
          🔖
        </button>

        <div className="relative">
          <button
            type="button"
            className="btn-ghost border-night-line px-3 text-paper"
            onClick={() => setSettingsOpen((open) => !open)}
            title="Pengaturan baca"
          >
            ⚙️
          </button>
          {settingsOpen && <ReaderSettings onClose={() => setSettingsOpen(false)} />}
        </div>
      </div>

      {/* Pemilih chapter diulang di sini, bukan hanya di header: saat membaca
          sambil memegang HP, jempol ada di bawah — memaksanya naik ke ujung
          layar tiap kali ingin melompat adalah beban yang tidak perlu. */}
      <div className="mx-auto mt-2 flex max-w-4xl items-center justify-between gap-2 text-xs">
        {prevChapterTo ? (
          <Link to={prevChapterTo} className="min-w-0 truncate text-paper/60 hover:text-naruto">
            ← <span className="hidden sm:inline">Chapter </span>sebelumnya
          </Link>
        ) : (
          <span className="text-paper/30">Chapter pertama</span>
        )}

        <button
          type="button"
          onClick={onBukaDaftar}
          className="flex-none rounded-lg border border-night-line px-3 py-1 font-mono text-xs text-paper/80 transition-colors hover:border-naruto hover:text-naruto"
          title="Pilih chapter (C)"
        >
          ☰ Ch. {formatChapterNumber(chapterNumber)}
        </button>

        {nextChapterTo ? (
          <Link to={nextChapterTo} className="min-w-0 truncate text-right text-paper/60 hover:text-naruto">
            <span className="hidden sm:inline">Chapter </span>berikutnya →
          </Link>
        ) : (
          <span className="text-paper/30">Chapter terakhir</span>
        )}
      </div>
    </footer>
  );
};

export default ReaderFooter;

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  api,
  useAddBookmarkMutation,
  useGetChapterQuery,
  useSaveProgressMutation,
} from '../api/apiSlice.js';
import { ErrorState, Spinner } from '../components/Common/index.jsx';
import { ReaderHeader, ReaderFooter } from '../components/Reader/ReaderControls.jsx';
import PageImage from '../components/Reader/PageImage.jsx';
import { setFit } from '../store/slices/readerSlice.js';
import { showToast } from '../store/slices/uiSlice.js';
import useKeyboardNav from '../hooks/useKeyboardNav.js';

const FIT_CYCLE = ['width', 'height', 'original'];

export const Reader = () => {
  const { chapterId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { mode, fit, zoom, brightness, contrast, pageGap } = useSelector((state) => state.reader);

  const {
    data: chapter,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useGetChapterQuery(chapterId);
  const [saveProgress] = useSaveProgressMutation();
  const [addBookmark, { isLoading: isBookmarking }] = useAddBookmarkMutation();

  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef(null);
  const pageRefs = useRef(new Map());
  const totalPages = chapter?.pages?.length ?? 0;

  // Mulai dari posisi baca terakhir saat chapter berganti.
  useEffect(() => {
    if (!chapter) return undefined;
    const resume = Math.min(Math.max(chapter.lastPageRead ?? 1, 1), Math.max(totalPages, 1));
    setCurrentPage(resume);

    // Yang menggulir adalah container reader, bukan window. Tanpa reset di sini
    // posisi scroll chapter sebelumnya ikut terbawa, sehingga chapter baru
    // seolah muncul di tengah dan harus digulir manual ke atas.
    if (containerRef.current) containerRef.current.scrollTop = 0;

    // Chapter yang pernah dibaca sebagian dilanjutkan dari halaman terakhir.
    if (resume > 1) {
      const frame = requestAnimationFrame(() => {
        pageRefs.current.get(resume)?.scrollIntoView({ block: 'start' });
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [chapter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pramuat data chapter berikutnya. Saat tombol "Chapter berikutnya" ditekan,
  // daftar halamannya sudah ada di cache sehingga kerangka reader tampil
  // seketika — yang tersisa hanya waktu unduh gambarnya.
  const prefetchChapter = api.usePrefetch('getChapter');
  useEffect(() => {
    if (chapter?.next?.id) prefetchChapter(String(chapter.next.id));
    if (chapter?.prev?.id) prefetchChapter(String(chapter.prev.id));
  }, [chapter?.next?.id, chapter?.prev?.id, prefetchChapter]);

  // Simpan progress (debounce 800ms) supaya tidak menulis DB tiap scroll.
  useEffect(() => {
    if (!chapter || totalPages === 0) return undefined;
    const timer = setTimeout(() => {
      saveProgress({ chapterId: chapter.id, lastPageRead: currentPage });
    }, 800);
    return () => clearTimeout(timer);
  }, [chapter, currentPage, totalPages, saveProgress]);

  /**
   * Sudah menyentuh dasar chapter?
   *
   * Dipisah karena halaman terakhir tidak akan pernah terpilih lewat aturan
   * "halaman teratas yang terlihat": begitu sampai dasar, halaman sebelumnya
   * masih ikut terlihat dan selalu menang karena posisinya lebih atas. Akibatnya
   * chapter yang sudah tamat berhenti tercatat di (N-1)/N — sekitar 98% — dan
   * tidak pernah dianggap selesai oleh tombol "Lanjut baca".
   */
  const diDasar = useCallback(() => {
    const node = containerRef.current;
    if (!node) return false;
    // Chapter yang gambarnya belum selesai dimuat masih pendek. Tanpa syarat
    // ini, chapter yang baru dibuka langsung dianggap tamat.
    if (node.scrollHeight <= node.clientHeight + 8) return false;
    return node.scrollTop + node.clientHeight >= node.scrollHeight - 48;
  }, []);

  // Mode scroll: halaman aktif ditentukan dari halaman yang paling terlihat.
  useEffect(() => {
    if (mode !== 'scroll' || totalPages === 0) return undefined;

    // Halaman aktif = halaman terlihat yang paling atas. Memakai posisi (bukan
    // rasio) supaya tetap benar saat gambar belum selesai dimuat dan semua
    // elemen masih bertumpuk di atas.
    const observer = new IntersectionObserver(
      (entries) => {
        if (diDasar()) {
          setCurrentPage(totalPages);
          return;
        }
        const topmost = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (topmost) setCurrentPage(Number(topmost.target.dataset.page));
      },
      { root: containerRef.current, threshold: [0, 0.25, 0.5], rootMargin: '0px 0px -55% 0px' },
    );

    pageRefs.current.forEach((node) => node && observer.observe(node));

    // IntersectionObserver hanya berbunyi saat ambang terlampaui, dan di dasar
    // sering tidak ada ambang baru yang dilewati. Scroll dipantau terpisah
    // supaya "tamat" benar-benar tercatat.
    const node = containerRef.current;
    const saatScroll = () => {
      if (diDasar()) setCurrentPage(totalPages);
    };
    node?.addEventListener('scroll', saatScroll, { passive: true });

    return () => {
      observer.disconnect();
      node?.removeEventListener('scroll', saatScroll);
    };
  }, [mode, totalPages, chapter?.id, diDasar]);

  const goToChapter = useCallback(
    (target) => {
      if (!target) return;
      navigate(`/read/${target.id}`);
    },
    [navigate],
  );

  const scrollToPage = useCallback((pageNumber) => {
    const node = pageRefs.current.get(pageNumber);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const next = useCallback(() => {
    if (currentPage < totalPages) {
      const target = currentPage + 1;
      setCurrentPage(target);
      if (mode === 'scroll') scrollToPage(target);
      else containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (chapter?.next) {
      goToChapter(chapter.next);
    }
  }, [chapter, currentPage, goToChapter, mode, scrollToPage, totalPages]);

  const prev = useCallback(() => {
    if (currentPage > 1) {
      const target = currentPage - 1;
      setCurrentPage(target);
      if (mode === 'scroll') scrollToPage(target);
      else containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (chapter?.prev) {
      goToChapter(chapter.prev);
    }
  }, [chapter, currentPage, goToChapter, mode, scrollToPage]);

  const handlers = useMemo(
    () => ({
      next,
      prev,
      first: () => (mode === 'scroll' ? scrollToPage(1) : setCurrentPage(1)),
      last: () => (mode === 'scroll' ? scrollToPage(totalPages) : setCurrentPage(totalPages)),
      prevChapter: () => goToChapter(chapter?.prev),
      nextChapter: () => goToChapter(chapter?.next),
      toggleFit: () => dispatch(setFit(FIT_CYCLE[(FIT_CYCLE.indexOf(fit) + 1) % FIT_CYCLE.length])),
      exit: () => navigate(chapter ? `/comic/${chapter.comic.slug}` : '/'),
    }),
    [chapter, dispatch, fit, goToChapter, mode, navigate, next, prev, scrollToPage, totalPages],
  );

  useKeyboardNav(handlers);

  const bookmark = async () => {
    if (!chapter) return;
    try {
      await addBookmark({
        comic_id: chapter.comicId,
        chapter_id: chapter.id,
        page_number: currentPage,
      }).unwrap();
      dispatch(showToast({ message: `Halaman ${currentPage} ditandai` }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err?.data?.error ?? 'Gagal menyimpan bookmark' }));
    }
  };

  if (isLoading) return <Spinner label="Menyiapkan halaman…" />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (!chapter) return null;

  const visiblePages = mode === 'single' ? chapter.pages.slice(currentPage - 1, currentPage) : chapter.pages;

  return (
    <div className="fixed inset-0 z-30 flex h-[100dvh] flex-col bg-[var(--reader-bg)]">
      <ReaderHeader chapter={chapter} comic={chapter.comic} />

      {/* Garis tipis saat chapter berganti: perpindahan terasa direspons,
          bukan diam sambil menampilkan isi lama. */}
      {isFetching && (
        <div className="h-0.5 w-full overflow-hidden bg-night-line">
          <div className="h-full w-1/3 animate-[slide-up_1s_ease-in-out_infinite] bg-naruto" />
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto"
        style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)` }}
      >
        {totalPages === 0 ? (
          <p className="py-20 text-center text-sm text-paper/60">
            Chapter ini belum punya halaman tersimpan.
          </p>
        ) : (
          <div
            // key per chapter: tanpa ini React memakai ulang elemen <img> yang
            // sama untuk nomor halaman yang sama, dan browser tetap melukis
            // gambar chapter LAMA sampai gambar baru selesai diunduh.
            key={chapter.id}
            className={
              mode === 'scroll'
                ? `reader-strip flex flex-col items-center ${pageGap === 'small' ? 'gap-1 py-1' : 'gap-0'}`
                : 'reader-strip'
            }
          >
            {visiblePages.map((page) => (
              <PageImage
                key={`${chapter.id}-${page.number}`}
                page={page}
                fit={fit}
                zoom={zoom}
                eager={page.number <= (chapter.lastPageRead ?? 1) + 1}
                onClick={next}
                ref={(node) => {
                  if (node) pageRefs.current.set(page.number, node);
                  else pageRefs.current.delete(page.number);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <ReaderFooter
        currentPage={currentPage}
        totalPages={totalPages}
        onPrev={prev}
        onNext={next}
        onBookmark={bookmark}
        isBookmarking={isBookmarking}
        prevChapterTo={chapter.prev ? `/read/${chapter.prev.id}` : null}
        nextChapterTo={chapter.next ? `/read/${chapter.next.id}` : null}
      />
    </div>
  );
};

export default Reader;

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
import ChapterPicker from '../components/Reader/ChapterPicker.jsx';
import { IS_APP } from '../platform/index.js';
import { dariSumber } from '../offline/idSumber.js';
import ModeBacaNatif from '../platform/ModeBacaNatif.jsx';
import PosisiBacaApp from '../offline/PosisiBacaApp.jsx';
import SumberOffline from '../offline/SumberOffline.jsx';
import { lanjutDari } from '../offline/posisiBaca.js';
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
    data: chapterServer,
    currentData: chapterKini,
    isFetching,
    isError,
    error,
    refetch,
    /*
     * Chapter dari situs sumber tidak pernah ada di server rumah, jadi
     * permintaannya dilewati sama sekali.
     *
     * Bukan penghematan: kalau servernya justru sedang TERSAMBUNG, permintaan
     * itu dijawab 404, `isError` menyala, dan spanduk galat muncul di atas
     * chapter yang sebenarnya sudah lengkap di HP. Yang paling parah, isError
     * juga memberi makan gerbang `gagalTanpaIsi` di bawah pada milidetik
     * sebelum <SumberOffline /> sempat melapor.
     *
     * dariSumber() datang dari offline/idSumber.js yang sengaja dibuat murni —
     * tanpa satu pun impor — supaya baris ini tidak menyeret lapisan offline
     * (dan lewat itu plugin Capacitor) ke bundel web.
     */
  } = useGetChapterQuery(chapterId, { skip: dariSumber(chapterId) });
  const [saveProgress] = useSaveProgressMutation();
  const [addBookmark, { isLoading: isBookmarking }] = useAddBookmarkMutation();

  const [currentPage, setCurrentPage] = useState(1);
  const [daftarTerbuka, setDaftarTerbuka] = useState(false);
  // Salinan lokal chapter ini, diisi <SumberOffline /> di bawah. Pada bundel web
  // ekspresi di bawahnya runtuh jadi konstanta dan seluruh lapisan offline ikut
  // dibuang Rollup.
  const [lokal, setLokal] = useState(null);
  const containerRef = useRef(null);
  const pageRefs = useRef(new Map());

  const dariLokal = IS_APP && lokal?.chapterId === Number(chapterId) ? lokal : null;
  // "Sudah tahu ada-tidaknya salinan lokal". Dipakai sebagai syarat melanjutkan
  // posisi baca: tanpa itu, chapter yang dibuka saat server mati akan melompat
  // ke halaman 1 lebih dulu, lalu ke posisi sebenarnya begitu berkasnya terbaca.
  const siapLokal = !IS_APP || Boolean(dariLokal);

  // Urutannya: jawaban untuk chapter yang SEDANG dibuka, lalu salinan HP,
  // baru jawaban lama. Dulu `chapterServer` — yaitu `data` milik RTK Query —
  // yang didahulukan, dan itu keliru justru karena `data` sengaja
  // lintas-argumen: begitu permintaan chapter BARU gagal (HP keluar dari
  // Wi-Fi di tengah sesi baca) ia jatuh kembali ke hasil chapter LAMA,
  // sementara `pages` di bawah sudah memakai gambar chapter baru dari HP.
  // Yang tampil: gambar chapter B dengan nomor, judul, dan tautan prev/next
  // milik chapter A — dan <PosisiBacaApp> mencatat posisi baca B ke ID
  // chapter A, lalu lanjutDari() memulihkan posisi A di dalam halaman B.
  // Keadaan itu tidak sembuh sendiri selama permintaan B tidak pernah
  // berhasil. Metadata B yang benar sebenarnya ADA di dariLokal.chapter; ia
  // cuma tertutup nilai basi.
  //
  // Bundel web tidak berubah perilakunya: di sana `dariLokal` selalu null,
  // jadi ungkapan ini runtuh jadi `currentData ?? data` — persis seperti
  // sebelumnya, termasuk saat perpindahan chapter.
  const chapter = chapterKini ?? dariLokal?.chapter ?? chapterServer ?? null;
  // GAMBARNYA selalu diambil dari HP kalau tersimpan: tidak ada kuota terpakai
  // dan halamannya muncul seketika, bahkan saat sedang tersambung.
  const pages = dariLokal?.halaman ?? chapter?.pages ?? [];
  const totalPages = pages.length;

  // "Permintaan chapter INI gagal dan tidak ada isinya dari mana pun."
  //
  // Dibedakan dari isError begitu saja karena `data` milik RTK Query sengaja
  // lintas-argumen: saat argumennya berganti dan permintaan chapter BARU
  // ditolak, ia jatuh kembali ke hasil chapter LAMA. Dengan `chapter` yang
  // karenanya tidak pernah null, gerbang di bawah terlewati dan reader
  // merender chapter sebelumnya padahal URL-nya sudah /read/<id-baru>: nomor
  // di header, tautan prev/next, bahkan tulisan progres semuanya masih milik
  // chapter lama, tidak ada galat maupun tombol coba lagi, dan tombol "Chapter
  // berikutnya" tampak sekadar tidak melakukan apa-apa sampai halamannya
  // dimuat ulang. `currentData` selalu milik argumen yang sedang dibuka, jadi
  // ia yang dipakai memutuskan.
  //
  // Syarat ketiganya adalah ISI lokal, bukan sekadar "probe-nya sudah
  // menjawab". <SumberOffline /> melapor juga untuk chapter yang TIDAK
  // tersimpan — rakitChapterLokal() mengembalikan objek kosong yang tetap
  // membawa chapterId yang benar — sehingga `!dariLokal` membuat gagalTanpaIsi
  // tidak pernah bisa true di build android. Terbukti di layar: chapter yang
  // gagal dimuat berhenti di "Menyiapkan halaman…" selamanya, tanpa galat dan
  // tanpa tombol coba lagi, sementara bundel web menampilkan ErrorState untuk
  // URL yang sama.
  //
  // `siapLokal` di atas tetap Boolean(dariLokal): yang ditanyakan di sana
  // memang "sudah tahu ada-tidaknya salinan", dan objek kosong itu justru
  // jawabannya. Yang ditanyakan di sini adalah "ada isinya atau tidak".
  const gagalTanpaIsi = isError && !chapterKini && !dariLokal?.chapter;

  // Mulai dari posisi baca terakhir saat chapter berganti.
  useEffect(() => {
    if (!chapter || !siapLokal) return undefined;
    // Build android: yang menang adalah simpanan PALING BARU — bisa yang dibuat
    // di HP saat luring, bisa yang dikirim server dari perangkat lain.
    const lanjut = IS_APP ? lanjutDari(chapter.id, chapter) : chapter.lastPageRead;
    const resume = Math.min(Math.max(lanjut ?? 1, 1), Math.max(totalPages, 1));
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
  }, [chapter?.id, siapLokal]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Build android menyimpannya lewat <PosisiBacaApp />: di HP posisi baca
    // harus mendarat di penyimpanan lokal lebih dulu, karena chapter tersimpan
    // tetap terbaca sampai habis tanpa server sama sekali.
    if (IS_APP) return undefined;
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
      chapterList: () => setDaftarTerbuka(true),
      toggleFit: () => dispatch(setFit(FIT_CYCLE[(FIT_CYCLE.indexOf(fit) + 1) % FIT_CYCLE.length])),
      exit: () => navigate(chapter ? `/comic/${chapter.comic.slug}` : '/'),
    }),
    [chapter, dispatch, fit, goToChapter, mode, navigate, next, prev, scrollToPage, totalPages],
  );

  // Pintasan reader dimatikan selama pemilih chapter terbuka: panel itu punya
  // kotak pencarian dan daftarnya sendiri yang perlu tombol panah dan Escape.
  useKeyboardNav(handlers, !daftarTerbuka);

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

  /*
   * Satu pintu keluar, bukan tiga: <SumberOffline /> harus tetap terpasang
   * selama menunggu, kalau tidak chapter yang dibuka saat server mati tidak
   * akan pernah sempat memberi tahu bahwa salinannya ada di HP — layarnya
   * berhenti di "Menyiapkan halaman…" selamanya.
   *
   * Dan posisinya di pohon HARUS sama untuk kedua keadaan. Dulu ia dirender di
   * dalam masing-masing cabang: begitu ia memanggil onHasil dan chapter jadi
   * tidak null lewat dariLokal, React melihat akar yang berbeda, membongkar
   * instans itu, lalu memasang yang baru di cabang sebelah. Pembersihan instans
   * pertama menjalankan bebaskanHalaman() atas daftar halaman yang PERSIS baru
   * saja dipasang di <img> — di build android yang dibuka di browser desktop,
   * url-nya blob: dan seluruh halaman chapter berkedip jadi gambar rusak sampai
   * instans kedua selesai merakit ulang. Di HP akibatnya lebih ringan, tapi
   * chapter.json tetap dibaca dan seluruh daftar halaman dirakit dua kali setiap
   * chapter dibuka. Maka kedua cabang di bawah sama-sama berakar Fragment dengan
   * SumberOffline di anak pertama, dan yang berganti hanya anak keduanya.
   */
  if (!chapter || gagalTanpaIsi) {
    return (
      <>
        {IS_APP && <SumberOffline chapterId={chapterId} onHasil={setLokal} />}
        {gagalTanpaIsi ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <Spinner label="Menyiapkan halaman…" />
        )}
      </>
    );
  }

  const visiblePages = mode === 'single' ? pages.slice(currentPage - 1, currentPage) : pages;

  return (
    <>
      {IS_APP && <SumberOffline chapterId={chapterId} onHasil={setLokal} />}
      <div className="fixed inset-0 z-30 flex h-[100dvh] flex-col bg-[var(--reader-bg)]">
        {/* Build android saja: status bar disembunyikan dan layar dijaga menyala
            selama reader terbuka, lalu dipulihkan saat ditinggalkan. */}
        {IS_APP && <ModeBacaNatif />}
        {IS_APP && (
          <PosisiBacaApp chapterId={chapter.id} comicId={chapter.comicId} halaman={currentPage} />
        )}

        <ReaderHeader
          chapter={chapter}
          comic={chapter.comic}
          onBukaDaftar={() => setDaftarTerbuka(true)}
        />

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
          chapterNumber={chapter.number}
          onPrev={prev}
          onNext={next}
          onBookmark={bookmark}
          onBukaDaftar={() => setDaftarTerbuka(true)}
          isBookmarking={isBookmarking}
          prevChapterTo={chapter.prev ? `/read/${chapter.prev.id}` : null}
          nextChapterTo={chapter.next ? `/read/${chapter.next.id}` : null}
        />

        {daftarTerbuka && (
          <ChapterPicker
            comicId={chapter.comicId}
            chapterAktifId={chapter.id}
            // Saat server tidak terjangkau, daftar chapter datang dari katalog di
            // HP — pemilih chapter tidak boleh jadi panel galat di tengah membaca.
            daftarLokal={dariLokal?.daftar}
            onPilih={(id) => {
              setDaftarTerbuka(false);
              if (id !== chapter.id) navigate(`/read/${id}`);
            }}
            onClose={() => setDaftarTerbuka(false)}
          />
        )}
      </div>
    </>
  );
};

export default Reader;

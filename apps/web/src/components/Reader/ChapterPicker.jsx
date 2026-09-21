import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGetChaptersQuery } from '../../api/apiSlice.js';
import { formatChapterNumber, formatRelativeTime } from '../../utils/format.js';

/*
 * Pemilih chapter.
 *
 * Tombol "chapter berikutnya" hanya bergerak satu langkah. Itu cukup saat
 * membaca berurutan, tapi menyiksa begitu pembaca ingin melompat jauh —
 * satu-satunya jalan sebelumnya adalah keluar ke halaman detail, menggulir
 * ratusan kartu, lalu masuk lagi.
 *
 * Ada komik 776 chapter di koleksi ini, jadi dua hal jadi syarat dan bukan
 * hiasan: daftarnya harus bisa DICARI, dan barisnya tidak boleh dirender
 * semuanya sekaligus. 776 baris DOM sekali tumpah membuat panel ini tersendat
 * saat dibuka di HP, padahal yang terlihat cuma sekitar sepuluh.
 */

const TINGGI_BARIS = 64; // px — dikunci karena jadi dasar hitungan virtualisasi
const SANGGA = 6; // baris ekstra di atas/bawah jendela tampak, penahan saat scroll cepat
const LOMPATAN = [-50, -10, 10, 50];

const bisaDibuka = (chapter) => chapter.isDownloaded && chapter.totalPages > 0;

// Toleransi satu halaman, sama seperti di halaman detail: data lama tidak pernah
// menyentuh halaman terakhir, jadi 64 dari 65 tetap dihitung tamat.
const sudahTamat = (chapter) =>
  Boolean(chapter.readAt) && (chapter.lastPageRead ?? 0) >= (chapter.totalPages ?? 0) - 1;

const Baris = ({ chapter, aktif, atas, onPilih }) => {
  const terkunci = !bisaDibuka(chapter);
  const tamat = sudahTamat(chapter);
  const persen = Math.round(chapter.progressPercentage ?? 0);

  return (
    <li className="absolute inset-x-0 px-2" style={{ top: atas, height: TINGGI_BARIS }}>
      <button
        type="button"
        disabled={terkunci}
        onClick={() => onPilih(chapter)}
        aria-current={aktif ? 'true' : undefined}
        className={`flex h-[60px] w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors ${
          aktif
            ? 'border-naruto bg-naruto/10'
            : 'border-transparent hover:border-night-line hover:bg-night-soft'
        } ${terkunci ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        <span
          className={`flex h-9 w-11 flex-none items-center justify-center rounded-lg font-mono text-sm font-bold ${
            aktif ? 'bg-naruto text-night' : 'bg-night-soft text-paper/80'
          }`}
        >
          {formatChapterNumber(chapter.number)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-paper">
            {chapter.title || `Chapter ${formatChapterNumber(chapter.number)}`}
          </span>
          <span className="block truncate text-[11px] text-paper/45">
            {terkunci ? 'Belum diunduh' : `${chapter.totalPages} halaman`}
            {chapter.readAt ? ` · ${formatRelativeTime(chapter.readAt)}` : ''}
          </span>
        </span>

        <span className="flex-none text-xs">
          {tamat && <span className="text-leaf-light">✓</span>}
          {!tamat && persen > 0 && <span className="font-mono text-paper/50">{persen}%</span>}
        </span>
      </button>
    </li>
  );
};

export const ChapterPicker = ({ comicId, chapterAktifId, onPilih, onClose }) => {
  const { data, isLoading, isError, refetch } = useGetChaptersQuery(
    { comicId, order: 'asc', ringkas: true },
    { skip: !comicId },
  );

  const [kueri, setKueri] = useState('');
  const [urutTerbaru, setUrutTerbaru] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [tinggiKotak, setTinggiKotak] = useState(420);

  const kotakRef = useRef(null);
  const inputRef = useRef(null);
  const rafRef = useRef(0);
  const sudahDipusatkan = useRef(false);

  // Urutan dibalik di sisi klien, bukan lewat permintaan baru: isinya persis
  // sama dan panjangnya bisa ratusan baris — memintanya dua kali hanya menambah
  // lalu lintas untuk sesuatu yang sudah ada di tangan.
  const semua = useMemo(() => data?.items ?? [], [data]);
  const terurut = useMemo(() => (urutTerbaru ? [...semua].reverse() : semua), [semua, urutTerbaru]);

  const cari = kueri.trim().toLowerCase();
  const tersaring = useMemo(() => {
    if (!cari) return terurut;
    return terurut.filter(
      (chapter) =>
        formatChapterNumber(chapter.number).includes(cari) ||
        (chapter.title ?? '').toLowerCase().includes(cari),
    );
  }, [terurut, cari]);

  // Lompatan cepat dihitung dari POSISI dalam daftar, bukan dari selisih nomor.
  // Penomoran chapter berlubang dan kadang berkoma, jadi "+10 nomor" bisa
  // mendarat di chapter yang tidak ada; "+10 posisi" selalu mendarat di sesuatu
  // yang benar-benar bisa dibuka.
  const terbuka = useMemo(() => semua.filter(bisaDibuka), [semua]);
  const indeksSekarang = terbuka.findIndex((chapter) => chapter.id === chapterAktifId);

  const tujuanLompat = (delta) => {
    if (indeksSekarang < 0) return null;
    const indeks = Math.min(terbuka.length - 1, Math.max(0, indeksSekarang + delta));
    const chapter = terbuka[indeks];
    return chapter && chapter.id !== chapterAktifId ? chapter : null;
  };

  const lompat = (delta) => {
    const chapter = tujuanLompat(delta);
    if (chapter) onPilih(chapter.id);
  };

  // Esc ditangani di sini, bukan oleh pintasan reader: selama panel terbuka
  // pintasan reader sengaja dimatikan supaya tombol panah tidak ikut menggeser
  // halaman di belakang panel.
  useEffect(() => {
    const saatTekan = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', saatTekan);
    return () => window.removeEventListener('keydown', saatTekan);
  }, [onClose]);

  // Fokus otomatis hanya untuk tetikus: di layar sentuh ini memunculkan papan
  // ketik dan langsung menutupi separuh daftar yang baru saja dibuka.
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)')?.matches) inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const node = kotakRef.current;
    if (!node) return undefined;
    const ukur = () => setTinggiKotak(node.clientHeight);
    ukur();
    const pengamat = new ResizeObserver(ukur);
    pengamat.observe(node);
    return () => pengamat.disconnect();
  }, []);

  // Panel dibuka langsung di posisi chapter yang sedang dibaca. Tanpa ini ia
  // selalu mulai dari chapter 1, dan pembaca di chapter 400 harus menggulir
  // ratusan baris hanya untuk menemukan dirinya sendiri.
  useLayoutEffect(() => {
    if (sudahDipusatkan.current || cari || tersaring.length === 0) return;
    const indeks = tersaring.findIndex((chapter) => chapter.id === chapterAktifId);
    const node = kotakRef.current;
    if (indeks < 0 || !node) return;
    const tengah = Math.max(0, indeks * TINGGI_BARIS - node.clientHeight / 2 + TINGGI_BARIS / 2);
    node.scrollTop = tengah;
    setScrollTop(tengah);
    sudahDipusatkan.current = true;
  }, [tersaring, chapterAktifId, cari]);

  // Scroll dipasang ke rAF: pada 776 baris, setState di setiap peristiwa scroll
  // memicu render jauh lebih sering daripada layar sanggup menggambar.
  const saatScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(kotakRef.current?.scrollTop ?? 0);
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const gantiKueri = (nilai) => {
    setKueri(nilai);
    if (kotakRef.current) kotakRef.current.scrollTop = 0;
    setScrollTop(0);
  };

  const pilih = (chapter) => {
    if (bisaDibuka(chapter)) onPilih(chapter.id);
  };

  // Enter membuka hasil teratas: mengetik "310" lalu Enter adalah jalur tercepat
  // melompat jauh, tanpa perlu menyentuh daftarnya sama sekali.
  const bukaHasilTeratas = () => {
    const tujuan = tersaring.find(bisaDibuka);
    if (tujuan) pilih(tujuan);
  };

  const saatSubmit = (event) => {
    event.preventDefault();
    bukaHasilTeratas();
  };

  // Enter ditangani langsung di kotaknya, tidak menumpang pengiriman implisit
  // form. Pengiriman implisit punya syarat yang halus (hanya berlaku saat form
  // berisi satu medan teks) dan diam-diam berhenti bekerja begitu ada medan
  // kedua ditambahkan di sini kelak. preventDefault menahan jalur implisitnya
  // supaya tidak ada perpindahan ganda.
  const saatTekanDiPencarian = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    bukaHasilTeratas();
  };

  const mulai = Math.max(0, Math.floor(scrollTop / TINGGI_BARIS) - SANGGA);
  const akhir = Math.min(
    tersaring.length,
    Math.ceil((scrollTop + tinggiKotak) / TINGGI_BARIS) + SANGGA,
  );
  const tampak = tersaring.slice(mulai, akhir);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-night/75 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pilih chapter"
        onClick={(event) => event.stopPropagation()}
        className="flex h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-night-line bg-night-card text-paper shadow-scroll animate-slide-up sm:h-[78dvh] sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 border-b border-night-line px-4 py-3">
          <h2 className="flex-1 text-sm font-bold">
            Pilih chapter
            {semua.length > 0 && (
              <span className="ml-2 font-normal text-paper/40">{semua.length} total</span>
            )}
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs text-paper/60 hover:bg-night-soft hover:text-paper"
            onClick={() => setUrutTerbaru((nilai) => !nilai)}
          >
            {urutTerbaru ? 'Terbaru ↓' : 'Terlama ↑'}
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-paper/50 hover:bg-night-soft hover:text-paper"
            onClick={onClose}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        <form onSubmit={saatSubmit} className="border-b border-night-line px-4 py-3">
          <input
            ref={inputRef}
            className="input border-night-line bg-night-soft/80 text-paper placeholder:text-paper/30"
            placeholder="Cari nomor atau judul chapter…"
            value={kueri}
            onChange={(event) => gantiKueri(event.target.value)}
            onKeyDown={saatTekanDiPencarian}
            inputMode="search"
            enterKeyHint="go"
          />

          {indeksSekarang >= 0 && !cari && (
            <div className="mt-3 flex items-center gap-2">
              <span className="label-mikro flex-none text-paper/40">Lompat</span>
              {LOMPATAN.map((delta) => (
                <button
                  key={delta}
                  type="button"
                  disabled={!tujuanLompat(delta)}
                  onClick={() => lompat(delta)}
                  className="flex-1 rounded-lg border border-night-line px-2 py-1 font-mono text-xs text-paper/80 transition-colors hover:border-naruto hover:text-naruto disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
          )}
        </form>

        <div ref={kotakRef} onScroll={saatScroll} className="relative flex-1 overflow-y-auto py-2">
          {isLoading && (
            <p className="py-10 text-center text-sm text-paper/50">Memuat daftar chapter…</p>
          )}

          {isError && (
            <div className="py-10 text-center">
              <p className="text-sm text-danger">Gagal memuat daftar chapter</p>
              <button
                type="button"
                className="btn-ghost mt-3 border-night-line text-xs text-paper"
                onClick={refetch}
              >
                Coba lagi
              </button>
            </div>
          )}

          {!isLoading && !isError && tersaring.length === 0 && (
            <p className="py-10 text-center text-sm text-paper/50">
              {cari ? `Tidak ada chapter yang cocok dengan "${kueri}"` : 'Belum ada chapter.'}
            </p>
          )}

          {/* Pengatur jarak setinggi daftar penuh: bilah gulir tetap jujur
              meski yang benar-benar dirender hanya sepuluhan baris. */}
          <ul className="relative" style={{ height: tersaring.length * TINGGI_BARIS }}>
            {tampak.map((chapter, i) => (
              <Baris
                key={chapter.id}
                chapter={chapter}
                aktif={chapter.id === chapterAktifId}
                atas={(mulai + i) * TINGGI_BARIS}
                onPilih={pilih}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ChapterPicker;

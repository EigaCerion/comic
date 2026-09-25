import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ambilSeri } from '../sumber/ambil.js';
import { siapkanPola } from '../sumber/pola.js';
import { EmptyState, Spinner } from '../components/Common/index.jsx';
import { formatChapterNumber } from '../utils/format.js';
import { useImportFromUrlMutation } from '../api/apiSlice.js';
import { showToast } from '../store/slices/uiSlice.js';
import { useAuth } from '../hooks/useAuth.js';
import { useTerhubung } from '../platform/terhubung.js';
import { antrekanChapterSumber } from '../offline/unduh.js';
import { idChapterSumber, useIndeksOffline } from '../offline/penyimpanan.js';

/**
 * Satu seri di situs sumber, dibaca langsung oleh HP: sampul, sinopsis, genre,
 * dan daftar chapternya.
 *
 * Alamat serinya datang lewat query `?url=`, bukan lewat segmen jalur. Alasannya
 * sederhana dan sudah terbukti mahal di tempat lain: alamat seri memuat garis
 * miring, titik dua, dan tanda tanya, dan menyelipkannya sebagai segmen jalur
 * berarti setiap kali router harus menebak di mana alamat itu berakhir.
 *
 * Chapter yang dipilih di sini punya DUA tujuan, dan yang utama adalah HP.
 *
 * "Simpan ke HP" mengambil chapternya langsung dari situs sumber ke penyimpanan
 * aplikasi — tanpa server, tanpa akun, tanpa izin apa pun. Itu jalur yang
 * dipakai orang yang cuma memasang APK-nya, dan selama berbulan-bulan ia tidak
 * ada: satu-satunya tombol di sini memanggil /api/imports/url, yang dijaga
 * kemampuan `kelola_koleksi` di server rumah. Orang tanpa server memilih 40
 * chapter lalu tidak punya apa pun untuk menekannya.
 *
 * "Kirim ke server" adalah jalur lama dan tetap ada, tapi hanya muncul kalau
 * server rumahnya benar-benar terjangkau DAN orangnya memang boleh mengelola
 * koleksi. Bedanya disebut di tombolnya masing-masing: yang satu selesai di HP
 * ini, yang lain menambah koleksi di rumah dan masih harus disimpan ke HP
 * sesudahnya.
 */

const labelSumber = (host) => {
  const potongan = String(host ?? '').toLowerCase().replace(/^www\./, '').split('.');
  const nama = potongan.length > 2 ? potongan[potongan.length - 2] : potongan[0];
  return nama ? nama[0].toUpperCase() + nama.slice(1) : 'Sumber';
};

/**
 * Satu baris chapter.
 *
 * `aksi` adalah satu-satunya alasan komponen ini dipisah: kotak centang pemilih
 * unduhan duduk di sana, dan baris ini menyediakan ruangnya dengan lebar tetap
 * supaya judul chapter yang panjang tidak mendorongnya keluar layar.
 *
 * Saat bisa dipilih, SELURUH baris jadi <label> untuk kotak centangnya, bukan
 * hanya kotak 16px itu. Di layar 375px kotak centang sendiri adalah sasaran
 * sentuh terkecil yang masih mungkin salah kena, sementara memilih 30 chapter
 * berarti 30 ketukan tepat sasaran — dan baris yang tidak bisa diketuk membuat
 * ketukan yang meleset terasa seperti aplikasi yang tidak merespons.
 */
const BarisChapter = ({ chapter, aksi = null, bisaDipilih = false, dipilih = false, saatToggle }) => {
  const isi = (
    <>
      <span className="w-16 flex-none text-xs font-bold tabular-nums">
        {chapter.nomor == null ? '—' : formatChapterNumber(chapter.nomor)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm" title={chapter.judul ?? ''}>
        {chapter.judul || `Chapter ${chapter.nomor ?? '?'}`}
      </span>
      {aksi ? <span className="flex-none">{aksi}</span> : null}
    </>
  );

  const kelas = 'flex min-w-0 items-center gap-3 border-b border-paper-line px-3 py-2 last:border-b-0 dark:border-night-line';

  if (!bisaDipilih) return <li className={kelas}>{isi}</li>;

  return (
    <li className={dipilih ? `${kelas} bg-naruto/[0.07]` : kelas}>
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 flex-none accent-naruto"
          checked={dipilih}
          onChange={saatToggle}
          aria-label={`Pilih chapter ${chapter.nomor == null ? chapter.judul : formatChapterNumber(chapter.nomor)}`}
        />
        {isi}
      </label>
    </li>
  );
};

/**
 * Sampul seri, dengan penahan kalau gambarnya tidak sampai.
 *
 * Sama alasannya dengan sampul kartu di layar Sumber, dan terbukti di layar:
 * sampul datang langsung dari CDN situs sumber, dan sebagian menolak permintaan
 * yang datang dari origin lain. Tanpa penangkap onError, yang tersisa adalah
 * kotak 2/3 yang benar-benar kosong — terbaca seperti halaman yang gagal dimuat,
 * padahal judul, sinopsis, dan seluruh daftar chapternya ada di sebelahnya.
 */
const SampulSeri = ({ seri }) => {
  const [gagal, setGagal] = useState(false);

  if (!seri.coverUrl || gagal) {
    return <div className="flex h-full w-full items-center justify-center text-3xl">🍥</div>;
  }

  return (
    <img
      src={seri.coverUrl}
      alt={`Sampul ${seri.title}`}
      className="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setGagal(true)}
    />
  );
};

/** Berapa chapter yang disorot tombol cepat "terbaru". */
const CEPAT = [5, 10, 25];

export const SumberSeri = () => {
  const [params] = useSearchParams();
  const alamat = params.get('url') ?? '';
  const dispatch = useDispatch();

  // Rute /api/imports/url dijaga wajibKemampuan('kelola_koleksi') di sisi server
  // (routes/index.js). Kotak centang disembunyikan dari yang tidak punya izin itu
  // bukan sebagai pengamanan — pengamanannya di server — melainkan supaya tamu
  // tidak menghabiskan waktu memilih 40 chapter untuk dijawab 403.
  const { bisa } = useAuth();
  const { terhubung } = useTerhubung();
  // Jalur server rumah butuh KEDUANYA: izinnya ada, dan servernya benar-benar
  // menjawab. Tanpa syarat kedua, orang tanpa server melihat tombol yang pasti
  // gagal — dan `bisa()` sendiri dijawab useMeQuery, yang saat server mati
  // mengembalikan daftar kemampuan kosong belakangan, bukan seketika.
  const kelola = bisa('kelola_koleksi') && terhubung;
  const indeks = useIndeksOffline();

  const [seri, setSeri] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);
  const [terpilih, setTerpilih] = useState(() => new Set());
  const [menyimpan, setMenyimpan] = useState(false);
  const [importFromUrl, { isLoading: mengantre }] = useImportFromUrlMutation();

  const muat = useCallback(async () => {
    if (!alamat) return;
    setMemuat(true);
    setGalat(null);
    try {
      // Tabel pola disiapkan lebih dulu di sini juga, bukan hanya di layar
      // Sumber: halaman ini bisa dibuka langsung dari riwayat atau tombol Back
      // tanpa pernah melewati layar itu, dan membacanya dengan selector lama
      // menghasilkan "0 chapter" yang menuduh situsnya.
      await siapkanPola();
      setSeri(await ambilSeri(alamat));
    } catch (error) {
      setGalat(error?.message ?? 'Halaman seri gagal dibaca');
    } finally {
      setMemuat(false);
    }
  }, [alamat]);

  useEffect(() => {
    muat();
  }, [muat]);

  /*
   * Chapter diurutkan dari yang terbaru dan dibentuk ulang seperlunya di sini.
   *
   * `kunci` dipakai sebagai key React dan memakai URL-nya, bukan nomornya:
   * sebagian situs menerbitkan dua tautan bernomor sama (chapter ulang, atau
   * versi berwarna), dan key kembar membuat React memperbarui baris yang salah.
   * Milestone unduhan butuh persis trio yang sama — nomor, judul, dan URL — jadi
   * bentuk ini yang dipertahankan.
   */
  const chapters = useMemo(() => {
    const mentah = Array.isArray(seri?.chapters) ? seri.chapters : [];
    return mentah
      .map((chapter) => ({
        kunci: chapter.url,
        nomor: Number.isFinite(chapter.number) ? chapter.number : null,
        judul: chapter.title ?? null,
        url: chapter.url,
      }))
      .sort((a, b) => (b.nomor ?? -Infinity) - (a.nomor ?? -Infinity));
  }, [seri]);

  /*
   * Host serinya, dari alamat yang sedang dibuka.
   *
   * Dipakai sebagai bagian kunci pemetaan id lokal (offline/idSumber.js), jadi
   * ia HARUS berasal dari sumber yang sama dengan yang dipakai saat mengantre —
   * kalau tidak, chapter yang sama mendapat dua id dan tersimpan dua kali.
   * Itulah kenapa `alamat` yang dibaca, bukan seri.url: extractSeries memang
   * tidak mengembalikan field url sama sekali.
   */
  const host = useMemo(() => {
    try {
      return new URL(alamat).hostname;
    } catch {
      return '';
    }
  }, [alamat]);

  /*
   * Chapter mana yang sudah ada di HP.
   *
   * Dihitung dari pemetaan id, bukan dari nomor chapter: dua seri berbeda boleh
   * sama-sama punya "chapter 5", dan yang menentukan identitas sebuah chapter
   * tersimpan adalah (host, seri, nomor) — persis kunci yang dipakai saat
   * mengalokasikan id-nya.
   */
  const diHP = useMemo(() => {
    const peta = new Map();
    if (!host) return peta;
    chapters.forEach((chapter) => {
      const id = idChapterSumber({ host, urlSeri: alamat, nomor: chapter.nomor, urlChapter: chapter.url }, indeks);
      if (id !== null && indeks.chapter[id]) peta.set(chapter.url, id);
    });
    return peta;
  }, [chapters, indeks, host, alamat]);

  // Pilihan dilupakan begitu serinya berganti. Tanpa ini, URL chapter yang
  // dipilih di seri sebelumnya masih duduk di Set saat halaman dipakai ulang oleh
  // router untuk seri lain, dan tombolnya melaporkan jumlah yang tidak ada di
  // daftar yang sedang terlihat.
  useEffect(() => {
    setTerpilih(new Set());
  }, [alamat]);

  const toggle = (url) =>
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(url)) baru.delete(url);
      else baru.add(url);
      return baru;
    });

  // `chapters` sudah urut dari nomor terbesar, jadi "terbaru" cukup potongan awal.
  const pilihTerbaru = (jumlah) => setTerpilih(new Set(chapters.slice(0, jumlah).map((chapter) => chapter.url)));

  /**
   * Simpan chapter terpilih LANGSUNG ke HP.
   *
   * Yang sudah ada di HP disaring lebih dulu, bukan diserahkan ke antrean.
   * Antrean memang melewati berkas yang sudah benar, tapi ia tetap mengambil
   * ulang halaman chapternya dari situs sumber untuk mengetahuinya — satu
   * permintaan ke situs orang lain untuk pekerjaan yang sudah selesai, dikalikan
   * jumlah chapter yang tercentang.
   */
  const simpanKeHP = async () => {
    const pilihan = chapters.filter((chapter) => terpilih.has(chapter.url));
    if (pilihan.length === 0) return;

    const baru = pilihan.filter((chapter) => !diHP.has(chapter.url));
    const dilewati = pilihan.length - baru.length;

    if (baru.length === 0) {
      setTerpilih(new Set());
      dispatch(showToast({ message: `${dilewati} chapter itu sudah ada di HP.` }));
      return;
    }

    setMenyimpan(true);
    try {
      const daftar = await antrekanChapterSumber({
        host,
        urlSeri: alamat,
        // Judul komik ikut disimpan ke katalog HP dan dipakai rak serta reader.
        // Serinya sudah pasti terbaca sampai di sini — daftar chapternya berasal
        // dari halaman yang sama — jadi cadangan ini cuma penjaga terakhir.
        judulKomik: seri?.title || labelSumber(host),
        urlSampul: seri?.coverUrl ?? null,
        chapters: baru.map((chapter) => ({ nomor: chapter.nomor, judul: chapter.judul, url: chapter.url })),
      });

      setTerpilih(new Set());
      dispatch(
        showToast({
          message:
            `${daftar.length} chapter mulai diunduh ke HP` +
            (dilewati ? ` · ${dilewati} sudah ada` : '') +
            '. Kemajuannya terlihat di Tersimpan di HP.',
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.message ?? 'Gagal menyiapkan unduhan' }));
    } finally {
      setMenyimpan(false);
    }
  };

  const unduhTerpilih = async () => {
    const pilihan = chapters.filter((chapter) => terpilih.has(chapter.url));
    if (pilihan.length === 0) return;

    try {
      const hasil = await importFromUrl({
        /*
         * `alamat`, bukan seri.url: extractSeries tidak mengembalikan field url
         * sama sekali (lihat objek kembaliannya di packages/sumber/index.js), jadi
         * seri.url adalah undefined. Mengirimnya berarti importSeries menerima
         * seriesUrl kosong, dan yang hilang bukan sekadar satu kolom — source_url
         * itulah yang dipakai Scout untuk mencocokkan kartu etalase dengan koleksi
         * dan pemeriksaan chapter baru untuk tahu harus melihat ke mana.
         */
        series_url: alamat,
        title: seri.title,
        cover_url: seri.coverUrl,
        author: seri.author,
        artist: seri.artist,
        status: seri.status,
        genres: seri.genres,
        description: seri.description,
        chapters: pilihan.map((chapter) => ({
          number: chapter.nomor,
          title: chapter.judul,
          url: chapter.url,
        })),
      }).unwrap();

      // Hanya yang benar-benar masuk antrian dilepas dari pilihan. Yang dilewati
      // (nomor yang sudah ada, URL ditolak allowlist) tetap tercentang supaya
      // terlihat mana yang tidak jadi — mengosongkan semuanya membuat kegagalan
      // sebagian tidak bisa dibedakan dari keberhasilan penuh.
      const diantre = new Set((hasil.queued ?? []).map((antrian) => antrian.number));
      setTerpilih(
        new Set(pilihan.filter((chapter) => !diantre.has(chapter.nomor)).map((chapter) => chapter.url)),
      );

      const dilewati = hasil.skipped?.length ?? 0;
      dispatch(
        showToast({
          message:
            `${hasil.queued?.length ?? 0} chapter masuk antrian server` +
            (dilewati ? ` · ${dilewati} dilewati (sudah ada)` : '') +
            '. Setelah selesai diunduh, simpan ke HP dari halaman komiknya.',
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal mengantre chapter' }));
    }
  };

  if (!alamat) {
    return (
      <EmptyState
        icon="🧭"
        title="Alamat seri tidak disebut"
        description="Halaman ini dibuka dari kartu di layar Situs Sumber."
        action={
          <Link to="/sumber" className="btn-accent">
            Ke Situs Sumber
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Link to="/sumber" className="text-xs text-night/60 hover:text-naruto dark:text-paper/60">
        ← Situs Sumber
      </Link>

      {memuat && !seri && <Spinner label="Membaca halaman seri…" />}

      {galat && !memuat && (
        <div className="card border-danger/40 px-6 py-8 text-center">
          <p className="text-sm font-semibold text-danger">Halaman seri gagal dibaca</p>
          {/* Pesannya sudah memuat status HTTP-nya kalau ada (lihat GalatSumber
              di sumber/ambil.js), dan itu yang membedakan "situs mati" dari
              "serinya sudah dihapus" — dua hal yang menuntut tindakan berbeda. */}
          <p className="mt-2 break-words text-xs text-night/60 dark:text-paper/60">{galat}</p>
          <p className="mt-2 break-all text-[11px] text-night/40 dark:text-paper/40">{alamat}</p>
          <button type="button" className="btn-ghost mt-4" onClick={muat}>
            Coba lagi
          </button>
        </div>
      )}

      {seri && (
        <>
          <div className="card flex flex-col gap-4 p-4 sm:flex-row">
            <div className="aspect-[2/3] w-32 flex-none overflow-hidden rounded-xl bg-paper-line dark:bg-night-line">
              <SampulSeri seri={seri} />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-black leading-snug">{seri.title}</h1>
              <p className="mt-1 text-[11px] text-night/50 dark:text-paper/50">
                {[labelSumber(seri.source), seri.status, seri.author, seri.artist].filter(Boolean).join(' · ')}
              </p>

              {seri.genres?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {seri.genres.map((genre) => (
                    <span key={genre} className="chip px-2 py-0.5 text-[11px]">
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {seri.description && (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-night/70 dark:text-paper/70">
                  {seri.description}
                </p>
              )}
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="section-title">
                <span aria-hidden="true">📚</span> Chapter
                <span className="ml-2 text-xs font-normal opacity-60">{chapters.length}</span>
              </h2>
              <button type="button" className="btn-ghost flex-none px-3 py-1 text-xs" onClick={muat} disabled={memuat}>
                {memuat ? 'Memuat…' : 'Muat ulang'}
              </button>
            </div>

            {/*
              Panel pemilih. Bukan bilah melayang (fixed): layar ini dibaca di HP
              dengan satu tangan, dan bilah melayang di bawah adalah persis jenis
              elemen yang menimpa isi halaman di layar 375px. Panel ini ikut
              mengalir, tepat di atas daftar yang dipilihnya.
            */}
            {chapters.length > 0 && (
              <div className="card mb-2 flex flex-wrap items-center gap-2 p-3">
                <span className="label-mikro flex-none">Pilih</span>
                {CEPAT.filter((jumlah) => jumlah < chapters.length).map((jumlah) => (
                  <button
                    key={jumlah}
                    type="button"
                    className="btn-ghost px-2.5 py-1 text-xs"
                    onClick={() => pilihTerbaru(jumlah)}
                  >
                    {jumlah} terbaru
                  </button>
                ))}
                <button
                  type="button"
                  className="btn-ghost px-2.5 py-1 text-xs"
                  onClick={() => pilihTerbaru(chapters.length)}
                >
                  Semua ({chapters.length})
                </button>
                {terpilih.size > 0 && (
                  <button
                    type="button"
                    className="btn-ghost px-2.5 py-1 text-xs"
                    onClick={() => setTerpilih(new Set())}
                  >
                    Kosongkan
                  </button>
                )}

                {/* ml-auto: tombol aksi menempel ke tepi kanan pada layar lebar,
                    dan turun jadi baris sendiri di 375px karena flex-wrap. */}
                <div className="ml-auto flex flex-none flex-wrap items-center gap-2">
                  {/* Jalur server rumah DI KIRI dan sebagai tombol sekunder,
                      meski ia yang lebih dulu ada: yang seharusnya paling mudah
                      ditekan adalah yang selesai di HP ini juga. */}
                  {kelola && (
                    <button
                      type="button"
                      className="btn-ghost px-3 py-1.5 text-xs"
                      onClick={unduhTerpilih}
                      disabled={terpilih.size === 0 || mengantre || menyimpan}
                      title="Tambahkan ke koleksi server rumah. Setelah selesai di sana, masih harus disimpan ke HP."
                    >
                      {mengantre ? 'Mengantre…' : '🏠 Kirim ke server'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-accent px-3 py-1.5 text-xs"
                    onClick={simpanKeHP}
                    disabled={terpilih.size === 0 || menyimpan || mengantre}
                  >
                    {menyimpan ? 'Menyiapkan…' : `⬇ Simpan ${terpilih.size} ke HP`}
                  </button>
                </div>
              </div>
            )}

            {chapters.length === 0 ? (
              <EmptyState
                icon="🍃"
                title="Tidak ada chapter yang terbaca"
                description="Halamannya terbuka, tapi tidak satu pun tautan chapter dikenali. Kemungkinan situsnya berganti tema."
              />
            ) : (
              <ul className="card overflow-hidden p-0">
                {chapters.map((chapter) => (
                  <BarisChapter
                    key={chapter.kunci}
                    chapter={chapter}
                    /* Tidak lagi bersyarat izin: menyimpan ke HP sendiri tidak
                       butuh persetujuan siapa pun. */
                    bisaDipilih
                    dipilih={terpilih.has(chapter.url)}
                    saatToggle={() => toggle(chapter.url)}
                    aksi={
                      diHP.has(chapter.url) ? (
                        <span className="text-[11px] font-semibold text-leaf" title="Sudah tersimpan di HP">
                          ✓ Di HP
                        </span>
                      ) : null
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default SumberSeri;

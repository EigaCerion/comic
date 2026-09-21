import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useGetScoutQuery,
  useImporScoutUrlMutation,
  useImportScoutItemMutation,
  useLazyCariScoutQuery,
  useRefreshScoutMutation,
} from '../api/apiSlice.js';
import { EmptyState, ErrorState, Spinner } from '../components/Common/index.jsx';
import { showToast } from '../store/slices/uiSlice.js';
import { formatChapterNumber, formatRelativeTime } from '../utils/format.js';

const SARINGAN_STATUS = [
  { value: 'semua', label: 'Semua', kunci: 'semua' },
  { value: 'baru', label: 'Baru', kunci: 'baru' },
  { value: 'update', label: 'Ada update', kunci: 'update' },
  { value: 'punya', label: 'Sudah punya', kunci: 'punya' },
];

const SARINGAN_BAGIAN = [
  { value: 'semua', label: 'Semua' },
  { value: 'terbaru', label: 'Terbaru' },
  { value: 'baru', label: 'Baru ditambahkan' },
];

const LENCANA = {
  baru: { label: 'Baru', kelas: 'border-naruto/50 bg-naruto/20 text-naruto' },
  update: { label: 'Ada update', kelas: 'border-shinobi/50 bg-shinobi/20 text-shinobi' },
  punya: { label: 'Sudah punya', kelas: 'border-leaf/50 bg-leaf/20 text-leaf-light' },
};

// Toast dipasang tanpa batas lebar di tengah layar, sedangkan judul di situs
// sumber rutin menembus 90 karakter — tanpa dipotong, pesannya melewati kedua
// tepi layar 375px.
const potongJudul = (judul, batas = 28) => {
  const teks = String(judul ?? '');
  return teks.length > batas ? `${teks.slice(0, batas - 1).trimEnd()}…` : teks;
};

// "02.ngomik.cc" dan "ngomik.cc" sama-sama tampil "Ngomik": subdomain yang
// berganti-ganti tidak berarti apa-apa bagi pembaca, nama situsnya yang berarti.
const labelSumber = (host) => {
  const potongan = String(host ?? '').toLowerCase().replace(/^www\./, '').split('.');
  const nama = potongan.length > 2 ? potongan[potongan.length - 2] : potongan[0];
  return nama ? nama[0].toUpperCase() + nama.slice(1) : 'Sumber';
};

// Panjang yang diterima server untuk pencarian ke situs sumber.
const CARI_MIN = 2;
const CARI_MAKS = 80;

/**
 * Kunci penanda "sedang/sudah diimpor" untuk kartu etalase MAUPUN kartu hasil
 * cari. Kartu hasil cari tidak punya id, dan judul yang sama bisa tampil di
 * kedua bagian sekaligus — kalau penandanya memakai id, mengimpor dari hasil
 * cari membiarkan tombol Impor di kartu etalase yang sama tetap hidup, dan
 * satu klik lagi berarti antrian ganda. URL seri disamakan dengan cara server
 * mencocokkan koleksi: subdomain rotasi (02.ngomik.cc) dan garis miring
 * penutup tidak boleh membuat kartu yang sama terbaca berbeda.
 */
const kunciKartu = (item) => {
  try {
    const url = new URL(item.seriesUrl);
    const domain = url.hostname.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
    return `${domain}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return `id:${item.id ?? item.kunci}`;
  }
};

const Chip = ({ aktif, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={aktif}
    className={`chip px-3 py-1 ${
      aktif
        ? 'border-naruto/50 bg-naruto/15 text-naruto'
        : 'hover:border-night/20 dark:hover:border-paper/20'
    }`}
  >
    {children}
  </button>
);

/**
 * Sampul diambil langsung dari CDN situs sumber, jadi kegagalannya adalah
 * kejadian biasa, bukan kasus tepi: berkasnya bisa sudah dihapus, atau CDN-nya
 * menolak permintaan yang datang dari domain lain. Tanpa penangkap `onError`
 * yang tersisa adalah ikon gambar rusak bawaan browser di dalam kotak 2/3 —
 * jauh lebih berisik daripada placeholder yang tenang.
 *
 * `referrerPolicy` dipasang karena sebagian CDN gambar menolak permintaan
 * berdasarkan header Referer; tanpa referer mereka memperlakukannya seperti
 * akses langsung.
 */
const Sampul = ({ item }) => {
  const [gagal, setGagal] = useState(false);

  if (!item.coverUrl || gagal) {
    return <div className="flex h-full w-full items-center justify-center text-3xl">🍥</div>;
  }

  return (
    <img
      src={item.coverUrl}
      alt={`Sampul ${item.title}`}
      className="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setGagal(true)}
    />
  );
};

const KartuScout = ({ item, diantre, memuat, onImpor }) => {
  const lencana = LENCANA[item.status] ?? LENCANA.baru;
  const nomor = item.latestChapter?.number;

  // `updatedText` adalah teks mentah dari situs ("2 menit lalu") dan ia beku
  // pada saat pemindaian. Tiga jam kemudian ia masih mengaku dua menit. Jadi
  // waktunya dihitung ulang dari `updatedAt`, dan teks situs hanya dipakai
  // kalau menitnya tidak bisa diurai sama sekali.
  const waktu = item.updatedAt ? formatRelativeTime(item.updatedAt) : (item.updatedText ?? '—');

  const aksi = () => {
    // Item yang baru diantre sesi ini tidak boleh menawarkan tombol impor lagi.
    // Server menghitung "sudah punya" dari chapter yang BERKASNYA sudah ada,
    // jadi selama unduhannya masih berjalan kartunya tetap berstatus baru/update
    // — dan tombol yang masih hidup di situ berarti antrian ganda.
    if (diantre != null) {
      return (
        <p className="text-[11px] font-semibold text-leaf-light">
          ✓ {diantre > 0 ? `${diantre} chapter diantre` : 'sudah diantre'} ·{' '}
          <Link to="/downloads" className="underline">
            lihat
          </Link>
        </p>
      );
    }

    if (item.status === 'punya') {
      return (
        <p className="text-[11px] text-night/45 dark:text-paper/45">
          ✓ Lengkap di koleksi
          {item.lintasSitus && ` dari ${labelSumber(item.koleksi.sumber)}`}
          {item.koleksi && (
            <>
              {' · '}
              <Link to={`/comic/${item.koleksi.slug}`} className="underline hover:text-naruto">
                buka
              </Link>
            </>
          )}
        </p>
      );
    }

    const tertinggal = item.chapterTertinggal > 0 ? item.chapterTertinggal : null;

    return (
      <>
        {/* Chapter dari situs lain akan masuk ke komik yang diimpor dari situs
            asalnya. Disebut di atas tombolnya, bukan disembunyikan, karena
            penomoran chapter antar situs tidak selalu sama. */}
        {item.lintasSitus && (
          <p className="mb-1.5 truncate text-[11px] text-night/50 dark:text-paper/50">
            Koleksi Anda dari {labelSumber(item.koleksi.sumber)}
          </p>
        )}
        <button
          type="button"
          className="btn-accent w-full px-2 text-xs"
          onClick={() => onImpor(item)}
          disabled={memuat}
        >
          {memuat
            ? 'Menyiapkan…'
            : item.status !== 'update'
              ? 'Impor'
              : tertinggal
                ? `Ambil ${tertinggal} chapter baru`
                : 'Ambil chapter baru'}
        </button>
      </>
    );
  };

  return (
    // min-w-0 di sini bukan hiasan: kartu ini adalah grid item, dan grid item
    // default tidak boleh menyusut di bawah lebar min-content-nya. Judul
    // ber-`truncate` punya white-space:nowrap, sehingga min-content-nya = lebar
    // judul utuh — satu judul 90 karakter cukup untuk melebarkan kolomnya dan
    // memunculkan scroll horizontal di 375px.
    <article className="card flex min-w-0 flex-col overflow-hidden">
      <div className="relative aspect-[2/3] overflow-hidden bg-paper-line dark:bg-night-line">
        <Sampul item={item} />
        <span
          className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${lencana.kelas}`}
        >
          {lencana.label}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-bold leading-snug" title={item.title}>
          {item.title}
        </h3>
        <p className="truncate text-[11px] text-night/50 dark:text-paper/50">
          {[labelSumber(item.sourceHost), item.tipe, item.genre].filter(Boolean).join(' · ')}
        </p>
        <p className="text-xs font-semibold">
          {/* Kartu hasil cari komikindo sama sekali tidak memuat chapter.
              "Tidak terbaca" di situ menuduh pengurai yang tidak salah apa-apa. */}
          {item.latestChapter == null
            ? 'Chapter terbaru tidak disebut'
            : nomor == null
              ? 'Nomor chapter tidak terbaca'
              : `Chapter ${formatChapterNumber(nomor)}`}
        </p>
        <p className="truncate text-[11px] text-night/40 dark:text-paper/40">{waktu}</p>
        <div className="mt-auto pt-2">{aksi()}</div>
      </div>
    </article>
  );
};

/**
 * Bagian "Hasil dari situs sumber". Dipisah dari grid etalase karena dua
 * daftar ini menjawab pertanyaan berbeda: etalase = apa yang sedang update di
 * halaman depan situs, hasil cari = judul tertentu yang dicari, update atau
 * tidak. Dicampur, kartu hasil cari akan terbaca sebagai "baru update".
 */
const HasilCariSumber = ({ hasil, diantre, sedangImpor, onImpor, onUlang, onTutup }) => {
  const data = hasil.currentData;
  const items = data?.items ?? [];
  const sumber = data?.sumber ?? [];
  const tidakDidukung = data?.tidakDidukung ?? [];
  const bergalat = sumber.filter((entri) => entri.galat);
  const semuaGagal = sumber.length > 0 && sumber.every((entri) => entri.galat && entri.jumlah === 0);

  const kosong = () => {
    if (sumber.length === 0) {
      return {
        icon: '🧭',
        title: 'Pencarian belum didukung',
        description:
          'Belum ada situs sumber yang punya konfigurasi pencarian. Judul yang sedang update tetap bisa diambil dari etalase di bawah.',
      };
    }
    if (semuaGagal) {
      return {
        icon: '📡',
        title: 'Situs sumber tidak bisa dihubungi',
        description: 'Rincian dari tiap situs ada di atas. Coba lagi sebentar lagi.',
      };
    }
    return {
      icon: '🔍',
      title: 'Tidak ditemukan di situs sumber',
      description: 'Coba ejaan lain, judul alternatifnya (Inggris atau romaji), atau kata yang lebih pendek.',
    };
  };

  return (
    <section className="mt-5" aria-label="Hasil dari situs sumber">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-title">
            <span aria-hidden="true">🌐</span> Hasil dari situs sumber
          </h2>
          {hasil.originalArgs && (
            <p className="break-words text-xs text-night/50 dark:text-paper/50">
              untuk “{hasil.originalArgs}”
            </p>
          )}
        </div>
        <button type="button" className="btn-ghost flex-none px-2 py-1 text-xs" onClick={onTutup}>
          Tutup
        </button>
      </div>

      {hasil.isFetching && <Spinner label="Mencari di situs sumber…" />}

      {!hasil.isFetching && hasil.isError && (
        <div className="mt-3">
          <ErrorState error={hasil.error} onRetry={onUlang} />
        </div>
      )}

      {/* isError ikut diperiksa: gagal mengulang kata yang sama tidak
          membuang data lamanya, dan galat di atas kartu lama saling membantah. */}
      {!hasil.isFetching && !hasil.isError && data && (
        <>
          {sumber.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="label-mikro">Sumber</span>
              {sumber.map((entri) => (
                <span key={entri.host} className={`chip ${entri.galat ? 'border-danger/40' : ''}`}>
                  {entri.galat && (
                    <span aria-label="ada galat" className="mr-1 text-danger">
                      !
                    </span>
                  )}
                  {labelSumber(entri.host)}
                  <span className="ml-1.5 opacity-60">{entri.jumlah}</span>
                </span>
              ))}
            </div>
          )}

          {/* Galat disebut per situs. Tanpa ini, "0 hasil" dari situs yang
              sedang mati terbaca sama dengan judul yang memang tidak ada. */}
          {bergalat.length > 0 && (
            <ul className="mt-3 space-y-1 break-words rounded-xl border border-danger/40 bg-danger/5 px-4 py-2 text-xs leading-relaxed text-night/70 dark:text-paper/70">
              {bergalat.map((entri) => (
                <li key={entri.host}>
                  <b>{labelSumber(entri.host)}</b> — {entri.galat}
                </li>
              ))}
            </ul>
          )}

          {tidakDidukung.length > 0 && (
            <p className="mt-2 text-xs text-night/50 dark:text-paper/50">
              Pencarian {tidakDidukung.map((host) => labelSumber(host)).join(', ')} belum didukung —
              judul dari situs itu tetap muncul di etalase saat sedang update.
            </p>
          )}

          {items.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                {...kosong()}
                action={
                  semuaGagal && (
                    <button type="button" className="btn-ghost" onClick={onUlang}>
                      Coba lagi
                    </button>
                  )
                }
              />
            </div>
          ) : (
            <div className="grid-komik mt-3">
              {items.map((item) => (
                <KartuScout
                  key={item.kunci}
                  item={item}
                  diantre={diantre[kunciKartu(item)]}
                  memuat={sedangImpor === kunciKartu(item)}
                  onImpor={onImpor}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};

export const Scout = () => {
  const dispatch = useDispatch();
  const [bagian, setBagian] = useState('semua');
  const [status, setStatus] = useState('semua');
  const [sumber, setSumber] = useState('semua');
  const [cari, setCari] = useState('');
  const [diantre, setDiantre] = useState({});
  const [sedangImpor, setSedangImpor] = useState(null);
  const [tampilkanHasil, setTampilkanHasil] = useState(false);

  // Hanya `bagian` yang dikirim ke server. Sumber, status, dan kata kunci
  // disaring di sini: datanya sudah di tangan, dan satu huruf yang diketik atau
  // satu chip yang ditekan tidak pantas berarti satu permintaan ke server.
  const query = useGetScoutQuery({ bagian });
  const [refresh, { isLoading: sedangMenyegarkan }] = useRefreshScoutMutation();
  const [impor] = useImportScoutItemMutation();
  const [imporUrl] = useImporScoutUrlMutation();
  // Lazy karena kotak yang sama menyaring etalase di setiap ketikan. Pencarian
  // ke situs sumber hanya boleh lahir dari Enter atau tombol Cari — setiap
  // permintaan menjangkau semua situs sumber dan dibatasi 20 per menit.
  const [cariDiSumber, hasilCari] = useLazyCariScoutQuery();
  const kataCari = cari.trim();
  const bisaCari = kataCari.length >= CARI_MIN && !hasilCari.isFetching;

  // Daftar kosongnya dibungkus useMemo karena `?? []` melahirkan array dengan
  // identitas baru tiap render, dan itu membatalkan memo penyaring di bawahnya.
  const daftar = query.data?.items;
  const items = useMemo(() => daftar ?? [], [daftar]);
  const scannedAt = query.data?.scannedAt ?? null;
  const daftarSumber = query.data?.sumber;
  const sumberList = useMemo(() => daftarSumber ?? [], [daftarSumber]);
  const sumberGagal = sumberList.filter((entri) => entri.galat);

  const itemsSumber = useMemo(
    () => (sumber === 'semua' ? items : items.filter((item) => item.sourceHost === sumber)),
    [items, sumber],
  );

  // Angka di chip status dihitung di sini, bukan diambil dari `jumlah` server.
  // Server tidak tahu sumber mana yang sedang dipilih, jadi begitu satu sumber
  // disaring angkanya tidak lagi cocok dengan isi grid — chip "Baru 31" yang
  // ternyata hanya berisi 4 kartu.
  const jumlah = useMemo(() => {
    const hitung = { semua: itemsSumber.length, baru: 0, update: 0, punya: 0 };
    itemsSumber.forEach((item) => {
      if (item.status in hitung) hitung[item.status] += 1;
    });
    return hitung;
  }, [itemsSumber]);

  const terlihat = useMemo(() => {
    const kata = cari.trim().toLowerCase();
    return itemsSumber.filter(
      (item) =>
        (status === 'semua' || item.status === status) &&
        (!kata || String(item.title ?? '').toLowerCase().includes(kata)),
    );
  }, [itemsSumber, status, cari]);

  const segarkan = async () => {
    try {
      const hasil = await refresh().unwrap();
      const gagal = (hasil?.penyegaran ?? [])
        .filter((entri) => entri.galat)
        .map((entri) => labelSumber(entri.host));
      const pesan = `Etalase disegarkan — ${hasil?.jumlah?.semua ?? 0} judul terbaca`;
      dispatch(
        showToast(
          gagal.length ? { type: 'error', message: `${pesan} · ${gagal.join(', ')} gagal` } : { message: pesan },
        ),
      );
    } catch (error) {
      dispatch(
        showToast({ type: 'error', message: error?.data?.error ?? 'Gagal memindai situs sumber' }),
      );
    }
  };

  const jalankanCari = (event) => {
    event?.preventDefault();
    if (kataCari.length < CARI_MIN || hasilCari.isFetching) return;
    setTampilkanHasil(true);
    cariDiSumber(kataCari);
  };

  const ulangiCari = () => {
    if (hasilCari.originalArgs) cariDiSumber(hasilCari.originalArgs);
  };

  const jalankanImpor = async (item, dariCari = false) => {
    const kunci = kunciKartu(item);
    // hanyaBaru hanya untuk yang memang tertinggal. Kalau komiknya belum ada
    // sama sekali, "hanya yang baru" tidak punya pembanding dan server akan
    // mengambil seluruh chapter — sama saja, tapi maksudnya jadi kabur.
    const hanyaBaru = item.status === 'update';
    setSedangImpor(kunci);
    try {
      const permintaan = dariCari
        ? imporUrl({ seriesUrl: item.seriesUrl, hanyaBaru })
        : impor({ id: item.id, hanyaBaru });
      const hasil = await permintaan.unwrap();
      const masuk = hasil?.queued?.length ?? 0;
      const dilewati = hasil?.skipped?.length ?? 0;
      setDiantre((sebelum) => ({ ...sebelum, [kunci]: masuk }));
      dispatch(
        showToast({
          message: `${potongJudul(item.title)}: ${masuk} chapter masuk antrian${
            dilewati ? ` · ${dilewati} dilewati` : ''
          }`,
        }),
      );
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Impor gagal' }));
    } finally {
      setSedangImpor(null);
    }
  };

  const imporHasilCari = (item) => jalankanImpor(item, true);

  const sibuk = sedangMenyegarkan || query.isFetching;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-black">Scout</h1>
          <p className="text-sm text-night/50 dark:text-paper/50">
            Etalase judul dari situs sumber — pilih yang mau masuk koleksi tanpa perlu membuka
            situsnya sendiri.
          </p>
        </div>
        <div className="flex flex-none items-center gap-3">
          <span className="text-xs text-night/45 dark:text-paper/45">
            {scannedAt ? `dipindai ${formatRelativeTime(scannedAt)}` : 'belum pernah dipindai'}
          </span>
          <button type="button" className="btn-ghost" onClick={segarkan} disabled={sibuk}>
            {sedangMenyegarkan ? 'Memindai…' : '↻ Segarkan'}
          </button>
        </div>
      </div>

      {/* Data basi tetap ditampilkan — menyembunyikannya hanya membuat halaman
          kosong tanpa penjelasan. Yang penting pengguna tahu ia sedang melihat
          hasil pindaian lama, dan tahu tombol mana yang memperbaikinya. */}
      {query.data?.basi && scannedAt && (
        <p className="mt-4 rounded-xl border border-naruto/40 bg-naruto/5 px-4 py-2 text-xs leading-relaxed text-night/70 dark:text-paper/70">
          Yang tampil di bawah adalah hasil pindaian {formatRelativeTime(scannedAt)} dan kemungkinan
          sudah tertinggal dari situsnya. Tekan Segarkan untuk membaca ulang.
        </p>
      )}

      {/* Sumber yang gagal disebut namanya. Tanpa ini, etalase yang tiba-tiba
          tanpa kartu komikindo terbaca seperti komikindo sedang tidak update. */}
      {sumberGagal.length > 0 && (
        <p className="mt-4 break-words rounded-xl border border-danger/40 bg-danger/5 px-4 py-2 text-xs leading-relaxed text-night/70 dark:text-paper/70">
          Pindaian terakhir gagal untuk{' '}
          <b>{sumberGagal.map((entri) => labelSumber(entri.host)).join(', ')}</b> — kartunya mungkin
          sudah tertinggal. {sumberGagal[0].galat}
        </p>
      )}

      <div className="card mt-5 flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {SARINGAN_STATUS.map((pilihan) => (
            <Chip
              key={pilihan.value}
              aktif={status === pilihan.value}
              onClick={() => setStatus(pilihan.value)}
            >
              {pilihan.label}
              <span className="ml-1.5 opacity-60">{jumlah[pilihan.kunci] ?? 0}</span>
            </Chip>
          ))}
        </div>

        {sumberList.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-mikro">Sumber</span>
            <Chip aktif={sumber === 'semua'} onClick={() => setSumber('semua')}>
              Semua
            </Chip>
            {sumberList.map((entri) => (
              <Chip
                key={entri.host}
                aktif={sumber === entri.host}
                onClick={() => setSumber(entri.host)}
              >
                {entri.galat && (
                  <span aria-label="gagal dipindai" className="mr-1 text-danger">
                    !
                  </span>
                )}
                {labelSumber(entri.host)}
                <span className="ml-1.5 opacity-60">{entri.jumlah}</span>
              </Chip>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mikro">Bagian</span>
          {SARINGAN_BAGIAN.map((pilihan) => (
            <Chip
              key={pilihan.value}
              aktif={bagian === pilihan.value}
              onClick={() => setBagian(pilihan.value)}
            >
              {pilihan.label}
            </Chip>
          ))}
        </div>

        <form role="search" onSubmit={jalankanCari} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input min-w-0 sm:flex-1"
            type="search"
            placeholder="Cari judul…"
            aria-label="Cari judul"
            maxLength={CARI_MAKS}
            value={cari}
            onChange={(event) => setCari(event.target.value)}
          />
          <button type="submit" className="btn-accent flex-none" disabled={!bisaCari}>
            {hasilCari.isFetching ? 'Mencari…' : 'Cari di situs sumber'}
          </button>
        </form>
        {/* Satu kotak, dua perilaku — disebut terang-terangan supaya kartu
            etalase yang menyusut saat mengetik tidak dikira hasil pencarian. */}
        <p className="-mt-1 text-[11px] leading-relaxed text-night/45 dark:text-paper/45">
          Mengetik hanya menyaring etalase. Enter atau tombol Cari (minimal {CARI_MIN} huruf) mencari
          langsung di situs sumber — untuk judul yang tidak sedang tampil di etalase.
        </p>
      </div>

      {tampilkanHasil && !hasilCari.isUninitialized && (
        <HasilCariSumber
          hasil={hasilCari}
          diantre={diantre}
          sedangImpor={sedangImpor}
          onImpor={imporHasilCari}
          onUlang={ulangiCari}
          onTutup={() => setTampilkanHasil(false)}
        />
      )}

      <div className="mt-5">
        {tampilkanHasil && !hasilCari.isUninitialized && (
          <h2 className="section-title mb-3">
            <span aria-hidden="true">🔭</span> Etalase
          </h2>
        )}
        {query.isLoading && <Spinner label="Membaca etalase…" />}
        {query.isError && <ErrorState error={query.error} onRetry={query.refetch} />}

        {!query.isLoading && !query.isError && terlihat.length === 0 && (
          <EmptyState
            icon={items.length === 0 ? '🔭' : '🔍'}
            title={items.length === 0 ? 'Etalase masih kosong' : 'Tidak ada yang cocok'}
            description={
              items.length === 0
                ? 'Belum ada kartu yang tersimpan dari situs sumber. Tekan Segarkan untuk memindai sekarang.'
                : kataCari.length >= CARI_MIN
                  ? 'Judul ini tidak tampil di etalase dengan saringan sekarang. Etalase hanya memuat yang sedang update — cari langsung di situs sumbernya.'
                  : 'Coba pilih saringan status yang lain, atau kosongkan kotak cari.'
            }
            action={
              items.length === 0 ? (
                <button type="button" className="btn-accent" onClick={segarkan} disabled={sibuk}>
                  {sedangMenyegarkan ? 'Memindai…' : '↻ Segarkan sekarang'}
                </button>
              ) : (
                // Disembunyikan kalau kata yang sama sudah dicari: hasilnya
                // sudah tampil di atas, dan tombol kedua hanya membakar jatah.
                kataCari.length >= CARI_MIN &&
                !(tampilkanHasil && hasilCari.originalArgs === kataCari) && (
                  <button type="button" className="btn-accent" onClick={jalankanCari} disabled={!bisaCari}>
                    Cari di situs sumber
                  </button>
                )
              )
            }
          />
        )}

        {terlihat.length > 0 && (
          <div className="grid-komik">
            {terlihat.map((item) => (
              <KartuScout
                key={item.id}
                item={item}
                diantre={diantre[kunciKartu(item)]}
                memuat={sedangImpor === kunciKartu(item)}
                onImpor={jalankanImpor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Scout;

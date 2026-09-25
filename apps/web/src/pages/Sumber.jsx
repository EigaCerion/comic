import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ambilKatalog, ambilPencarian, daftarHost } from '../sumber/ambil.js';
import { kembalikanTabelBawaan, siapkanPola, statusPola } from '../sumber/pola.js';
import { EmptyState, Spinner } from '../components/Common/index.jsx';
import { formatChapterNumber } from '../utils/format.js';

/**
 * Menjelajah situs sumber LANGSUNG dari HP, tanpa server rumah sama sekali.
 *
 * Ini kembaran Scout untuk orang yang cuma memasang APK-nya. Tata letaknya
 * sengaja dibuat semirip mungkin dengan halaman Scout — chip sumber, grid
 * kartu, sampul 2/3, judul, chapter terbaru — supaya orang yang sudah pernah
 * memakai versi webnya tidak perlu belajar layar baru. Yang berbeda ada di
 * bawah permukaan: di sini tidak ada RTK Query dan tidak ada satu pun
 * permintaan ke /api, karena pada perangkat yang dituju layar ini memang tidak
 * ada server yang bisa ditanya.
 *
 * Satu keputusan yang membentuk seluruh berkas: KEGAGALAN DIHITUNG PER SITUS.
 * Enam situs dimuat berdampingan, masing-masing dengan keadaannya sendiri, dan
 * satu situs yang sedang mati hanya menghasilkan satu baris peringatan —
 * bukan layar galat yang menelan lima situs lain yang baik-baik saja.
 */

// "02.ngomik.cc" dan "ngomik.cc" sama-sama tampil "Ngomik": subdomain yang
// berganti-ganti tidak berarti apa-apa bagi pembaca, nama situsnya yang berarti.
// Disalin dari Scout.jsx alih-alih diimpor dari sana — Scout adalah layar
// server rumah dengan hook RTK Query di puncaknya, dan mengimpor satu fungsi
// kecil dari sana menyeret seluruh layar itu ke jalur ini.
const labelSumber = (host) => {
  const potongan = String(host ?? '').toLowerCase().replace(/^www\./, '').split('.');
  const nama = potongan.length > 2 ? potongan[potongan.length - 2] : potongan[0];
  return nama ? nama[0].toUpperCase() + nama.slice(1) : 'Sumber';
};

const CARI_MIN = 2;
const CARI_MAKS = 80;

const tautanSeri = (seriesUrl) => `/sumber/seri?url=${encodeURIComponent(seriesUrl)}`;

/**
 * Sampul datang langsung dari CDN situs sumber, jadi gagal memuat adalah
 * kejadian biasa: berkasnya dihapus, atau CDN-nya menolak permintaan dari
 * origin lain. Tanpa penangkap onError yang tersisa adalah ikon gambar rusak
 * bawaan di dalam kotak 2/3 — jauh lebih berisik daripada placeholder tenang.
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

const KartuSumber = ({ item }) => {
  const nomor = item.latestChapter?.number;

  return (
    // min-w-0 wajib: kartu ini grid item, dan grid item tidak boleh menyusut di
    // bawah lebar min-content-nya. Judul ber-`truncate` punya white-space:nowrap
    // sehingga min-content-nya = lebar judul utuh, dan satu judul 90 karakter
    // cukup untuk melahirkan scroll horizontal di layar 375px.
    <article className="card flex min-w-0 flex-col overflow-hidden">
      <Link to={tautanSeri(item.seriesUrl)} className="block">
        <div className="relative aspect-[2/3] overflow-hidden bg-paper-line dark:bg-night-line">
          <Sampul item={item} />
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-bold leading-snug" title={item.title}>
          <Link to={tautanSeri(item.seriesUrl)} className="hover:text-naruto">
            {item.title}
          </Link>
        </h3>
        <p className="truncate text-[11px] text-night/50 dark:text-paper/50">
          {/* `item.host` ditempelkan pemanggil, dan itu satu-satunya sumber nama
              situs yang ada di sini: kartu dari panenKartu() sengaja tidak
              membawa host-nya sendiri — yang membawanya adalah pembungkus
              { source, items } di sekelilingnya, dan itu sudah terlepas begitu
              kartu enam situs digabung jadi satu daftar. Versi sebelumnya
              membaca item.source yang tidak pernah ada, sehingga SETIAP kartu
              tampil "Sumber" dan satu-satunya penanda asal judul ikut hilang. */}
          {[labelSumber(item.host), item.tipe, item.genre].filter(Boolean).join(' · ')}
        </p>
        <p className="text-xs font-semibold">
          {/* Kartu hasil cari sebagian situs memang tidak memuat chapter sama
              sekali. "Tidak terbaca" di situ menuduh pengurai yang tidak salah. */}
          {item.latestChapter == null
            ? 'Chapter terbaru tidak disebut'
            : nomor == null
              ? 'Nomor chapter tidak terbaca'
              : `Chapter ${formatChapterNumber(nomor)}`}
        </p>
        <p className="truncate text-[11px] text-night/40 dark:text-paper/40">
          {item.updatedText ?? '—'}
        </p>
        <div className="mt-auto pt-2">
          <Link to={tautanSeri(item.seriesUrl)} className="btn-ghost block w-full px-2 py-1 text-center text-xs">
            Lihat chapter
          </Link>
        </div>
      </div>
    </article>
  );
};

/** Satu baris "situs ini kenapa" — dipakai untuk galat maupun peringatan. */
const BarisKabar = ({ host, pesan, jenis }) => (
  <li>
    <b>{labelSumber(host)}</b> — <span className={jenis === 'galat' ? 'text-danger' : ''}>{pesan}</span>
  </li>
);

const Chip = ({ aktif, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={aktif}
    className={`chip px-3 py-1 ${
      aktif ? 'border-naruto/50 bg-naruto/15 text-naruto' : 'hover:border-night/20 dark:hover:border-paper/20'
    }`}
  >
    {children}
  </button>
);

const KOSONG = { memuat: false, items: [], warning: null, galat: null };

/** Identitas tetap, supaya efek pemuatan tidak berjalan lagi hanya karena
 *  daftar host kosong dibuat ulang. */
const TANPA_HOST = { katalog: [], cari: [] };

/**
 * Hasil yang bertahan melewati perpindahan layar — disimpan di tingkat modul,
 * bukan di dalam komponen.
 *
 * /sumber dan /sumber/seri adalah dua rute bersaudara, jadi menekan satu kartu
 * lalu menekan Back MELEPAS layar ini dan memasangnya lagi dengan state kosong.
 * Tanpa simpanan ini, membuka sepuluh seri berturut-turut — cara menjelajah
 * yang paling biasa — berarti empat puluh pengambilan halaman etalase penuh
 * dalam beberapa menit, di atas kuota seluler orangnya. Antrean per host di
 * ambil.js hanya mengatur JARAK antar permintaan (1200 ms) dan sama sekali
 * tidak mengurangi JUMLAHnya; yang menekan jumlahnya cuma simpanan ini. Di sisi
 * situs, satu alamat IP rumahan yang menarik beranda berulang kali tiap
 * beberapa detik justru pola yang paling mirip pemindai — persis yang ingin
 * dihindari antrean itu.
 *
 * Umurnya sengaja pendek: yang dijual layar ini adalah "chapter terbaru", dan
 * lima menit cukup untuk satu sesi menjelajah tanpa pernah menyuguhkan daftar
 * yang sudah terasa basi.
 */
const UMUR_SIMPANAN_MS = 5 * 60 * 1000;

/**
 * KEGAGALAN JUGA DIINGAT, dan itu perbaikan atas versi pertama layar ini.
 *
 * Dulu hanya jalur sukses yang menulis simpanan, dengan alasan yang benar untuk
 * situs yang sedang MATI: mengingat kegagalannya lima menit berarti situs yang
 * sudah pulih tetap tampil kosong. Tapi alasan itu sama sekali tidak menutupi
 * 429 dan 403 — di sana situsnya justru secara eksplisit minta dijauhi, dan
 * yang terjadi adalah kebalikannya: setiap tombol Back memasang ulang layar
 * ini, tidak ada entri simpanan untuk host yang gagal, jadi ia diketuk lagi.
 * Membuka sepuluh seri berturut-turut berarti sepuluh permintaan baru ke host
 * yang BARU SAJA menjawab "terlalu banyak permintaan", dari satu alamat IP
 * rumahan. Antrean per host hanya memberi jarak; ia tidak mengurangi jumlah.
 *
 * Maka umurnya dibedakan: sebentar untuk "situsnya sedang bermasalah", lama
 * untuk "situsnya menyuruh pergi". Tombol "Muat ulang" tetap menembus keduanya,
 * karena di situ orangnya sendiri yang meminta.
 */
const UMUR_GAGAL_MS = 60 * 1000;
const UMUR_DITOLAK_MS = 10 * 60 * 1000;
/** Retry-After yang menyebut berjam-jam tetap dihormati, tapi ada batasnya:
 *  header yang salah tulis tidak boleh mematikan sebuah situs seharian. */
const UMUR_DITOLAK_MAKS_MS = 60 * 60 * 1000;

const umurKegagalan = (error) => {
  const status = error?.status ?? null;
  if (status !== 429 && status !== 403) return UMUR_GAGAL_MS;
  // Situs yang menyebut sendiri berapa lama ia minta dijauhi lebih tahu
  // daripada angka tetap di berkas ini (lihat Retry-After di sumber/ambil.js).
  const diminta = Number(error?.tungguMs);
  if (Number.isFinite(diminta) && diminta > 0) {
    return Math.min(Math.max(diminta, UMUR_GAGAL_MS), UMUR_DITOLAK_MAKS_MS);
  }
  return UMUR_DITOLAK_MS;
};

const simpananEtalase = new Map(); // host -> { keadaan, pada, umur }
let simpananCari = null; // { kata, perHost, tidakDidukung, pada }

/**
 * Penanda giliran pencarian, di tingkat modul karena simpanannya juga di sana.
 *
 * Tanpa ini, pencarian yang sudah ditutup hidup lagi: tombol "Tutup" boleh
 * ditekan selagi permintaan masih terbang (bisa belasan detik kalau satu situs
 * sedang mati), lalu Promise.all selesai dan menimpa `simpananCari = null` yang
 * baru saja ditulis handler-nya. Menekan Back dari satu seri sesudah itu
 * memulihkan pencarian yang sengaja ditutup, lengkap dengan kotak kata kunci
 * yang sengaja dikosongkan.
 */
let penandaCari = 0;

const masihSegar = (pada, umur = UMUR_SIMPANAN_MS) => Date.now() - pada < umur;

/**
 * Entri simpanan yang masih berlaku, atau null.
 *
 * Yang sudah lewat umurnya DIBUANG di sini, bukan dibiarkan menumpuk: entri
 * basi yang masih ada akan terbaca lagi sebagai "kartu yang sudah sempat
 * terbaca" saat pengambilan berikutnya gagal, sehingga daftar lima menit lalu
 * muncul kembali di bawah baris galat seolah baru.
 */
const tersimpanSegar = (host) => {
  const isi = simpananEtalase.get(host);
  if (!isi) return null;
  if (!masihSegar(isi.pada, isi.umur)) {
    simpananEtalase.delete(host);
    return null;
  }
  return isi.keadaan;
};

const etalaseTersimpan = () => {
  const awal = {};
  simpananEtalase.forEach((_isi, host) => {
    const keadaan = tersimpanSegar(host);
    if (keadaan) awal[host] = keadaan;
  });
  return awal;
};

const cariTersimpan = () => (simpananCari && masihSegar(simpananCari.pada) ? simpananCari : null);

export const Sumber = () => {
  const [pola, setPola] = useState(null);
  const [hostTersedia, setHostTersedia] = useState(TANPA_HOST);
  const [etalase, setEtalase] = useState(etalaseTersimpan); // host -> keadaan
  const [sumberDipilih, setSumberDipilih] = useState('semua');
  const [memulihkanPola, setMemulihkanPola] = useState(false);

  // Pencarian ikut dipulihkan, bukan cuma etalasenya: kembali dari satu hasil
  // dan mendapati kotak pencarian kosong berarti mengetik ulang kata yang sama
  // lalu menembakkannya lagi ke semua situs.
  const [kata, setKata] = useState(() => cariTersimpan()?.kata ?? '');
  const [cari, setCari] = useState(cariTersimpan); // { kata, perHost, tidakDidukung }
  const [sedangCari, setSedangCari] = useState(false);

  /*
   * Tabel pola disiapkan DULU, sebelum satu host pun disebut.
   *
   * daftarHost() membaca tabel yang sedang aktif, dan tabel dari server rumah
   * bisa saja mematikan sebuah situs atau memperbaiki selectornya. Memanggilnya
   * sebelum tabelnya terpasang berarti memuat etalase dengan selector lama lalu
   * menampilkannya seolah-olah itu yang terbaru.
   *
   * Daftarnya juga tidak lagi dibaca lewat import statis @naruread/sumber:
   * satu import itu cukup untuk menanam cheerio (~250 kB setelah minify) di
   * chunk entry bundel android, yang diurai dan dieksekusi pada setiap start
   * dingin — dibayar penuh bahkan oleh orang yang cuma membaca chapter yang
   * sudah tersimpan di HP. daftarHost() di sumber/ambil.js adalah pintu malas
   * yang sama dengan yang dipakai pengambilnya.
   */
  useEffect(() => {
    let dibatalkan = false;

    const siapkan = async () => {
      let keadaan;
      try {
        keadaan = await siapkanPola();
      } catch {
        keadaan = statusPola();
      }

      let daftar = TANPA_HOST;
      try {
        daftar = await daftarHost();
      } catch (error) {
        // Mesin pembaca gagal dimuat berarti tidak ada satu pun situs yang bisa
        // dibaca. Disebut di layar, bukan dibiarkan jadi "belum ada yang
        // terbaca" yang menuduh situsnya.
        keadaan = {
          ...keadaan,
          peringatan: [
            ...(keadaan?.peringatan ?? []),
            `Mesin pembaca situs gagal dimuat: ${error?.message ?? 'tidak diketahui'}.`,
          ],
        };
      }

      if (dibatalkan) return;
      setHostTersedia(daftar);
      setPola(keadaan);
    };

    siapkan();
    return () => {
      dibatalkan = true;
    };
  }, []);

  const hostKatalog = hostTersedia.katalog;
  const hostCari = hostTersedia.cari;

  const muatSatu = useCallback(async (host) => {
    setEtalase((sebelum) => ({ ...sebelum, [host]: { ...KOSONG, ...sebelum[host], memuat: true, galat: null } }));
    try {
      const hasil = await ambilKatalog(host);
      const keadaan = {
        memuat: false,
        items: Array.isArray(hasil?.items) ? hasil.items : [],
        warning: hasil?.warning ?? null,
        galat: null,
      };
      simpananEtalase.set(host, { keadaan, pada: Date.now(), umur: UMUR_SIMPANAN_MS });
      setEtalase((sebelum) => ({ ...sebelum, [host]: keadaan }));
    } catch (error) {
      // Kartu yang sudah sempat terbaca dipertahankan. Menyegarkan ulang dan
      // gagal tidak boleh berarti isi layar hilang — yang bertambah cuma satu
      // baris keterangan. Dibaca dari simpanan, bukan dari updater state,
      // karena keadaan yang sama harus mendarat di keduanya dan menulis
      // simpanan dari dalam updater berarti menulisnya saat React merender.
      const sebelumnya = tersimpanSegar(host) ?? KOSONG;
      const keadaan = {
        ...sebelumnya,
        memuat: false,
        galat: error?.message ?? 'gagal dihubungi',
      };
      simpananEtalase.set(host, { keadaan, pada: Date.now(), umur: umurKegagalan(error) });
      setEtalase((sebelum) => ({ ...sebelum, [host]: keadaan }));
    }
  }, []);

  // Tiap host berangkat sendiri-sendiri, dan itu memang boleh: yang haram
  // adalah menembaki SATU situs berbarengan, dan itu sudah dijaga antrean per
  // host di ambil.js. Enam situs berbeda masing-masing hanya melihat satu
  // permintaan tenang dari satu HP.
  //
  // Yang masih segar di simpanan dilewati — termasuk kegagalan yang masih
  // diingat. State awal sudah memuatnya, dan mengambilnya lagi persis kebiasaan
  // yang membuat pemasangan ulang layar ini mahal. Tombol "Muat ulang" tetap
  // memaksa pengambilan baru.
  useEffect(() => {
    hostKatalog.forEach((host) => {
      if (tersimpanSegar(host)) return;
      muatSatu(host);
    });
  }, [hostKatalog, muatSatu]);

  const jalankanCari = async (event) => {
    event?.preventDefault();
    const teks = kata.trim();
    // `pola` ikut dijaga, bukan cuma panjang katanya. Selama tabelnya belum
    // terpasang, hostCari masih kosong dan Promise.all([]) selesai seketika
    // dengan nol hasil — yang tampil di layar sebagai vonis "Tidak ditemukan di
    // situs sumber" atas pencarian yang bahkan tidak pernah meninggalkan HP,
    // dan orangnya akan menyimpulkan judulnya memang tidak ada. Jendelanya
    // bukan satu frame: kalau alamat server tersimpan tapi servernya mati,
    // siapkanPola() baru menyerah sesudah batas waktunya habis.
    if (!pola || teks.length < CARI_MIN || teks.length > CARI_MAKS || sedangCari) return;

    // Giliran ini. Tombol "Tutup" dan pencarian berikutnya sama-sama menaikkan
    // penandanya, jadi giliran yang sudah ditinggalkan tidak akan pernah
    // mengklaim simpanan di ujung sana.
    penandaCari += 1;
    const giliranIni = penandaCari;

    setSedangCari(true);
    // Kiryuu sengaja tidak punya blok `cari`: pencariannya menuntut POST plus
    // nonce dari halamannya sendiri, dan menembak GET ?s= di sana membalas
    // judul populer yang tampil persis seperti hasil pencarian sungguhan.
    // Disebut apa adanya sebagai "belum didukung", bukan dibiarkan jadi nol hasil.
    const tidakDidukung = hostKatalog.filter((host) => !hostCari.includes(host));
    setCari({ kata: teks, perHost: {}, tidakDidukung });

    // Saringan sumber dikembalikan ke "Semua" kalau situs yang sedang dipilih
    // tidak ikut dicari. Tanpa ini, orang yang sedang menyaring etalase ke
    // Kiryuu lalu menekan Cari mendapat layar "tidak ditemukan" yang sempurna
    // menyesatkan: hasilnya ada, hanya saja disaring oleh chip yang bahkan
    // tidak lagi tampil di barisan chip pencarian.
    if (sumberDipilih !== 'semua' && !hostCari.includes(sumberDipilih)) setSumberDipilih('semua');

    // Dikumpulkan juga di luar state, karena yang disimpan nanti adalah hasil
    // utuhnya: state terakhir hanya bisa dibaca lewat updater, dan menyimpan
    // dari dalam updater berarti menulis simpanan saat React sedang merender.
    const perHost = {};

    await Promise.all(
      hostCari.map(async (host) => {
        try {
          const hasil = await ambilPencarian(host, teks);
          perHost[host] = {
            items: Array.isArray(hasil?.items) ? hasil.items : [],
            warning: hasil?.warning ?? null,
            galat: null,
          };
        } catch (error) {
          perHost[host] = { items: [], warning: null, galat: error?.message ?? 'gagal dihubungi' };
        }
        setCari((sebelum) =>
          sebelum?.kata !== teks
            ? sebelum
            : { ...sebelum, perHost: { ...sebelum.perHost, [host]: perHost[host] } },
        );
      }),
    );

    // Giliran yang sudah ditinggalkan berhenti di sini: tidak menulis simpanan,
    // dan tidak menyentuh `sedangCari` yang sudah jadi milik giliran lain.
    if (giliranIni !== penandaCari) return;

    // Hasilnya disimpan apa adanya, termasuk situs yang gagal: yang dipulihkan
    // saat orangnya kembali dari satu hasil harus layar yang sama persis dengan
    // yang ditinggalkannya. Menekan Cari lagi tetap mengambil yang baru.
    simpananCari = { kata: teks, perHost, tidakDidukung, pada: Date.now() };
    setSedangCari(false);
  };

  const tutupCari = () => {
    // Simpanannya ikut dibuang: "Tutup" berarti selesai dengan pencarian itu,
    // dan memulihkannya saat layar ini dipasang lagi adalah persis kebalikan
    // dari yang baru saja diminta. Penandanya dinaikkan supaya pencarian yang
    // masih terbang tidak menulis simpanan itu kembali beberapa detik kemudian.
    penandaCari += 1;
    simpananCari = null;
    setCari(null);
    setKata('');
    setSedangCari(false);
  };

  /**
   * Jalan pulang dari tabel pola yang ternyata salah.
   *
   * Tanpa tombol ini, tabel dari server yang "versi"-nya lebih tinggi terpasang
   * lagi setiap aplikasi dibuka dan tidak bisa dikalahkan tabel bawaan APK —
   * satu-satunya cara keluar adalah menghapus seluruh data aplikasi lewat
   * setelan Android, ikut menghapus chapter tersimpan dan posisi bacanya.
   */
  const kembalikanBawaan = async () => {
    setMemulihkanPola(true);
    const keadaan = await kembalikanTabelBawaan();
    let daftar = TANPA_HOST;
    try {
      daftar = await daftarHost();
    } catch {
      /* mesinnya sudah gagal dimuat sejak awal; peringatannya sudah tampil */
    }
    // Kartu yang sedang tampil dibaca dengan tabel yang baru saja dicabut, jadi
    // simpanannya ikut dibuang — efek pemuatan di atas mengambilnya lagi.
    simpananEtalase.clear();
    setEtalase({});
    setHostTersedia(daftar);
    setPola(keadaan);
    setMemulihkanPola(false);
  };

  const daftarTampil = useMemo(() => {
    const sumberIni = (host) => sumberDipilih === 'semua' || host === sumberDipilih;

    if (cari) {
      return Object.entries(cari.perHost)
        .filter(([host]) => sumberIni(host))
        .flatMap(([host, keadaan]) => (keadaan.items ?? []).map((item) => ({ ...item, host: host })));
    }
    return hostKatalog
      .filter((host) => sumberIni(host))
      .flatMap((host) => (etalase[host]?.items ?? []).map((item) => ({ ...item, host: host })));
  }, [cari, etalase, hostKatalog, sumberDipilih]);

  // Tabel pola yang belum siap DIHITUNG sebagai sedang memuat. Tanpa itu,
  // hostKatalog masih kosong sehingga tidak ada satu pun host yang berstatus
  // memuat, dan layar menuduh "Situs sumber tidak bisa dihubungi dari HP ini"
  // sebelum satu permintaan pun dikirim — sampai beberapa detik kalau
  // siapkanPola() sedang menunggu server rumah yang mati. Spinner-nya sudah ada
  // di bawah dan mengambil alih sendiri.
  const sedangMemuat =
    pola == null ||
    (cari ? sedangCari : hostKatalog.length > 0 && hostKatalog.some((host) => etalase[host]?.memuat));

  const kabar = useMemo(() => {
    const sumberKeadaan = cari ? cari.perHost : etalase;
    return Object.entries(sumberKeadaan)
      .flatMap(([host, keadaan]) => [
        keadaan?.galat ? { host: host, pesan: keadaan.galat, jenis: 'galat' } : null,
        keadaan?.warning ? { host: host, pesan: keadaan.warning, jenis: 'warning' } : null,
      ])
      .filter(Boolean);
  }, [cari, etalase]);

  const jumlahPerHost = (host) =>
    cari ? (cari.perHost[host]?.items?.length ?? 0) : (etalase[host]?.items?.length ?? 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="section-title">
            <span aria-hidden="true">🌐</span> Situs Sumber
          </h1>
          <p className="text-xs text-night/50 dark:text-paper/50">
            Dibaca langsung dari situsnya oleh HP ini — server rumah tidak ikut campur.
            {pola && ` Pola v${pola.versi} (${pola.asal}).`}
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center justify-end gap-2">
          {/* Hanya tampil kalau memang ada yang bisa dikembalikan. */}
          {pola && pola.asal !== 'bawaan' && (
            <button
              type="button"
              className="btn-ghost px-3 py-1 text-xs"
              onClick={kembalikanBawaan}
              disabled={memulihkanPola}
            >
              {memulihkanPola ? 'Memulihkan…' : 'Kembalikan tabel bawaan'}
            </button>
          )}
          {!cari && (
            <button
              type="button"
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => hostKatalog.forEach((host) => muatSatu(host))}
              disabled={sedangMemuat}
            >
              {sedangMemuat ? 'Memuat…' : 'Muat ulang'}
            </button>
          )}
        </div>
      </header>

      {/* Peringatan tabel pola berdiri sendiri, di atas segalanya: kalau tabel
          dari server ditolak, SEMUA yang di bawah ini dibaca dengan selector
          lama, dan itu penjelasan yang dibutuhkan lebih dulu. */}
      {pola?.peringatan?.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-danger/40 bg-danger/5 px-4 py-2 text-xs leading-relaxed">
          {/* Key berbasis urutan, bukan isi pesan: daftar ini hanya bertambah
              dan tidak pernah diurutkan ulang, sementara dua pesan yang PERSIS
              sama memang mungkin (tabel simpanan dan tabel server sama-sama
              ditolak karena alasan yang sama), dan key kembar membuat React
              menampilkan salah satunya saja. */}
          {pola.peringatan.map((pesan, urutan) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={urutan}>{pesan}</li>
          ))}
        </ul>
      )}

      <form className="flex gap-2" onSubmit={jalankanCari}>
        <input
          className="input flex-1"
          value={kata}
          onChange={(event) => setKata(event.target.value)}
          placeholder="Cari judul di situs sumber…"
          maxLength={CARI_MAKS}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="btn-accent flex-none px-4"
          disabled={!pola || kata.trim().length < CARI_MIN || sedangCari}
        >
          {sedangCari ? 'Mencari…' : 'Cari'}
        </button>
        {cari && (
          <button type="button" className="btn-ghost flex-none px-3" onClick={tutupCari}>
            Tutup
          </button>
        )}
      </form>

      {cari && (
        <p className="break-words text-xs text-night/50 dark:text-paper/50">
          Hasil untuk “{cari.kata}”
          {cari.tidakDidukung.length > 0 && (
            <>
              {' · '}
              pencarian {cari.tidakDidukung.map((host) => labelSumber(host)).join(', ')} belum didukung —
              judul dari situs itu tetap muncul di etalase saat sedang update
            </>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mikro">Sumber</span>
        <Chip aktif={sumberDipilih === 'semua'} onClick={() => setSumberDipilih('semua')}>
          Semua
          <span className="ml-1.5 opacity-60">{daftarTampil.length}</span>
        </Chip>
        {(cari ? hostCari : hostKatalog).map((host) => {
          const keadaan = cari ? cari.perHost[host] : etalase[host];
          return (
            <Chip key={host} aktif={sumberDipilih === host} onClick={() => setSumberDipilih(host)}>
              {keadaan?.galat && (
                <span aria-label="ada galat" className="mr-1 text-danger">
                  !
                </span>
              )}
              {labelSumber(host)}
              <span className="ml-1.5 opacity-60">{jumlahPerHost(host)}</span>
            </Chip>
          );
        })}
      </div>

      {/* Kabar per situs, bukan satu galat untuk seluruh halaman. Tanpa ini,
          "0 judul" dari situs yang sedang mati terbaca sama persis dengan
          situs yang memang tidak punya judul itu. */}
      {kabar.length > 0 && (
        <ul className="space-y-1 break-words rounded-xl border border-danger/40 bg-danger/5 px-4 py-2 text-xs leading-relaxed text-night/70 dark:text-paper/70">
          {kabar.map((satu) => (
            <BarisKabar key={`${satu.host}-${satu.jenis}`} {...satu} />
          ))}
        </ul>
      )}

      {sedangMemuat && daftarTampil.length === 0 && (
        <Spinner label={cari ? 'Mencari di situs sumber…' : 'Membaca etalase situs sumber…'} />
      )}

      {!sedangMemuat && daftarTampil.length === 0 && (
        <EmptyState
          icon={cari ? '🔍' : '📡'}
          title={cari ? 'Tidak ditemukan di situs sumber' : 'Belum ada yang terbaca'}
          description={
            cari
              ? 'Coba ejaan lain, judul alternatifnya (Inggris atau romaji), atau kata yang lebih pendek.'
              : 'Situs sumber tidak bisa dihubungi dari HP ini. Cek koneksi, lalu muat ulang.'
          }
        />
      )}

      {daftarTampil.length > 0 && (
        <div className="grid-komik">
          {daftarTampil.map((item) => (
            <KartuSumber key={`${item.host}|${item.seriesUrl}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Sumber;

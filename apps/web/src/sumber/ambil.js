import tabelBawaan from '@naruread/sumber/selectors.js';
import { ASLI_NATIF } from '../platform/index.js';

/**
 * Lapisan jaringan aplikasi ke situs sumber — tanpa server rumah sama sekali.
 *
 * Padanannya di server adalah apps/api/src/utils/httpClient.js, dan sopan
 * santunnya ditiru baris demi baris: robots.txt, jeda antar permintaan ke host
 * yang sama, User-Agent yang menyebut diri, batas waktu, satu kali coba ulang,
 * dan pengalihan yang diikuti SENDIRI dengan pemeriksaan tiap lompatan.
 * Yang TIDAK ditiru adalah kodenya — berkas itu memakai p-limit dan konfigurasi
 * berbasis process.env, dua hal yang tidak ada di WebView.
 *
 * Tiga hal yang membentuk seluruh berkas ini:
 *
 * 1. Situs sumber tidak mengirim satu pun header CORS, jadi `fetch` dari origin
 *    WebView boleh mengirim permintaannya tapi tidak pernah boleh MEMBACA
 *    jawabannya. CapacitorHttp menjalankan permintaannya di sisi Java, di luar
 *    jangkauan aturan asal-usul browser, dan itulah satu-satunya alasan
 *    penjelajahan langsung ini mungkin di HP.
 * 2. Build android tetap harus bisa dibuka di browser desktop untuk diperiksa,
 *    dan di sana CapacitorHttp tidak ada. Jadi jalur `fetch` biasa dipertahankan
 *    di belakang ASLI_NATIF — ia akan kandas pada CORS untuk situs sungguhan,
 *    tapi seluruh alur di atasnya (antrean, robots, penguraian) tetap bisa diuji.
 * 3. Yang dihubungi HANYA host yang sudah ada di tabel bawaan APK. Tabel pola
 *    boleh diperbarui dari server rumah (lihat pola.js), dan tabel yang disusupi
 *    adalah cara paling murah untuk menyuruh HP orang lain menembaki mesin yang
 *    bukan situs komik. Daftar host di bawah sengaja dibaca dari selectors.js
 *    yang ikut dibundel, bukan dari tabel yang sedang aktif.
 */

/** Batas waktu satu permintaan. Halaman HTML situs komik jarang lewat 5 detik;
 *  15 detik memberi ruang untuk jaringan seluler yang buruk tanpa membuat layar
 *  "Memuat…" terasa menggantung selamanya. */
const BATAS_WAKTU_MS = 15_000;

/** Jeda minimum antar permintaan ke host yang SAMA. Server rumah memakai 750 ms;
 *  di sini dinaikkan karena yang mengetuk adalah alamat IP rumahan milik satu
 *  orang, bukan server yang sudah lama dikenal situsnya. */
const JEDA_HOST_MS = 1200;

/** Jeda tambahan sebelum percobaan kedua, supaya kegagalan sesaat (ganti menara
 *  seluler, Wi-Fi yang baru pulih) punya waktu untuk benar-benar lewat. */
const JEDA_ULANG_MS = 1500;

/** Sama dengan httpClient.js di server. Lima sudah jauh lebih banyak daripada
 *  yang dipakai situs komik sungguhan (biasanya satu: http→https atau
 *  tanpa-www→www), dan cukup rendah untuk menghentikan rantai yang memutar. */
const MAKS_LOMPATAN = 5;

/**
 * Menyebut diri apa adanya, lengkap dengan alamat proyeknya, supaya pemilik
 * situs yang melihat log punya sesuatu untuk dicari dan seseorang untuk dihubungi.
 *
 * Catatan jujur: di browser desktop header ini TIDAK terpasang — User-Agent ada
 * di daftar header terlarang milik fetch dan diam-diam dibuang. Di perangkat
 * sungguhan, tempat jalur ini benar-benar dipakai, CapacitorHttp memasangnya.
 */
const USER_AGENT = 'NaruReader-App/0.1 (+pembaca komik pribadi; https://github.com/EigaCerion/comic)';

/** Umur cache robots.txt. Sama dengan server (30 menit) — hanya saja di HP satu
 *  "sesi" jarang sepanjang itu, jadi praktisnya sekali per host per pembukaan. */
const UMUR_ROBOTS_MS = 30 * 60 * 1000;

/**
 * Galat yang membawa status HTTP-nya.
 *
 * Alasannya ada di layar: "situs sedang mati" (5xx, atau tidak ada jawaban sama
 * sekali) dan "halamannya sudah dihapus" (404) menuntut dua kalimat yang
 * berbeda dari pemanggil, dan tanpa angka ini keduanya sampai sebagai satu
 * string yang sama-sama berbunyi "gagal memuat".
 *
 * `tungguMs` diisi dari header Retry-After kalau situsnya menyebutkan berapa
 * lama ia minta dijauhi. Layar Sumber memakainya untuk menentukan berapa lama
 * kegagalan itu diingat, supaya host yang baru saja menjawab 429 tidak diketuk
 * ulang setiap kali layarnya dipasang lagi.
 */
export class GalatSumber extends Error {
  constructor(pesan, { status = null, kode = 'jaringan', url = null, tungguMs = null } = {}) {
    super(pesan);
    this.name = 'GalatSumber';
    /** Status HTTP sebenarnya, atau null kalau jawabannya tidak pernah datang. */
    this.status = status;
    /** 'http' | 'jaringan' | 'robots' | 'host-asing' | 'pengalihan' | 'pola' */
    this.kode = kode;
    this.url = url;
    /** Berapa lama situsnya minta dijauhi (ms), kalau ia menyebutkannya. */
    this.tungguMs = tungguMs;
  }
}

const tidur = (ms) => new Promise((selesai) => setTimeout(selesai, ms));

const normalHost = (host) => String(host ?? '').toLowerCase().replace(/^www\./, '');

const domainInduk = (host) => normalHost(host).split('.').slice(-2).join('.');

// ── Mesin sumber, dimuat saat benar-benar dipakai ─────────────────────────

let mesin = null;

/**
 * Pintu satu-satunya ke @naruread/sumber, dan sengaja lewat import() alih-alih
 * import statis di puncak berkas.
 *
 * Alasannya khusus bundel ANDROID, bukan bundel web — di web seluruh modul ini
 * memang sudah terbuang utuh oleh Rollup karena tidak ada yang memakainya.
 * Terukur di dist-android: import statis membuat cheerio/htmlparser2 (~250 kB
 * setelah minify) mendarat di chunk entry, yaitu chunk yang diurai dan
 * dieksekusi pada SETIAP start dingin. Orang yang cuma membaca chapter yang
 * sudah tersimpan di HP membayar seluruh mesin penguraian HTML itu tanpa pernah
 * membuka layar Sumber. Lewat import(), ia jatuh ke chunk tersendiri yang baru
 * diambil saat layar Sumber benar-benar bekerja.
 *
 * Polanya sama persis dengan @capacitor/core di http() di bawah.
 */
const mesinSumber = async () => {
  if (!mesin) mesin = await import('@naruread/sumber');
  return mesin;
};

/**
 * Host yang punya etalase dan host yang punya pencarian, dibaca lewat pintu
 * malas yang sama. Layar Sumber memanggilnya SESUDAH siapkanPola() selesai —
 * keduanya memang sudah menunggu promise itu, jadi tidak ada penungguan baru
 * yang ditambahkan ke jalur layar.
 */
export const daftarHost = async () => {
  const { daftarHostKatalog, daftarHostCari } = await mesinSumber();
  return { katalog: daftarHostKatalog(), cari: daftarHostCari() };
};

/**
 * Host yang boleh dihubungi — dari tabel BAWAAN, bukan dari tabel aktif:
 * pola.js boleh memasang tabel dari server rumah, dan tabel itu datang lewat
 * jaringan.
 *
 * Dihitung saat pertama dipakai, bukan di puncak berkas, dan itu BUKAN soal
 * kecepatan. `new Set(...)` di tingkat modul dianggap Rollup sebagai efek
 * samping, sehingga ia tidak boleh dibuang — dan satu baris itu saja cukup
 * untuk menyeret seluruh tabel pola (dan lewatnya, cheerio) ke dalam bundel WEB
 * yang tidak pernah memakai satu pun di antaranya. Terukur: 255 kB turun jadi
 * 177 kB begitu perhitungannya dipindahkan ke dalam fungsi.
 */
let hostSah = null;
const daftarHostSah = () => {
  if (!hostSah) hostSah = new Set(Object.keys(tabelBawaan.hosts ?? {}).map(normalHost));
  return hostSah;
};

/**
 * Subdomain diterima selama domain induknya terdaftar: komiku memakai
 * api.komiku.org untuk pencarian dan ngomik merotasi 02.ngomik.cc, dan keduanya
 * sah. Yang ditolak adalah domain yang sama sekali lain.
 */
const bolehDihubungi = (urlTeks) => {
  let target;
  try {
    target = new URL(urlTeks);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  const sah = daftarHostSah();
  const host = normalHost(target.hostname);
  return sah.has(host) || sah.has(domainInduk(host));
};

const wajibSah = (urlTeks, konteks) => {
  if (bolehDihubungi(urlTeks)) return;
  throw new GalatSumber(
    `${konteks} menunjuk ke ${urlTeks} yang tidak ada di daftar situs bawaan aplikasi. ` +
      'Permintaan tidak dikirim — tabel pola yang memuat alamat asing tidak boleh ' +
      'membuat aplikasi ini menghubungi mesin lain.',
    { kode: 'host-asing', url: urlTeks },
  );
};

// ── Antrean per host ──────────────────────────────────────────────────────

/*
 * Satu permintaan pada satu waktu per host, dengan jeda di antaranya.
 *
 * Bukan sekadar "jangan terlalu cepat": halaman etalase enam situs yang dibuka
 * bersamaan dari satu HP terlihat persis seperti pemindai di sisi situs, dan
 * yang paling mungkin terjadi bukan teguran melainkan alamat IP rumah orangnya
 * masuk daftar blokir. Antar host tetap boleh berbarengan — itu enam mesin yang
 * berbeda, masing-masing hanya melihat satu permintaan tenang.
 */
const antrean = new Map(); // host -> promise terakhir di rantai
const terakhirPada = new Map(); // host -> Date.now() permintaan terakhir selesai

const bergiliran = (host, kerja) => {
  const sebelumnya = antrean.get(host) ?? Promise.resolve();

  const giliran = sebelumnya.then(async () => {
    const jeda = JEDA_HOST_MS - (Date.now() - (terakhirPada.get(host) ?? 0));
    if (jeda > 0) await tidur(jeda);
    try {
      return await kerja();
    } finally {
      // Dicatat SESUDAH selesai, bukan sebelum mulai: permintaan yang memakan
      // 8 detik sudah memberi situsnya jeda lebih dari cukup, dan menghitung
      // dari waktu mulai justru menumpuk dua permintaan di ujungnya.
      terakhirPada.set(host, Date.now());
    }
  });

  // Rantainya tidak boleh putus karena satu kegagalan — kalau `giliran` yang
  // ditolak dipasang sebagai ekor, permintaan berikutnya ikut ditolak tanpa
  // pernah dikirim, dan satu situs mati akan terlihat seperti situs yang
  // menolak semua permintaan berikutnya selamanya.
  antrean.set(
    host,
    giliran.then(
      () => {},
      () => {},
    ),
  );
  return giliran;
};

// ── Permintaan mentah ─────────────────────────────────────────────────────

let modulHttp = null;

/**
 * CapacitorHttp diambil lewat import(), bukan import statis di puncak berkas.
 *
 * Aturannya sudah tertulis di platform/index.js dan berlaku penuh di sini: satu
 * import statis @capacitor/core cukup untuk menyeretnya ke bundel web yang tidak
 * pernah memakainya. Berkas ini memang hanya dirujuk dari cabang IS_APP, tapi
 * jaring pengaman itu hanya berlaku selama tidak ada yang lupa — dan yang
 * membayar kelupaan itu adalah setiap pembaca di desktop.
 */
const http = async () => {
  if (!modulHttp) {
    const modul = await import('@capacitor/core');
    modulHttp = { CapacitorHttp: modul.CapacitorHttp };
  }
  return modulHttp;
};

/**
 * Satu header, tanpa membedakan huruf besar-kecil.
 *
 * Wajib: jembatan native membangun objek headernya dari
 * connection.getHeaderFields(), jadi kapitalisasinya mengikuti apa yang
 * dikirim server apa adanya — 'Location', 'location', dan 'LOCATION' sama-sama
 * mungkin dari situs yang berbeda. `headers.Location` akan benar untuk sebagian
 * situs dan diam-diam salah untuk sisanya, yang di sini berarti pengalihan
 * tidak terbaca sama sekali.
 */
const nilaiHeader = (headers, nama) => {
  if (!headers) return null;
  // Objek Headers milik fetch sudah tidak membedakan huruf besar-kecil sendiri.
  if (typeof headers.get === 'function') return headers.get(nama);
  const kunci = Object.keys(headers).find((k) => k.toLowerCase() === nama);
  return kunci ? headers[kunci] : null;
};

/**
 * Retry-After boleh berupa jumlah detik ATAU tanggal HTTP, dan keduanya benar
 * dipakai situs sungguhan. Dikembalikan dalam milidetik, atau null kalau
 * headernya tidak ada / tidak terbaca.
 */
const jedaDiminta = (headers) => {
  const nilai = nilaiHeader(headers, 'retry-after');
  if (nilai == null || String(nilai).trim() === '') return null;
  const teks = String(nilai).trim();
  const detik = Number(teks);
  if (Number.isFinite(detik)) return Math.max(0, detik * 1000);
  const waktu = Date.parse(teks);
  return Number.isFinite(waktu) ? Math.max(0, waktu - Date.now()) : null;
};

/**
 * Satu permintaan GET, TANPA mengikuti pengalihan. Mengembalikan status apa
 * adanya — 404, 302, dan 503 BUKAN lemparan di sini, karena yang memutuskan
 * artinya adalah pemanggil di atasnya. Yang dilempar hanya kegagalan yang tidak
 * punya status sama sekali.
 */
const permintaan = async (url, { accept, batasMs }) => {
  const asal = new URL(url);
  const kepala = {
    'User-Agent': USER_AGENT,
    Accept: accept,
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    // Sebagian situs komik menolak permintaan tanpa Referer, menganggapnya
    // pengikis. Merujuk ke beranda situsnya sendiri adalah yang paling jujur:
    // itu memang dari mana pembaca biasa akan datang.
    Referer: `${asal.protocol}//${asal.host}/`,
  };

  if (ASLI_NATIF) {
    const { CapacitorHttp } = await http();
    let jawab;
    try {
      jawab = await CapacitorHttp.get({
        url,
        headers: kepala,
        connectTimeout: batasMs,
        readTimeout: batasMs,
        responseType: 'text',
        // Diterjemahkan jembatan jadi setInstanceFollowRedirects(false). Tanpa
        // ini HttpURLConnection mengikuti pengalihan sendiri — sampai 20
        // lompatan — dan seluruh badan jawabannya sudah terunduh sebelum satu
        // pun pemeriksaan daftar host sempat berjalan. Lihat ambilDenganPengalihan.
        disableRedirects: true,
      });
    } catch (error) {
      // Jembatan native melempar untuk kegagalan soket DAN, pada sebagian versi,
      // untuk status di luar 2xx. Statusnya diselamatkan kalau ada supaya
      // "chapter hilang" tidak terlanjur dilaporkan sebagai "situs mati".
      const status = Number(error?.status ?? error?.response?.status);
      if (Number.isFinite(status) && status > 0) {
        return {
          status,
          teks: String(error?.data ?? error?.response?.data ?? ''),
          headers: error?.headers ?? error?.response?.headers ?? null,
        };
      }
      throw new GalatSumber(error?.message || 'Permintaan gagal dikirim', { url });
    }
    // responseType 'text' TIDAK dihormati jembatan native untuk jawaban
    // ber-Content-Type application/json: HttpRequestHandler.readData()
    // mengembalikan hasil parse-nya (komentarnya sendiri: "backward
    // compatibility"), jadi yang tiba di sini objek, bukan string. String(objek)
    // menghasilkan '[object Object]', cheerio menguraikannya tanpa mengeluh, dan
    // yang terbaca nol kartu — lalu extractKatalog menuduh tabel selector
    // "situs mengganti tema". Isinya diselamatkan apa adanya lewat stringify,
    // dan kasusnya ditandai supaya kegagalan angkut tidak pernah lagi menyamar
    // sebagai kegagalan selector (lihat ambilHtml).
    const bukanTeks = jawab != null && jawab.data != null && typeof jawab.data !== 'string';
    return {
      status: Number(jawab?.status) || 0,
      teks: bukanTeks ? JSON.stringify(jawab.data) : (jawab?.data ?? ''),
      headers: jawab?.headers ?? null,
      bukanTeks,
    };
  }

  // Jalur browser desktop. Untuk situs sungguhan ini akan berhenti di CORS, dan
  // itu memang tidak bisa diperbaiki dari sini — yang tetap berguna adalah
  // seluruh alur di sekelilingnya bisa dijalankan tanpa perangkat Android.
  let jawab;
  try {
    jawab = await fetch(url, {
      headers: { Accept: accept },
      redirect: 'manual',
      signal: AbortSignal.timeout(batasMs),
    });
  } catch (error) {
    const sebab =
      error?.name === 'TimeoutError'
        ? `tidak ada jawaban dalam ${Math.round(batasMs / 1000)} detik`
        : (error?.message ?? 'permintaan gagal');
    throw new GalatSumber(sebab, { url });
  }
  // Di dalam browser, redirect: 'manual' menghasilkan jawaban "opaqueredirect":
  // status 0, tanpa header, tanpa badan. Tujuannya benar-benar tidak bisa
  // dibaca dari sana, jadi ditandai di sini dan ditolak dengan jujur di atas —
  // bukan ditebak. Di Node (uji fixture) dan di jembatan native, headernya utuh.
  const buta = jawab.type === 'opaqueredirect';
  return {
    status: jawab.status,
    teks: buta ? '' : await jawab.text(),
    headers: jawab.headers,
    buta,
  };
};

// ── robots.txt ────────────────────────────────────────────────────────────

/** Parser minimal, sama cakupannya dengan milik server: hanya Disallow/Allow. */
const uraikanRobots = (teks) => {
  const grup = [];
  let kini = null;

  teks.split(/\r?\n/).forEach((baris) => {
    const bersih = baris.split('#')[0].trim();
    if (!bersih) return;
    const [kunciMentah, ...sisa] = bersih.split(':');
    const kunci = kunciMentah.trim().toLowerCase();
    const nilai = sisa.join(':').trim();

    if (kunci === 'user-agent') {
      if (!kini || kini.aturan.length > 0) {
        kini = { agen: [], aturan: [] };
        grup.push(kini);
      }
      kini.agen.push(nilai.toLowerCase());
    } else if ((kunci === 'disallow' || kunci === 'allow') && kini) {
      kini.aturan.push({ boleh: kunci === 'allow', jalur: nilai });
    }
  });

  return grup;
};

/**
 * Pencocokan satu baris Disallow/Allow. Hanya '*' yang punya arti khusus;
 * seluruh sisanya literal — termasuk '?', dan itu bukan soal kerapian.
 *
 * Alamat pencarian milestone ini berbentuk /?s=kata (selectors.js: ngomik.cc,
 * komikindo.ch), sementara `Disallow: /?s=` adalah baris baku yang dipasang
 * Yoast/RankMath di hampir setiap WordPress. Tanpa di-escape, '/?s=' dibaca
 * regex sebagai "garis miring OPSIONAL lalu s=" — tidak pernah cocok dengan
 * /?s=naruto — sehingga situs yang MELARANG halaman pencariannya justru tetap
 * ditembaki dari setiap HP. Salahnya ke dua arah: `Disallow: /?` menghasilkan
 * '^/?' yang cocok dengan SEMUA jalur dan memblokir seluruh host.
 */
const jalurCocok = (pola, jalur) => {
  if (pola === '') return false;
  const regex = pola.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${regex}`).test(jalur);
  } catch {
    // Satu baris robots.txt yang cacat tidak boleh mematikan seluruh host.
    // Lemparan dari sini tidak berhenti di mana pun sampai ambilHtml, dan yang
    // sampai ke layar adalah pesan yang bahkan tidak menyebut robots — untuk
    // setiap permintaan ke host itu, selama isi robots.txt-nya masih sama.
    return false;
  }
};

const simpananRobots = new Map(); // host -> { janji, pada }

/**
 * Sekali per host per sesi, lalu dipakai ulang.
 *
 * Yang di-cache adalah PROMISE-nya, bukan hasilnya: enam kartu etalase dari
 * satu situs berangkat hampir bersamaan, dan menyimpan hasil saja berarti enam
 * pengambilan robots.txt serentak sebelum yang pertama sempat selesai — persis
 * kebalikan dari maksud berkas ini.
 */
const aturanRobots = (asal) => {
  const tersimpan = simpananRobots.get(asal.host);
  if (tersimpan && Date.now() - tersimpan.pada < UMUR_ROBOTS_MS) return tersimpan.janji;

  // Pengalihan robots.txt ikut diikuti (banyak situs memindahkannya ke www atau
  // ke https), tapi TANPA memeriksa robots lagi — itu akan memanggil dirinya
  // sendiri tanpa ujung. Mengambil robots.txt memang selalu boleh.
  const janji = ambilDenganPengalihan(`${asal.protocol}//${asal.host}/robots.txt`, {
    accept: 'text/plain',
    batasMs: 8000,
    hormatiRobots: false,
  })
    .then((jawab) => (jawab.status >= 200 && jawab.status < 300 ? uraikanRobots(jawab.teks) : []))
    .catch(() => {
      // Tidak terbaca bukan berarti terlarang. Situs tanpa robots.txt, dan
      // jaringan yang sedang buruk, sama-sama sampai di sini — memperlakukannya
      // sebagai larangan akan mematikan penjelajahan untuk alasan yang salah.
      // Server rumah memutuskan hal yang sama di tempat yang sama.
      return [];
    });

  simpananRobots.set(asal.host, { janji, pada: Date.now() });
  return janji;
};

const izinRobots = async (urlTeks) => {
  const target = new URL(urlTeks);
  const grup = await aturanRobots(target);
  if (grup.length === 0) return null;

  const ua = USER_AGENT.toLowerCase();
  const dipakai =
    grup.find((g) => g.agen.some((agen) => agen !== '*' && ua.includes(agen))) ??
    grup.find((g) => g.agen.includes('*'));
  if (!dipakai) return null;

  const jalur = target.pathname + target.search;
  const cocok = dipakai.aturan
    .filter((aturan) => jalurCocok(aturan.jalur, jalur))
    .sort((a, b) => b.jalur.length - a.jalur.length)[0];

  if (cocok && !cocok.boleh) {
    return `robots.txt ${target.host} melarang ${jalur} (Disallow: ${cocok.jalur})`;
  }
  return null;
};

// ── Pengalihan, diikuti sendiri ───────────────────────────────────────────

/**
 * Satu permintaan, pengalihannya diikuti SENDIRI, dan setiap tujuan diperiksa
 * SEBELUM satu byte pun diambil darinya.
 *
 * Versi sebelumnya membiarkan pengalihan diikuti otomatis (redirect: 'follow'
 * di browser, dan HttpURLConnection yang mengikutinya sendiri di HP) lalu
 * memeriksa `urlAkhir` sesudahnya. Itu terlambat dua kali:
 *
 * 1. Badan jawabannya sudah terunduh utuh saat pemeriksaan berjalan. Satu situs
 *    sumber yang disusupi — atau domain sumber yang kedaluwarsa dan kini
 *    menunjuk mesin lain — cukup membalas 302 untuk membuat setiap HP yang
 *    membuka layar Sumber benar-benar menembak alamat pilihan penyerang, dengan
 *    alamat IP rumah pemiliknya dan Referer yang menyebut situs sumbernya.
 * 2. Di perangkat, `urlAkhir` itu sendiri tidak bisa dipercaya. Ia berasal dari
 *    HttpResponse.url, yang diisi jembatan dari connection.getURL() — javadoc-nya
 *    sendiri menyebutnya "the value of this URLConnection's URL field", yaitu URL
 *    PERMINTAAN, dan HttpURLConnection berbasis okhttp tidak menjamin field itu
 *    diperbarui sesudah pengalihan. Kalau tidak diperbarui, pemeriksaannya lolos
 *    dan isi dari host asing diurai sebagai katalog. Jalur fetch desktop mengisi
 *    `url` dengan benar, jadi kegagalan itu HANYA muncul di HP dan tidak akan
 *    pernah terlihat saat build android diperiksa di laptop.
 *
 * Sekarang alamat akhir adalah alamat yang kita sendiri putuskan untuk diminta,
 * bukan yang dilaporkan pihak lain. Kembarannya di server sudah lebih dulu
 * meninggalkan pola ikuti-lalu-periksa: httpClient.js menyebutnya "lubang SSRF
 * yang terbukti".
 */
const ambilDenganPengalihan = async (urlAwal, { accept, batasMs, hormatiRobots = true }) => {
  let alamatKini = urlAwal;

  for (let lompatan = 0; ; lompatan += 1) {
    wajibSah(alamatKini, lompatan === 0 ? 'Alamat yang diminta' : 'Pengalihan dari situs sumber');

    if (hormatiRobots) {
      // Tiap host punya robots.txt sendiri, jadi tujuan pengalihan ikut
      // ditanyakan. Sebelumnya hanya URL awal yang diperiksa, sehingga situs
      // yang melarang sebuah jalur tetap ditembaki lewat pengalihan.
      const larangan = await izinRobots(alamatKini);
      if (larangan) throw new GalatSumber(larangan, { kode: 'robots', url: alamatKini });
    }

    const alamatPermintaan = alamatKini;
    const jawab = await bergiliran(new URL(alamatPermintaan).host, () =>
      permintaan(alamatPermintaan, { accept, batasMs }),
    );

    const lokasi =
      jawab.status >= 300 && jawab.status < 400 ? nilaiHeader(jawab.headers, 'location') : null;

    if (!lokasi) {
      if (jawab.buta) {
        throw new GalatSumber(
          `${alamatPermintaan} membalas dengan pengalihan yang tujuannya tidak bisa dibaca dari ` +
            'browser desktop. Di perangkat Android jalur ini memakai jembatan native dan tujuannya terbaca.',
          { kode: 'pengalihan', url: alamatPermintaan },
        );
      }
      return { ...jawab, urlAkhir: alamatPermintaan };
    }

    if (lompatan >= MAKS_LOMPATAN) {
      throw new GalatSumber(`Terlalu banyak pengalihan (${MAKS_LOMPATAN}) mulai dari ${urlAwal}`, {
        kode: 'pengalihan',
        url: urlAwal,
      });
    }

    let tujuan;
    try {
      tujuan = new URL(lokasi, alamatPermintaan);
    } catch {
      throw new GalatSumber(`Pengalihan dari ${alamatPermintaan} menyebut alamat yang tidak terbaca (${lokasi})`, {
        kode: 'pengalihan',
        url: alamatPermintaan,
      });
    }
    alamatKini = tujuan.toString();
  }
};

// ── Pengambilan HTML ──────────────────────────────────────────────────────

/**
 * Kegagalan yang pantas dicoba sekali lagi: belum ada jawaban, atau gerbangnya
 * yang tumbang.
 *
 * 429 sengaja TIDAK ada di sini lagi. Mengulang permintaan ke situs yang baru
 * saja bilang "terlalu banyak permintaan" adalah persis hal yang dimintanya
 * untuk tidak dilakukan, dan satu kunjungan ke host yang sedang membatasi laju
 * berharga dua permintaan alih-alih satu. Yang menggantikannya: statusnya
 * dibawa ke layar bersama Retry-After, dan layar Sumber mengingat kegagalan itu
 * supaya host tersebut tidak diketuk ulang tiap kali layarnya dipasang lagi.
 */
const layakDiulang = (status) => status === null || (status >= 500 && status <= 599);

/**
 * Lemparan yang pantas dicoba lagi hanyalah kegagalan jaringan. Penolakan
 * robots, host di luar daftar, dan rantai pengalihan yang cacat akan menjawab
 * hal yang sama persis untuk kedua kalinya — mengulangnya hanya menunda pesan
 * galatnya 1,5 detik.
 */
const pantasDiulang = (galat, status) => (galat ? galat.kode === 'jaringan' : layakDiulang(status));

const jelaskanStatus = (status, url) => {
  if (status === 404 || status === 410) return `Halaman tidak ada lagi di situs sumber (HTTP ${status})`;
  if (status === 403 || status === 503) {
    return `HTTP ${status} dari ${new URL(url).host} — kemungkinan diblokir penjaga bot; halaman ini perlu dibuka lewat peramban`;
  }
  if (status === 429) return `HTTP 429 — terlalu banyak permintaan ke ${new URL(url).host}, tunggu sebentar`;
  if (status >= 500) return `Situs sumber sedang bermasalah (HTTP ${status})`;
  return `HTTP ${status} untuk ${url}`;
};

/**
 * Ambil satu halaman HTML dari situs sumber.
 *
 * @param {string} url
 * @param {{ batasMs?: number }} [opsi]
 * @returns {Promise<{ html: string, urlAkhir: string, status: number }>}
 * @throws {GalatSumber} `.status` memuat status HTTP sebenarnya kalau ada
 */
export const ambilHtml = async (url, { batasMs = BATAS_WAKTU_MS } = {}) => {
  const sekali = () =>
    ambilDenganPengalihan(url, { accept: 'text/html,application/xhtml+xml', batasMs });

  let jawab = null;
  let galat = null;
  try {
    jawab = await sekali();
  } catch (error) {
    galat = error;
  }

  // Tepat satu kali ulang. Dua atau tiga terdengar lebih gigih, tapi yang
  // sebenarnya terjadi saat sebuah situs sedang tumbang adalah HP mengetuk
  // pintu yang sama berkali-kali lebih lama — sementara orangnya menunggu layar
  // yang tidak bergerak.
  if (pantasDiulang(galat, jawab?.status ?? null)) {
    await tidur(JEDA_ULANG_MS);
    try {
      jawab = await sekali();
      galat = null;
    } catch (error) {
      galat = error;
    }
  }

  if (galat) throw galat;

  if (jawab.status < 200 || jawab.status >= 300) {
    throw new GalatSumber(jelaskanStatus(jawab.status, url), {
      status: jawab.status,
      kode: 'http',
      url,
      // Situs yang menyebut berapa lama ia minta dijauhi dipercaya. Yang
      // memakainya adalah layar Sumber, untuk menentukan umur ingatan
      // kegagalannya.
      tungguMs: jedaDiminta(jawab.headers),
    });
  }

  // Jawaban yang datang sebagai objek JSON (lihat permintaan()) disebut apa
  // adanya di sini. Kalau dibiarkan lewat, yang muncul di layar adalah tuduhan
  // terhadap tabel selector — pesan yang mengirim pemeliharanya membenahi
  // selectors.js untuk kerusakan yang sama sekali bukan di sana.
  if (jawab.bukanTeks) {
    throw new GalatSumber(
      `Jawaban dari ${new URL(url).host} bukan HTML (Content-Type JSON) — bukan selectornya yang salah`,
      { status: jawab.status, url },
    );
  }

  return { html: jawab.teks, urlAkhir: jawab.urlAkhir, status: jawab.status };
};

// ── Pembungkus per jenis halaman ──────────────────────────────────────────

/*
 * Tiga fungsi di bawah adalah satu-satunya tempat alamat halaman DIBANGUN dari
 * tabel pola. Dipusatkan di sini, bukan di layar, karena dua layar yang
 * membangun alamatnya sendiri-sendiri akan berbeda diam-diam begitu salah satu
 * diperbaiki — dan karena milestone unduhan berikutnya butuh pintu yang sama
 * persis untuk halaman chapter.
 */

const konfigurasi = async (host) => {
  const { resolveSourceConfig } = await mesinSumber();
  try {
    return resolveSourceConfig(`https://${normalHost(host)}/`);
  } catch (error) {
    throw new GalatSumber(error.message, { kode: 'pola' });
  }
};

/**
 * Etalase satu situs: `{ source, extractor, items[], warning }` dari
 * extractKatalog. Melempar GalatSumber kalau situsnya yang gagal; `warning`
 * di dalam hasil berarti halamannya terbaca tapi ada yang janggal.
 */
export const ambilKatalog = async (host) => {
  const { extractKatalog } = await mesinSumber();
  const cfg = await konfigurasi(host);
  const url = cfg.katalog?.url || `https://${normalHost(host)}/`;
  const { html, urlAkhir } = await ambilHtml(url);
  return extractKatalog(html, urlAkhir);
};

/**
 * Hasil pencarian satu situs. Host tanpa blok `cari` ditolak di sini, bukan
 * dibiarkan menembak `?s=` yang ditebak: kiryuu membuktikan tebakan itu
 * berbahaya — GET-nya mengabaikan kata kuncinya dan tetap membalas judul
 * populer, yang tampil di layar persis seperti hasil pencarian sungguhan.
 */
export const ambilPencarian = async (host, kata) => {
  const { extractPencarian } = await mesinSumber();
  const cfg = await konfigurasi(host);
  const pola = cfg.cari?.url;
  if (!pola || !pola.includes('{q}')) {
    throw new GalatSumber(`Pencarian di ${normalHost(host)} belum didukung`, { kode: 'pola' });
  }
  const url = pola.split('{q}').join(encodeURIComponent(String(kata).trim()));
  const { html, urlAkhir } = await ambilHtml(url);
  return extractPencarian(html, urlAkhir);
};

/**
 * Halaman satu seri: sampul, sinopsis, genre, dan daftar chapternya.
 */
export const ambilSeri = async (seriesUrl) => {
  const { extractSeries } = await mesinSumber();
  const { html, urlAkhir } = await ambilHtml(seriesUrl);
  return extractSeries(html, urlAkhir);
};

/**
 * Halaman satu chapter: daftar URL gambarnya, urut halaman.
 *
 * Bentuknya mengikuti ambilSeri di atas — satu ambilHtml, satu extractor — dan
 * `urlAkhir` DIKEMBALIKAN, tidak cuma dipakai di dalam. Pemanggilnya
 * (offline/unduhSumber.js) memerlukannya sebagai Referer saat mengunduh
 * gambarnya: yang dipercaya CDN situs sumber adalah alamat halaman yang
 * BENAR-BENAR memuat gambar itu, dan halaman chapter kerap dialihkan (http→https,
 * slug lama→slug baru) sehingga alamat yang diminta bukan alamat yang berlaku.
 *
 * `imageUrls` kosong TIDAK dilempar dari sini: bedanya "situsnya berganti tema"
 * dan "chapternya memang belum ada gambarnya" cuma bisa dijelaskan oleh
 * pemanggil yang tahu sedang mengunduh chapter apa.
 *
 * @param {string} urlChapter
 * @returns {Promise<{ extractor:string, imageUrls:string[], hostFallbacks:object, urlAkhir:string }>}
 */
export const ambilHalamanChapter = async (urlChapter) => {
  const { extractChapterPages } = await mesinSumber();
  const { html, urlAkhir } = await ambilHtml(urlChapter);
  return { ...extractChapterPages(html, urlAkhir), urlAkhir };
};

// ── Gambar halaman ────────────────────────────────────────────────────────

/*
 * Gambar tidak lewat ambilHtml, dan tiga pembatas di bawah adalah satu-satunya
 * penjagaan yang tersisa untuknya.
 *
 * Alasannya bentuk datanya: berkas gambar diunduh @capacitor/file-transfer
 * langsung ke disk dari sisi native (lihat unduh.js — jalur base64 lewat
 * jembatan JS yang membuat aplikasi terbunuh kehabisan memori), jadi permintaan
 * itu tidak pernah melewati permintaan() di berkas ini. Yang masih bisa
 * dikerjakan dari sini: menentukan headernya dan memeriksa alamatnya.
 */

/**
 * Host yang jelas menunjuk ke dalam jaringan sendiri.
 *
 * Padanannya di server adalah hostPublik() di utils/validators.js, dan
 * kebutuhannya sama persis: URL gambar datang dari HTML milik situs sumber, yaitu
 * teks dari pihak lain. Satu situs sumber yang disusupi cukup menyisipkan
 * <img src="http://192.168.1.1/..."> untuk membuat setiap HP yang menyimpan
 * chapter itu mengetuk router pemiliknya sendiri — dari dalam jaringan rumahnya,
 * tempat banyak perangkat masih percaya siapa pun yang bisa menjangkaunya.
 */
const hostKeDalam = (hostname) => {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;

  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 link-local
    const tertanam = host.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    return tertanam ? hostKeDalam(tertanam[1]) : false;
  }

  // IPv4 dalam bentuk apa pun: bertitik, satu angka desimal (2130706433 =
  // 127.0.0.1), atau heksadesimal. Ketiganya diterima browser.
  let angka = null;
  const bertitik = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (bertitik) {
    const oktet = bertitik.slice(1).map(Number);
    if (oktet.some((satu) => satu > 255)) return true;
    angka = ((oktet[0] << 24) >>> 0) + (oktet[1] << 16) + (oktet[2] << 8) + oktet[3];
  } else if (/^\d+$/.test(host)) {
    angka = Number(host) >>> 0;
  } else if (/^0x[0-9a-f]+$/i.test(host)) {
    angka = Number.parseInt(host, 16) >>> 0;
  }

  if (angka === null) return false; // nama domain biasa

  const dalam = (bawah, atas) => angka >= bawah && angka <= atas;
  return (
    dalam(0x00000000, 0x00ffffff) || // 0.0.0.0/8
    dalam(0x7f000000, 0x7fffffff) || // 127.0.0.0/8
    dalam(0x0a000000, 0x0affffff) || // 10.0.0.0/8
    dalam(0xac100000, 0xac1fffff) || // 172.16.0.0/12
    dalam(0xc0a80000, 0xc0a8ffff) || // 192.168.0.0/16
    dalam(0xa9fe0000, 0xa9feffff) || // 169.254.0.0/16
    dalam(0x64400000, 0x647fffff) || // 100.64.0.0/10 CGNAT
    dalam(0xe0000000, 0xffffffff) //   multicast & sisanya
  );
};

/**
 * Alamat gambar yang boleh diunduh, atau null.
 *
 * Daftar host bawaan TIDAK diberlakukan di sini, dan itu keputusan sadar yang
 * sama dengan yang diambil server (sanitizeSourceUrl dengan anyPublicHost):
 * gambar komik hampir selalu dilayani CDN dengan nama yang sama sekali lain dari
 * situsnya (image2.komiku.to, cdn.*.net) dan berganti tanpa pemberitahuan.
 * Memaksanya lewat daftar bawaan berarti hampir semua chapter gagal diunduh
 * dengan pesan yang menuduh daftar host. Yang dituntut: alamatnya datang dari
 * halaman yang SUDAH lolos daftar itu, skemanya http/https, dan tujuannya bukan
 * di dalam jaringan sendiri.
 */
export const alamatGambarSah = (urlTeks) => {
  let target;
  try {
    target = new URL(String(urlTeks));
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (hostKeDalam(target.hostname)) return null;
  return target.toString();
};

/**
 * Header untuk permintaan gambar ke situs sumber.
 *
 * Referer bukan hiasan: sebagian besar CDN komik menjawab 403 untuk permintaan
 * gambar yang tidak menyebut halaman asalnya — itu cara termurah mereka menolak
 * pengikis dan hotlink. Server rumah sudah memakai aturan yang sama
 * (httpClient.fetchImage menerima referer dari chapter_url), dan tanpa ini jalur
 * HP akan gagal untuk situs yang di server justru berhasil.
 */
export const headerGambar = (urlHalaman) => ({
  'User-Agent': USER_AGENT,
  Accept: 'image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
  Referer: urlHalaman,
});

/**
 * Alamat yang layak dicoba untuk satu gambar: aslinya dulu, lalu hasil
 * penukaran host sesuai peta yang diumumkan halaman chapter itu sendiri
 * (extractChapterPages.hostFallbacks).
 *
 * Kembaran daftarKandidat() di apps/api/src/jobs/downloadQueue.js, dan ada
 * karena alasan yang sama: ada chapter yang host gambar utamanya benar-benar
 * mati sementara host cadangannya melayani berkas yang sama dengan normal.
 * Tanpa mencobanya, chapter seperti itu jadi jalan buntu permanen meski
 * halamannya sehat.
 */
export const kandidatGambar = (url, cadangan) => {
  const kandidat = [];
  const tambah = (alamat) => {
    const sah = alamatGambarSah(alamat);
    if (sah && !kandidat.includes(sah)) kandidat.push(sah);
  };

  tambah(url);
  Object.entries(cadangan ?? {}).forEach(([dari, ke]) => {
    if (!String(url).includes(dari)) return;
    tambah(String(url).split(dari).join(ke));
  });
  return kandidat;
};

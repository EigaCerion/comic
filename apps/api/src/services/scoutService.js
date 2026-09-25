import { getDb } from '../db/index.js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { badRequest, notFound, sanitizeSourceUrl } from '../utils/validators.js';
import { fetchHtml } from '../utils/httpClient.js';
import {
  daftarHostCari,
  daftarHostKatalog,
  extractKatalog,
  extractPencarian,
  resolveSourceConfig,
} from '@naruread/sumber';
import '../utils/sumberLogger.js';
import { importSeries, previewSeries } from './urlImportService.js';

const log = createLogger('naruread:scout');

/**
 * Umur maksimum hasil pindaian sebelum dianggap basi.
 *
 * Halaman depan situs sumber berubah beberapa kali per jam. Lima belas menit
 * cukup rapat untuk tetap terasa "hari ini" tanpa membuat setiap kali panel
 * dibuka jadi satu permintaan baru ke situs orang.
 */
export const BATAS_SEGAR_MENIT = 15;

/**
 * Berapa lama kartu yang sudah tidak terlihat di halaman depan situs sumber
 * tetap disimpan. Tanpa batas, etalase hanya bertambah: komiku saja sudah
 * menyimpan 72 kartu padahal halaman depannya menampilkan 64, dan dengan empat
 * sumber, kartu yang bukan lagi "terbaru" menumpuk setiap hari. Dua hari cukup
 * untuk tetap melihat update koleksi yang terlewat semalam.
 */
export const UMUR_KARTU_JAM = 48;

const batasUmurKartu = (sekarang = Date.now()) => new Date(sekarang - UMUR_KARTU_JAM * 3_600_000).toISOString();

const HOST_BAWAAN = 'komiku.org';

/**
 * Stempel waktu di tabel ini bisa datang dalam dua bentuk: ISO yang kita tulis
 * sendiri, dan "YYYY-MM-DD HH:MM:SS" dari DEFAULT datetime('now') milik SQLite.
 * Bentuk kedua tidak memuat penanda zona; dibaca apa adanya oleh Date, ia
 * ditafsirkan sebagai waktu lokal dan umurnya meleset sejauh selisih zona —
 * tujuh jam di sini, cukup untuk membuat data segar terbaca basi.
 */
const keIso = (nilai) => {
  if (!nilai) return null;
  const teks = String(nilai).trim();
  const berzona = /[TZ]|[+-]\d{2}:?\d{2}$/.test(teks);
  const stempel = Date.parse(berzona ? teks : `${teks.replace(' ', 'T')}Z`);
  return Number.isFinite(stempel) ? new Date(stempel).toISOString() : null;
};

const normalHost = (host) => String(host ?? '').toLowerCase().replace(/^www\./, '');

/**
 * Situs sumber rutin berpindah subdomain — ngomik kini melayani dari
 * 02.ngomik.cc, kiryuu dari v7.kiryuu.to — sementara komik yang diimpor lebih
 * dulu menyimpan alamat lamanya. Membandingkan hostname utuh membuat komik yang
 * sama terbaca sebagai judul baru begitu angkanya bergeser.
 *
 * Kuncinya domain allowlist yang cocok, bukan sekadar dua label terakhir:
 * "x.co.id" akan runtuh jadi "co.id" dan menyamakan situs yang tidak
 * berhubungan sama sekali.
 */
const domainInduk = (host) => {
  const nama = normalHost(host);
  return (
    config.allowedSourceDomains.find((domain) => nama === domain || nama.endsWith(`.${domain}`)) ?? nama
  );
};

/**
 * Bentuk URL yang bisa dibandingkan. Host tanpa "www.", tanpa garis miring
 * penutup, tanpa query maupun fragmen — tanpa penyeragaman ini satu karakter
 * beda sudah cukup membuat komik yang jelas-jelas sama terbaca sebagai "baru".
 */
const kunciUrl = (url) => {
  try {
    const target = new URL(String(url));
    return `${domainInduk(target.hostname)}${target.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return null;
  }
};

/**
 * Petakan seluruh koleksi sekali jalan: URL seri, slug, dan chapter tertinggi
 * yang benar-benar ada di disk. Satu query agregat, bukan satu query per kartu
 * etalase — panel ini menampilkan puluhan kartu sekaligus.
 *
 * Yang dihitung hanya chapter yang SUDAH terunduh. Chapter yang baru masuk
 * antrian sudah punya barisnya sendiri di tabel chapters padahal berkasnya
 * belum ada; kalau ikut dihitung, etalase mengaku "punya" sedetik setelah
 * tombol impor ditekan dan menyembunyikan pekerjaan yang belum selesai.
 */
/** Domain allowlist asal sebuah komik, dibaca dari source_url-nya. */
const hostSumber = (url) => {
  if (!url) return null;
  try {
    return domainInduk(new URL(String(url)).hostname);
  } catch {
    return null;
  }
};

/** Segmen terakhir path — cara yang sama dengan kartu etalase menurunkan slug. */
const slugDariUrl = (url) => {
  if (!url) return null;
  try {
    return (new URL(String(url)).pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase() || null;
  } catch {
    return null;
  }
};

const petaKoleksi = (db) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.slug, c.source_url, c.total_chapters,
              MAX(CASE WHEN ch.is_downloaded = 1 THEN ch.chapter_number END) AS chapter_tertinggi
         FROM comics c
         LEFT JOIN chapters ch ON ch.comic_id = c.id
        GROUP BY c.id`,
    )
    .all();

  const lewatUrl = new Map();
  const lewatSlug = new Map();

  rows.forEach((row) => {
    const entri = {
      comicId: row.id,
      slug: row.slug,
      totalChapters: row.total_chapters ?? 0,
      chapterTertinggi: row.chapter_tertinggi ?? null,
      sumber: hostSumber(row.source_url),
    };
    const kunci = kunciUrl(row.source_url);
    if (kunci) lewatUrl.set(kunci, entri);

    // Slug kita tidak selalu sama bentuk dengan slug di URL sumber. Judul yang
    // terbaca "Komik Spare Me, Great Lord!" jadi slug "komik-spare-me-great-lord",
    // sementara URL sumbernya "/manga/spare-me-great-lord/". Diukur pada koleksi
    // nyata, TIDAK SATU PUN dari 26 komik cocok lewat slug mentah — cadangan ini
    // inert sampai awalannya ikut dilepas. Bentuk mentah didaftarkan lebih dulu
    // supaya kecocokan persis selalu menang atas kecocokan hasil pelepasan.
    const slug = String(row.slug).toLowerCase();
    lewatSlug.set(slug, entri);
    const tanpaAwalan = slug.replace(/^komik-/, '');
    if (tanpaAwalan !== slug && !lewatSlug.has(tanpaAwalan)) lewatSlug.set(tanpaAwalan, entri);

    // Slug versi situs sumber, dari source_url kita sendiri. Judul
    // "Regressor’s Life After Retirement" menjadi slug kita
    // "komik-regressor-s-life-after-retirement" (apostrof jadi pemisah),
    // sementara komiku, ngomik, dan komikindo sama-sama menulis
    // "regressors-life-after-retirement". Tanpa kunci ini, hasil cari ngomik dan
    // komikindo untuk komik yang sudah ada di rak tampil sebagai "baru". Tetap
    // kecocokan persis, dan pendek (< 6 huruf) ditolak supaya segmen umum
    // seperti "manga" tidak ikut jadi kunci.
    const slugSumber = slugDariUrl(row.source_url);
    if (slugSumber && slugSumber.length >= 6 && !lewatSlug.has(slugSumber)) lewatSlug.set(slugSumber, entri);
  });

  return { lewatUrl, lewatSlug };
};

/**
 * Cocokkan satu kartu etalase dengan koleksi: URL seri dulu, slug sebagai
 * cadangan untuk komik yang diimpor sebelum source_url disimpan.
 *
 * Slug harus sama PERSIS. Pencocokan longgar (LIKE "%slug%") terdengar murah
 * hati tapi justru merusak: "tower-of-god" akan mengaku sebagai
 * "tower-of-god-season-2", lalu chapter sumber yang satu diantrekan ke komik
 * yang lain — kesalahan yang baru ketahuan setelah gambarnya tersimpan.
 */
const cocokkan = (row, peta) =>
  peta.lewatUrl.get(kunciUrl(row.series_url)) ??
  peta.lewatSlug.get(String(row.slug ?? '').toLowerCase()) ??
  null;

/** Baris scout_items + koleksi yang cocok -> bentuk yang dipakai frontend. */
const bentukItem = (row, peta) => {
  const koleksi = cocokkan(row, peta);
  const nomorSumber = Number.isFinite(row.latest_chapter_number) ? row.latest_chapter_number : null;

  let status = 'baru';
  let tertinggal = 0;

  if (koleksi) {
    const punya = koleksi.chapterTertinggi;
    if (nomorSumber === null) {
      // Situs tidak menyebut nomor chapter terbarunya. Tidak ada dasar untuk
      // mengaku tertinggal, dan menebak lebih buruk daripada diam.
      status = 'punya';
    } else if (punya !== null && punya >= nomorSumber) {
      status = 'punya';
    } else {
      status = 'update';
      tertinggal = Math.max(0, Math.round(nomorSumber - (punya ?? 0)));
    }
  }

  return {
    id: row.id,
    sourceHost: row.source_host,
    seriesUrl: row.series_url,
    slug: row.slug,
    title: row.title,
    coverUrl: row.cover_url,
    genre: row.genre,
    tipe: row.tipe,
    bagian: row.bagian,
    updatedText: row.updated_text,
    updatedAt: keIso(row.updated_at),
    latestChapter: {
      number: nomorSumber,
      title: row.latest_chapter_title,
      url: row.latest_chapter_url,
    },
    status,
    koleksi,
    // Kartu kiryuu bisa menempel ke komik yang diimpor dari komiku. Itu
    // disengaja — chapter yang tertinggal boleh ditambal dari situs lain — tapi
    // pengguna harus melihatnya sebelum menekan tombol ambil, karena penomoran
    // chapter antar situs tidak dijamin sama.
    lintasSitus: Boolean(koleksi?.sumber && koleksi.sumber !== domainInduk(row.source_host)),
    chapterTertinggal: tertinggal,
  };
};

/** Kapan etalase terakhir dipindai — dipakai untuk menentukan basi atau belum. */
const pindaiTerakhir = (db) => keIso(db.prepare('SELECT MAX(scanned_at) AS t FROM scout_items').get()?.t);

const pindaiPerHost = (db) =>
  new Map(
    db
      .prepare('SELECT source_host AS host, MAX(scanned_at) AS t FROM scout_items GROUP BY source_host')
      .all()
      .map((row) => [row.host, keIso(row.t)]),
  );

/**
 * Galat pindaian terakhir per host, cukup disimpan di memori.
 *
 * Dua gunanya. Antarmuka perlu tahu sumber mana yang sedang tidak terbaca —
 * tanpa itu, kartu komikindo yang hilang tampak seperti komikindo tidak update.
 * Dan penyegaran otomatis tidak boleh menembak ulang situs yang baru saja gagal
 * di setiap permintaan: panel ini dibuka berulang kali, dan situs yang sedang
 * mati akan dihujani permintaan yang pasti gagal.
 */
const galatPindai = new Map(); // host -> { pesan, pada }

const umurMenit = (scannedAt) =>
  scannedAt ? Math.max(0, Math.round((Date.now() - Date.parse(scannedAt)) / 60000)) : null;

/**
 * Satu kartu hasil ekstraksi -> satu baris siap simpan.
 *
 * URL seri yang di luar allowlist dibuang, bukan disimpan dengan tanda. Kartu
 * yang tidak akan pernah bisa diimpor hanya jadi tombol mati di layar.
 */
const angkaAtauNull = (nilai) => {
  if (nilai === null || nilai === undefined || nilai === '') return null;
  const angka = Number(nilai);
  return Number.isFinite(angka) ? angka : null;
};

const keBaris = (item, { host, sekarang, scannedAt }) => {
  const seriesUrl = sanitizeSourceUrl(item?.seriesUrl);
  if (!seriesUrl || !item?.slug || !item?.title) return null;

  // Number(null) bernilai 0, bukan NaN. Tanpa penjagaan ini, kartu yang situsnya
  // tidak menyebut waktu update (seluruh etalase komikindo, kartu "Baru
  // Ditambahkan" di komiku) tercatat ter-update "0 menit lalu" tepat saat
  // dipindai dan tampil sebagai kartu paling segar di etalase. Nomor chapter
  // yang kosong pun akan tersimpan sebagai "Chapter 0".
  const menit = angkaAtauNull(item.updatedMenitLalu);
  const nomor = angkaAtauNull(item.latestChapter?.number);

  return {
    source_host: normalHost(item.source ?? host),
    series_url: seriesUrl,
    slug: String(item.slug),
    title: String(item.title),
    // Poster hampir selalu dilayani CDN dengan domain lain (thumbnail.komiku.to),
    // jadi allowlist halaman tidak berlaku untuknya — penjagaan alamat internal
    // tetap jalan lewat sanitizeSourceUrl.
    cover_url: item.coverUrl ? sanitizeSourceUrl(item.coverUrl, { anyPublicHost: true }) : null,
    genre: item.genre ?? null,
    tipe: item.tipe ?? null,
    bagian: item.bagian === 'baru' ? 'baru' : 'terbaru',
    latest_chapter_number: Number.isFinite(nomor) ? nomor : null,
    latest_chapter_title: item.latestChapter?.title ?? null,
    latest_chapter_url: item.latestChapter?.url ? sanitizeSourceUrl(item.latestChapter.url) : null,
    updated_text: item.updatedText ?? null,
    // Situs hanya menyebut "2 menit lalu". Diubah jadi waktu absolut DI SINI,
    // saat pindaiannya masih hangat: satu jam kemudian "2 menit lalu" sudah
    // berarti hal yang sama sekali lain.
    updated_at: Number.isFinite(menit) ? new Date(sekarang - menit * 60_000).toISOString() : null,
    scanned_at: scannedAt,
  };
};

/**
 * Pindai halaman depan situs sumber dan simpan hasilnya.
 *
 * Seluruh baris ditulis dalam satu transaksi. Etalase dibaca sambil ditulis
 * (panelnya di-poll), dan sapuan setengah jadi akan tampil sebagai daftar yang
 * separuh baru separuh kemarin — membingungkan tanpa memberi tahu apa pun.
 */
export const segarkan = async ({ host = HOST_BAWAAN } = {}) => {
  const beranda = sanitizeSourceUrl(`https://${normalHost(host)}/`);
  if (!beranda) {
    throw badRequest(
      `Host ${host} ditolak. Tambahkan domainnya ke ALLOWED_SOURCE_DOMAINS di .env kalau memang ingin dipindai.`,
    );
  }

  // Halaman etalase tidak selalu beranda — packages/sumber/selectors.js yang menentukan.
  // Kalau alamatnya ditulis di sana, itu yang dipakai; tanpa ini kolom `url`
  // di konfigurasi jadi hiasan dan host berikutnya akan dipindai di halaman
  // yang salah tanpa ada yang sadar.
  const dariConfig = resolveSourceConfig(beranda)?.katalog?.url;
  const url = (dariConfig && sanitizeSourceUrl(dariConfig)) || beranda;

  const { html, finalUrl } = await fetchHtml(url);
  const katalog = extractKatalog(html, finalUrl);
  if (katalog?.warning) log.warn(`pindai ${host}: ${katalog.warning}`);

  // Satu stempel untuk seluruh sapuan. Kalau tiap baris membaca jamnya sendiri,
  // umur data jadi kabur justru di ambang 15 menit tempat keputusan basi diambil.
  const sekarang = Date.now();
  const scannedAt = new Date(sekarang).toISOString();

  const kartu = Array.isArray(katalog?.items) ? katalog.items : [];

  // Nol kartu hampir selalu berarti situsnya mengganti tata letak, bukan "hari
  // ini tidak ada update". Dijadikan galat supaya sumber itu ditandai di
  // antarmuka, dan supaya kartu lamanya tidak ikut terbuang oleh pembersihan di
  // bawah — etalase yang diam-diam mengosong adalah kerusakan yang tak terlihat.
  if (kartu.length === 0) {
    throw new Error(katalog?.warning ?? `Tidak ada kartu terbaca di ${host}`);
  }
  const baris = kartu.map((item) => keBaris(item, { host, sekarang, scannedAt })).filter(Boolean);

  const db = getDb();
  const simpan = db.transaction((rows) => {
    const upsert = db.prepare(
      `INSERT INTO scout_items
         (source_host, series_url, slug, title, cover_url, genre, tipe, bagian,
          latest_chapter_number, latest_chapter_title, latest_chapter_url,
          updated_text, updated_at, scanned_at)
       VALUES
         (@source_host, @series_url, @slug, @title, @cover_url, @genre, @tipe, @bagian,
          @latest_chapter_number, @latest_chapter_title, @latest_chapter_url,
          @updated_text, @updated_at, @scanned_at)
       ON CONFLICT(source_host, series_url) DO UPDATE SET
          slug = excluded.slug,
          title = excluded.title,
          bagian = excluded.bagian,
          scanned_at = excluded.scanned_at,
          -- Kartu di bagian "baru" memuat lebih sedikit keterangan daripada
          -- kartu yang sama di bagian "terbaru". Menimpanya dengan NULL berarti
          -- poster, nomor chapter, dan keterangan waktu yang tadi sudah tampil
          -- ikut hilang.
          cover_url = COALESCE(excluded.cover_url, cover_url),
          updated_text = COALESCE(excluded.updated_text, updated_text),
          genre = COALESCE(excluded.genre, genre),
          tipe = COALESCE(excluded.tipe, tipe),
          latest_chapter_number = COALESCE(excluded.latest_chapter_number, latest_chapter_number),
          latest_chapter_title = COALESCE(excluded.latest_chapter_title, latest_chapter_title),
          latest_chapter_url = COALESCE(excluded.latest_chapter_url, latest_chapter_url),
          updated_at = COALESCE(excluded.updated_at, updated_at)`,
    );
    // Menyembuhkan baris yang tersimpan sebelum angkaAtauNull ada: waktu palsu
    // "tepat saat dipindai" pada kartu tanpa keterangan waktu. Upsert memakai
    // COALESCE, jadi tanpa ini nilai palsu itu bertahan selamanya pada kartu
    // yang terus terlihat di setiap pindaian.
    db.prepare('UPDATE scout_items SET updated_at = NULL WHERE source_host = ? AND updated_text IS NULL').run(
      normalHost(host),
    );
    // Sama untuk genre: sebelum "Just now" dikenali sebagai waktu, teks itu tersimpan
    // sebagai genre kartu kiryuu yang paling baru, dan COALESCE di upsert akan
    // mempertahankannya selamanya karena kiryuu memang tidak pernah mengirim genre.
    db.prepare("UPDATE scout_items SET genre = NULL WHERE source_host = ? AND lower(genre) = 'just now'").run(
      normalHost(host),
    );
    rows.forEach((row) => upsert.run(row));
  });

  simpan(baris);

  // Kartu host ini yang tidak terlihat lagi selama UMUR_KARTU_JAM dibuang.
  // Hanya dijalankan setelah pindaian host ini BERHASIL: situs yang sedang mati
  // tidak boleh kehilangan etalasenya hanya karena tidak bisa dihubungi, dan
  // banner galat sudah memberi tahu bahwa kartunya mungkin tertinggal.
  const terbuang = db
    .prepare('DELETE FROM scout_items WHERE source_host = ? AND scanned_at < ?')
    .run(normalHost(host), batasUmurKartu(sekarang)).changes;
  log.info(`pindai ${host}: ${kartu.length} kartu terbaca, ${baris.length} tersimpan, ${terbuang} kartu lama dibuang`);

  galatPindai.delete(normalHost(host));
  return { host: normalHost(host), terbaca: kartu.length, tersimpan: baris.length, terbuang, scannedAt };
};

/**
 * Host yang konfigurasinya sudah dicabut tidak akan pernah dipindai lagi, jadi
 * kartunya tidak pernah melewati pembersihan di segarkan(). Umurnya dihitung
 * dengan batas yang sama supaya kartu itu tidak menetap selamanya.
 */
const buangKartuYatim = () => {
  const aktif = hostTerpindai();
  if (aktif.length === 0) return;
  getDb()
    .prepare(
      `DELETE FROM scout_items WHERE scanned_at < ? AND source_host NOT IN (${aktif.map(() => '?').join(', ')})`,
    )
    .run(batasUmurKartu(), ...aktif);
};

/** Host yang punya konfigurasi katalog DAN masih diizinkan allowlist. */
export const hostTerpindai = () =>
  daftarHostKatalog().filter((host) => sanitizeSourceUrl(`https://${host}/`));

const pindaiAman = async (host) => {
  try {
    return { host, ...(await segarkan({ host })) };
  } catch (error) {
    galatPindai.set(host, { pesan: error.message, pada: Date.now() });
    log.warn(`pindai ${host} gagal: ${error.message}`);
    return { host, galat: error.message };
  }
};

/**
 * Pindai beberapa sumber sekaligus, bersamaan. Jeda sopan sudah diatur per
 * host oleh httpClient, jadi situs yang berbeda tidak perlu saling menunggu —
 * berurutan hanya membuat tombol Segarkan berlipat lebih lama tanpa satu
 * permintaan pun jadi lebih ramah. Tidak pernah melempar: satu situs mati
 * tidak boleh menggagalkan pindaian situs lain.
 */
export const segarkanSemua = async ({ hosts = hostTerpindai() } = {}) => {
  const hasil = await Promise.all(hosts.map(pindaiAman));
  buangKartuYatim();
  return hasil;
};

/**
 * Segarkan hanya sumber yang datanya memang sudah tua, dan JANGAN melempar
 * kalau gagal. Situs sumber yang sedang mati bukan alasan untuk menolak
 * permintaan: etalase kemarin masih menunjukkan apa yang tertinggal di koleksi,
 * sementara halaman error tidak menunjukkan apa pun.
 *
 * Umur dihitung PER HOST. Dengan satu stempel global, sumber yang baru
 * ditambahkan tidak pernah dipindai selama sumber lain masih segar — komiku
 * yang dipindai lima menit lalu cukup untuk menahan komikindo di luar etalase
 * sampai lima belas menit lewat.
 */
export const segarkanKalauBasi = async () => {
  const terakhir = pindaiPerHost(getDb());
  const sekarang = Date.now();

  const perlu = hostTerpindai().filter((host) => {
    const galat = galatPindai.get(host);
    if (galat && sekarang - galat.pada < BATAS_SEGAR_MENIT * 60_000) return false;
    const umur = umurMenit(terakhir.get(host));
    return umur === null || umur >= BATAS_SEGAR_MENIT;
  });

  if (perlu.length === 0) return { disegarkan: [] };
  return { disegarkan: await segarkanSemua({ hosts: perlu }) };
};

/**
 * Etalase yang sudah dicocokkan dengan koleksi.
 *
 * `jumlah` dihitung setelah saringan bagian dan pencarian, tapi SEBELUM
 * saringan status — angka itu dipakai sebagai label tab, dan tab harus
 * memberi tahu ada berapa isinya sebelum ditekan.
 */
/**
 * Keadaan tiap sumber untuk chip saringan: berapa kartunya, kapan terakhir
 * terbaca, dan galatnya kalau pindaian terakhir gagal. Host yang masih punya
 * kartu tersimpan tetap dilaporkan walau konfigurasinya sudah dicabut, supaya
 * kartu itu tidak jadi yatim tanpa saringan.
 */
const ringkasanSumber = (db, items) => {
  const perHost = pindaiPerHost(db);
  const hosts = new Set([...hostTerpindai(), ...items.map((item) => normalHost(item.sourceHost))]);
  return [...hosts].map((host) => {
    const scannedAt = perHost.get(host) ?? null;
    return {
      host,
      jumlah: items.filter((item) => normalHost(item.sourceHost) === host).length,
      scannedAt,
      umurMenit: umurMenit(scannedAt),
      galat: galatPindai.get(host)?.pesan ?? null,
    };
  });
};

export const daftar = ({ status = 'semua', bagian = 'semua', q = '' } = {}) => {
  const db = getDb();
  const where = [];
  const params = {};

  if (bagian && bagian !== 'semua') {
    where.push('bagian = :bagian');
    params.bagian = String(bagian);
  }
  const teks = String(q ?? '').trim();
  if (teks) {
    where.push('title LIKE :q');
    params.q = `%${teks}%`;
  }

  const rows = db
    .prepare(
      `SELECT * FROM scout_items
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY updated_at DESC NULLS LAST, id ASC`,
    )
    .all(params);

  const peta = petaKoleksi(db);

  // Seri yang sama bisa tersimpan dua kali setelah situsnya berpindah
  // subdomain, karena UNIQUE-nya memakai URL utuh. Yang ditampilkan hanya baris
  // hasil pindaian paling akhir, supaya kartunya tidak muncul kembar.
  const unik = new Map();
  rows.forEach((row) => {
    const kunci = kunciUrl(row.series_url) ?? `${row.source_host}|${row.series_url}`;
    const lama = unik.get(kunci);
    if (!lama || (keIso(row.scanned_at) ?? '') > (keIso(lama.scanned_at) ?? '')) unik.set(kunci, row);
  });
  const items = [...unik.values()].map((row) => bentukItem(row, peta));

  const jumlah = { semua: items.length, baru: 0, update: 0, punya: 0 };
  items.forEach((item) => {
    jumlah[item.status] += 1;
  });

  // Umur diambil dari seluruh tabel, bukan dari baris yang lolos saringan:
  // mengetik kata pencarian tidak mengubah kapan etalase terakhir dipindai.
  const scannedAt = pindaiTerakhir(db);
  const umur = umurMenit(scannedAt);

  return {
    items: status && status !== 'semua' ? items.filter((item) => item.status === status) : items,
    scannedAt,
    umurMenit: umur,
    basi: umur === null || umur >= BATAS_SEGAR_MENIT,
    jumlah,
    sumber: ringkasanSumber(db, items),
  };
};

// ── Pencarian di situs sumber ─────────────────────────────────────────────

const PANJANG_Q_MIN = 2;
const PANJANG_Q_MAKS = 80;

/**
 * Lima menit cukup untuk menutup kebiasaan mengetik, menghapus, lalu mengetik
 * lagi kata yang sama tanpa setiap kali menembak tiga situs orang, dan cukup
 * pendek supaya chapter yang baru rilis tidak tertahan lama di hasil cari.
 */
const UMUR_CACHE_CARI_MS = 5 * 60_000;

// Setiap kata kunci berbeda menambah satu entri per host; tanpa batas, Map ini
// tumbuh sepanjang umur proses.
const MAKS_ENTRI_CACHE_CARI = 300;

const cacheCari = new Map(); // "host|q" -> { pada, janji }

/** Host yang punya blok cari DAN masih diizinkan allowlist. */
export const hostTercari = () =>
  daftarHostCari().filter((host) => sanitizeSourceUrl(`https://${host}/`));

const rapikanKataCari = (q) => (typeof q === 'string' ? q.replace(/\s+/g, ' ').trim() : '');

const rapikanCacheCari = (sekarang) => {
  for (const [kunci, entri] of cacheCari) {
    if (sekarang - entri.pada >= UMUR_CACHE_CARI_MS) cacheCari.delete(kunci);
  }
  // Masih penuh setelah yang basi dibuang: yang tertua keluar lebih dulu —
  // Map menjaga urutan sisip.
  while (cacheCari.size >= MAKS_ENTRI_CACHE_CARI) cacheCari.delete(cacheCari.keys().next().value);
};

/**
 * Ambil dan urai hasil cari satu host, lewat cache.
 *
 * Yang disimpan adalah janji, bukan hasil jadi: dua permintaan untuk kata yang
 * sama yang datang berdekatan (debounce di antarmuka tidak menjamin itu tidak
 * terjadi) berbagi satu pengambilan. Yang disimpan juga hasil ekstraksi mentah,
 * BUKAN hasil yang sudah dicocokkan dengan koleksi — status punya/update harus
 * berubah begitu impor selesai, bukan lima menit kemudian.
 */
const cariDiHost = (host, kataNormal) => {
  const kunci = `${host}|${kataNormal}`;
  const sekarang = Date.now();
  const tersimpan = cacheCari.get(kunci);
  if (tersimpan && sekarang - tersimpan.pada < UMUR_CACHE_CARI_MS) {
    log.debug(`cari "${kataNormal}" di ${host}: dari cache`);
    return tersimpan.janji;
  }

  // Pola tanpa {q} akan mengambil halaman yang sama untuk kata apa pun, dan
  // isinya tampil seolah-olah hasil pencarian.
  const pola = resolveSourceConfig(`https://${host}/`)?.cari?.url;
  const url = pola?.includes('{q}') ? sanitizeSourceUrl(pola.split('{q}').join(encodeURIComponent(kataNormal))) : null;
  if (!url) {
    return Promise.reject(new Error(`Alamat pencarian ${host} tidak memuat {q} atau ditolak allowlist`));
  }

  const janji = fetchHtml(url).then(({ html, finalUrl }) => extractPencarian(html, finalUrl));

  // Galat dan halaman yang tata letaknya tidak terbaca tidak disimpan: situs
  // yang tadi gagal harus benar-benar dicoba lagi saat pengguna mengulang,
  // bukan dijawab kegagalan yang sama selama lima menit.
  const lupakan = () => {
    if (cacheCari.get(kunci)?.janji === janji) cacheCari.delete(kunci);
  };
  janji.then((hasil) => hasil?.warning && lupakan(), lupakan);

  if (cacheCari.size >= MAKS_ENTRI_CACHE_CARI) rapikanCacheCari(sekarang);
  cacheCari.set(kunci, { pada: sekarang, janji });
  return janji;
};

/**
 * Kartu hasil cari -> bentuk kontrak. Dilewatkan keBaris lalu bentukItem,
 * jalur yang sama dengan etalase, supaya status, lintasSitus, dan
 * chapterTertinggal dihitung dengan aturan yang persis sama: hasil cari dan
 * etalase tidak boleh berbeda pendapat tentang kartu yang sama.
 */
const keHasilCari = (row, peta) => {
  const item = bentukItem(row, peta);
  const { number, url } = item.latestChapter;
  return {
    kunci: item.seriesUrl,
    sourceHost: item.sourceHost,
    seriesUrl: item.seriesUrl,
    slug: item.slug,
    title: item.title,
    coverUrl: item.coverUrl,
    genre: item.genre,
    tipe: item.tipe,
    updatedText: item.updatedText,
    // Kartu cari komikindo tidak memuat chapter sama sekali. Objek berisi
    // null semua akan dibaca antarmuka sebagai "Chapter null".
    latestChapter: number === null && !url ? null : item.latestChapter,
    status: item.status,
    koleksi: item.koleksi,
    lintasSitus: item.lintasSitus,
    chapterTertinggal: item.chapterTertinggal,
  };
};

/**
 * Cari judul langsung di mesin pencari tiap situs sumber, untuk judul yang
 * tidak sedang tampil di etalase "terbaru". Hasilnya TIDAK disimpan ke
 * scout_items: tabel itu adalah cermin halaman depan situs, dan kartu hasil
 * cari yang ikut masuk akan tampil sebagai "baru update" padahal tidak.
 *
 * Tidak pernah gagal karena satu situs: galat tiap host dilaporkan di
 * `sumber`, sementara hasil dari host lain tetap dikirim.
 */
export const cariDiSumber = async ({ q } = {}) => {
  const kata = rapikanKataCari(q);
  if (kata.length < PANJANG_Q_MIN) throw badRequest(`Kata pencarian minimal ${PANJANG_Q_MIN} karakter`);
  if (kata.length > PANJANG_Q_MAKS) throw badRequest(`Kata pencarian maksimal ${PANJANG_Q_MAKS} karakter`);
  const kataNormal = kata.toLowerCase();

  const hosts = hostTercari();
  const tidakDidukung = hostTerpindai().filter((host) => !hosts.includes(host));

  const perHost = await Promise.all(
    hosts.map(async (host) => {
      try {
        const hasil = await cariDiHost(host, kataNormal);
        if (hasil?.warning) log.warn(`cari "${kata}" di ${host}: ${hasil.warning}`);
        return { host, kartu: Array.isArray(hasil?.items) ? hasil.items : [], galat: hasil?.warning ?? null };
      } catch (error) {
        log.warn(`cari "${kata}" di ${host} gagal: ${error.message}`);
        return { host, kartu: [], galat: error.message };
      }
    }),
  );

  const peta = petaKoleksi(getDb());
  const sekarang = Date.now();
  const scannedAt = new Date(sekarang).toISOString();
  const terlihat = new Set();
  const items = [];

  const sumber = perHost.map(({ host, kartu, galat }) => {
    let jumlah = 0;
    kartu.forEach((satu) => {
      const row = keBaris(satu, { host, sekarang, scannedAt });
      if (!row) return;
      const item = keHasilCari(row, peta);
      // `kunci` dipakai antarmuka sebagai key React; kembar berarti kartu yang
      // salah ikut diperbarui saat daftar berubah.
      if (terlihat.has(item.kunci)) return;
      terlihat.add(item.kunci);
      items.push(item);
      jumlah += 1;
    });
    return { host, jumlah, galat };
  });

  log.info(`cari "${kata}": ${items.length} hasil dari ${hosts.length} sumber`);
  return { q: kata, items, sumber, tidakDidukung };
};

// ── Impor ─────────────────────────────────────────────────────────────────

/**
 * Jalur impor bersama untuk kartu etalase dan URL hasil cari.
 *
 * `row` berbentuk baris scout_items (series_url, slug, title, cover_url)
 * karena itulah yang dipahami cocokkan(); URL hasil cari cukup dibungkus ke
 * bentuk yang sama supaya aturan pencocokan koleksinya tidak bercabang.
 *
 * `hanyaBaru` adalah tombol "ambil yang tertinggal saja": chapter yang nomornya
 * tidak melebihi milik kita disaring di sini, supaya menambah 3 chapter tidak
 * berarti mengunduh ulang 117 chapter yang sudah ada di disk.
 */
const imporSeri = async (row, { hanyaBaru = false } = {}) => {
  const koleksi = cocokkan(row, petaKoleksi(getDb()));
  const seri = await previewSeries(row.series_url);

  // Tanpa komik yang cocok, atau saat kita belum punya satu chapter pun,
  // "hanya yang baru" berarti semuanya memang baru.
  const batas = hanyaBaru ? koleksi?.chapterTertinggi ?? null : null;
  const semua = Array.isArray(seri.chapters) ? seri.chapters : [];
  const chapters = batas === null ? semua : semua.filter((chapter) => Number(chapter.number) > batas);

  if (!chapters.length) {
    throw badRequest(
      hanyaBaru
        ? `Tidak ada chapter yang lebih baru dari yang sudah kita punya (chapter ${koleksi?.chapterTertinggi ?? 0})`
        : (seri.warning ?? 'Tidak ada chapter yang terdeteksi di halaman seri'),
    );
  }

  log.info(
    `impor ${row.slug}: ${chapters.length} dari ${semua.length} chapter dipilih` +
      (koleksi ? ` (menyambung komik #${koleksi.comicId})` : ''),
  );

  // comicId yang cocok diteruskan supaya chapter baru menempel ke komik yang
  // sudah ada, bukan melahirkan judul kembar di rak.
  return importSeries({
    seriesUrl: seri.url ?? row.series_url,
    title: seri.title || row.title,
    author: seri.author,
    artist: seri.artist,
    genres: seri.genres,
    status: seri.status,
    description: seri.description,
    coverUrl: seri.coverUrl ?? row.cover_url,
    comicId: koleksi?.comicId ?? seri.existingComic?.id ?? null,
    chapters,
  });
};

/** Impor satu kartu etalase ke koleksi. */
export const impor = async ({ id, hanyaBaru = false } = {}) => {
  const row = getDb().prepare('SELECT * FROM scout_items WHERE id = ?').get(Number(id));
  if (!row) throw notFound('Item etalase tidak ditemukan — coba segarkan dulu');
  return imporSeri(row, { hanyaBaru });
};

/**
 * Impor langsung dari URL seri — dipakai hasil cari, yang sengaja tidak punya
 * baris di scout_items untuk dirujuk lewat id.
 */
export const imporDariUrl = async ({ seriesUrl, hanyaBaru = false } = {}) => {
  if (typeof seriesUrl !== 'string' || !seriesUrl.trim()) throw badRequest('seriesUrl wajib diisi');
  const url = sanitizeSourceUrl(seriesUrl.trim());
  if (!url) {
    throw badRequest(
      'URL seri ditolak. Tambahkan domainnya ke ALLOWED_SOURCE_DOMAINS di .env kalau memang ingin dipakai.',
    );
  }

  // Slug diturunkan dengan cara yang sama seperti kartu etalase dan hasil cari,
  // supaya komik yang tadi tampil "punya" di hasil cari juga dikenali di sini
  // dan chapter-nya menempel ke komik yang sama, bukan melahirkan judul kembar.
  return imporSeri({ series_url: url, slug: slugDariUrl(url), title: null, cover_url: null }, { hanyaBaru });
};

export default {
  segarkan,
  segarkanSemua,
  segarkanKalauBasi,
  hostTerpindai,
  hostTercari,
  daftar,
  cariDiSumber,
  impor,
  imporDariUrl,
  BATAS_SEGAR_MENIT,
  UMUR_KARTU_JAM,
};

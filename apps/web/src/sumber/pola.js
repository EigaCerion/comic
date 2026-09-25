import tabelBawaan from '@naruread/sumber/selectors.js';
import { IS_APP } from '../platform/index.js';
import { alamatServer } from '../platform/server.js';

/**
 * Tabel pola mana yang dipakai extractor: yang ikut dibundel, atau yang lebih
 * baru dari server rumah.
 *
 * Masalah yang diselesaikannya: tabel selector ikut dibekukan ke dalam APK,
 * sementara situs komik mengganti tema tanpa memberi tahu siapa pun. Tanpa
 * berkas ini, satu pergantian tema berarti aplikasi berhenti membaca situs itu
 * sampai ada rilis APK baru — dan pemilik server rumah yang sudah memperbaiki
 * selectornya sendiri tetap tidak bisa menolong HP-nya sendiri.
 *
 * Aturannya sengaja sederhana dan satu arah: yang "versi"-nya lebih tinggi yang
 * menang. Tanpa angka itu, "punya server" akan selalu mengalahkan bawaan, dan
 * server rumah yang belum pernah di-pull justru akan MEMUNDURKAN aplikasi yang
 * baru dipasang ke tabel yang lebih tua.
 *
 * Yang TIDAK boleh dilakukan tabel dari server: menambah situs baru. Host asing
 * dibuang di sini (dan ditolak sekali lagi di ambil.js), karena tabel adalah
 * cara termurah untuk menyuruh HP orang lain menembaki mesin pilihan penyerang.
 * Konsekuensinya jujur dan disebut di layar: situs yang benar-benar baru tetap
 * butuh APK baru.
 *
 * Dan satu aturan yang lahir belakangan: HARUS ADA JALAN PULANG. Tabel yang
 * menang disimpan permanen dan dipasang lagi setiap aplikasi dibuka, jadi tabel
 * ber-"versi" besar yang ternyata salah untuk build ini akan mengunci layar
 * Sumber di "0 kartu terbaca" selamanya — rilis APK baru pun kalah angka.
 * Karena itu ada batas atas pada "versi" dan ada kembalikanTabelBawaan().
 */

const KUNCI_SIMPANAN = 'naruread:pola-sumber';

/** Server rumah yang tidak menjawab secepat ini dianggap tidak ada. Pembaruan
 *  tabel adalah kemewahan; menahan layar Sumber demi menunggunya tidak. */
const BATAS_MS = 4000;

/**
 * Selisih "versi" terbesar yang masih masuk akal di atas tabel bawaan APK.
 *
 * Tanpa batas ini satu tabel ber-`versi: 20260924` (gaya tanggal) atau
 * `versi: 999999` cukup untuk membuat tabel bawaan tidak akan pernah menang
 * lagi, di APK mana pun, selamanya. Seribu revisi di depan sudah jauh lebih
 * banyak daripada yang bisa dihasilkan repositori ini di antara dua rilis;
 * apa pun di atas itu bukan tabel yang lebih baru, melainkan angka yang salah.
 */
const LOMPAT_VERSI_MAKS = 1000;

const versiBawaan = () => Number(tabelBawaan.versi) || 0;

/**
 * Host yang dikenal APK ini. Dihitung saat pertama dipakai, bukan di puncak
 * berkas: `new Set(...)` di tingkat modul adalah efek samping di mata Rollup,
 * dan satu baris itu menahan seluruh tabel pola di dalam bundel web yang tidak
 * pernah membukanya. Ceritanya lengkap di sumber/ambil.js.
 */
let hostBawaan = null;
const daftarHostBawaan = () => {
  if (!hostBawaan) {
    hostBawaan = new Set(Object.keys(tabelBawaan.hosts ?? {}).map((host) => String(host).toLowerCase()));
  }
  return hostBawaan;
};

let keadaan = {
  versi: versiBawaan(),
  asal: 'bawaan',
  peringatan: [],
};

/** Keadaan tabel yang sedang terpasang, untuk ditampilkan di layar Sumber. */
export const statusPola = () => keadaan;

let mesin = null;

/**
 * Pintu malas ke @naruread/sumber — alasannya sama persis dengan di ambil.js:
 * satu import statis saja menarik cheerio (~250 kB) ke chunk entry bundel
 * android, yang diurai pada setiap start dingin walau layar Sumber tidak pernah
 * dibuka. Yang tetap statis hanyalah selectors.js, karena ia data belaka dan
 * `versi` bawaannya sudah dibutuhkan sebelum satu pemanggil pun datang.
 */
const mesinSumber = async () => {
  if (!mesin) mesin = await import('@naruread/sumber');
  return mesin;
};

let modulPrefs = null;

/**
 * Plugin Capacitor adalah Proxy yang menerjemahkan SETIAP akses properti —
 * termasuk `.then` — menjadi panggilan plugin, jadi mengembalikannya langsung
 * dari fungsi async menghasilkan promise yang tidak pernah selesai. Seluruh
 * ceritanya ada di platform/server.js; yang penting di sini: proxy-nya selalu
 * dibungkus objek biasa dulu.
 */
const prefs = async () => {
  if (!modulPrefs) modulPrefs = await import('@capacitor/preferences');
  return { Preferences: modulPrefs.Preferences };
};

const catat = (pesan) => {
  // Keras-keras ke konsol DAN disimpan untuk ditampilkan. Tabel yang ditolak
  // diam-diam adalah kegagalan paling mahal di berkas ini: semuanya tetap
  // jalan, hanya saja dengan selector lama, dan yang terlihat berbulan-bulan
  // kemudian cuma "situsnya tidak terbaca lagi".
  console.warn(`[pola] ${pesan}`);
  keadaan = { ...keadaan, peringatan: [...keadaan.peringatan, pesan] };
};

/**
 * Terima hanya yang berbentuk tabel, hanya host yang sudah dikenal, dan hanya
 * "versi" yang masih dalam jangkauan wajar dari tabel bawaan.
 *
 * @returns {{ versi: number, pola: object, dibuang: string[] }}
 * @throws {Error} kalau bentuknya bukan tabel sama sekali
 */
const periksaTabel = (mentah) => {
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) {
    throw new Error('bukan objek');
  }
  const versi = Number(mentah.versi);
  if (!Number.isFinite(versi)) throw new Error('tidak punya "versi" berupa angka');

  const batasAtas = versiBawaan() + LOMPAT_VERSI_MAKS;
  if (versi > batasAtas) {
    throw new Error(
      `"versi" ${versi} terlalu jauh di atas tabel bawaan aplikasi (batas ${batasAtas}) — ` +
        'tabel seperti itu tidak akan pernah bisa dikalahkan rilis APK mana pun',
    );
  }

  if (!mentah.hosts || typeof mentah.hosts !== 'object' || Array.isArray(mentah.hosts)) {
    throw new Error('tidak punya blok "hosts"');
  }

  const dikenal = daftarHostBawaan();
  const hosts = {};
  const dibuang = [];
  Object.entries(mentah.hosts).forEach(([host, entri]) => {
    if (dikenal.has(String(host).toLowerCase())) hosts[host] = entri;
    else dibuang.push(host);
  });

  if (Object.keys(hosts).length === 0) {
    throw new Error('tidak memuat satu pun situs yang dikenal aplikasi ini');
  }

  return { versi, pola: { ...mentah, hosts }, dibuang };
};

/**
 * Pasang kalau lebih baru dari yang sedang terpasang.
 *
 * @returns {Promise<object|null>} tabel yang SUDAH tersaring kalau jadi dipasang
 */
const pasangKalauLebihBaru = async (tabel, asal) => {
  let periksa;
  try {
    periksa = periksaTabel(tabel);
  } catch (error) {
    catat(`Tabel pola dari ${asal} diabaikan: ${error.message}.`);
    return null;
  }

  if (periksa.dibuang.length > 0) {
    catat(
      `Tabel pola dari ${asal} memuat situs yang tidak dikenal aplikasi ini dan dibuang: ` +
        `${periksa.dibuang.join(', ')}. Situs baru hanya bisa ditambahkan lewat versi aplikasi baru.`,
    );
  }

  const { pasangTabelPola, versiTabelPola } = await mesinSumber();
  if (periksa.versi <= versiTabelPola()) return null;

  try {
    pasangTabelPola(periksa.pola);
  } catch (error) {
    catat(`Tabel pola dari ${asal} ditolak mesin sumber: ${error.message}.`);
    return null;
  }

  keadaan = { ...keadaan, versi: periksa.versi, asal };
  return periksa.pola;
};

const bacaSimpanan = async () => {
  try {
    const { Preferences } = await prefs();
    const { value } = await Preferences.get({ key: KUNCI_SIMPANAN });
    if (!value) return null;
    return JSON.parse(value);
  } catch (error) {
    // JSON rusak di penyimpanan bukan kasus tepi: aplikasi bisa mati di tengah
    // penulisan. Yang tersimpan dibuang, bukan dipertahankan untuk gagal lagi
    // setiap kali layar Sumber dibuka.
    catat(`Tabel pola tersimpan tidak terbaca (${error.message}); memakai bawaan.`);
    await hapusSimpanan();
    return null;
  }
};

const hapusSimpanan = async () => {
  try {
    const { Preferences } = await prefs();
    await Preferences.remove({ key: KUNCI_SIMPANAN });
  } catch {
    /* penyimpanan memang tidak bisa dipakai; bawaan tetap jalan */
  }
};

const simpan = async (tabel) => {
  try {
    const { Preferences } = await prefs();
    await Preferences.set({ key: KUNCI_SIMPANAN, value: JSON.stringify(tabel) });
  } catch {
    // Gagal menyimpan hanya berarti tabelnya diambil lagi dari server saat
    // aplikasi dibuka berikutnya. Sesi yang sedang berjalan sudah memakainya.
  }
};

const tanyaServer = async () => {
  const alamat = alamatServer();
  if (!alamat) return null;

  const kendali = new AbortController();
  const jam = setTimeout(() => kendali.abort(), BATAS_MS);
  try {
    const jawab = await fetch(`${alamat}/api/sumber/pola`, {
      signal: kendali.signal,
      cache: 'no-store',
    });
    if (!jawab.ok) return null;
    const isi = await jawab.json();
    // Bentuk jawabannya { versi, pola }. `versi` di luar dipakai server untuk
    // menjawab cepat; yang dipasang tetap tabelnya sendiri, supaya tidak ada dua
    // angka yang bisa berbeda.
    //
    // Yang TIDAK diperiksa di sini: penanda identitas ala /api/health. Alamatnya
    // tidak pernah masuk penyimpanan tanpa lolos periksaServer() lebih dulu
    // (lihat Sambung.jsx), jadi router dan captive portal tidak pernah bisa jadi
    // alamatServer(); dan keduanya sama-sama http polos, sehingga penanda itu
    // pun bukan pagar bagi lawan yang sengaja. Yang benar-benar menolong adalah
    // jalan pulang di bawah.
    return isi?.pola ?? null;
  } catch {
    // Server mati, HP di jaringan lain, atau rute ini belum ada (server rumah
    // yang belum diperbarui). Ketiganya berarti hal yang sama bagi kita: pakai
    // yang sudah ada. Ini BUKAN kegagalan yang perlu diributkan — aplikasi
    // memang dirancang untuk hidup tanpa server.
    return null;
  } finally {
    clearTimeout(jam);
  }
};

let pemuatan = null;

const muat = async () => {
  const tersimpan = await bacaSimpanan();
  if (tersimpan) await pasangKalauLebihBaru(tersimpan, 'simpanan');

  const dariServer = await tanyaServer();
  if (dariServer) {
    // Yang disimpan adalah tabel yang SUDAH tersaring, bukan yang mentah dari
    // jaringan: kalau aturan penyaringnya diperketat nanti, yang tersimpan tidak
    // boleh menyelundupkan host yang hari ini sudah ditolak.
    const terpasang = await pasangKalauLebihBaru(dariServer, 'server rumah');
    if (terpasang) await simpan(terpasang);
  }

  return keadaan;
};

/**
 * Pastikan tabel terbaik yang tersedia sudah terpasang.
 *
 * Aman dipanggil berkali-kali: layar Sumber dan layar seri sama-sama
 * memanggilnya saat dipasang, dan yang di-cache adalah promise-nya — bukan flag
 * "sudah jalan" — supaya dua pemanggil yang hampir bersamaan menunggu pemuatan
 * yang sama alih-alih menembak server dua kali.
 *
 * Sengaja TIDAK dipanggil dari main.jsx. Membuka aplikasi tidak boleh menunggu
 * jaringan; yang butuh tabel mutakhir hanyalah layar yang benar-benar membaca
 * situs sumber, dan di situlah beberapa ratus milidetik ini pantas dibayar.
 *
 * @returns {Promise<{ versi: number, asal: string, peringatan: string[] }>}
 */
export const siapkanPola = () => {
  if (!IS_APP) return Promise.resolve(keadaan);
  if (!pemuatan) {
    pemuatan = muat().catch((error) => {
      catat(`Pembaruan tabel pola gagal: ${error.message}. Memakai tabel bawaan aplikasi.`);
      return keadaan;
    });
  }
  return pemuatan;
};

/**
 * Jalan pulang: buang tabel dari server dan pakai tabel bawaan APK lagi.
 *
 * Kenapa ini harus ada. Tabel yang menang disimpan permanen, dipasang lagi
 * sebelum server ditanya setiap kali aplikasi dibuka, dan tidak bisa dikalahkan
 * oleh tabel ber-versi lebih rendah — termasuk tabel bawaan APK yang baru.
 * Pemicunya bahkan tidak butuh penyerang: HP yang pernah menunjuk server lain
 * (fork, punya teman, cabang repo yang versinya jauh lebih tinggi) memungut
 * tabel itu dan membawanya terus. Tanpa fungsi ini, satu-satunya cara keluar
 * adalah menghapus SELURUH data aplikasi lewat setelan Android — ikut
 * menghapus chapter tersimpan, posisi baca, dan alamat servernya.
 *
 * @param {{ tanyaLagi?: boolean }} [opsi] tanyaLagi: server masih boleh
 *   menawarkan tabelnya lagi di sesi ini. Dipakai saat alamat server BERGANTI —
 *   yang lama memang harus dilupakan, dan yang baru berhak menawarkan miliknya.
 *   Bawaannya false, karena penekan tombol "Kembalikan tabel bawaan" justru
 *   sedang ingin lepas dari tabel yang server ini sodorkan.
 * @returns {Promise<{ versi: number, asal: string, peringatan: string[] }>}
 */
export const kembalikanTabelBawaan = async ({ tanyaLagi = false } = {}) => {
  if (!IS_APP) return keadaan;

  await hapusSimpanan();

  try {
    const { pasangTabelPola } = await mesinSumber();
    pasangTabelPola(null);
  } catch (error) {
    // Mesinnya gagal dimuat berarti tidak ada extractor sama sekali; simpanan
    // sudah telanjur dibuang, dan itu bagian yang benar-benar penting.
    catat(`Tabel bawaan tidak bisa dipasang ulang: ${error.message}.`);
  }

  keadaan = { versi: versiBawaan(), asal: 'bawaan', peringatan: [] };
  // Promise pemuatan ikut disetel, bukan dibiarkan: yang tersimpan di dalamnya
  // adalah keadaan lama, dan setiap pemanggil siapkanPola() berikutnya akan
  // mendapat angka versi yang sudah tidak terpasang lagi.
  pemuatan = tanyaLagi ? null : Promise.resolve(keadaan);
  return keadaan;
};

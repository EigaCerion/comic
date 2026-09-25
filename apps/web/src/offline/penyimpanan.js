import { useSyncExternalStore } from 'react';
import { ASLI_NATIF, IS_APP } from '../platform/index.js';
import { siapkanPosisi } from './posisiBaca.js';

/**
 * Rak komik di dalam HP: berkas gambar, katalognya, dan cara membuat URL yang
 * bisa dipasang di <img> tanpa menyentuh jaringan.
 *
 * Tata letaknya di Directory.Data (folder milik aplikasi; ikut terhapus saat
 * aplikasi dicopot, dan tidak pernah muncul di galeri):
 *
 *   offline/index.json          katalog: komik apa saja, chapter apa saja
 *   offline/<chapterId>/chapter.json   jawaban server apa adanya + nama berkas
 *   offline/<chapterId>/001.webp       halaman, nama berkasnya dari server
 *   offline/<chapterId>/sampul.webp    cover komiknya
 *
 * Folder dinamai id chapter, bukan slug komik + nomor. Slug bisa berubah kalau
 * judulnya disunting, dan nomor chapter bisa berkoma; id adalah satu-satunya
 * yang tidak pernah berubah dan tidak perlu dibersihkan dari karakter aneh.
 *
 * Cover disimpan ULANG di tiap folder chapter, bukan satu kali per komik.
 * Terdengar boros (belasan KB per chapter), tapi menghapus satu chapter jadi
 * operasi tunggal: buang foldernya, selesai. Dengan cover milik bersama,
 * penghapusan mana pun harus lebih dulu membuktikan tidak ada chapter lain yang
 * masih memakainya — akuntansi yang pasti salah suatu hari nanti dan menyisakan
 * komik tanpa gambar di rak offline.
 */

export const VERSI_INDEKS = 1;

const AKAR = 'offline';
const BERKAS_INDEKS = `${AKAR}/index.json`;
const NAMA_CHAPTER_JSON = 'chapter.json';

/*
 * Plugin Capacitor adalah Proxy yang menerjemahkan SETIAP akses properti jadi
 * panggilan plugin, `.then` sekalipun. Mengembalikannya langsung dari fungsi
 * async membuat runtime menganggapnya thenable dan promise-nya tidak pernah
 * selesai — layar putih tanpa galat. Sudah pernah menggigit sekali di
 * platform/server.js, jadi di sini pun proxy-nya selalu dipindahkan ke objek
 * biasa lebih dulu.
 */
let modulFs = null;

export const fsPlugin = async () => {
  if (!modulFs) {
    const m = await import('@capacitor/filesystem');
    modulFs = { Filesystem: m.Filesystem, Directory: m.Directory, Encoding: m.Encoding };
  }
  return modulFs;
};

const indeksKosong = () => ({ versi: VERSI_INDEKS, komik: {}, chapter: {} });

let indeks = indeksKosong();

// Petikan yang dibagikan ke React. useSyncExternalStore membandingkan hasil
// getSnapshot dengan ===, jadi objeknya harus TETAP sama selama tidak ada
// perubahan dan BERGANTI identitas tepat saat ada.
let petikan = indeks;
const pendengar = new Set();

const siarkan = () => {
  petikan = { ...indeks };
  pendengar.forEach((beri) => beri());
};

const langgan = (beri) => {
  pendengar.add(beri);
  return () => pendengar.delete(beri);
};

const bacaPetikan = () => petikan;

/** Katalog offline yang ikut merender ulang saat isinya berubah. */
export const useIndeksOffline = () => useSyncExternalStore(langgan, bacaPetikan, bacaPetikan);

export const indeksSekarang = () => petikan;

/* ── Berkas ─────────────────────────────────────────────────────────── */

export const folderChapter = (chapterId) => `${AKAR}/${chapterId}`;

export const jalurBerkas = (chapterId, nama) => `${folderChapter(chapterId)}/${nama}`;

export const pastikanFolder = async (chapterId) => {
  const { Filesystem, Directory } = await fsPlugin();
  try {
    await Filesystem.mkdir({ path: folderChapter(chapterId), directory: Directory.Data, recursive: true });
  } catch {
    // mkdir melempar kalau foldernya sudah ada, dan itu justru keadaan yang
    // paling sering terjadi (melanjutkan unduhan yang tadi dibatalkan).
  }
};

/** Ukuran berkas dalam byte, atau null kalau belum ada. */
export const ukuranBerkas = async (jalur) => {
  const { Filesystem, Directory } = await fsPlugin();
  try {
    const hasil = await Filesystem.stat({ path: jalur, directory: Directory.Data });
    return hasil?.type === 'directory' ? null : (hasil?.size ?? null);
  } catch {
    return null;
  }
};

export const tulisBlob = async (jalur, blob) => {
  const { Filesystem, Directory } = await fsPlugin();
  // Blob hanya didukung implementasi web plugin ini (IndexedDB). Di perangkat
  // sungguhan berkas gambar ditulis oleh @capacitor/file-transfer, bukan lewat
  // sini — base64 seukuran halaman komik harus melewati jembatan JS→native
  // sebagai string dan itu yang membuat unduhan besar kehabisan memori.
  await Filesystem.writeFile({ path: jalur, directory: Directory.Data, data: blob, recursive: true });
};

const bacaTeks = async (jalur) => {
  const { Filesystem, Directory, Encoding } = await fsPlugin();
  const hasil = await Filesystem.readFile({ path: jalur, directory: Directory.Data, encoding: Encoding.UTF8 });
  // Di web, isi berkas bisa kembali sebagai Blob kalau dulunya ditulis sebagai
  // Blob. Yang di sini selalu ditulis sebagai teks, tapi berjaga tetap murah.
  return typeof hasil.data === 'string' ? hasil.data : await hasil.data.text();
};

const tulisTeks = async (jalur, teks) => {
  const { Filesystem, Directory, Encoding } = await fsPlugin();
  await Filesystem.writeFile({
    path: jalur,
    directory: Directory.Data,
    data: teks,
    encoding: Encoding.UTF8,
    recursive: true,
  });
};

export const bacaChapterJson = async (chapterId) => {
  try {
    return JSON.parse(await bacaTeks(jalurBerkas(chapterId, NAMA_CHAPTER_JSON)));
  } catch {
    return null;
  }
};

export const tulisChapterJson = (chapterId, isi) =>
  tulisTeks(jalurBerkas(chapterId, NAMA_CHAPTER_JSON), JSON.stringify(isi));

/**
 * Nama berkas yang BENAR-BENAR ada di folder satu chapter, atau null kalau
 * foldernya sendiri tidak terbaca.
 *
 * Satu readdir per chapter, bukan satu stat per halaman: chapter webtoon bisa
 * 60 halaman, dan 60 bolak-balik jembatan native hanya untuk membuka reader
 * adalah persis jenis penundaan yang membuat halaman pertama terasa lama.
 */
export const berkasChapter = async (chapterId) => {
  const { Filesystem, Directory } = await fsPlugin();
  try {
    const isi = await Filesystem.readdir({ path: folderChapter(chapterId), directory: Directory.Data });
    return new Set((isi?.files ?? []).map((berkas) => berkas.name));
  } catch {
    return null;
  }
};

/**
 * Buang folder satu chapter. Mengembalikan true kalau foldernya benar-benar
 * sudah tidak ada sesudahnya.
 *
 * Dulu SEMUA kegagalan rmdir dianggap sukses, padahal plugin-nya juga melempar
 * untuk izin ditolak dan galat I/O, bukan hanya untuk folder yang memang tidak
 * ada. Pemanggilnya tetap membuang baris indeksnya, jadi folder berisi 40
 * halaman tertinggal utuh tanpa wakil di katalog mana pun: tidak muncul di
 * /offline, tidak dihitung totalBytesTersimpan. Orang yang menekan "Hapus"
 * justru untuk melegakan ruang melihat angka di kartu turun sementara Setelan →
 * Aplikasi → Penyimpanan tidak bergerak sedikit pun.
 */
const hapusFolder = async (chapterId) => {
  const { Filesystem, Directory } = await fsPlugin();
  try {
    await Filesystem.rmdir({ path: folderChapter(chapterId), directory: Directory.Data, recursive: true });
    return true;
  } catch {
    // Folder yang memang sudah tidak ada juga melempar, dan itu justru keadaan
    // yang paling sering terjadi. Dibedakan dengan stat langsung — BUKAN lewat
    // ukuranBerkas, yang sengaja membalas null untuk direktori dan karena itu
    // tidak bisa membedakan "sudah lenyap" dari "masih utuh di sana".
    try {
      await Filesystem.stat({ path: folderChapter(chapterId), directory: Directory.Data });
      return false;
    } catch {
      return true;
    }
  }
};

/* ── Indeks ─────────────────────────────────────────────────────────── */

/**
 * Bangun ulang katalog dari isi folder.
 *
 * Dipakai kalau index.json hilang atau rusak. Bisa dilakukan justru karena tiap
 * chapter membawa chapter.json-nya sendiri: katalog di sini adalah ringkasan
 * yang bisa dihitung ulang, bukan satu-satunya tempat datanya hidup. Kalau
 * index.json jadi sumber kebenaran tunggal, satu penulisan yang terpotong mati
 * listrik akan melenyapkan puluhan chapter yang berkasnya masih utuh di disk.
 */
const bangunUlang = async () => {
  const { Filesystem, Directory } = await fsPlugin();
  const baru = indeksKosong();
  let isi;
  try {
    isi = await Filesystem.readdir({ path: AKAR, directory: Directory.Data });
  } catch {
    return baru;
  }

  for (const berkas of isi?.files ?? []) {
    if (berkas.type !== 'directory') continue;
    const chapterId = Number(berkas.name);
    if (!Number.isInteger(chapterId)) continue;
    const simpanan = await bacaChapterJson(chapterId);
    if (!simpanan?.chapter?.id) continue;
    baru.chapter[chapterId] = simpanan.chapter;
    if (simpanan.komik?.id) baru.komik[simpanan.komik.id] = simpanan.komik;
  }
  return baru;
};

const sahkan = (mentah) => {
  if (!mentah || typeof mentah !== 'object') return null;
  if (mentah.versi !== VERSI_INDEKS) return null;
  if (!mentah.komik || !mentah.chapter) return null;
  return { versi: VERSI_INDEKS, komik: mentah.komik, chapter: mentah.chapter };
};

const muatIndeks = async () => {
  let hasil = null;
  try {
    hasil = sahkan(JSON.parse(await bacaTeks(BERKAS_INDEKS)));
  } catch {
    hasil = null;
  }
  if (!hasil) {
    // Indeks belum ada (pemasangan baru) atau tidak terbaca. Keduanya ditangani
    // sama: pindai folder, tulis ulang. Yang pertama menghasilkan katalog
    // kosong tanpa satu pun galat ke muka pengguna.
    hasil = await bangunUlang();
    try {
      await tulisTeks(BERKAS_INDEKS, JSON.stringify(hasil));
    } catch {
      /* penyimpanan penuh atau ditolak — katalog di memori tetap bisa dipakai */
    }
  }
  indeks = hasil;
  siarkan();
};

/*
 * Semua penulisan index.json lewat satu rantai promise.
 *
 * Dua chapter bisa selesai nyaris bersamaan (yang satu lewat antrean, yang lain
 * ditekan manual). Tanpa rantai ini keduanya membaca katalog yang sama, menambah
 * barisnya masing-masing, lalu menulis — dan yang menulis belakangan menghapus
 * jejak yang pertama. Chapter itu tetap ada berkasnya di disk tapi tidak pernah
 * muncul di rak offline, dan tidak ada yang tahu kenapa.
 */
let rantai = Promise.resolve();
const diam = () => undefined;

const berurutan = (kerja) => {
  const hasil = rantai.then(kerja, kerja);
  rantai = hasil.then(diam, diam);
  return hasil;
};

const ubahIndeks = (ubah) =>
  berurutan(async () => {
    const kembali = ubah(indeks);
    try {
      await tulisTeks(BERKAS_INDEKS, JSON.stringify(indeks));
    } catch {
      /* gagal menulis katalog: isinya tetap benar di memori sampai aplikasi
         ditutup, dan pemuatan berikutnya akan membangunnya ulang dari folder */
    }
    siarkan();
    return kembali;
  });

/**
 * Daftarkan satu chapter yang berkasnya sudah lengkap.
 *
 * Dipanggil PALING AKHIR oleh unduh.js, sesudah chapter.json ditulis. Urutan
 * itu yang membuat unduhan setengah jalan tidak pernah terlihat selesai:
 * apa pun yang belum ada di indeks dianggap belum ada sama sekali.
 */
export const daftarkanChapter = ({ komik, chapter }) =>
  ubahIndeks((isi) => {
    isi.komik[komik.id] = { ...isi.komik[komik.id], ...komik };
    isi.chapter[chapter.id] = chapter;
  });

export const hapusChapterTersimpan = async (chapterId) => {
  // Baris indeksnya hanya dibuang kalau berkasnya benar-benar lenyap. Katalog
  // adalah satu-satunya tempat ruang terpakai itu masih punya wakil; membuang
  // barisnya sementara foldernya bertahan berarti membuang juga satu-satunya
  // tombol yang bisa mencoba menghapusnya lagi.
  if (!(await hapusFolder(chapterId))) return;
  await ubahIndeks((isi) => {
    const entri = isi.chapter[chapterId];
    delete isi.chapter[chapterId];
    if (!entri) return;
    // Komik tanpa chapter tersisa ikut dibuang. Kalau dibiarkan, rak offline
    // menampilkan kartu komik kosong yang tidak bisa dibuka dan tidak bisa
    // dihapus lewat jalan mana pun.
    const masihAda = Object.values(isi.chapter).some((lain) => lain.comicId === entri.comicId);
    if (!masihAda) delete isi.komik[entri.comicId];
    else if (isi.komik[entri.comicId]?.sampul?.startsWith(`${chapterId}/`)) {
      // Sampul komik ini tersimpan di folder chapter yang barusan dibuang.
      // Dialihkan ke chapter lain yang masih punya, supaya kartunya tidak
      // berubah jadi kotak kosong.
      const pengganti = Object.values(isi.chapter).find(
        (lain) => lain.comicId === entri.comicId && lain.punyaSampul,
      );
      isi.komik[entri.comicId].sampul = pengganti ? `${pengganti.id}/${pengganti.namaSampul}` : null;
    }
  });
};

export const hapusKomikTersimpan = async (comicId) => {
  const daftar = Object.values(indeksSekarang().chapter).filter((entri) => entri.comicId === comicId);

  /*
   * Katalog diperbarui LEBIH DULU, folder-foldernya menyusul.
   *
   * Menghapus komik 200 chapter memakan waktu, dan Android membunuh aplikasi
   * yang ditinggal di latar kapan saja. Dengan urutan sebaliknya — seperti dulu,
   * satu ubahIndeks di paling akhir — yang tersisa saat itu terjadi adalah
   * puluhan baris indeks TANPA berkas: chapter yang tetap tampil di rak, tetap
   * dihitung ukurannya, dan begitu dibuka halamannya tidak ada.
   *
   * Yang tersisa sekarang adalah folder yatim, dan itu dipungut kembali oleh
   * buangSisaTerhapus saat aplikasi dibuka berikutnya. Chapternya muncul lagi di
   * rak — tidak enak dilihat sesudah menekan "Hapus", tapi ia jujur: ruangnya
   * memang masih terpakai, dan tombol hapusnya ada lagi. Baris indeks yatim
   * tidak punya kedua-duanya.
   */
  await ubahIndeks((isi) => {
    daftar.forEach((entri) => delete isi.chapter[entri.id]);
    delete isi.komik[comicId];
  });

  for (const entri of daftar) {
    await hapusFolder(entri.id);
  }
};

/* ── Bacaan katalog ─────────────────────────────────────────────────── */

export const chapterTersimpan = (chapterId) => indeksSekarang().chapter[Number(chapterId)] ?? null;

/*
 * Ketiga pembacaan di bawah menerima petikan katalog sebagai argumen.
 *
 * Bukan gaya, melainkan syarat useMemo: komponen yang memanggilnya sudah
 * berlangganan katalog lewat useIndeksOffline, dan kalau hasilnya dihitung dari
 * state modul tanpa menyebut petikannya, tidak ada satu pun nilai yang bisa
 * ditaruh di daftar dependensi tanpa berbohong.
 */

/** Chapter satu komik, urut nomor — dasar tombol prev/next saat luring. */
export const chapterKomikTersimpan = (comicId, isi = indeksSekarang()) =>
  Object.values(isi.chapter)
    .filter((entri) => entri.comicId === Number(comicId))
    .sort((a, b) => a.nomor - b.nomor);

export const komikTersimpan = (isi = indeksSekarang()) =>
  Object.values(isi.komik)
    .map((komik) => {
      const daftar = chapterKomikTersimpan(komik.id, isi);
      return {
        ...komik,
        chapter: daftar,
        bytes: daftar.reduce((jumlah, entri) => jumlah + (entri.bytes ?? 0), 0),
        // Yang dicari orang adalah "kapan komik ini terakhir kubawa", bukan
        // kapan chapter bernomor terbesar disimpan — dua hal yang berbeda
        // begitu ada chapter lama ditambal belakangan.
        disimpanPada: daftar.reduce(
          (paling, entri) => (paling && paling > entri.disimpanPada ? paling : entri.disimpanPada),
          null,
        ),
      };
    })
    .sort((a, b) => (a.judul ?? '').localeCompare(b.judul ?? ''));

export const totalBytesTersimpan = (isi = indeksSekarang()) =>
  Object.values(isi.chapter).reduce((jumlah, entri) => jumlah + (entri.bytes ?? 0), 0);

/* ── URL yang bisa dipasang di <img> ────────────────────────────────── */

/*
 * Di perangkat sungguhan, akar folder data diselesaikan SEKALI lalu dipakai
 * untuk menyusun URL secara sinkron. Reader merender daftar halaman dalam satu
 * putaran render; kalau tiap halaman perlu satu panggilan async ke jembatan
 * native, halaman pertama baru muncul setelah puluhan bolak-balik yang
 * sebenarnya cuma menyambung string.
 */
let uriAkar = null;

/** Jalur berkas lengkap (file://…) — dibutuhkan @capacitor/file-transfer. */
export const uriBerkas = (chapterId, nama) => (uriAkar ? `${uriAkar}/${chapterId}/${nama}` : null);

/**
 * URL yang bisa dipasang di <img src>.
 *
 * Di HP: convertFileSrc mengubah file:// jadi origin internal WebView, karena
 * WebView menolak memuat file:// dari halaman http. Di browser desktop berkasnya
 * ada di IndexedDB, bukan di sistem berkas, jadi satu-satunya jalan adalah
 * membacanya dan membuat blob URL — dan blob URL itu WAJIB dilepas lagi
 * (bebaskanUrl), kalau tidak isinya menetap di memori sampai tab ditutup.
 */
export const urlLokal = async (chapterId, nama) => {
  if (ASLI_NATIF) {
    const penuh = uriBerkas(chapterId, nama);
    if (penuh && window.Capacitor?.convertFileSrc) return window.Capacitor.convertFileSrc(penuh);
    return null;
  }
  try {
    const { Filesystem, Directory } = await fsPlugin();
    const hasil = await Filesystem.readFile({ path: jalurBerkas(chapterId, nama), directory: Directory.Data });
    const data = hasil?.data;
    if (data instanceof Blob) return URL.createObjectURL(data);
    if (typeof data === 'string' && data) return `data:image/webp;base64,${data}`;
    return null;
  } catch {
    return null;
  }
};

export const bebaskanUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
};

/* ── Penyiapan ──────────────────────────────────────────────────────── */

/**
 * Buang folder chapter yang tidak dikenal katalog.
 *
 * Unduhan yang dibatalkan atau gagal meninggalkan folder berisi puluhan gambar
 * TANPA chapter.json dan tanpa baris indeks. Sisa itu lalu tidak terlihat oleh
 * siapa pun: /offline hanya menggambar isi indeks, totalBytesTersimpan hanya
 * menjumlah entri indeks, dan bangunUlang melewatinya. Tidak ada tombol yang
 * bisa merebut ruangnya kembali — satu-satunya jalan adalah "Hapus data
 * aplikasi", yang sekaligus melenyapkan alamat server, token sesi, dan semua
 * chapter yang sah. Sesudah berbulan-bulan, angka di kartu /offline jadi jauh
 * lebih kecil daripada yang dilihat Android di Setelan → Aplikasi.
 *
 * Disapu di sini, sesudah indeks dimuat dan sebelum ada unduhan yang berjalan,
 * jadi tidak ada folder yang sedang ditulis yang bisa ikut terbuang. Folder yang
 * PUNYA chapter.json tidak dibuang melainkan didaftarkan lagi — lihat alasannya
 * di dalam putaran.
 */
const buangSisaTerhapus = async () => {
  const { Filesystem, Directory } = await fsPlugin();
  let isi;
  try {
    isi = await Filesystem.readdir({ path: AKAR, directory: Directory.Data });
  } catch {
    return;
  }

  for (const berkas of isi?.files ?? []) {
    // index.json ikut terdaftar di sini dan bukan direktori.
    if (berkas.type !== 'directory') continue;
    const chapterId = Number(berkas.name);
    if (!Number.isInteger(chapterId)) continue;
    if (indeks.chapter[chapterId]) continue;

    const simpanan = await bacaChapterJson(chapterId);
    if (simpanan?.chapter?.id && simpanan.komik?.id) {
      /*
       * Chapter yang berkasnya lengkap tapi hilang dari katalog DIPUNGUT
       * kembali, bukan sekadar dilewati.
       *
       * Alasan lamanya — "itu bahan mentah bangunUlang" — tidak pernah berlaku:
       * bangunUlang hanya dipanggil kalau index.json hilang atau tidak lolos
       * sahkan(), sementara keadaan ini justru lahir dengan index.json yang
       * MASIH sah — tulisan katalog gagal karena penyimpanan penuh, atau
       * prosesnya dibunuh di sela tulisChapterJson dan daftarkanChapter. Jadi
       * folder itu tidak pernah dipungut maupun dibuang: tidak muncul di
       * /offline, tidak dihitung totalBytesTersimpan, dan satu-satunya jalan
       * merebut ruangnya adalah "Hapus data aplikasi" — yang sekaligus
       * melenyapkan alamat server, token sesi, dan semua chapter yang sah.
       * Persis penyakit yang penyapu ini mengaku hendak menyembuhkan.
       *
       * Didaftarkan lagi, ia kembali terlihat di rak dan karena itu bisa dihapus
       * lewat tombol yang sudah ada.
       */
      await daftarkanChapter({ komik: simpanan.komik, chapter: simpanan.chapter });
      continue;
    }

    await hapusFolder(chapterId);
  }
};

let penyiapan = null;

const siapkan = async () => {
  if (ASLI_NATIF) {
    try {
      const { Filesystem, Directory } = await fsPlugin();

      /*
       * mkdir punya try SENDIRI, dan ini bukan kerapian — di sinilah seluruh
       * lapisan offline pernah mati.
       *
       * Filesystem.mkdir MENOLAK kalau foldernya sudah ada, recursive:true
       * sekalipun (pesannya "Directory already exists, cannot be overwritten";
       * pastikanFolder di berkas ini sudah mencatat perilaku yang sama).
       * Folder `offline` sudah ada pada SETIAP peluncuran setelah chapter
       * pertama disimpan — jadi keadaan yang paling sering terjadi adalah
       * keadaan yang gagal.
       *
       * Dulu kedua panggilan ini berbagi satu try. Akibatnya: mkdir menolak,
       * getUri tidak pernah dijalankan, dan uriAkar tetap null seumur proses.
       * Dari sana semuanya runtuh tanpa satu pesan galat pun ke muka pengguna:
       *   - urlLokal mengembalikan null, jadi rakitChapterLokal mengaku tidak
       *     punya chapter itu → SETIAP komik tersimpan tidak bisa dibaca sama
       *     sekali, padahal berkas dan katalognya utuh;
       *   - turunkanBerkas melempar "Folder penyimpanan aplikasi tidak bisa
       *     dibuka" → menyimpan chapter baru pun gagal.
       * Yang membuatnya sulit dilihat: pada pemasangan baru foldernya belum ada,
       * jadi mkdir berhasil dan semuanya bekerja — kerusakannya baru muncul
       * pada peluncuran KEDUA, dan sembuh sesaat setiap kali data aplikasi
       * dibersihkan.
       */
      try {
        await Filesystem.mkdir({ path: AKAR, directory: Directory.Data, recursive: true });
      } catch {
        /* sudah ada, dan itu justru keadaan normalnya */
      }

      const { uri } = await Filesystem.getUri({ path: AKAR, directory: Directory.Data });
      uriAkar = uri;
    } catch {
      /* tanpa uriAkar, unduhan native gagal dengan pesan jelas di antrean */
    }
  }
  // Posisi baca ikut dimuat di sini, bukan dari main.jsx: keduanya sama-sama
  // harus siap sebelum reader dibuka pertama kali, dan satu pintu penyiapan
  // lebih sulit dilupakan daripada dua.
  await Promise.all([muatIndeks(), siapkanPosisi()]);

  // Sesudah indeks siap, bukan berbarengan: penyapunya memakai indeks itu untuk
  // memutuskan folder mana yang yatim. Kegagalannya tidak boleh menahan
  // penyiapan — ruang yang belum direbut jauh lebih ringan daripada rak offline
  // yang gagal terbuka.
  try {
    await buangSisaTerhapus();
  } catch {
    /* disapu lagi saat aplikasi dibuka berikutnya */
  }
};

/**
 * Dipanggil main.jsx sebelum render pertama pada build android.
 *
 * Dibatasi waktu dengan alasan yang sama seperti pemuatan alamat server:
 * jembatan native pernah membalas dengan promise yang tidak pernah selesai, dan
 * karena render menunggunya, yang tampil adalah layar putih tanpa sepatah pesan
 * pun. Rak offline yang kosong sesaat jauh lebih bisa dijelaskan daripada itu.
 */
export const siapkanOffline = () => {
  if (!IS_APP) return Promise.resolve();
  if (!penyiapan) {
    penyiapan = Promise.race([
      siapkan().catch(diam),
      new Promise((selesai) => {
        setTimeout(selesai, 4000);
      }),
    ]);
  }
  return penyiapan;
};

/*
 * Id lokal untuk komik dan chapter yang datang LANGSUNG dari situs sumber.
 *
 * Seluruh lapisan offline dibangun di atas satu anggapan: id chapter adalah
 * ANGKA. Nama folder dipakai apa adanya sebagai nama folder (penyimpanan.js),
 * katalog memakainya sebagai kunci objek, bacaLokal.js mengisi bidang `id`
 * jawaban server dengannya, dan rute /read/:chapterId meneruskannya ke reader.
 * Chapter dari situs sumber tidak punya angka seperti itu — yang dimilikinya
 * hanyalah alamat halaman.
 *
 * Jalan yang dipilih: TETAP ANGKA, hanya dari penghitung yang lain. Entri sumber
 * mulai di 1.000.000.000, sementara id dari server rumah saat ini paling besar
 * lima digit, jadi keduanya tidak bisa bertabrakan selama satu abad pemakaian
 * normal. Konsekuensinya penyimpanan.js, bacaLokal.js, Reader, dan rute
 * /read/:chapterId tidak perlu diubah sama sekali — dan itulah seluruh nilainya.
 *
 * Alternatif yang ditolak: id berupa string ("kiryuu:one-piece:1045"). Ia
 * memaksa setiap tempat di atas membedakan dua jenis id, termasuk perbandingan
 * `entri.comicId === Number(comicId)` di chapterKomikTersimpan dan
 * `Number(berkas.name)` di bangunUlang — dua baris yang diam-diam menjawab false
 * untuk seluruh koleksi sumber, tanpa satu pun galat.
 *
 * Berkas ini MURNI: tidak ada impor, tidak menyentuh penyimpanan, tidak
 * menyentuh Capacitor. Dua alasan yang keduanya penting:
 *   1. Reader.jsx (yang ikut ke bundel WEB) perlu `dariSumber()` untuk tahu
 *      kapan tidak boleh menembak server rumah. Mengimpornya dari
 *      penyimpanan.js akan menyeret @capacitor/filesystem ke bundel web.
 *   2. Alokasi id adalah bagian tersulit di fitur ini dan satu-satunya yang
 *      bisa diuji tanpa perangkat: sebagai fungsi murni ia dijalankan langsung
 *      oleh Node (apps/api/scripts/test-id-sumber.js).
 */

/**
 * Awal penghitung id lokal.
 *
 * Angkanya bukan selera: ia harus jauh di atas id server rumah yang paling
 * besar, dan tetap jauh di bawah Number.MAX_SAFE_INTEGER supaya penjumlahan
 * biasa tetap tepat. Satu miliar memenuhi keduanya dengan selisih yang tidak
 * perlu dijelaskan kepada siapa pun.
 */
export const AWAL_ID_SUMBER = 1_000_000_000;

/** Id ini milik entri sumber, bukan entri server rumah? */
export const dariSumber = (id) => {
  const angka = Number(id);
  return Number.isInteger(angka) && angka >= AWAL_ID_SUMBER;
};

const normalHost = (host) =>
  String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');

/**
 * Penanda seri di dalam sebuah host: SELURUH jalur URL-nya, bukan segmen
 * terakhir saja.
 *
 * Segmen terakhir lebih tahan terhadap situs yang memindahkan /manga/x jadi
 * /komik/x, tapi ia juga menyatukan dua seri BERBEDA yang kebetulan berakhiran
 * sama (/manga/naruto dan /manhwa/naruto). Dua kerusakan itu tidak sebanding:
 * yang pertama melahirkan satu kartu kembar di rak — jelek, mudah dilihat,
 * mudah dihapus — sementara yang kedua menumpuk chapter dua komik di dalam satu
 * kartu, dan tombol prev/next melompat dari komik yang satu ke komik yang lain
 * tanpa ada yang tahu kenapa.
 *
 * Garis miring di ujung dibuang: banyak situs menerbitkan kedua bentuknya, dan
 * halaman yang sama tidak boleh menghasilkan dua komik.
 */
export const penandaSeri = (urlSeri) => {
  const teks = String(urlSeri ?? '').trim();
  try {
    const url = new URL(teks);
    const jalur = url.pathname.replace(/\/+$/, '');
    return (jalur || '/').toLowerCase();
  } catch {
    return teks.toLowerCase();
  }
};

/**
 * Penanda satu chapter di dalam satu seri.
 *
 * Nomor chapter yang dipakai, bukan alamatnya: situs sumber rutin mengganti
 * alamat chapter (menambah akhiran, mengubah pola slug) tanpa isinya berubah,
 * dan memakai alamat berarti chapter yang SAMA mendapat id baru — lalu tersimpan
 * dua kali, memakan ruang dua kali, dan muncul dua kali di rak.
 *
 * Chapter tanpa nomor jatuh ke alamatnya. extractSeries sudah membuang tautan
 * yang nomornya tidak terbaca, jadi cabang ini hampir tidak pernah dilewati —
 * tapi "hampir" bukan alasan untuk memetakan seluruhnya ke satu kunci `null`
 * yang akan membuat seluruh chapter tanpa nomor berbagi satu folder.
 */
export const penandaChapter = (nomor, urlChapter) => {
  /*
   * Number() TIDAK dipakai langsung pada nilainya, dan itu bukan kerewelan:
   * Number(null) dan Number('') sama-sama bernilai 0, dan 0 lolos
   * Number.isFinite. Akibatnya SETIAP chapter tanpa nomor memetakan ke kunci
   * yang sama persis, "n0" — seluruhnya berbagi satu id, satu nama folder, dan
   * yang kedua menimpa halaman yang pertama. Persis tabrakan yang paragraf di
   * atas ada untuk mencegah.
   *
   * Yang diterima hanya angka sungguhan, atau teks yang seluruhnya angka
   * (extractSeries sesekali menjawab "10.5" sebagai string). null, undefined,
   * teks kosong, dan boolean jatuh ke alamatnya.
   */
  const angka = typeof nomor === 'string' && nomor.trim() !== '' ? Number(nomor) : nomor;
  if (typeof angka === 'number' && Number.isFinite(angka)) return `n${angka}`;
  return `u${penandaSeri(urlChapter)}`;
};

export const kunciKomik = (host, urlSeri) => `${normalHost(host)}|${penandaSeri(urlSeri)}`;

export const kunciChapter = (host, urlSeri, nomor, urlChapter) =>
  `${kunciKomik(host, urlSeri)}|${penandaChapter(nomor, urlChapter)}`;

export const pemetaanKosong = () => ({ berikut: AWAL_ID_SUMBER, komik: {}, chapter: {} });

const idSah = (nilai) => {
  const angka = Number(nilai);
  return Number.isInteger(angka) && angka >= AWAL_ID_SUMBER ? angka : null;
};

const salinPeta = (mentah) => {
  const bersih = {};
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) return bersih;
  Object.entries(mentah).forEach(([kunci, nilai]) => {
    const id = idSah(nilai);
    if (id !== null) bersih[kunci] = id;
  });
  return bersih;
};

/**
 * Bereskan blok pemetaan yang dibaca dari index.json.
 *
 * `berikut` selalu dihitung ulang sebagai satu di atas id terbesar yang benar-
 * benar terpakai, bukan dipercaya apa adanya. index.json ditulis ulang setiap
 * kali katalog berubah dan bisa terpotong mati listrik; `berikut` yang mundur
 * (atau hilang) akan membuat alokasi berikutnya mengembalikan id yang SUDAH
 * dipakai chapter lain — dan karena id adalah nama folder, chapter baru akan
 * menulis halamannya ke dalam folder chapter yang sudah tersimpan.
 *
 * `idTerpakai` adalah id yang dipegang KATALOG (baris komik dan chapter),
 * bukan pemetaan. Keduanya bisa berbeda: blok pemetaan hilang sementara baris
 * katalognya utuh adalah bentuk kerusakan yang paling mungkin terjadi, karena
 * pemetaan adalah bagian yang paling baru ditambahkan dan paling mudah hilang
 * saat katalog ditulis ulang oleh versi lain. Tanpa memperhitungkannya,
 * penghitung dimulai dari nol lagi tepat di atas folder yang sudah terisi.
 */
export const sahkanPemetaan = (mentah, idTerpakai = []) => {
  const peta = {
    berikut: AWAL_ID_SUMBER,
    komik: salinPeta(mentah?.komik),
    chapter: salinPeta(mentah?.chapter),
  };

  const diminta = Number(mentah?.berikut);
  let batas = Number.isInteger(diminta) && diminta > AWAL_ID_SUMBER ? diminta : AWAL_ID_SUMBER;
  [...Object.values(peta.komik), ...Object.values(peta.chapter), ...idTerpakai].forEach((nilai) => {
    const id = idSah(nilai);
    if (id !== null && id + 1 > batas) batas = id + 1;
  });
  peta.berikut = batas;
  return peta;
};

/**
 * Ambilkan id lokal untuk satu chapter sumber, buat baru kalau belum ada.
 *
 * MENGUBAH `pemetaan` DI TEMPAT, dan itu disengaja: pemanggilnya adalah
 * ubahIndeks() di penyimpanan.js, yang menyerikan seluruh perubahan katalog
 * lewat satu rantai promise dan menulis index.json sesudahnya. Karena setiap
 * alokasi lewat rantai itu, dua chapter dari komik yang sama yang diantre
 * berbarengan tidak bisa sama-sama melihat "belum ada" lalu melahirkan dua
 * comicId — pemenang pertama sudah tercatat sebelum yang kedua mulai membaca.
 *
 * @returns {{ comicId: number, chapterId: number, baru: boolean }}
 */
export const alokasikanId = (pemetaan, { host, urlSeri, nomor, urlChapter }) => {
  const kk = kunciKomik(host, urlSeri);
  const kc = kunciChapter(host, urlSeri, nomor, urlChapter);

  const ambil = (peta, kunci) => {
    const ada = idSah(peta[kunci]);
    if (ada !== null) return { id: ada, baru: false };
    const id = pemetaan.berikut;
    pemetaan.berikut = id + 1;
    peta[kunci] = id;
    return { id, baru: true };
  };

  const komik = ambil(pemetaan.komik, kk);
  const chapter = ambil(pemetaan.chapter, kc);
  return { comicId: komik.id, chapterId: chapter.id, baru: chapter.baru };
};

/** Id chapter sumber yang SUDAH pernah dialokasikan, atau null. Tanpa efek. */
export const idChapterTerdaftar = (pemetaan, { host, urlSeri, nomor, urlChapter }) =>
  idSah(pemetaan?.chapter?.[kunciChapter(host, urlSeri, nomor, urlChapter)]);

/**
 * Bangun ulang pemetaan dari entri chapter yang ada di katalog.
 *
 * Dipakai saat index.json hilang atau rusak (bangunUlang di penyimpanan.js).
 * Tanpa ini, katalog yang dipulihkan dari folder akan kehilangan seluruh
 * pemetaannya: chapter 1–4 sebuah komik sumber tetap terbaca di rak, tapi
 * menyimpan chapter 5 melahirkan comicId BARU — dan komik yang sama muncul dua
 * kali di rak dengan tombol prev/next yang tidak pernah menyambung.
 *
 * Itu sebabnya entri chapter sumber wajib membawa blok `sumber`-nya sendiri ke
 * dalam chapter.json: ia satu-satunya bahan yang membuat pemulihan ini mungkin.
 */
export const pemetaanDariChapter = (daftar = []) => {
  const peta = pemetaanKosong();
  const terpakai = [];
  daftar.forEach((entri) => {
    // Id-nya dicatat lebih dulu, bahkan untuk entri yang blok `sumber`-nya tidak
    // terbaca: folder bernama id itu tetap ada di disk, jadi penghitung tidak
    // boleh menawarkannya lagi kepada chapter berikutnya.
    terpakai.push(entri?.id, entri?.comicId);
    const sumber = entri?.sumber;
    if (!sumber?.host || !sumber?.urlSeri) return;
    if (!dariSumber(entri.id) || !dariSumber(entri.comicId)) return;
    peta.komik[kunciKomik(sumber.host, sumber.urlSeri)] = Number(entri.comicId);
    peta.chapter[kunciChapter(sumber.host, sumber.urlSeri, entri.nomor, sumber.urlChapter)] = Number(entri.id);
  });
  return sahkanPemetaan(peta, terpakai);
};

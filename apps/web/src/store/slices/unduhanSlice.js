import { createSlice } from '@reduxjs/toolkit';

/**
 * Antrean "simpan ke HP" — hanya dipasang pada build Android.
 *
 * Keadaannya ditaruh di redux, bukan di modul unduh.js, karena empat layar
 * menanyakan hal yang sama pada saat bersamaan: tombol per chapter di halaman
 * detail, panel simpan massal di atasnya, halaman /offline, dan lencana di
 * sidebar. Dengan state di modul, keempatnya perlu langganan sendiri-sendiri
 * dan gampang tertinggal satu render.
 *
 * Chapter yang sedang diunduh TETAP berada di `antre` (selalu di kepala) dan
 * hanya dicerminkan ke `sedang`. Itu membuat pertanyaan yang paling sering
 * diajukan antarmuka — "chapter ini sudah diantre atau belum?" — cukup satu
 * pemeriksaan, bukan dua yang bisa tidak sinkron sesaat.
 */

const keadaanAwal = {
  // [{ chapterId, comicId, nomor, judulKomik, slugKomik }]
  antre: [],
  sedang: null,
  // Kemajuan dihitung dalam HALAMAN, bukan persen: halaman komik panjang
  // ukurannya sangat tidak rata, jadi "7/18" lebih jujur daripada "39%".
  selesai: 0,
  total: 0,
  galat: null,
  /*
   * Antrean berhenti menunggu jaringan, bukan gagal.
   *
   * Keluar jangkauan Wi-Fi membuat setiap permintaan gagal seketika. Kalau itu
   * dicatat sebagai `galat`, chapternya dibuang dari antrean dan putarannya
   * langsung melahap chapter berikutnya dengan cara yang sama — sepuluh chapter
   * lenyap dalam milidetik. Jadi kegagalan jaringan menahan antrean utuh dan
   * cuma menandainya di sini; isinya { chapterId, pesan }.
   */
  tertahan: null,
};

const buang = (antre, chapterId) => antre.filter((item) => item.chapterId !== chapterId);

// Penanda murni di depan createSlice bukan hiasan. store/index.js memasang
// reducer ini hanya kalau IS_APP, dan pada build web ekspresi itu runtuh jadi
// objek kosong — tapi tanpa penanda, Rollup tetap menganggap panggilan di ruang
// modul sebagai efek samping dan seluruh berkas ikut terbawa ke bundel web
// sebagai kode mati.
const irisan = /*#__PURE__*/ createSlice({
  name: 'unduhan',
  initialState: keadaanAwal,
  reducers: {
    antrekan(state, action) {
      const masuk = Array.isArray(action.payload) ? action.payload : [action.payload];
      masuk.forEach((item) => {
        // Menekan tombol dua kali, atau "Simpan 10 berikutnya" yang tumpang
        // tindih dengan yang sudah diantre, tidak boleh melahirkan dua unduhan
        // untuk chapter yang sama — yang kedua akan berebut berkas yang sama.
        if (state.antre.some((ada) => ada.chapterId === item.chapterId)) return;
        state.antre.push(item);
      });
    },
    mulai(state, action) {
      state.sedang = action.payload;
      state.selesai = 0;
      state.total = 0;
      state.galat = null;
      state.tertahan = null;
    },
    maju(state, action) {
      state.selesai = action.payload.selesai;
      state.total = action.payload.total;
    },
    beres(state, action) {
      state.antre = buang(state.antre, action.payload);
      state.sedang = null;
      state.selesai = 0;
      state.total = 0;
    },
    gagal(state, action) {
      state.antre = buang(state.antre, action.payload.chapterId);
      state.sedang = null;
      state.selesai = 0;
      state.total = 0;
      state.galat = { chapterId: action.payload.chapterId, pesan: action.payload.pesan };
    },
    /*
     * Jaringan hilang: antrean DITAHAN, tidak dibuang.
     *
     * Ini satu-satunya reducer yang meninggalkan chapter di kepala antrean
     * sesudah kegagalan. Itu memang inti perbedaannya dengan `gagal`: yang
     * dibutuhkan bukan pesan galat melainkan daftar chapternya, supaya begitu
     * HP-nya kembali ke Wi-Fi rumah unduhannya lanjut dari tempat berhenti
     * tanpa orangnya harus mengingat dan menekan sepuluh tombol simpan lagi.
     */
    tunda(state, action) {
      state.sedang = null;
      state.selesai = 0;
      state.total = 0;
      state.tertahan = { chapterId: action.payload.chapterId, pesan: action.payload.pesan };
    },
    buangSatu(state, action) {
      state.antre = buang(state.antre, action.payload);
    },
    // Galat terakhir tidak punya aksi "tutup": ia hilang sendiri begitu chapter
    // berikutnya mulai diunduh. Tombol tutup hanya menambah cara untuk
    // menyembunyikan kabar buruk tanpa memperbaikinya.
    kosongkan(state) {
      // `sedang` sengaja tidak disentuh: pembatalan chapter yang sedang jalan
      // dikerjakan pelarinya sendiri lewat penanda batal, dan menghapusnya di
      // sini hanya membuat antarmuka mengaku berhenti sebelum berkasnya betul-
      // betul berhenti ditulis.
      state.antre = state.sedang ? state.antre.filter((item) => item.chapterId === state.sedang.chapterId) : [];
      // Antrean yang sedang menunggu jaringan ikut dikosongkan di sini, jadi
      // tidak ada lagi yang ditunggu.
      state.tertahan = null;
    },
  },
});

/*
 * Setiap sentuhan ke objek irisan dibungkus fungsi, bukan diekspor lewat
 * destrukturisasi seperti dua irisan lain di folder ini.
 *
 * Alasannya sama dengan penanda murni di atas, dan sudah terbukti sekali:
 * `export const { antrekan } = irisan.actions` adalah PEMBACAAN PROPERTI di
 * ruang modul, dan Rollup wajib menganggapnya mungkin punya efek samping —
 * properti bisa saja getter. Satu baris itu cukup untuk menahan seluruh berkas
 * ini, createSlice berikut immer-nya, di dalam bundel web yang tidak punya satu
 * pun tombol simpan-ke-HP. Dibungkus fungsi, tidak ada apa pun yang dijalankan
 * saat modul dimuat dan bundel web kehilangan seluruhnya.
 */
export const antrekan = (isi) => irisan.actions.antrekan(isi);
export const mulai = (isi) => irisan.actions.mulai(isi);
export const maju = (isi) => irisan.actions.maju(isi);
export const beres = (chapterId) => irisan.actions.beres(chapterId);
export const gagal = (isi) => irisan.actions.gagal(isi);
export const tunda = (isi) => irisan.actions.tunda(isi);
export const buangSatu = (chapterId) => irisan.actions.buangSatu(chapterId);
export const kosongkan = () => irisan.actions.kosongkan();

export const unduhanReducer = (keadaan, aksi) => irisan.reducer(keadaan, aksi);

/**
 * Keadaan satu chapter menurut antrean: null (tidak diantre), 'antre', atau
 * 'mengunduh' lengkap dengan kemajuannya. Dipakai tombol di halaman detail dan
 * daftar di /offline supaya keduanya membaca aturan yang sama persis.
 */
export const statusUnduh = (unduhan, chapterId) => {
  if (unduhan.sedang?.chapterId === chapterId) {
    return { keadaan: 'mengunduh', selesai: unduhan.selesai, total: unduhan.total };
  }
  if (unduhan.antre.some((item) => item.chapterId === chapterId)) {
    return { keadaan: 'antre', selesai: 0, total: 0 };
  }
  return null;
};

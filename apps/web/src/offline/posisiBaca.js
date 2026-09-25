import { IS_APP } from '../platform/index.js';
import { tokenSesi, urlServer } from '../platform/server.js';

/**
 * Posisi baca di HP: dicatat lokal dulu, dikirim ke server kalau sempat.
 *
 * Di web, menyimpan posisi baca adalah satu PUT yang boleh gagal — halamannya
 * toh datang dari server yang sama, jadi kalau PUT gagal, berarti servernya
 * memang mati dan tidak ada yang bisa membaca apa pun. Di HP tidak begitu:
 * chapter yang sudah disimpan tetap bisa dibaca sampai habis di kereta, dan
 * semua posisi baca selama perjalanan itu akan lenyap kalau hanya dikirim
 * sekali lalu dilupakan.
 *
 * Jadi setiap simpanan masuk penyimpanan HP bersama WAKTU BACANYA, lalu
 * diantre. Server sudah menerima read_at dan hanya menimpa kalau kiriman itu
 * lebih baru (lihat progressService.saveProgress), jadi antrean yang baru
 * terkirim dua jam kemudian tidak bisa memundurkan posisi yang sementara itu
 * dibuat dari desktop.
 */

const KUNCI = 'naruread:posisi-baca';
const VERSI = 1;

/*
 * Batas jumlah baris yang disimpan.
 *
 * Satu baris per chapter yang pernah dibuka. Koleksi ini punya komik 776
 * chapter, dan pembaca berat bisa menyentuh ribuan chapter dalam setahun —
 * dibiarkan tumbuh, satu nilai Preferences bisa jadi ratusan KB yang dibaca
 * utuh setiap aplikasi dibuka. Yang dibuang selalu yang paling lama tidak
 * disentuh, dan hanya yang sudah terkirim ke server.
 */
const BATAS_BARIS = 2000;

let modulPrefs = null;

// Sama seperti di platform/server.js: proxy plugin tidak boleh dikembalikan
// langsung dari fungsi async, karena `.then`-nya ikut dianggap panggilan plugin.
const prefs = async () => {
  if (!modulPrefs) modulPrefs = await import('@capacitor/preferences');
  return { Preferences: modulPrefs.Preferences };
};

/*
 * bedaJam: jam server dikurangi jam HP, dalam milidetik.
 *
 * Dipelajari dari jawaban PUT (read_at yang benar-benar tersimpan dibanding
 * stempel yang barusan dikirim) dan dipakai untuk menggeser waktu lokal ke garis
 * waktu server sebelum dibandingkan. Tanpa itu `lanjutDari` membandingkan dua
 * jam yang berbeda: HP yang jamnya tertinggal akan menganggap baris server yang
 * lebih tua sebagai yang lebih baru, lalu melompat mundur ke halaman yang
 * ditinggalkan desktop. Ketelitiannya sampai detik saja karena kolom server
 * memang hanya berpresisi detik — cukup, sebab yang dilawan adalah selisih
 * puluhan detik sampai menit, bukan milidetik.
 */
let data = { versi: VERSI, posisi: {}, antre: [], bedaJam: 0 };

/**
 * Waktu dari server dan waktu dari HP dibandingkan dalam milidetik.
 *
 * Server menyimpan 'YYYY-MM-DD HH:MM:SS' dalam UTC tanpa penanda zona; kalau
 * string itu diserahkan ke Date() apa adanya, browser membacanya sebagai waktu
 * LOKAL dan hasilnya meleset sebesar offset zona waktu — tujuh jam di sini,
 * cukup untuk membuat posisi server selalu menang atau selalu kalah.
 */
const msDari = (waktu) => {
  if (!waktu) return 0;
  const teks = String(waktu);
  const iso = teks.includes('T') ? teks : `${teks.replace(' ', 'T')}Z`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

let rantai = Promise.resolve();
const diam = () => undefined;

const simpan = () => {
  // Penulisan diserikan: reader menyimpan tiap 800 ms sambil digulir, dan dua
  // penulisan yang tumpang tindih akan saling menimpa seluruh objeknya — bukan
  // hanya barisnya.
  rantai = rantai.then(async () => {
    try {
      const { Preferences } = await prefs();
      await Preferences.set({ key: KUNCI, value: JSON.stringify(data) });
    } catch {
      /* penyimpanan ditolak: posisi tetap benar selama aplikasi hidup */
    }
  }, diam);
  return rantai;
};

const pangkas = () => {
  const kunci = Object.keys(data.posisi);
  if (kunci.length <= BATAS_BARIS) return;
  const menunggu = new Set(data.antre.map(String));
  kunci
    .filter((id) => !menunggu.has(id))
    .sort((a, b) => msDari(data.posisi[a]?.readAt) - msDari(data.posisi[b]?.readAt))
    .slice(0, kunci.length - BATAS_BARIS)
    .forEach((id) => delete data.posisi[id]);
};

export const siapkanPosisi = async () => {
  if (!IS_APP) return;
  try {
    const { Preferences } = await prefs();
    const { value } = await Preferences.get({ key: KUNCI });
    const mentah = value ? JSON.parse(value) : null;
    if (mentah?.versi === VERSI && mentah.posisi) {
      data = {
        versi: VERSI,
        posisi: mentah.posisi,
        antre: Array.isArray(mentah.antre) ? mentah.antre : [],
        bedaJam: Number.isFinite(mentah.bedaJam) ? mentah.bedaJam : 0,
      };
    }
  } catch {
    // Isinya tidak terbaca (versi lama, JSON terpotong). Dimulai dari kosong:
    // posisi baca yang hilang hanya berarti satu chapter dibuka dari awal,
    // sementara melempar galat di sini menahan seluruh aplikasi.
  }
};

export const posisiLokal = (chapterId) => data.posisi[String(chapterId)] ?? null;

/**
 * Halaman tempat chapter ini harus dilanjutkan.
 *
 * Yang menang adalah yang paling BARU, bukan yang paling jauh. Membaca ulang
 * dari awal adalah tindakan sadar; kalau posisi terjauh yang selalu menang,
 * pembaca yang mengulang chapter dari halaman 1 akan dilempar kembali ke
 * halaman 40 setiap kali membukanya.
 */
export const lanjutDari = (chapterId, chapterServer) => {
  const lokal = posisiLokal(chapterId);
  const halamanServer = chapterServer?.lastPageRead ?? null;
  if (!lokal) return halamanServer;
  if (!halamanServer) return lokal.halaman;
  // Waktu lokal digeser ke garis waktu server dulu; keduanya dicatat oleh jam
  // yang berbeda dan selisih jam HP tidak boleh menentukan siapa yang menang.
  return msDari(lokal.readAt) + data.bedaJam >= msDari(chapterServer?.readAt) ? lokal.halaman : halamanServer;
};

/**
 * @param {{chapterId:number, comicId:number, halaman:number}} isi
 */
export const catatPosisi = ({ chapterId, comicId, halaman }) => {
  const id = String(chapterId);
  data.posisi[id] = { comicId, halaman, readAt: new Date().toISOString() };

  /*
   * Tamu tidak diantrekan sama sekali. Server menolak PUT progress tanpa akun
   * (posisi baca itu data pribadi), jadi antrean milik tamu hanya akan menumpuk
   * selamanya dan setiap kali tersambung menembakkan 401 beruntun.
   *
   * Yang ditanya adalah ADA-TIDAKNYA TOKEN, bukan jawaban /auth/me. Itu bukan
   * penyederhanaan melainkan syarat: justru saat luring-lah antrean ini berguna,
   * dan saat luring /auth/me gagal sehingga useAuth melaporkan "belum masuk"
   * untuk semua orang. Memakai jawabannya berarti tidak ada satu pun posisi baca
   * luring yang pernah diantrekan — persis hal yang berkas ini ada untuk
   * mencegahnya. Token yang ternyata sudah mati tidak berbahaya: apiSlice
   * membuangnya begitu server menjawab 401, dan antrean berhenti sendiri.
   */
  if (tokenSesi() && !data.antre.includes(id)) data.antre.push(id);

  pangkas();
  simpan();
  kirimAntrean();
};

let sedangKirim = false;

/**
 * Kosongkan antrean ke server. Aman dipanggil kapan saja — saat menyimpan, saat
 * jaringan kembali, saat aplikasi dibangunkan.
 */
export const kirimAntrean = async () => {
  if (!IS_APP || sedangKirim) return;
  if (!tokenSesi() || data.antre.length === 0) return;

  sedangKirim = true;
  // Ada baris yang tertinggal karena berubah selagi PUT-nya menggantung? Satu
  // putaran hanya menyentuh tiap id sekali, dan catatPosisi yang memanggil
  // fungsi ini balik seketika selama sedangKirim masih menyala — tanpa putaran
  // susulan, nilai barunya menunggu sampai aplikasi dibuka lagi.
  let ulangi = false;
  try {
    for (const id of [...data.antre]) {
      const baris = data.posisi[id];
      if (!baris) {
        data.antre = data.antre.filter((lain) => lain !== id);
        continue;
      }

      // Cap waktu baris SEBELUM dikirim. Nilainya unik per pencatatan karena
      // catatPosisi selalu menulis stempel baru, jadi cukup untuk mengenali
      // apakah barisnya berubah selagi PUT ini menggantung.
      const capWaktu = baris.readAt;

      let res;
      try {
        res = await fetch(urlServer(`/api/chapters/${id}/progress`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-NaruReader-Klien': 'android',
            Authorization: `Bearer ${tokenSesi()}`,
          },
          body: JSON.stringify({
            last_page_read: baris.halaman,
            read_at: capWaktu,
            // Jam HP saat paket ini berangkat: server memakai selisihnya
            // terhadap read_at (umur kiriman) supaya jam HP yang melenceng
            // tidak ikut menentukan siapa yang menang.
            dikirim_pada: new Date().toISOString(),
          }),
        });
      } catch {
        // Jaringan putus di tengah antrean. Berhenti di sini dan biarkan sisanya
        // menunggu: mencoba semuanya hanya menghabiskan waktu untuk kegagalan
        // yang sudah pasti sama.
        break;
      }

      if (res.ok) {
        // Jawaban membawa read_at yang benar-benar tersimpan, dalam jam server.
        // Dibandingkan dengan stempel yang barusan dikirim, itu memberi selisih
        // jam HP terhadap server — satu-satunya kesempatan mempelajarinya.
        // Hanya dipakai kalau kiriman ini yang menang; kalau kalah, read_at yang
        // dikembalikan milik baris lain dan selisihnya jadi ngawur.
        try {
          const jawab = await res.json();
          if (jawab?.diterapkan && jawab.readAt) {
            const beda = msDari(jawab.readAt) - msDari(capWaktu);
            if (Number.isFinite(beda)) data.bedaJam = beda;
          }
        } catch {
          /* badan jawaban tidak terbaca: selisih jam lama tetap dipakai */
        }
      }

      if (res.ok || res.status === 404 || res.status === 403) {
        // 404 dan 403 permanen: chapternya sudah dihapus di server, atau akun
        // ini memang tidak berhak menulisnya. Menahannya di antrean berarti
        // mencobanya lagi selamanya.
        //
        // Dibuang HANYA kalau barisnya masih sama. catatPosisi yang jalan selagi
        // PUT ini menggantung (debounce 800 ms, PUT di Wi-Fi lambat bisa lebih
        // lama) menimpa data.posisi[id] tanpa mengantrekan ulang — id-nya masih
        // ada di antrean, jadi `!data.antre.includes(id)` menolaknya. Membuang
        // id di sini akan mengubur halaman yang lebih baru itu untuk selamanya.
        if (data.posisi[id]?.readAt === capWaktu) {
          data.antre = data.antre.filter((lain) => lain !== id);
        } else {
          ulangi = true;
        }
      } else if (res.status === 401) {
        // Sesi mati. Antrean ditahan utuh — begitu orangnya masuk lagi, seluruh
        // riwayat bacanya menyusul dengan waktu aslinya.
        break;
      } else {
        break;
      }
    }
  } finally {
    sedangKirim = false;
    simpan();
  }

  // Putarannya berhenti sendiri: tiap putaran butuh satu perjalanan ke server,
  // jadi ia hanya berulang selama orangnya masih menggulir, dan berakhir begitu
  // halamannya menetap.
  if (ulangi) kirimAntrean();
};

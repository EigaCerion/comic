import { usePembaruan } from './pembaruan.js';
import { formatRelativeTime } from '../utils/format.js';

/**
 * Bagian "Versi aplikasi" di halaman Pengaturan, khusus build Android.
 *
 * Di web pertanyaannya tidak pernah ada: halamannya dimuat ulang dari server
 * tiap kali dibuka, jadi "versi yang dipakai" selalu yang terbaru. APK yang
 * dipasang lewat sideload justru kebalikannya — ia diam di HP sampai ada yang
 * mengganti, dan tidak ada toko aplikasi yang memberi tahu.
 *
 * Kelas Tailwind di sini sengaja dipilih dari yang SUDAH dipakai layar lain.
 * Tailwind memindai seluruh src/ apa adanya, jadi ia tidak tahu berkas ini cuma
 * hidup di build android: satu warna baru saja sudah menambah aturan CSS ke
 * bundel web yang tidak akan pernah memakainya.
 */

/**
 * Tombol unduh memanggil mulaiUnduhPembaruan(), BUKAN sebuah <a href>.
 *
 * Dulu memang <a href target="_blank">, dengan alasan bahwa jembatan Capacitor
 * sudah menyerahkan host luar ke Android lewat Intent.ACTION_VIEW. Benar, tapi
 * tidak cukup: Bridge.launchIntent() memanggil startActivity TANPA
 * FLAG_ACTIVITY_NEW_TASK, jadi browsernya berdiri DI DALAM tumpukan tugas
 * NaruReader. Untuk berkas 30-an MB, kembali ke aplikasi ini berarti mendorong
 * jendela yang sedang mengunduh ke belakang — dan itulah yang terlihat sebagai
 * unduhan yang berhenti tepat di akhir. Penjelasan lengkapnya di
 * android/.../BukaDiLuar.java.
 *
 * PEMASANGANNYA tetap dikerjakan Android, bukan aplikasi ini. Memasang sendiri
 * dari dalam aplikasi menuntut izin REQUEST_INSTALL_PACKAGES plus FileProvider
 * untuk menyerahkan berkasnya ke installer — izin yang persis membuat aplikasi
 * hasil sideload terlihat mencurigakan, demi menghemat dua ketukan. Sengaja di
 * luar cakupan; yang ditambahkan sebagai gantinya adalah petunjuk langkah demi
 * langkah di bawah tombolnya.
 */
const waktuRelatif = (ms) => (Number.isFinite(ms) ? formatRelativeTime(new Date(ms).toISOString()) : 'belum pernah');

/** Byte jadi MB satu desimal — satuan yang dipakai orang untuk berkas 30-an MB. */
const mb = (byte) => `${(Number(byte || 0) / 1048576).toFixed(1)} MB`;

const Baris = ({ label, nilai }) => (
  <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
    <span className="opacity-60">{label}</span>
    <span className="font-mono font-semibold">{nilai}</span>
  </div>
);

export const KartuPembaruan = () => {
  const {
    versiTerpasang,
    versiRilis,
    urlUnduh,
    diperiksaPada,
    dicobaPada,
    sedangMemeriksa,
    galat,
    adaPembaruan,
    sedangDiunduh,
    galatUnduh,
    namaBerkas,
    unduhanId,
    unduhanKeadaan,
    unduhanTerunduh,
    unduhanTotal,
    unduhanAktif,
    unduhanSelesai,
    unduhanRusak,
    unduhanGagal,
    persenUnduh,
    cekPembaruan,
    mulaiUnduhPembaruan,
    bukaUnduhan,
    batalkanUnduhanPembaruan,
  } = usePembaruan();

  // Enam keadaan yang benar-benar berbeda, dan hanya SATU di antaranya boleh
  // berbunyi "sudah terbaru": pemeriksaan yang gagal tidak tahu apa-apa tentang
  // versi terbaru, dan mengatakan aplikasinya mutakhir justru membuat orang
  // berhenti memeriksa. "Belum pernah diperiksa" juga bukan "sudah terbaru".
  //
  // Versi TERPASANG yang belum diketahui adalah keadaan keenam, dan dulu ia
  // jatuh ke cabang hijau. adaPembaruan hanya benar kalau bandingVersi === 1,
  // jadi versiTerpasang null membuatnya false — dan tanpa cabang sendiri,
  // titik hijau "Sudah versi terbaru" muncul tepat di atas baris yang
  // membantahnya, "Terpasang: tidak diketahui". Jendelanya nyata: versiTerpasang
  // baru disiarkan setelah penyiapan selesai membaca Preferences, sementara
  // tombol di bawah sudah aktif sejak render pertama.
  const nada = adaPembaruan
    ? { titik: 'bg-primary', teks: 'text-primary', label: `Versi ${versiRilis} tersedia` }
    : sedangMemeriksa
      ? { titik: 'bg-txt-2/40', teks: 'opacity-60', label: 'Memeriksa…' }
      : galat
        ? { titik: 'bg-danger', teks: 'text-danger', label: 'Belum bisa diperiksa' }
        : versiTerpasang == null
          ? { titik: 'bg-txt-2/40', teks: 'opacity-60', label: 'Versi terpasang belum diketahui' }
          : diperiksaPada
            ? { titik: 'bg-success', teks: 'text-success', label: 'Sudah versi terbaru' }
            : { titik: 'bg-txt-2/40', teks: 'opacity-60', label: 'Belum pernah diperiksa' };

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">
        <span aria-hidden="true">⬆️</span>
        Versi aplikasi
      </h2>

      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 flex-none rounded-full ${nada.titik}`} aria-hidden="true" />
        <span className={`text-sm font-bold ${nada.teks}`}>{nada.label}</span>
      </div>

      <div className="mt-3">
        <Baris label="Terpasang" nilai={versiTerpasang ?? 'tidak diketahui'} />
        <Baris label="Di GitHub" nilai={versiRilis ?? '—'} />
        <Baris label="Terakhir diperiksa" nilai={waktuRelatif(diperiksaPada)} />
      </div>

      {galat && (
        <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {galat}. Angka di atas adalah hasil pemeriksaan terakhir yang berhasil
          {dicobaPada ? `; terakhir dicoba ${waktuRelatif(dicobaPada)}` : ''}.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => cekPembaruan()} disabled={sedangMemeriksa}>
          {sedangMemeriksa ? 'Memeriksa…' : 'Cek pembaruan'}
        </button>
        {adaPembaruan && urlUnduh && !unduhanAktif && (
          <button type="button" className="btn-accent flex-1 text-center" onClick={() => mulaiUnduhPembaruan()}>
            {unduhanSelesai ? 'Unduh ulang' : unduhanRusak || unduhanGagal ? 'Coba lagi' : `Unduh ${versiRilis}`}
          </button>
        )}
      </div>

      {/* Galat UNDUHAN, bukan galat pemeriksaan — kalimatnya berdiri sendiri
          tanpa embel-embel soal angka versi di atas. Ini juga yang menjamin
          tombol Unduh tidak pernah lagi bisa ditekan tanpa menghasilkan apa
          pun: setiap jalan buntu di baliknya berakhir di kotak ini. */}
      {galatUnduh && (
        <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{galatUnduh}</p>
      )}

      {/* Unduhan SEDANG berjalan. Bilah progresnya bukan hiasan: unduhan 31 MB
          tanpa angka yang bergerak adalah unduhan yang disangka macet, lalu
          ditekan lagi — persis kebiasaan yang membuat berkas separuh jadi
          menumpuk di folder Download. */}
      {unduhanAktif && (
        <div className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-primary">
              {unduhanKeadaan === 'jeda' ? 'Unduhan dijeda sistem' : 'Mengunduh di latar belakang'}
            </p>
            <button type="button" className="font-semibold underline opacity-70" onClick={() => batalkanUnduhanPembaruan()}>
              Batalkan
            </button>
          </div>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/20">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: persenUnduh == null ? '100%' : `${persenUnduh}%` }}
            />
          </div>

          <p className="mt-1.5 tabular-nums opacity-70">
            {persenUnduh == null ? 'Besarnya belum diketahui' : `${persenUnduh}%`}
            {unduhanTotal > 0 && ` · ${mb(unduhanTerunduh)} dari ${mb(unduhanTotal)}`}
          </p>

          <p className="mt-2 opacity-70">
            Unduhan ini milik sistem, bukan aplikasi ini — ia tetap berjalan meski NaruReader ditutup.
          </p>
        </div>
      )}

      {/* Selesai DAN ukurannya cocok. Pemasangannya tetap dimulai orangnya
          sendiri dari daftar unduhan: memasang dari dalam aplikasi menuntut izin
          REQUEST_INSTALL_PACKAGES, persis izin yang membuat aplikasi hasil
          sideload dicurigai Play Protect. */}
      {unduhanSelesai && (
        <div className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-xs">
          <p className="font-semibold text-success">Unduhan selesai dan ukurannya cocok</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4 opacity-70">
            <li>Ketuk tombol di bawah, atau buka notifikasi unduhan selesai.</li>
            <li>Ketuk {namaBerkas ?? `NaruReader-${versiRilis}.apk`}, izinkan pemasangan dari sumber itu, lalu Pasang.</li>
          </ol>
          <p className="mt-2 opacity-70">
            Komik yang sudah tersimpan di HP tidak ikut terhapus dan tidak perlu diunduh ulang.
          </p>
          <button type="button" className="btn-accent mt-2 w-full" onClick={() => bukaUnduhan()}>
            Buka unduhan
          </button>
        </div>
      )}

      {/* Jalur cadangan: unduhan diserahkan ke browser karena unduhan sistem
          tidak bisa dipakai. Petunjuknya berbeda, jadi kalimatnya juga. */}
      {sedangDiunduh && !unduhanAktif && !unduhanSelesai && !unduhanRusak && unduhanId == null && (
        <div className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-xs">
          <p className="font-semibold text-primary">Unduhan berjalan di browser</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4 opacity-70">
            <li>Biarkan browser menyelesaikannya. Aplikasi ini boleh ditutup.</li>
            <li>Buka notifikasi unduhan selesai, atau menu Unduhan di browser.</li>
            <li>Ketuk NaruReader-{versiRilis}.apk, izinkan pemasangan dari sumber itu, lalu Pasang.</li>
          </ol>
        </div>
      )}

      <p className="mt-3 text-xs opacity-50">
        Diperiksa otomatis paling sering sekali sehari. Berkasnya diunduh layanan unduhan Android ke
        folder Download, dan ukurannya dicocokkan dengan yang disebut GitHub sebelum Anda diminta
        memasangnya.
      </p>
    </section>
  );
};

export default KartuPembaruan;

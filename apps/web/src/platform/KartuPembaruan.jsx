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
 * Tombol unduh memakai <a>, BUKAN plugin pembuka tautan.
 *
 * Aplikasi ini belum pernah membuka URL luar, jadi tidak ada cara lama yang
 * bisa diikuti — dan menambah @capacitor/browser hanya untuk satu tombol
 * berarti menambah dependensi native (plus Custom Tabs) demi sesuatu yang sudah
 * dikerjakan jembatan Capacitor sendiri: navigasi ke host di luar aplikasi
 * jatuh ke Bridge.launchIntent() (capacitor-android, Bridge.java), yang
 * menembakkan Intent.ACTION_VIEW dan menyerahkannya ke Android. Untuk berkas
 * .apk, itu berarti pengunduh sistem.
 *
 * window.open() sengaja dihindari: di WebView tanpa setSupportMultipleWindows
 * ia bisa diabaikan diam-diam, dan tombol yang tidak melakukan apa-apa lebih
 * buruk daripada tombol yang membuka tab.
 *
 * PEMASANGANNYA tetap dikerjakan Android, bukan aplikasi ini. Memasang sendiri
 * dari dalam aplikasi menuntut izin REQUEST_INSTALL_PACKAGES plus FileProvider
 * untuk menyerahkan berkasnya ke installer — izin yang persis membuat aplikasi
 * hasil sideload terlihat mencurigakan, demi menghemat dua ketukan. Sengaja di
 * luar cakupan.
 */
const waktuRelatif = (ms) => (Number.isFinite(ms) ? formatRelativeTime(new Date(ms).toISOString()) : 'belum pernah');

const Baris = ({ label, nilai }) => (
  <div className="flex items-center justify-between border-b border-paper-line py-2 text-sm last:border-0 dark:border-night-line">
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
    cekPembaruan,
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
    ? { titik: 'bg-naruto', teks: 'text-naruto', label: `Versi ${versiRilis} tersedia` }
    : sedangMemeriksa
      ? { titik: 'bg-night/30 dark:bg-paper/30', teks: 'opacity-60', label: 'Memeriksa…' }
      : galat
        ? { titik: 'bg-rose-500', teks: 'text-rose-500', label: 'Belum bisa diperiksa' }
        : versiTerpasang == null
          ? { titik: 'bg-night/30 dark:bg-paper/30', teks: 'opacity-60', label: 'Versi terpasang belum diketahui' }
          : diperiksaPada
            ? { titik: 'bg-emerald-500', teks: 'text-emerald-500', label: 'Sudah versi terbaru' }
            : { titik: 'bg-night/30 dark:bg-paper/30', teks: 'opacity-60', label: 'Belum pernah diperiksa' };

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
        {adaPembaruan && urlUnduh && (
          <a href={urlUnduh} target="_blank" rel="noreferrer" className="btn-accent flex-1 text-center">
            Unduh {versiRilis}
          </a>
        )}
      </div>

      <p className="mt-3 text-xs opacity-50">
        Diperiksa otomatis paling sering sekali sehari. Berkasnya diunduh Android seperti berkas
        biasa; pemasangannya dimulai dari notifikasi unduhan.
      </p>
    </section>
  );
};

export default KartuPembaruan;

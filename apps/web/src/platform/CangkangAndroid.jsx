import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ASLI_NATIF, mandiri } from './index.js';
import { alamatServer } from './server.js';
import { useTerhubung } from './terhubung.js';
import { kirimAntrean } from '../offline/posisiBaca.js';
import { lanjutkanUnduhan } from '../offline/unduh.js';

/**
 * Layar yang tetap berguna saat server tidak terjangkau: rak simpanan,
 * penyambungan, reader (chapter yang sudah ada di HP), pengaturan (di situlah
 * alamat server diganti), dan penjelajahan situs sumber — yang memang tidak
 * pernah menyentuh server. Sisanya isinya datang dari server seluruhnya, jadi
 * membiarkan orangnya di sana saat jaringan putus hanya menyuguhkan kerangka
 * kosong.
 */
const tanpaServer = (jalur) =>
  jalur === '/offline' ||
  jalur === '/settings' ||
  jalur.startsWith('/read/') ||
  mandiri(jalur);

/**
 * Bagian aplikasi yang tidak punya padanan di web: tombol Back perangkat keras,
 * gerbang "belum tahu alamat server", dan kabar kalau server rumah tidak
 * terjangkau.
 *
 * Ditulis sebagai komponen tanpa tampilan tetap (bukan hook yang dipanggil di
 * App) supaya App.jsx cukup menambah satu `{IS_APP && <CangkangAndroid />}`.
 * Pada build web ekspresi itu runtuh jadi `false` dan seluruh berkas ini —
 * termasuk import() plugin di dalamnya — hilang dari bundel.
 */
export const CangkangAndroid = () => {
  const lokasi = useLocation();
  const navigate = useNavigate();
  const { terhubung, sedangMemeriksa, periksaUlang } = useTerhubung();

  // Pendengar backButton dipasang sekali saja. Kalau ia ikut dipasang ulang
  // tiap pindah halaman, ada jeda beberapa milidetik di setiap perpindahan
  // ketika tombol Back tidak dipegang siapa pun dan Android menutup aplikasi.
  // Jadi jalur terkini dititipkan lewat ref.
  const jalurRef = useRef(lokasi.pathname);
  jalurRef.current = lokasi.pathname;

  useEffect(() => {
    if (!ASLI_NATIF) return undefined;

    let pegangan = null;
    let dibatalkan = false;

    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', ({ canGoBack }) => {
          // Di beranda, Back berarti "selesai" — itu yang diharapkan pengguna
          // Android. navigate(-1) di sana hanya memutar riwayat aplikasi lain
          // atau tidak melakukan apa-apa, dan aplikasi terasa tidak bisa
          // ditutup.
          //
          // canGoBack ikut ditanya karena jalur saja tidak cukup. Pemasangan
          // pertama mendarat di '/' lalu langsung navigate('/sambung', replace),
          // dan start dingin tanpa server jadi navigate('/offline', replace) —
          // replace tidak menambah entri riwayat. Jalurnya bukan '/', tapi tidak
          // ada tempat untuk mundur, dan begitu pendengar ini terpasang Capacitor
          // berhenti menjalankan perilaku bawaannya: tanpa exitApp() di sini,
          // Back tidak melakukan apa pun dan aplikasi tidak bisa ditutup sama
          // sekali.
          if (!canGoBack || jalurRef.current === '/') App.exitApp();
          else navigate(-1);
        }),
      )
      .then((hasil) => {
        if (dibatalkan) hasil.remove();
        else pegangan = hasil;
      })
      .catch(() => {
        /* plugin tidak tersedia: Android memakai perilaku bawaannya */
      });

    return () => {
      dibatalkan = true;
      pegangan?.remove();
    };
  }, [navigate]);

  // Tanpa alamat server, layar yang isinya datang dari server hanya menyuguhkan
  // rak kosong yang terlihat seperti aplikasi rusak, bukan seperti aplikasi yang
  // belum disetel. Yang dikecualikan adalah layar mandiri: melempar orang dari
  // /sumber ke /sambung berarti menuntut server justru dari halaman yang
  // dirancang untuk hidup tanpa server.
  useEffect(() => {
    if (!alamatServer() && !mandiri(lokasi.pathname)) {
      navigate('/sambung', { replace: true });
    }
  }, [lokasi.pathname, navigate]);

  // Posisi baca yang menumpuk selama luring dikirim begitu server terjangkau
  // lagi. Di sinilah tempatnya: cangkang ini satu-satunya yang hidup selama
  // aplikasi hidup dan sudah berlangganan status koneksi.
  //
  // Antrean unduh ikut dilanjutkan dari sini. Ia berhenti utuh saat jaringan
  // hilang alih-alih membuang sisanya, jadi harus ada yang membangunkannya —
  // tanpa ini chapter yang tadi diantre menunggu selamanya.
  useEffect(() => {
    if (terhubung) {
      kirimAntrean();
      lanjutkanUnduhan();
    }
  }, [terhubung]);

  // Dilempar ke rak simpanan SEKALI saat jaringan putus, bukan setiap render:
  // sesudah itu orangnya bebas kembali ke halaman mana pun, termasuk untuk
  // melihat sendiri bahwa memang belum ada isinya.
  const sempatPutus = useRef(false);
  useEffect(() => {
    if (sedangMemeriksa) return;
    if (terhubung) {
      sempatPutus.current = false;
      return;
    }
    if (sempatPutus.current) return;
    sempatPutus.current = true;
    if (!tanpaServer(lokasi.pathname)) navigate('/offline', { replace: true });
  }, [terhubung, sedangMemeriksa, lokasi.pathname, navigate]);

  // Spanduk melayang hanya untuk reader. Layar lain memakai pita di dalam
  // aliran halaman (PitaOffline di AppLayout), yang mendorong isi ke bawah
  // alih-alih menutupi TopBar — keluhan lama spanduk ini.
  if (!lokasi.pathname.startsWith('/read/')) return null;
  if (terhubung || sedangMemeriksa) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-40 flex items-center gap-3 bg-danger px-4 py-2 text-sm text-white shadow-scroll"
    >
      <span className="min-w-0 flex-1">
        Server rumah tidak terjangkau. Pastikan HP ada di Wi-Fi yang sama dan server menyala.
      </span>
      <button
        type="button"
        onClick={() => periksaUlang()}
        className="flex-none rounded-lg bg-white px-3 py-1 text-xs font-semibold text-danger"
      >
        Coba lagi
      </button>
    </div>
  );
};

export default CangkangAndroid;

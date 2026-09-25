import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { api } from '../api/apiSlice.js';
import { ASLI_NATIF } from '../platform/index.js';
import { alamatServer, normalkanAlamat, setelAlamatServer, setelToken } from '../platform/server.js';
import { periksaServer, periksaUlang } from '../platform/terhubung.js';
import { kembalikanTabelBawaan } from '../sumber/pola.js';

/**
 * Layar pertama build Android: DUA jalan, bukan satu gerbang.
 *
 * Dulu layar ini cuma menanyakan alamat server rumah, dan itu masuk akal selama
 * aplikasi tidak lebih dari jendela ke server itu. Sekarang tidak lagi: orang
 * yang memasang APK-nya dari GitHub bisa mengunduh komik langsung dari situs
 * sumber ke HP-nya, tanpa server dan tanpa akun. Menyodorkan kotak "alamat
 * server" kepada orang itu berarti menyuruhnya menyiapkan sesuatu yang tidak
 * akan pernah dipunyainya, di layar pertama, sebelum ia melihat satu pun komik.
 *
 * Jadi keduanya ditawarkan sejajar, dan yang tanpa server ditaruh DI ATAS —
 * itulah yang bisa langsung dipakai siapa pun. Formulir servernya tetap utuh,
 * cuma dilipat; ia terbuka sendiri kalau memang sudah pernah ada alamat
 * tersimpan, karena orang yang datang ke sini dengan alamat lama datang untuk
 * memperbaikinya.
 *
 * Tidak ada pendaftaran akun lokal di jalur pertama, dan itu disengaja:
 * menyimpan komik ke HP sendiri tidak butuh persetujuan siapa pun. Akun lokal
 * hanya akan menambah satu layar lagi sebelum komik pertama — dan satu kata
 * sandi yang, kalau lupa, tidak bisa dipulihkan siapa pun.
 *
 * Alamat server selalu DIUJI dulu, tidak langsung disimpan. Salah ketik satu
 * digit menghasilkan aplikasi yang setiap layarnya gagal memuat tanpa menyebut
 * sebabnya, dan orangnya akan menyalahkan koleksi atau Wi-Fi — bukan angka yang
 * baru saja diketiknya sendiri.
 */
export const Sambung = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const tersimpan = alamatServer();
  const [teks, setTeks] = useState(tersimpan ?? '');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);
  // Terbuka sendiri kalau sudah pernah ada alamat: orang yang datang ke sini
  // membawa alamat lama datang untuk menggantinya, bukan untuk memilih jalan.
  const [bukaServer, setBukaServer] = useState(Boolean(tersimpan));

  const simpan = async (masukan) => {
    const bersih = normalkanAlamat(masukan);
    if (!bersih) {
      setGalat('Alamat tidak dikenali. Contoh: 192.168.1.5 atau 192.168.1.5:3000');
      return;
    }

    setSibuk(true);
    setGalat(null);
    const hidup = await periksaServer(bersih);
    if (!hidup) {
      setSibuk(false);
      setGalat(
        `Tidak ada NaruReader di ${bersih}. Cek server sudah menyala dan HP ada di Wi-Fi yang sama.`,
      );
      return;
    }

    // Token sesi hanya berlaku di server yang menerbitkannya. Kalau alamatnya
    // benar-benar berpindah, membawanya serta berarti setiap permintaan pertama
    // ke server baru dijawab 401 dan sesi baru terhapus lagi.
    //
    // Tabel pola juga milik server lama, dan itu yang paling mahal kalau ikut
    // terbawa: tabel yang menang disimpan permanen dan dipasang lagi setiap
    // aplikasi dibuka, sementara tabel ber-versi lebih rendah — termasuk milik
    // server baru dan milik APK sendiri — tidak akan pernah bisa
    // mengalahkannya. Tanpa baris ini, satu HP yang pernah menunjuk server
    // orang lain membawa selectornya selamanya. Servernya yang baru tetap boleh
    // menawarkan tabelnya sendiri; yang dibuang cuma sisa yang lama.
    if (bersih !== tersimpan) {
      await setelToken(null);
      await kembalikanTabelBawaan({ tanyaLagi: true });
    }
    await setelAlamatServer(bersih);

    // Cache RTK Query masih berisi rak, chapter, dan statistik milik server
    // lama. Tanpa dibuang, layar berikutnya menampilkan koleksi server lain.
    dispatch(api.util.resetApiState());
    periksaUlang();
    setSibuk(false);
    navigate('/', { replace: true });
  };

  const pindai = async () => {
    setGalat(null);
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import(
        '@capacitor/barcode-scanner'
      );
      const hasil = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: 'Arahkan ke QR di layar NaruReader',
      });
      const isi = hasil?.ScanResult;
      if (!isi) return;
      setTeks(isi);
      await simpan(isi);
    } catch {
      // Dibatalkan oleh pengguna dan izin kamera ditolak sama-sama sampai ke
      // sini sebagai lemparan, tanpa cara membedakannya. Yang aman adalah
      // menunjuk ke jalan keluar yang pasti ada.
      setGalat('Pemindaian dibatalkan atau kamera tidak bisa dipakai. Ketik alamatnya saja.');
    }
  };

  return (
    <div className="app-bg flex min-h-full flex-col justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-naruto text-2xl font-black text-night shadow-glow">
            忍
          </span>
          <h1 className="text-2xl font-black">Mulai dari mana?</h1>
          <p className="mt-1.5 text-sm opacity-60">
            Dua-duanya boleh, dan boleh dipakai bersamaan. Pilihannya bisa diubah kapan saja di
            Pengaturan.
          </p>
        </div>

        {/*
          Jalur tanpa server DI ATAS dan sebagai kartu penuh, bukan tautan kecil
          di kaki halaman seperti sebelumnya. Inilah satu-satunya jalur yang
          pasti bisa dipakai orang yang baru memasang APK-nya, dan di WebView
          tidak ada address bar untuk menemukannya sendiri.
        */}
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-black">
            <span aria-hidden="true">📲</span> Pakai di HP ini saja
          </h2>
          <p className="mt-1.5 text-sm opacity-70">
            Cari komik di situs sumber yang kami dukung, lalu simpan chapternya langsung ke HP.
            Tidak perlu server, tidak perlu akun, dan yang sudah tersimpan tetap bisa dibaca tanpa
            internet.
          </p>
          <Link to="/sumber" className="btn-accent mt-4 w-full">
            Mulai tanpa server
          </Link>
        </section>

        <section className="card mt-4 p-5">
          <h2 className="flex items-center gap-2 text-base font-black">
            <span aria-hidden="true">🏠</span> Sambungkan ke server rumah
          </h2>
          <p className="mt-1.5 text-sm opacity-70">
            Kalau koleksinya sudah ada di komputer dan NaruReader berjalan di sana. HP ini harus di
            Wi-Fi yang sama.
          </p>

          {!bukaServer ? (
            <button type="button" className="btn-ghost mt-4 w-full" onClick={() => setBukaServer(true)}>
              Saya punya server
            </button>
          ) : (
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                simpan(teks);
              }}
            >
              <label className="block">
                <span className="label-mikro">Alamat server</span>
                <input
                  className="input mt-1.5 font-mono"
                  value={teks}
                  onChange={(event) => setTeks(event.target.value)}
                  placeholder="192.168.1.5:3000"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>

              {galat && (
                <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  {galat}
                </p>
              )}

              <button type="submit" className="btn-accent w-full" disabled={sibuk}>
                {sibuk ? 'Memeriksa…' : 'Sambungkan'}
              </button>

              {/* Pemindai hanya ada di perangkat sungguhan. Di browser desktop
                  tombolnya disembunyikan, bukan dibiarkan melempar saat ditekan. */}
              {ASLI_NATIF && (
                <button type="button" className="btn-ghost w-full" onClick={pindai} disabled={sibuk}>
                  Pindai QR
                </button>
              )}
            </form>
          )}
        </section>

        <p className="mt-4 text-center text-xs opacity-50">
          Alamat servernya tertulis di jendela NaruReader di komputer, dan di halaman Pengaturan.
        </p>
      </div>
    </div>
  );
};

export default Sambung;

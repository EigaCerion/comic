import { Link } from 'react-router-dom';
import { alamatServer } from './server.js';
import { useTerhubung } from './terhubung.js';

/**
 * Bagian "server yang dipakai" di halaman Pengaturan, khusus build Android.
 *
 * Di web pertanyaannya tidak pernah muncul — halamannya datang dari server itu
 * sendiri. Di HP, alamat yang tersimpan adalah satu-satunya hal yang bisa
 * membuat seluruh aplikasi diam, jadi ia harus terlihat dan bisa diganti tanpa
 * menghapus data aplikasi.
 */
export const KartuServerApp = () => {
  const { terhubung, sedangMemeriksa, periksaUlang } = useTerhubung();
  const alamat = alamatServer();

  const nada = sedangMemeriksa
    ? { titik: 'bg-night/30 dark:bg-paper/30', teks: 'opacity-60', label: 'Memeriksa…' }
    : terhubung
      ? { titik: 'bg-emerald-500', teks: 'text-emerald-500', label: 'Terhubung' }
      : { titik: 'bg-rose-500', teks: 'text-rose-500', label: 'Tidak terjangkau' };

  return (
    <section className="card p-5">
      <h2 className="section-title mb-4">
        <span aria-hidden="true">🛰️</span>
        Server yang dipakai
      </h2>

      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 flex-none rounded-full ${nada.titik}`} aria-hidden="true" />
        <span className={`text-sm font-bold ${nada.teks}`}>{nada.label}</span>
      </div>

      <p className="mt-3 break-all font-mono text-sm">{alamat ?? 'Belum disetel'}</p>

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => periksaUlang()}>
          Periksa ulang
        </button>
        <Link to="/sambung" className="btn-accent flex-1">
          Ganti server
        </Link>
      </div>

      <p className="mt-3 text-xs opacity-50">
        Alamat Wi-Fi berubah tiap pindah jaringan. Kalau server sudah punya nama tetap, pakai nama
        itu supaya tidak perlu disambung ulang.
      </p>
    </section>
  );
};

export default KartuServerApp;

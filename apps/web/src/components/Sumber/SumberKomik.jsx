import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  useCariSumberKomikMutation,
  useGetSumberKomikQuery,
  useHapusSumberKomikMutation,
  useSetujuiSumberKomikMutation,
  useTambahSumberKomikMutation,
} from '../../api/apiSlice.js';
import { showToast } from '../../store/slices/uiSlice.js';
import { Spinner } from '../Common/index.jsx';

/**
 * Panel "Sumber komik" di halaman komik.
 *
 * Yang diselesaikan panel ini terjadi berulang kali dan selalu sama: situs
 * sumber sebuah komik mati, lalu "Cek chapter baru" untuk komik itu gagal
 * selamanya — sampai ada yang mencari sendiri komik yang sama di situs lain
 * dan menempelkan tautannya. Setiap kali, untuk setiap komik.
 *
 * Pembagian tugasnya sengaja tidak simetris:
 *   - BERPINDAH antar sumber yang sudah disetujui berjalan sendiri, tanpa panel
 *     ini dibuka sama sekali (sumberService.ambilSeriDenganCadangan).
 *   - MENAMBAH sumber baru dicari otomatis, tapi dipasang hanya setelah
 *     disetujui di sini.
 *
 * Batas itu bukan kehati-hatian berlebihan. Judul komik di situs sumber sering
 * nyaris sama — sekuel, spin-off, versi berwarna, judul Inggris vs romaji untuk
 * karya berbeda. Memasang yang salah berarti chapter komik LAIN masuk ke
 * koleksi ini, dan itu baru ketahuan saat dibaca, setelah puluhan chapter
 * telanjur terunduh ke disk.
 */

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const LENCANA = {
  siap: { teks: 'Siap pakai', kelas: 'text-success' },
  calon: { teks: 'Menunggu persetujuan', kelas: 'text-primary' },
  mati: { teks: 'Tidak terbaca', kelas: 'text-danger' },
};

const BarisSumber = ({ sumber, comicId, onPesan }) => {
  const [setujui, { isLoading: menyetujui }] = useSetujuiSumberKomikMutation();
  const [hapus, { isLoading: menghapus }] = useHapusSumberKomikMutation();
  const lencana = LENCANA[sumber.status] ?? LENCANA.calon;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
      <span className="flex items-center gap-2 font-mono text-sm font-semibold">
        {sumber.aktif && (
          <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-black text-primary-on" title="Sedang dipakai">
            AKTIF
          </span>
        )}
        {host(sumber.seriesUrl)}
      </span>

      <span className={`text-xs ${lencana.kelas}`}>{lencana.teks}</span>

      {/* Skor kemiripan judul hanya berarti untuk kandidat hasil pencarian —
          untuk alamat yang ditempel tangan, yang menjamin kebenarannya adalah
          orang yang menempelnya. */}
      {sumber.status === 'calon' && sumber.kemiripan != null && (
        <span className="text-xs opacity-60">judul {Math.round(sumber.kemiripan * 100)}% mirip</span>
      )}

      {sumber.chapterTerakhir != null && (
        <span className="text-xs opacity-60">s/d Ch {sumber.chapterTerakhir}</span>
      )}

      {/* Kegagalan terakhir ditampilkan apa adanya: itu satu-satunya petunjuk
          kenapa sebuah sumber berhenti dipakai, dan menyembunyikannya membuat
          perpindahan otomatis terasa seperti sesuatu yang terjadi tanpa sebab. */}
      {sumber.lastError && (
        <span className="w-full truncate text-xs text-danger/80" title={sumber.lastError}>
          {sumber.lastError}
        </span>
      )}

      <span className="ml-auto flex flex-none gap-2">
        <a
          href={sumber.seriesUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-ghost px-2 py-1 text-xs"
          title={sumber.seriesUrl}
        >
          Buka
        </a>
        {sumber.status === 'calon' && (
          <button
            type="button"
            className="btn-accent px-2 py-1 text-xs"
            disabled={menyetujui}
            onClick={async () => {
              try {
                await setujui({ comicId, id: sumber.id }).unwrap();
                onPesan({ message: `${host(sumber.seriesUrl)} disetujui sebagai sumber cadangan` });
              } catch (error) {
                onPesan({ type: 'error', message: error?.data?.error ?? 'Gagal menyetujui' });
              }
            }}
          >
            ✓ Setujui
          </button>
        )}
        {sumber.status === 'siap' && !sumber.aktif && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            disabled={menyetujui}
            onClick={async () => {
              try {
                await setujui({ comicId, id: sumber.id, pakaiSekarang: true }).unwrap();
                onPesan({ message: `Sumber aktif pindah ke ${host(sumber.seriesUrl)}` });
              } catch (error) {
                onPesan({ type: 'error', message: error?.data?.error ?? 'Gagal memindahkan' });
              }
            }}
          >
            Pakai ini
          </button>
        )}
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs text-danger"
          disabled={menghapus}
          onClick={async () => {
            try {
              await hapus({ comicId, id: sumber.id }).unwrap();
              onPesan({ message: `${host(sumber.seriesUrl)} dibuang dari daftar sumber` });
            } catch (error) {
              onPesan({ type: 'error', message: error?.data?.error ?? 'Gagal menghapus' });
            }
          }}
        >
          ✕
        </button>
      </span>
    </li>
  );
};

export const SumberKomik = ({ comicId }) => {
  const dispatch = useDispatch();
  const { data, isLoading } = useGetSumberKomikQuery(comicId);
  const [cari, { isLoading: mencari }] = useCariSumberKomikMutation();
  const [tambah, { isLoading: menambah }] = useTambahSumberKomikMutation();
  const [tempel, setTempel] = useState('');

  const onPesan = (isi) => dispatch(showToast(isi));

  const items = data?.items ?? [];
  const calon = items.filter((satu) => satu.status === 'calon');
  const terpakai = items.filter((satu) => satu.status !== 'calon');

  const cariSumber = async () => {
    try {
      const hasil = await cari(comicId).unwrap();
      const baru = (hasil.kandidat ?? []).length;
      onPesan({
        type: baru ? 'success' : 'error',
        message: baru
          ? `${baru} kandidat ditemukan — periksa judulnya sebelum menyetujui`
          : 'Tidak ada judul yang cukup mirip di situs lain. Tempel alamatnya sendiri kalau Anda sudah menemukannya.',
      });
    } catch (error) {
      onPesan({ type: 'error', message: error?.data?.error ?? 'Pencarian gagal' });
    }
  };

  const tempelSumber = async (event) => {
    event.preventDefault();
    const url = tempel.trim();
    if (!url) return;
    try {
      await tambah({ comicId, seriesUrl: url }).unwrap();
      setTempel('');
      onPesan({ message: 'Sumber ditambahkan' });
    } catch (error) {
      onPesan({ type: 'error', message: error?.data?.error ?? 'Alamat ditolak' });
    }
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="section-title mb-0">
          <span aria-hidden="true">🔗</span>
          Sumber komik
        </h2>
        <button
          type="button"
          className="btn-ghost ml-auto px-3 py-1 text-xs"
          onClick={cariSumber}
          disabled={mencari}
        >
          {mencari ? 'Mencari…' : '🔎 Cari sumber lain'}
        </button>
      </div>

      <p className="mt-2 text-xs opacity-60">
        Kalau situs yang aktif tidak bisa dibaca, cek chapter baru berpindah sendiri ke sumber lain
        yang sudah disetujui — tanpa menempel tautan lagi.
      </p>

      {isLoading ? (
        <div className="mt-4">
          <Spinner />
        </div>
      ) : (
        <>
          {terpakai.length === 0 && calon.length === 0 && (
            <p className="mt-4 rounded-lg bg-surface-soft px-3 py-2 text-xs text-txt-2">
              Komik ini belum punya sumber yang tercatat. Tekan “Cari sumber lain”, atau tempel alamat
              halaman serinya di bawah.
            </p>
          )}

          {terpakai.length > 0 && (
            <ul className="mt-3">
              {terpakai.map((sumber) => (
                <BarisSumber key={sumber.id} sumber={sumber} comicId={comicId} onPesan={onPesan} />
              ))}
            </ul>
          )}

          {calon.length > 0 && (
            <div className="mt-4">
              <p className="label-mikro text-primary">Kandidat — periksa judulnya dulu</p>
              <ul className="mt-1">
                {calon.map((sumber) => (
                  <BarisSumber key={sumber.id} sumber={sumber} comicId={comicId} onPesan={onPesan} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <form className="mt-4 flex flex-wrap gap-2" onSubmit={tempelSumber}>
        <input
          className="input min-w-0 flex-1 font-mono text-xs"
          value={tempel}
          onChange={(event) => setTempel(event.target.value)}
          placeholder="https://situs-lain.com/manga/judul-komik/"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="btn-ghost flex-none px-3 py-1 text-xs" disabled={menambah || !tempel.trim()}>
          Tambah
        </button>
      </form>
    </section>
  );
};

export default SumberKomik;

import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  useCreateUserMutation,
  useDeleteUserMutation,
  useGetUsersQuery,
  useUpdateUserMutation,
} from '../api/apiSlice.js';
import { EmptyState, ErrorState, Spinner } from '../components/Common/index.jsx';
import { showToast } from '../store/slices/uiSlice.js';
import { formatRelativeTime } from '../utils/format.js';
import { useAuth } from '../hooks/useAuth.js';

const PERAN = [
  { nilai: 'super_admin', label: 'Super Admin', jelas: 'Semua akses, termasuk mengelola akun' },
  { nilai: 'publisher', label: 'Publisher', jelas: 'Kelola koleksi, unduhan, dan metadata' },
  { nilai: 'editor', label: 'Editor', jelas: 'Sunting metadata dan moderasi komentar' },
  { nilai: 'author', label: 'Author', jelas: 'Unggah chapter manual' },
  { nilai: 'reader', label: 'Reader', jelas: 'Baca, beri rating, dan berkomentar' },
];

const WARNA_PERAN = {
  super_admin: 'text-naruto',
  publisher: 'text-shinobi',
  editor: 'text-leaf-light',
  author: 'text-leaf-light',
  reader: 'opacity-60',
};

const FormAkunBaru = ({ onSelesai }) => {
  const dispatch = useDispatch();
  const [buat, { isLoading }] = useCreateUserMutation();
  const [isi, setIsi] = useState({ username: '', password: '', role: 'reader', displayName: '' });

  const kirim = async (event) => {
    event.preventDefault();
    try {
      const user = await buat(isi).unwrap();
      dispatch(showToast({ message: `Akun "${user.username}" dibuat sebagai ${user.role}` }));
      setIsi({ username: '', password: '', role: 'reader', displayName: '' });
      onSelesai?.();
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal membuat akun' }));
    }
  };

  const ubah = (kunci) => (e) => setIsi((v) => ({ ...v, [kunci]: e.target.value }));

  return (
    <form onSubmit={kirim} className="card mt-5 grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
      <label className="block">
        <span className="label-mikro">Username</span>
        <input className="input mt-1" value={isi.username} onChange={ubah('username')} required />
      </label>
      <label className="block">
        <span className="label-mikro">Nama tampilan</span>
        <input className="input mt-1" value={isi.displayName} onChange={ubah('displayName')} />
      </label>
      <label className="block">
        <span className="label-mikro">Kata sandi awal</span>
        <input
          className="input mt-1"
          type="password"
          value={isi.password}
          onChange={ubah('password')}
          minLength={8}
          required
        />
      </label>
      <label className="block">
        <span className="label-mikro">Peran</span>
        <select className="input mt-1" value={isi.role} onChange={ubah('role')}>
          {PERAN.map((p) => (
            <option key={p.nilai} value={p.nilai}>
              {p.label} — {p.jelas}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className="btn-accent" disabled={isLoading}>
          {isLoading ? 'Membuat…' : 'Buat akun'}
        </button>
      </div>
    </form>
  );
};

const BarisAkun = ({ akun, sayaId }) => {
  const dispatch = useDispatch();
  const [ubah] = useUpdateUserMutation();
  const [hapus] = useDeleteUserMutation();
  const diriSendiri = akun.id === sayaId;

  const jalankan = async (aksi, pesanSukses) => {
    try {
      await aksi().unwrap();
      dispatch(showToast({ message: pesanSukses }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error?.data?.error ?? 'Gagal' }));
    }
  };

  const resetSandi = () => {
    const baru = window.prompt(`Kata sandi baru untuk "${akun.username}" (minimal 8 karakter):`);
    if (!baru) return;
    jalankan(
      () => ubah({ id: akun.id, password: baru }),
      `Kata sandi ${akun.username} diganti — semua sesinya dikeluarkan`,
    );
  };

  return (
    <li className="card flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          {akun.displayName}
          {diriSendiri && <span className="chip ml-2">kamu</span>}
          {!akun.isActive && <span className="chip ml-2 text-danger">nonaktif</span>}
        </p>
        <p className="truncate text-xs opacity-50">
          @{akun.username} · dibuat {formatRelativeTime(akun.createdAt)} ·{' '}
          {akun.lastLoginAt
            ? `masuk terakhir ${formatRelativeTime(akun.lastLoginAt)}`
            : 'belum pernah masuk'}
        </p>
      </div>

      <select
        className="input w-auto flex-none py-1 text-xs"
        value={akun.role}
        disabled={diriSendiri}
        title={diriSendiri ? 'Peran akun sendiri tidak bisa diubah dari sini' : 'Ubah peran'}
        onChange={(e) =>
          jalankan(
            () => ubah({ id: akun.id, role: e.target.value }),
            `${akun.username} sekarang ${e.target.value}`,
          )
        }
      >
        {PERAN.map((p) => (
          <option key={p.nilai} value={p.nilai}>
            {p.label}
          </option>
        ))}
      </select>

      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={resetSandi}>
        Reset sandi
      </button>

      <button
        type="button"
        className="btn-ghost px-2 py-1 text-xs"
        disabled={diriSendiri}
        onClick={() =>
          jalankan(
            () => ubah({ id: akun.id, isActive: !akun.isActive }),
            akun.isActive ? `${akun.username} dinonaktifkan` : `${akun.username} diaktifkan`,
          )
        }
      >
        {akun.isActive ? 'Nonaktifkan' : 'Aktifkan'}
      </button>

      <button
        type="button"
        className="btn-ghost px-2 py-1 text-xs text-danger"
        disabled={diriSendiri}
        onClick={() => {
          if (!window.confirm(`Hapus akun "${akun.username}"? Komentar dan ratingnya ikut hilang.`)) {
            return;
          }
          jalankan(() => hapus(akun.id), `Akun ${akun.username} dihapus`);
        }}
      >
        Hapus
      </button>
    </li>
  );
};

export const Users = () => {
  const { user } = useAuth();
  const { data, isLoading, error } = useGetUsersQuery();
  const [tampilForm, setTampilForm] = useState(false);

  if (isLoading) return <Spinner />;
  if (error) {
    return (
      <ErrorState
        title="Tidak bisa membuka daftar akun"
        message={error?.data?.error ?? 'Halaman ini hanya untuk super admin.'}
      />
    );
  }

  const items = data?.items ?? [];
  const perPeran = PERAN.map((p) => ({
    ...p,
    jumlah: items.filter((u) => u.role === p.nilai).length,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Kelola akun</h1>
          <p className="mt-1 text-sm opacity-50">
            {items.length} akun ·{' '}
            {perPeran
              .filter((p) => p.jumlah > 0)
              .map((p) => `${p.jumlah} ${p.label.toLowerCase()}`)
              .join(' · ')}
          </p>
        </div>
        <button type="button" className="btn-accent" onClick={() => setTampilForm((v) => !v)}>
          {tampilForm ? 'Tutup' : '+ Akun baru'}
        </button>
      </div>

      {tampilForm && <FormAkunBaru onSelesai={() => setTampilForm(false)} />}

      {items.length === 0 ? (
        <EmptyState
          icon="👤"
          title="Belum ada akun"
          description="Buat akun pertama lewat tombol di atas."
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((akun) => (
            <BarisAkun key={akun.id} akun={akun} sayaId={user?.id} />
          ))}
        </ul>
      )}

      <div className="card mt-5 p-5">
        <h2 className="section-title mb-4">Arti tiap peran</h2>
        <ul className="space-y-1.5 text-sm">
          {PERAN.map((p) => (
            <li key={p.nilai} className="flex flex-wrap gap-x-2">
              <span className={`font-semibold ${WARNA_PERAN[p.nilai]}`}>{p.label}</span>
              <span className="opacity-60">— {p.jelas}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Users;

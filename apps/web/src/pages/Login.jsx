import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useLoginMutation, useRegisterMutation } from '../api/apiSlice.js';
import { showToast } from '../store/slices/uiSlice.js';

const Kolom = ({ label, ...props }) => (
  <label className="block">
    <span className="label-mikro">{label}</span>
    <input className="input mt-1.5" {...props} />
  </label>
);

export const Login = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState('masuk'); // masuk | daftar
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [galat, setGalat] = useState(null);

  const [login, { isLoading: sedangMasuk }] = useLoginMutation();
  const [register, { isLoading: sedangDaftar }] = useRegisterMutation();
  const sibuk = sedangMasuk || sedangDaftar;

  /**
   * Kembali ke halaman yang tadi dituju — tapi hanya kalau tujuannya benar-benar
   * halaman di dalam aplikasi ini.
   *
   * Nilai mentah tidak pernah dipercaya: "//situs-lain.com" dan "/\situs-lain"
   * sama-sama dibaca browser sebagai alamat LUAR, dan react-router versi ini
   * punya kerentanan open-redirect lewat backslash. Satu baris pemeriksaan di
   * sini menutup jalur itu tanpa bergantung pada pustaka.
   */
  const mentah = location.state?.dari;
  const tujuan =
    typeof mentah === 'string' && /^\/(?![/\\])/.test(mentah) ? mentah : '/';

  const kirim = async (event) => {
    event.preventDefault();
    setGalat(null);
    try {
      const hasil =
        mode === 'masuk'
          ? await login({ username, password }).unwrap()
          : await register({ username, password, displayName: displayName || undefined }).unwrap();
      dispatch(showToast({ message: `Selamat datang, ${hasil.user.displayName}` }));
      navigate(tujuan, { replace: true });
    } catch (error) {
      setGalat(error?.data?.error ?? 'Tidak bisa terhubung ke server');
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-naruto text-2xl font-black text-night shadow-glow">
          忍
        </span>
        <h1 className="text-2xl font-black">
          {mode === 'masuk' ? 'Masuk ke NaruReader' : 'Buat akun pembaca'}
        </h1>
        <p className="mt-1.5 text-sm opacity-60">
          Membaca komik tidak butuh akun. Akun hanya diperlukan untuk memberi rating dan
          berkomentar.
        </p>
      </div>

      <form onSubmit={kirim} className="card space-y-4 p-5">
        <Kolom
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        {mode === 'daftar' && (
          <Kolom
            label="Nama tampilan (opsional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Nama yang muncul di komentar"
          />
        )}
        <Kolom
          label="Kata sandi"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'masuk' ? 'current-password' : 'new-password'}
          required
        />

        {galat && (
          <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {galat}
          </p>
        )}

        <button type="submit" className="btn-accent w-full" disabled={sibuk}>
          {sibuk ? 'Memproses…' : mode === 'masuk' ? 'Masuk' : 'Daftar sebagai pembaca'}
        </button>

        <p className="text-center text-xs opacity-60">
          {mode === 'masuk' ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
          <button
            type="button"
            className="font-semibold text-naruto hover:underline"
            onClick={() => {
              setMode(mode === 'masuk' ? 'daftar' : 'masuk');
              setGalat(null);
            }}
          >
            {mode === 'masuk' ? 'Daftar di sini' : 'Masuk di sini'}
          </button>
        </p>
      </form>

      <p className="mt-4 text-center text-xs opacity-50">
        <Link to="/" className="hover:text-naruto hover:underline">
          Lanjut membaca tanpa akun
        </Link>
      </p>
    </div>
  );
};

export default Login;

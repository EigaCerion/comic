import { Link } from 'react-router-dom';

export const NotFound = () => (
  <div className="flex flex-col items-center gap-4 py-24 text-center">
    <span className="text-5xl" aria-hidden="true">
      🌀
    </span>
    <h1 className="text-2xl font-black">Halaman ini menghilang dalam jutsu</h1>
    <p className="max-w-md text-sm text-night/60 dark:text-paper/60">
      Rute yang kamu buka tidak ada. Kembali ke beranda dan lanjutkan membaca.
    </p>
    <Link to="/" className="btn-primary">
      Kembali ke beranda
    </Link>
  </div>
);

export default NotFound;

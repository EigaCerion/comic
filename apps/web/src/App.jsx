import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useSelector } from 'react-redux';
import AppLayout from './components/Layout/AppLayout.jsx';
import Home from './pages/Home.jsx';
import Browse from './pages/Browse.jsx';
import ComicDetail from './pages/ComicDetail.jsx';
import Reader from './pages/Reader.jsx';
import Downloads from './pages/Downloads.jsx';
import Upload from './pages/Upload.jsx';
import Import from './pages/Import.jsx';
import Scout from './pages/Scout.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Users from './pages/Users.jsx';
import NotFound from './pages/NotFound.jsx';
import Sambung from './pages/Sambung.jsx';
import Offline from './pages/Offline.jsx';
import Sumber from './pages/Sumber.jsx';
import SumberSeri from './pages/SumberSeri.jsx';
import { IS_APP } from './platform/index.js';
import CangkangAndroid from './platform/CangkangAndroid.jsx';

export const App = () => {
  const theme = useSelector((state) => state.ui.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0f1419' : '#f5f1e8');
  }, [theme]);

  return (
    <>
      {/* Hanya build android. Ekspresi ini runtuh jadi `false` saat build web,
          dan Rollup ikut membuang seluruh modulnya — termasuk plugin Capacitor
          yang di-import() di dalamnya. */}
      {IS_APP && <CangkangAndroid />}

      <Routes>
        {/* Reader tampil full-screen, di luar layout utama */}
        <Route path="/read/:chapterId" element={<Reader />} />

        {/* Layar penyambungan tidak punya arti di web: di sana server-nya
            adalah asal halaman ini sendiri. */}
        {IS_APP && <Route path="/sambung" element={<Sambung />} />}

        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          {/* Rak komik di dalam HP. Satu-satunya layar yang tidak menyentuh API
              sama sekali, jadi ia tetap berguna saat server rumah mati. */}
          {IS_APP && <Route path="/offline" element={<Offline />} />}
          {/* Penjelajahan situs sumber langsung dari HP. Build android saja —
              di web, pekerjaan ini milik panel Scout, yang melakukannya dari
              server rumah lengkap dengan pencocokan koleksi. Dua layar ini
              satu-satunya yang berguna pada aplikasi yang BELUM pernah
              disambungkan ke server mana pun. */}
          {IS_APP && <Route path="/sumber" element={<Sumber />} />}
          {IS_APP && <Route path="/sumber/seri" element={<SumberSeri />} />}
          <Route path="/browse" element={<Browse />} />
          {/* Tujuan tombol Kembali di reader untuk komik yang datang dari situs
              sumber. Slug komik itu dibentuk sebagai "sumber/<comicId>"
              (offline/unduhSumber.js) justru supaya ia mendarat di sini dan
              bukan di /comic/:slug — yang hidup dari koleksi server rumah dan
              akan menjawab "tidak ditemukan" untuk komik yang memang tidak
              pernah ada di sana. Rute tiga segmen ini menang atas /comic/:slug
              yang dua segmen, jadi keduanya tidak berebut. */}
          {IS_APP && <Route path="/comic/sumber/:comicId" element={<Offline />} />}
          <Route path="/comic/:slug" element={<ComicDetail />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/import" element={<Import />} />
          <Route path="/scout" element={<Scout />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Login />} />
          <Route path="/users" element={<Users />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
};

export default App;

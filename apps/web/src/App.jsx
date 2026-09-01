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
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Users from './pages/Users.jsx';
import NotFound from './pages/NotFound.jsx';

export const App = () => {
  const theme = useSelector((state) => state.ui.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0f1419' : '#f5f1e8');
  }, [theme]);

  return (
    <Routes>
      {/* Reader tampil full-screen, di luar layout utama */}
      <Route path="/read/:chapterId" element={<Reader />} />

      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/comic/:slug" element={<ComicDetail />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/import" element={<Import />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/login" element={<Login />} />
        <Route path="/users" element={<Users />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
};

export default App;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import store from './store/index.js';
import App from './App.jsx';
import { IS_APP } from './platform/index.js';
import { siapkanPlatform } from './platform/server.js';
import { siapkanOffline } from './offline/penyimpanan.js';
import './styles/globals.css';

const mulai = () =>
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </React.StrictMode>,
  );

// Build android menunggu alamat server & token terbaca dari penyimpanan dulu.
// Kalau render didahulukan, permintaan render pertama menembak origin WebView
// (http://localhost) yang tidak punya API, dan aplikasi melempar orangnya ke
// layar "Sambungkan" walau alamatnya sebenarnya sudah tersimpan.
// Katalog offline ikut dimuat di sini dan bukan saat layar pertama dirender:
// reader menentukan posisi lanjut baca dari padanya, dan membaca katalognya
// belakangan berarti setiap chapter mulai dari halaman 1 dulu sebelum melompat.
// Urutannya berantai karena keduanya menunggu penyimpanan yang sama.
// Pada build web ekspresi ini runtuh jadi `mulai()` saja.
if (IS_APP) siapkanPlatform().then(siapkanOffline).then(mulai, mulai);
else mulai();

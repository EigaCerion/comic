# Catatan Rilis

Isi berkas ini juga dipakai apa adanya sebagai keterangan di halaman
[Releases](https://github.com/EigaCerion/comic/releases).

Versi APK diturunkan dari `"version"` di `apps/web/package.json` (dan harus sama
dengan `package.json` akar). Membangun APK rilis: `apps/web/scripts/build-android.ps1`
— hanya skrip itu yang meneruskan versinya ke Gradle.

---

## 0.3.1

Rilis perbaikan. Satu bug yang membuat pembaruan dalam aplikasi tidak bisa
dipakai sama sekali, dan penggantian cara mengunduhnya supaya kegagalan yang
sudah pernah terjadi tidak bisa terulang.

> **Pasang menimpa 0.3.0.** Tidak perlu mencopot, dan chapter yang sudah
> tersimpan di HP tetap utuh.

### Tombol "Unduh" yang ditekan dan tidak melakukan apa-apa

Sejak 0.2.0, menekan Unduh di kartu "Versi aplikasi" tidak menghasilkan apa pun:
browser tidak terbuka, tidak ada pesan galat, tombolnya pun tidak berubah.
Artinya pembaruan dalam aplikasi tidak pernah bisa dipakai di 0.2.0 maupun
0.3.0 — satu-satunya jalan adalah mengunduh APK-nya sendiri dari GitHub.

Sebabnya satu baris. `muatPlugin()` mengembalikan proxy plugin Capacitor apa
adanya dari fungsi `async`. Proxy itu menjawab SETIAP akses properti dengan
sebuah fungsi — termasuk `.then` — jadi JavaScript menyangkanya sebuah promise
lalu memanggil `plugin.then(resolve, reject)`. Panggilan itu diteruskan ke
Android sebagai metode plugin bernama "then", dijawab «"BukaDiLuar.then()" is
not implemented on android», dan penolakannya jatuh di rantai promise
tersendiri yang tidak dipegang siapa pun. Akibatnya `await`-nya menggantung
selamanya: bukan berhasil, bukan gagal, hanya diam — dan `try/catch` di
sekelilingnya tidak pernah menyala.

Aturan ini sebenarnya sudah tertulis di `platform/server.js` dan dipatuhi enam
pemuat plugin lain di proyek ini; `bukaLuar.js` satu-satunya yang melanggarnya.
Sekarang proxy-nya dibungkus objek biasa seperti yang lain.

### Pembaruan diunduh layanan unduhan Android, bukan browser

Dua kegagalan nyata sudah tercatat dari jalur browser, dan keduanya berakhir di
tempat yang sama — pembaruan yang tidak jadi terpasang:

* Tautan `github.com` diklaim **aplikasi GitHub** lewat app link, jadi yang
  mengunduh adalah pengunduh internal aplikasi itu. Ketika NaruReader dibuka
  kembali, jendela yang sedang mengunduh terdorong ke latar belakang dan
  Android membekukan kerja jaringannya. Yang terlihat: unduhan berhenti di 99%.
* Lewat Chrome, unduhan yang terputus lalu dilanjutkan menghasilkan berkas yang
  **ukurannya tepat sampai byte terakhir tetapi isinya rusak**. Pemasang Android
  menolaknya dengan "paket tampaknya tidak valid" — kalimat yang menunjuk ke
  APK, padahal yang rusak berkas unduhannya.

Sekarang unduhannya dikerjakan DownloadManager milik Android. Pekerjaan itu
milik sistem, bukan milik proses aplikasi: ia tidak bisa terdorong ke latar
belakang, ia tetap berjalan meski NaruReader ditutup, ia punya notifikasi
progres sendiri, dan ia menyambung lagi saat jaringan putus-nyambung. Tidak ada
izin baru — DownloadManager menulis ke folder Download tanpa izin penyimpanan
sejak Android 10.

Pemasangannya tetap dimulai Anda sendiri dari notifikasi atau tombol "Buka
unduhan". Memasang dari dalam aplikasi menuntut izin `REQUEST_INSTALL_PACKAGES`,
persis izin yang membuat aplikasi hasil sideload dicurigai Play Protect.

### Ukuran berkas dicocokkan sebelum Anda diminta memasang

Jawaban GitHub menyebut ukuran aset sampai byte. Setelah unduhan selesai,
angkanya dicocokkan; yang tidak cocok ditandai rusak berikut kedua angkanya, dan
tombol pasangnya tidak muncul. Berkas rusak yang memicu "paket tampaknya tidak
valid" akan tertangkap di sini.

Perlu disebut jujur: ukuran yang cocok **tidak** membuktikan isinya utuh — justru
kejadian di atas contohnya. Yang pasti adalah kebalikannya, ukuran yang meleset
sudah pasti berkas yang tidak utuh.

### Kegagalan tidak bisa diam lagi

Setiap panggilan plugin dari lapisan pembaruan diberi batas waktu 8 detik, dan
setiap jalan buntu menulis kalimatnya sendiri ke layar. Galat unduhan juga
dipisahkan dari galat pemeriksaan — sebelumnya keduanya berbagi satu bidang,
sehingga berkas rusak dilaporkan dengan kalimat tentang hasil pemeriksaan
terakhir. Bentuk kegagalan "ditekan, lalu tidak ada apa-apa" tidak boleh ada
lagi, apa pun sebabnya nanti.

---

## 0.3.0

Rilis tata letak, dan seluruhnya hanya menyentuh aplikasi Android. Tampilan web
tidak berubah sebaris pun.

> **Pasang menimpa 0.2.0.** Tidak perlu mencopot, dan chapter yang sudah
> tersimpan di HP tetap utuh.

### Navigasi pindah ke bawah layar

Laci samping adalah pola web: ia menuntut dua ketukan untuk setiap perpindahan,
dan tombolnya duduk di pojok kiri atas — sudut terjauh dari ibu jari. Sekarang
ada bilah tab di tepi bawah: **Beranda · Jelajahi · Sumber · Tersimpan ·
Lainnya**, dengan lencana jumlah komik di tab Tersimpan.

Menu selengkapnya tetap di laci yang sama, dibuka tab "Lainnya" — bukan
disalin jadi lembar menu kedua yang suatu hari akan berbeda isinya.

### Beranda disusun ulang

Sampul komik sekarang mendapat ruang penuh di kepala halaman, satu judul per
layar, digeser mendatar. Di bawahnya baris yang juga digeser untuk **Lanjut
baca** (dengan bilah kemajuan di kaki tiap sampul) dan **Favorit**, lalu
**Baru diperbarui** sebagai daftar bernomor.

Grid ditinggalkan di HP karena dua kolom hanya memuat empat judul sebelum
lipatan — seluruh koleksi terbaca sebagai satu daftar panjang tanpa penekanan.
Baris mendatar memuat lebih banyak per tinggi layar, dan ubin yang terpotong di
tepi kanan adalah isyarat "masih ada lagi" yang tidak dimiliki grid.

### Jelajahi: penyaring jadi chip

Tiga kotak pilihan yang dulu bertumpuk setinggi hampir satu layar penuh —
sehingga yang pertama terlihat saat membuka Jelajahi adalah formulir, bukan satu
pun komik — sekarang jadi dua baris chip yang digeser. Pilihan yang sedang aktif
selalu terbaca tanpa membuka apa pun.

Gridnya tiga kolom, bukan dua: sembilan judul muat sebelum lipatan, dan sampul
selebar 108px masih mudah dikenali.

### Tersimpan di HP: rak jadi terlipat

Dulu tiap komik merender SELURUH chapternya sekaligus. Satu komik 180 chapter
berarti 180 baris, dan beberapa komik berarti ribuan baris sekaligus — menggulir
sampai komik kedua praktis mustahil. Sekarang tiap komik terlipat jadi satu
baris, dan yang dibuka pun dibatasi 25 chapter dengan tombol untuk menampilkan
sisanya.

Tombol **hapus semua chapter** dipindah ke dalam panel yang terbuka. Sebelumnya
ia duduk tepat di sebelah judul — penghapus permanen selebar jempol, persis di
tempat yang disentuh orang saat hendak MEMBUKA komiknya.

### Ikon diseragamkan

Navigasi dulu memakai emoji ditambah satu glif teks, dan campuran itu tidak bisa
dirapikan: emoji dilukis font sistem, jadi bentuk dan beratnya berbeda di tiap
perangkat — dan warnanya tidak bisa diikutkan tema. Dua belas ikon sekarang
digambar sebagai SVG dengan satu berat garis, dan ikut berwarna bersama label
tab yang sedang aktif.

### Untuk yang membaca kodenya

Tata letak Android hidup di `apps/web/src/platform/` (`TabBawah`, `BerandaApp`,
`JelajahiApp`, `UbinKomik`) di balik `IS_APP`, jadi Rollup membuangnya utuh dari
bundel web. Pemisahannya diperiksa dari dua arah pada tiap build: penanda khas
Android harus nol di bundel web, dan penanda khas web harus nol di bundel
Android.

---

## 0.2.0

Rilis tampilan. Tidak ada fitur yang hilang dan tidak ada yang perlu diunduh
ulang — yang berubah adalah seluruh permukaan aplikasi.

> **Pasang menimpa 0.1.2.** Tidak perlu mencopot, dan chapter yang sudah
> tersimpan di HP tetap utuh.

### Tampilan baru menyeluruh

Warna lama — hijau Konoha, jingga Naruto, latar gelap kebiruan — diganti satu
palet yang dipakai seluruh aplikasi: **Soft Lavender + Warm Neutral**. Latar
terang tidak lagi putih mentah, latar gelap tidak lagi mendekati hitam, dan
sampul komik sekarang satu-satunya hal berwarna kuat di layar.

Yang berubah bukan sekadar warna latar dan tombol: kartu komik, navigasi,
kotak pencarian, formulir, badge genre, kabar galat, dan penanda status semuanya
dibawa ke satu sistem yang sama. Beberapa di antaranya sekalian diperbaiki
artinya — status "Hiatus" dulu merah, sewarna dengan "gagal memuat" dan "hapus
komik", padahal tidak ada yang rusak; sekarang kuning. Titik "sedang
memeriksa…" dulu berwarna padahal ia bukan kabar baik maupun buruk; sekarang
abu netral.

### Tema terang dan gelap benar-benar setara

Sebelumnya tiap komponen menulis dua warna — satu untuk terang, satu untuk
gelap — dan komponen baru gampang lupa menulis separuhnya. Sekarang warnanya
yang berganti, bukan kelasnya, jadi tidak ada lagi tulisan yang hilang di salah
satu tema.

Perpindahan temanya juga dibuat halus, dan hanya warnanya yang ditransisikan:
menganimasikan seluruh tata letak akan terasa tersendat di halaman berisi
ratusan ubin komik.

### Reader mengikuti tema

Bilah atas dan bawah reader dulu **dipaksa gelap** apa pun temanya. Di tema
terang hasilnya dua bilah hitam pekat yang mengapit halaman komik putih — batas
keras yang menarik mata keluar dari gambar, persis yang tidak diinginkan saat
membaca. Sekarang keduanya mengikuti tema, dan area bacanya tetap punya warna
sendiri yang lebih tenang daripada latar aplikasi.

Kendali kecerahan dan kontras di panel setelan tidak disentuh.

### Daftar situs sumber diperbarui

Kiryuu pindah alamat; yang lama sudah mati total, jadi tanpa rilis ini sumber
itu tidak akan pernah memberi hasil lagi di HP. Dua sumber yang sudah tidak
pernah menjawab — **mgkomik.id** dan **siikomik.net** — dibuang supaya tidak
lagi muncul sebagai pilihan yang pasti gagal.

### Untuk yang membaca kodenya

Tabel pola situs dipecah jadi satu berkas per situs
(`packages/sumber/situs/`), lengkap dengan penjelasan keanehan masing-masing
dan panduan tiga langkah menambah situs baru. Tidak ada satu pun `if (host ===
...)` di dalam mesin ekstraksinya — situsnya dijelaskan sebagai data, bukan
sebagai cabang kode.

Warna aplikasi sekarang hidup di satu tempat (`apps/web/src/styles/theme.css`)
sebagai variabel CSS; `tailwind.config.js` tidak memuat satu pun nilai hex.
Mengganti tema di kemudian hari cukup menyunting satu berkas.

Pengujian bertambah: `npm run test:sumber-cadangan` (22 pemeriksaan untuk sumber
cadangan per komik) dan `npm run test:import-lewati` (12 pemeriksaan yang
menjaga chapter yang sudah ada tidak diunduh ulang).

---

## 0.1.2

Rilis ini membereskan satu ketimpangan dan dua bug yang terlihat langsung di HP.

> **Pasang menimpa 0.1.1.** Tidak perlu mencopot, dan chapter yang sudah
> tersimpan tidak perlu diunduh ulang.

### Unduh komik dari situs sumber langsung ke HP

Sampai 0.1.1, tombol unduh di halaman seri sumber memanggil `/api/imports/url` —
API server rumah, dijaga kemampuan `kelola_koleksi`. Artinya orang yang cuma
memasang APK-nya dari GitHub bisa mencari komik, membuka serinya, mencentang 40
chapter, lalu tidak punya apa pun untuk menekannya. Seluruh guna aplikasi ini
adalah membawa komik di dalam HP, dan justru itulah yang tidak bisa dikerjakannya.

Sekarang ada **Simpan ke HP**: chapternya diambil langsung dari situs sumber ke
penyimpanan aplikasi, tanpa server, tanpa akun, tanpa izin apa pun. Chapter yang
sudah ada diberi tanda "✓ Di HP" dan dilewati, kemajuannya muncul di rak
**Tersimpan di HP** seperti unduhan lain, dan hasilnya dibaca reader yang sama.

Tombol lama tetap ada sebagai **Kirim ke server**, tapi hanya muncul kalau server
rumahnya benar-benar terjangkau dan orangnya memang boleh mengelola koleksi.

Yang perlu diketahui kalau ikut membaca kodenya: entri dari situs sumber
mendapat id ANGKA dari penghitung yang mulai di 1.000.000.000
(`apps/web/src/offline/idSumber.js`), sementara id dari server rumah masih lima
digit. Itu yang membuat penyimpanan, katalog, reader, dan rute `/read/:chapterId`
tidak perlu diubah sama sekali — semuanya tetap bekerja dengan id angka.
Pemetaannya disimpan di `index.json`, yang naik ke versi 2; katalog versi 1 tetap
dibaca apa adanya.

### Layar pertama tidak lagi memaksa mencari server

Membuka aplikasi untuk pertama kali langsung menyodorkan kotak "alamat server".
Untuk orang yang tidak punya server — dan tidak berniat membuatnya — itu adalah
permintaan menyiapkan sesuatu yang tidak akan pernah ada, sebelum ia melihat satu
pun komik.

Sekarang layarnya menawarkan dua jalan sejajar: **Pakai di HP ini saja** dan
**Sambungkan ke server rumah**. Yang pertama di atas, karena itulah yang bisa
langsung dipakai siapa pun. Formulir servernya tetap utuh, cuma dilipat — dan
terbuka sendiri kalau memang sudah pernah ada alamat tersimpan.

Tidak ada pendaftaran akun lokal, dan itu disengaja: menyimpan komik ke HP
sendiri tidak butuh persetujuan siapa pun. Akun lokal hanya menambah satu layar
lagi sebelum komik pertama, berikut satu kata sandi yang kalau lupa tidak bisa
dipulihkan siapa pun.

### Jam dan ikon baterai menimpa panel atas — sekarang benar-benar diperbaiki

Perbaikan di 0.1.1 memasang inset sistem sebagai padding WebView di
`MainActivity`, dan itu tidak pernah terlihat hasilnya. Sebabnya: Capacitor 8
punya plugin bawaan `SystemBars` yang selalu aktif, dan pada WebView 140 ke atas
dengan `viewport-fit=cover` — keadaan HP penguji — ia justru **berhenti** memberi
jarak secara native dan menyerahkan seluruhnya ke lapisan web lewat
`env(safe-area-inset-*)` serta variabel CSS yang ia suntikkan sendiri. Padding
yang dipasang di sisi Java bekerja di jalur yang sudah ditinggalkan.

Sekarang jaraknya dihitung di CSS (`--aman-atas`/`--aman-bawah` di
`styles/theme.css`), dengan variabel suntikan Capacitor didahulukan dan `env()`
sebagai cadangan — supaya pada WebView lama, yang masih memberi jarak secara
native, jaraknya tidak terhitung dua kali. Terpasang di TopBar, laci menu,
footer, toast, dan bilah atas-bawah reader. Kode inset di `MainActivity` dibuang.

### Unduhan pembaruan yang berhenti tepat di akhir

Berkas APK-nya turun sampai 100% lalu menggantung di "Mendownload…". Penyebabnya
bukan penyimpanan: `Bridge.launchIntent()` milik Capacitor memanggil
`startActivity` tanpa `FLAG_ACTIVITY_NEW_TASK`, jadi browsernya berdiri **di
dalam** tumpukan tugas NaruReader — dan untuk berkas 32 MB, kembali ke aplikasi
berarti mendorong jendela yang sedang mengunduh ke belakang.

Tombol Unduh sekarang lewat plugin kecil `BukaDiLuar` (https saja, tanpa izin
baru) yang membukanya sebagai tugas terpisah: unduhannya berjalan di latar
belakang dan aplikasi boleh ditutup. Sesudah ditekan, kartu Pengaturan berubah
jadi tiga langkah — tunggu selesai, buka notifikasi unduhan, ketuk berkasnya lalu
Pasang — berikut catatan bahwa komik tersimpan tidak ikut terhapus.

### Untuk yang membangun sendiri

`docs/KOMPILASI-APK.md` menjelaskan langkah demi langkah cara mengompilasi APK
dari VS Code, termasuk jalur manual lewat Capacitor dan daftar kegagalan yang
sudah pernah terjadi. `.vscode/tasks.json` menjalankannya dari Command Palette.

Pengujian baru: `npm run test:id-sumber` (46 pemeriksaan untuk alokasi id lokal —
stabil, tidak bertabrakan, index.json lama tetap terbaca, pemetaan bisa dibangun
ulang dari folder). Dua di antaranya gagal saat pertama ditulis: setiap chapter
yang nomornya tidak terbaca memetakan ke kunci yang sama, karena `Number(null)`
bernilai 0 — seluruhnya akan berbagi satu folder, dan yang kedua menimpa yang
pertama.

---

## 0.1.1

Rilis perbaikan. Empat dari lima perbaikan di bawah menyangkut hal yang sudah
terlihat langsung di HP.

> **Wajib pasang ulang.** APK 0.1.0 tidak bisa membaca komik yang sudah
> tersimpan di HP — itu bug yang diperbaiki di sini, dan perbaikannya tidak bisa
> sampai lewat cara lain selain APK baru. Chapter yang sudah tersimpan **tidak
> perlu diunduh ulang**: berkasnya selama ini utuh, yang rusak hanya jalan
> membacanya.

### Komik tersimpan tidak bisa dibaca sama sekali

Gejalanya: chapter yang sudah disimpan ke HP terlihat di rak `/offline` berikut
ukurannya, tapi membukanya tidak menghasilkan satu halaman pun. Menyimpan
chapter baru juga gagal dengan "Folder penyimpanan aplikasi tidak bisa dibuka".

Penyebabnya satu blok `try` di `apps/web/src/offline/penyimpanan.js`.
`Filesystem.mkdir` dan `Filesystem.getUri` duduk bersama di dalamnya, dan
`Filesystem.mkdir` **menolak** kalau foldernya sudah ada — `recursive: true`
sekalipun. Folder `offline` sudah ada pada setiap peluncuran setelah chapter
pertama disimpan, jadi keadaan yang paling sering terjadi justru keadaan yang
gagal: mkdir menolak, `getUri` tidak pernah dijalankan, dan akar folder data
tetap kosong seumur proses. Sesudah itu setiap URL halaman lokal bernilai null,
dan pembaca menyimpulkan chapternya tidak ada.

Yang membuatnya lama tidak tertangkap: pada pemasangan baru folder itu belum
ada, jadi mkdir berhasil dan semuanya bekerja. Kerusakannya baru muncul pada
peluncuran **kedua**, dan sembuh sesaat setiap kali data aplikasi dibersihkan.

### Komik tersimpan tidak tampil di beranda

Beranda seluruhnya digerakkan API, jadi komik yang sudah dibawa ke HP tidak
pernah punya tempat di sana. Sekarang ada baris **Tersimpan di HP** yang langsung
menunjuk chapter paling pantas dilanjutkan per komik, dihitung dari posisi baca
yang tersimpan di HP sendiri.

Sekalian satu pesan yang menyesatkan: saat server rumah tidak terjangkau, beranda
menulis "Perpustakaan masih kosong" kepada orang yang koleksinya utuh. Sekarang
yang tampil adalah galat berikut tombol coba lagi — yang selama ini sudah ada di
kode tapi tidak pernah sempat terlihat karena selalu didahului pesan kosong itu.

### Jam dan ikon baterai menimpa panel atas

Android 15 ke atas memaksa aplikasi menggambar tepi-ke-tepi, sehingga status bar
sistem jatuh di atas breadcrumb dan kotak pencarian. Inset sistem sekarang
dipasang sebagai padding WebView di `MainActivity`.

Perbaikan sebelumnya memakai `android:fitsSystemWindows` di `activity_main.xml`,
dan berkas itu ternyata tidak pernah dipakai: `BridgeActivity` milik Capacitor 8
menginflasi layout miliknya sendiri. Berkas mati itu dibuang.

Halaman komik tetap memakai seluruh tinggi layar — saat status bar disembunyikan,
insetnya mengecil sendiri jadi nol.

### Halaman seri sumber belum bisa mengunduh

Daftar chapter di halaman seri sumber bisa dilihat tapi tidak bisa diapa-apakan.
Sekarang tiap chapter bisa dicentang — seluruh baris jadi sasaran ketuk, bukan
kotak kecilnya — dengan tombol cepat **5/10/25 terbaru** dan **Semua**, lalu
diantre ke server rumah untuk diunduh.

### Unduh ke HP sekarang bisa memilih sendiri

Dulu tombolnya terkunci pada "10 chapter berikutnya". Sekarang panelnya menerima
rentang: tombol cepat mengisinya, dan angkanya bisa disunting langsung. Panelnya
menyebut berapa chapter yang akan disimpan dan berapa yang dilewati karena sudah
ada di HP.

### Dua sumber hilang dari Scout tanpa pesan

Daftar domain bawaan di sisi server ketinggalan dua host yang blok katalognya
sudah lengkap, sehingga **komikindo.ch** dan **kiryuu.to** tersaring tanpa satu
baris log pun bagi siapa pun yang menjalankan server tanpa berkas `.env`.
Sekarang keempat sumber benar-benar dipindai.

### Untuk yang membaca kodenya

Lapisan offline sebelumnya tidak punya satu pun pengujian, karena ia hanya masuk
akal di dalam browser. `apps/web/uji-offline` sekarang menjalankan modul offline
yang asli di Chromium dengan plugin Capacitor ditiruan — 19 pemeriksaan,
`npm run test:offline`. Lima di antaranya gagal sebelum perbaikan pertama di atas,
dengan gejala yang sama seperti yang dilaporkan dari HP.

Ditambah `npm run test:rentang` (23 pemeriksaan untuk hitungan rentang chapter:
batas inklusif, rentang terbalik, nomor desimal seperti Ch 10.5).

# Catatan Rilis

Isi berkas ini juga dipakai apa adanya sebagai keterangan di halaman
[Releases](https://github.com/EigaCerion/comic/releases).

Versi APK diturunkan dari `"version"` di `apps/web/package.json` (dan harus sama
dengan `package.json` akar). Membangun APK rilis: `apps/web/scripts/build-android.ps1`
— hanya skrip itu yang meneruskan versinya ke Gradle.

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

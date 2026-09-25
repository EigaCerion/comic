# Catatan Rilis

Isi berkas ini juga dipakai apa adanya sebagai keterangan di halaman
[Releases](https://github.com/EigaCerion/comic/releases).

Versi APK diturunkan dari `"version"` di `apps/web/package.json` (dan harus sama
dengan `package.json` akar). Membangun APK rilis: `apps/web/scripts/build-android.ps1`
— hanya skrip itu yang meneruskan versinya ke Gradle.

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

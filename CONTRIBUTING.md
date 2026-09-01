# Berkontribusi ke NaruReader

Terima kasih sudah mau ikut membangun. Dokumen ini menjelaskan cara kerja
proyek ini secara jujur — termasuk bagian yang belum rapi — supaya kontribusimu
tidak terbuang karena salah asumsi.

---

## Melaporkan bug

Laporan yang baik menghemat berjam-jam penelusuran. Sertakan sebanyak mungkin
dari ini:

**Untuk masalah unduhan atau impor**

- Teks error lengkap dari halaman **Unduhan** (pesan kami menyebut nomor halaman
  dan URL-nya — jangan dipotong)
- URL sumber komiknya, kalau boleh dibagikan
- Isi `apps/api/logs/error.log` di sekitar waktu kejadian

**Untuk masalah tampilan**

- Lebar layar (mis. "HP 375px" atau "laptop 1440px")
- Mode terang atau gelap
- Halaman mana, dan apa yang kamu harapkan terjadi

**Untuk masalah koneksi dari HP**

Jalankan ini lebih dulu dan lampirkan hasilnya — ia memeriksa alamat, firewall,
VPN, dan isolasi jaringan sekaligus:

```bash
npm run precheck
```

**Selalu sertakan**: versi Node (`node -v`), sistem operasi, dan langkah untuk
mengulang kejadiannya.

---

## Menyiapkan lingkungan

Ikuti bagian **Pemasangan** di [README.md](README.md). Untuk pengembangan pakai
mode dua port supaya perubahan langsung termuat:

```bash
npm run dev
```

Frontend di `http://localhost:5173`, API di `http://localhost:3000`.

---

## Konvensi kode

### Bahasa

Proyek ini memakai **dua bahasa dengan pembagian yang disengaja**:

- **Istilah domain dan alur bisnis → bahasa Indonesia.** Contoh nyata dari kode:
  `hashSandi`, `wajibLogin`, `bolehkah`, `batasiAksi`, `urlUtama`, `sapuanKedua`,
  `rapikanNomor`, `daftarKomik`.
- **Istilah teknis baku → bahasa Inggris.** `db`, `req`, `res`, `config`, `row`,
  `slug`, `payload`, dan nama pustaka tetap apa adanya.

Aturan praktisnya: kalau istilah itu punya padanan Indonesia yang wajar, pakai
Indonesia. Kalau menerjemahkannya justru membingungkan (`request` → "permintaan"
di tengah kode Express), biarkan Inggris.

### Komentar

Komentar di sini menjelaskan **kenapa**, bukan **apa**. Kode sudah menunjukkan
apa yang terjadi; yang tidak terlihat adalah alasannya.

Banyak komentar merujuk kejadian nyata yang melatarbelakanginya — misalnya kenapa
timeout unduhan berbasis kemacetan alih-alih total waktu, atau kenapa `min-w-0`
wajib ada pada elemen ber-`truncate`. **Pertahankan gaya ini.** Kalau kamu
memperbaiki bug yang tidak kentara, tulis satu-dua kalimat tentang gejalanya —
itu yang mencegah orang berikutnya mengembalikannya tanpa sadar.

### Lint

```bash
npm run lint
```

Saat ini ESLint baru dikonfigurasi untuk `apps/web`. Kode `apps/api` mengikuti
gaya yang sama secara manual: modul ESM, `const` lebih dulu, tanpa `var`.
Menambahkan konfigurasi lint untuk `apps/api` termasuk kontribusi yang ditunggu.

---

## Menguji perubahan

**Belum ada kerangka uji otomatis.** Ini keterbatasan nyata, bukan pilihan
desain — dan memperbaikinya adalah kontribusi yang sangat berharga.

Yang tersedia sekarang adalah tiga skrip pemeriksaan:

```bash
npm run test:db
```

```bash
npm run test:extractor
```

```bash
npm run test:audit
```

### Disiplin yang berlaku: ukur, jangan mengira

Proyek ini berkali-kali tertolong oleh kebiasaan mengukur sebelum dan sesudah
perubahan. Beberapa bug paling merepotkan justru **tidak terlihat mata** dan baru
ketahuan dari angka.

Kalau perubahanmu menyentuh tampilan, sertakan angka di deskripsi PR:

- Lebar layar 375px: apakah `document.documentElement.scrollWidth` tetap 375,
  dan berapa elemen yang meluber ke kanan
- Lebar desktop: lebar kartu, padding, posisi elemen yang kamu ubah

Kalau menyentuh unduhan atau kompresi, bandingkan hasil sebelum dan sesudah pada
berkas yang sama — ukuran keluaran, mode kompresi, dan dimensinya.

---

## Batasan yang wajib dihormati

Empat hal ini sudah pernah menimbulkan masalah nyata dan diperbaiki dengan susah
payah. Perubahan yang melanggarnya akan ditolak.

**1. Mobile tidak boleh regresi.** Di lebar 375px, semua halaman harus bebas
scroll horizontal. Grid wajib punya definisi kolom dasar; elemen ber-`truncate`
di dalam flex wajib punya `min-w-0`.

**2. Jangan pakai properti yang mahal saat scroll.** `background-attachment:
fixed` dan `backdrop-filter` pada elemen yang berulang (seperti kartu komik)
pernah membuat scroll di HP tersendat parah. Satu elemen tetap (header) masih
wajar.

**3. Jangan menambah dependensi tanpa alasan kuat.** Fitur autentikasi ditulis
memakai `node:crypto` bawaan, bukan pustaka baru. Kalau usulanmu butuh paket
tambahan, jelaskan di PR kenapa tidak bisa tanpa itu.

**4. Keamanan tidak boleh mundur.** Sandi disimpan sebagai hash scrypt. Rahasia
tidak boleh masuk ke repo. Endpoint yang mengubah data wajib dijaga izin, dan
membaca komik harus tetap terbuka tanpa akun.

---

## Alur pull request

1. **Fork** repo ini dan buat branch dari `main`
2. Kerjakan satu hal per PR — PR kecil jauh lebih cepat ditinjau
3. Jalankan `npm run lint` dan pastikan bersih
4. Uji di **dua ukuran layar** kalau menyentuh tampilan
5. Tulis deskripsi PR yang memuat:
   - Masalah apa yang diselesaikan
   - Bagaimana kamu membuktikannya berhasil (angka, bukan kesan)
   - Apa yang berpotensi rusak karenanya

Pesan commit yang jelas dalam bahasa Indonesia atau Inggris sama-sama diterima.

---

## Yang sedang dibutuhkan

Kalau ingin membantu tapi belum tahu mulai dari mana:

| Bidang | Contoh pekerjaan |
|---|---|
| **Pengujian** | Menyiapkan kerangka uji (Vitest), uji unit untuk pengurai sumber dan pipeline kompresi |
| **Sumber impor** | Menambah preset selector untuk situs baru di `apps/api/src/services/sources/selectors.json` |
| **Aksesibilitas** | Navigasi keyboard di pembaca, label ARIA, pengujian pembaca layar |
| **Terjemahan** | Antarmuka saat ini hanya bahasa Indonesia |
| **Dokumentasi** | Panduan pemasangan untuk macOS dan Linux (sekarang berfokus ke Windows) |
| **Lint API** | Konfigurasi ESLint untuk `apps/api` |

---

## Catatan tentang sumber komik

NaruReader adalah **mesin pembaca dan pengelola koleksi**, bukan penyedia konten.
Aplikasi ini tidak memaketkan komik apa pun.

Kalau kontribusimu menyentuh bagian impor, hormati aturan situs sumber: patuhi
`robots.txt` (`RESPECT_ROBOTS=true` adalah default dan jangan diubah), pertahankan
jeda antar permintaan, dan identifikasi diri lewat `USER_AGENT` yang jujur.
Kontribusi yang bertujuan menembus proteksi bot tidak akan diterima.

---

## Lisensi

Dengan berkontribusi, kamu setuju kontribusimu dilisensikan sama dengan proyek
ini.

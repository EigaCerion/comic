# Mengompilasi APK NaruReader

Panduan ini untuk membangun APK sendiri dari VS Code di PC ini. Ada dua jalan:
**satu perintah** (yang dipakai sehari-hari) dan **langkah demi langkah** (kalau
ada yang gagal dan perlu tahu bagian mana yang salah).

Keduanya menghasilkan berkas yang sama persis. Skrip satu-perintah itu memang
tidak lebih dari urutan langkah di bawah, ditambah beberapa pemeriksaan yang
menggagalkan build lebih awal alih-alih setelah menunggu sepuluh menit.

---

## 0. Yang harus sudah ada di mesin (sekali saja)

| Apa | Di mana | Catatan |
| --- | --- | --- |
| JDK 21 | `D:\Android\jdk-21` | Tidak dipasang sistem-lebar dan tidak di PATH |
| Android SDK | `D:\Android\sdk` | Berisi `platforms\android-36`, `build-tools\36.0.0`, `cmdline-tools\latest` |
| Cache Gradle | `D:\Android\gradle-home` | Terisi sendiri saat build pertama |
| Kunci rilis | `D:\CODE\key\naruread\` | `naruread-rilis.keystore` + `key.properties` |
| Node.js | 18 ke atas | `node -v` |

JDK dan SDK sengaja **tidak** ditaruh di `PATH` pengguna maupun di `JAVA_HOME`
permanen. Mesin ini juga memakai Node dan alat lain yang punya pendapat sendiri
soal `JAVA_HOME`, dan menyetelnya permanen pernah membuat hal-hal yang tidak
berhubungan ikut rusak. Semua perintah di bawah menyetelnya **hanya untuk
terminal itu sendiri**.

`key.properties` berisi empat baris: `storeFile`, `storePassword`, `keyAlias`,
`keyPassword`. Berkas itu dan keystore-nya hidup **di luar semua repositori** dan
tidak boleh disalin ke dalamnya. Kalau keystore hilang, tidak ada lagi APK baru
yang bisa dipasang menimpa yang sudah beredar — Android menolak pembaruan yang
sertifikatnya berbeda, dan satu-satunya jalan adalah mencopot aplikasi, yang
menghapus seluruh komik tersimpan di HP setiap pemakainya.

---

## 1. Buka proyeknya di VS Code

1. **File → Open Folder…** → `D:\CODE\comic\naruread-app`
2. Buka terminal: **Ctrl + `**
3. Pastikan terminalnya **PowerShell** — namanya terbaca di sudut kanan panel
   terminal. Kalau yang terbuka Git Bash atau cmd, klik panah di sebelah **+** →
   **PowerShell**. Seluruh perintah di bawah adalah sintaks PowerShell.

Kalau baru saja menarik perubahan dari Git, sekali saja:

```powershell
npm install
```

### Tanpa mengetik apa pun: Command Palette

`.vscode/tasks.json` di repo ini sudah memuat seluruh perintah di bawah sebagai
tugas VS Code:

- **Ctrl + Shift + B** → langsung membangun **APK rilis**.
- **Ctrl + Shift + P** → `Tasks: Run Task` → pilih salah satu:

  | Tugas | Yang dikerjakan |
  | --- | --- |
  | APK rilis | Bagian 3 — jalur sehari-hari |
  | APK rilis (timpa versi yang sudah ada) | Sama, untuk versi yang belum pernah diunggah |
  | APK debug | Untuk dicoba di HP sendiri, tanpa kunci rilis |
  | Bundel android + cap sync (tanpa Gradle) | Langkah 4.3 + 4.4 saja |
  | Periksa sebelum build (lint + uji) | Bagian 9 |
  | Periksa tanda tangan APK | Bagian 5 |

Tugas-tugas itu dipaksa berjalan di PowerShell, apa pun shell bawaan terminal
yang sedang aktif — semua perintah di sini sintaks PowerShell, dan menjalankannya
di Git Bash gagal dengan pesan yang tidak menyebut sebabnya.

Sisa panduan ini menjelaskan apa yang sebenarnya dikerjakan tugas-tugas itu,
untuk saat ada yang gagal.

---

## 2. Naikkan nomor versi — wajib untuk setiap rilis

Versi ditulis di **dua** berkas dan keduanya harus sama:

- `package.json` (akar repo) → `"version"`
- `apps/web/package.json` → `"version"`

Yang benar-benar menentukan APK hanya yang di `apps/web`, tapi build akan menolak
jalan kalau keduanya berbeda — karena menaikkan yang akar saja adalah hal paling
wajar dilakukan orang, dan dulu itu tidak mengubah APK sama sekali tanpa memberi
satu pun tanda.

Bentuknya `major.minor.patch`, dengan **minor dan patch di bawah 100**
(`versionCode` APK dihitung `major*10000 + minor*100 + patch`).

Kenapa wajib: tidak ada apa pun dalam alur ini yang menaikkan versi sendiri.
Membangun ulang tanpa menaikkannya menghasilkan biner **berbeda** di bawah nomor
versi yang **sama** — dan pengecek pembaruan di dalam aplikasi hanya
membandingkan nomornya, jadi tidak seorang pun akan pernah diberi tahu bahwa
binernya berganti.

---

## 3. Jalan cepat: satu perintah

```powershell
powershell -ExecutionPolicy Bypass -File apps\web\scripts\build-android.ps1
```

Hasilnya `apps\web\dist-apk\NaruReader-<versi>.apk`, ditandatangani kunci rilis,
`debuggable false`.

Untuk mencoba di HP sendiri tanpa menyentuh kunci rilis:

```powershell
powershell -ExecutionPolicy Bypass -File apps\web\scripts\build-android.ps1 -ModeDebug
```

APK debug mendarat dengan nama berbeda (`NaruReader-<versi>-debug.apk`) supaya
tidak pernah tertukar dengan yang akan diunggah. **APK debug tidak bisa dipasang
menimpa APK rilis dan sebaliknya** — sertifikatnya berbeda, dan Android hanya
akan berkata "App not installed".

Kalau perlu membangun ulang versi yang berkas APK-nya sudah ada di `dist-apk`
**dan** yang lama belum pernah diunggah, tambahkan `-Timpa`.

---

## 4. Jalan manual, langkah demi langkah

Kerjakan semuanya di **satu** terminal PowerShell; variabel lingkungannya hanya
hidup selama terminal itu terbuka.

### 4.1 Tunjuk JDK, SDK, dan kunci — untuk terminal ini saja

```powershell
$env:JAVA_HOME = 'D:\Android\jdk-21'
$env:ANDROID_HOME = 'D:\Android\sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\sdk'
$env:GRADLE_USER_HOME = 'D:\Android\gradle-home'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:NARUREAD_KEY_PROPERTIES = 'D:\CODE\key\naruread\key.properties'
```

Periksa JDK-nya benar-benar terpakai:

```powershell
java -version
```

Harus menyebut **21**. Kalau menyebut versi lain, `PATH`-nya belum berlaku —
biasanya karena perintahnya dijalankan di terminal yang berbeda.

### 4.2 Beri tahu Gradle di mana SDK-nya

```powershell
Set-Content -Path apps\web\android\local.properties -Value 'sdk.dir=D:\\Android\\sdk' -Encoding ascii
```

Backslash-nya memang digandakan: isinya berkas *properties* Java, dan `\A` tanpa
penggandaan terbaca sebagai escape sehingga path-nya rusak diam-diam.
`-Encoding ascii` juga bukan hiasan — BOM membuat kunci pertamanya terbaca
sebagai `\uFEFFsdk.dir` dan SDK dianggap tidak ada.

### 4.3 Bangun bundel web mode android

```powershell
npm run build --workspace apps/web -- --mode android
```

Hasilnya `apps\web\dist-android\`. Mode `android` itulah yang menyalakan
`IS_APP`, memasukkan kode Capacitor, lapisan offline, dan pembaca situs sumber.
Build web biasa (`npm run build`) sengaja tidak memuat satu pun di antaranya.

### 4.4 Salin bundelnya ke proyek Android — inilah tugas Capacitor

```powershell
cd apps\web
npx cap sync android
cd ..\..
```

`cap sync` mengerjakan dua hal: menyalin `dist-android` ke
`android\app\src\main\assets\public`, dan mendaftarkan ulang seluruh plugin
Capacitor (Filesystem, FileTransfer, Preferences, StatusBar, dan kawan-kawan) ke
`android\app\capacitor.build.gradle` serta
`android\capacitor-cordova-android-plugins`.

**Langkah ini wajib diulang setiap kali kode web berubah.** Melewatinya
menghasilkan APK yang terkompilasi dengan bersih dan berisi aplikasi versi lama —
kegagalan yang tidak memberi satu pun pesan.

### 4.5 Kompilasi APK-nya

```powershell
cd apps\web\android
$env:GRADLE_OPTS = '-Xmx1g -Dfile.encoding=UTF-8'
.\gradlew.bat assembleRelease "-PnaruVersi=0.1.2" --no-daemon --max-workers=2 "-Dorg.gradle.jvmargs=-Xmx1g"
cd ..\..\..
```

Ganti `0.1.2` dengan versi yang barusan ditulis di `package.json`. Nilai itu yang
jadi `versionName`, dan `versionCode` dihitung darinya. Kalau `-PnaruVersi` tidak
diberikan, `build.gradle` menolak jalan — supaya tidak ada APK yang terbangun
dengan versi tebakan.

Untuk build debug (tanpa kunci rilis): ganti `assembleRelease` dengan
`assembleDebug`; hasilnya di `app\build\outputs\apk\debug\app-debug.apk`.

Batasan memori itu bukan kehati-hatian berlebihan: PC ini punya RAM 3,8 GB, dan
bawaan Gradle (daemon 1536 MB, pekerja sebanyak inti CPU) membuatnya *swap*
sampai build berhenti sendiri. `--no-daemon` supaya JVM-nya tidak menetap
memakan memori setelah selesai.

Build pertama paling lama (Gradle mengunduh dependensinya); yang berikutnya jauh
lebih cepat.

### 4.6 Ambil APK-nya dan beri nama yang benar

```powershell
$versi = (Get-Content apps\web\package.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force apps\web\dist-apk | Out-Null
Copy-Item apps\web\android\app\build\outputs\apk\release\app-release.apk "apps\web\dist-apk\NaruReader-$versi.apk" -Force
Get-Item "apps\web\dist-apk\NaruReader-$versi.apk" | Select-Object Name, Length
```

**Nama berkasnya tidak boleh diubah.** Pengecek pembaruan di dalam aplikasi
membaca versi dari nama aset (`NaruReader-0.1.2.apk`), bukan dari nama tag maupun
judul rilisnya — tag di repo ini dipakai ulang terus (`APK`).

---

## 5. Periksa hasilnya sebelum diunggah

Tanda tangan dan rentang Android yang didukung:

```powershell
D:\Android\sdk\build-tools\36.0.0\apksigner.bat verify --print-certs --verbose "apps\web\dist-apk\NaruReader-0.1.2.apk"
```

Yang harus terbaca: `Verified using v2 scheme: true`, pemiliknya `CN=NaruReader`,
dan sidik jari SHA-256 yang **sama dengan rilis sebelumnya**. Sidik jari berbeda
berarti APK-nya ditandatangani kunci lain, dan tidak akan bisa dipasang menimpa
yang sudah ada di HP siapa pun.

Versi, versionCode, dan minSdk:

```powershell
D:\Android\sdk\build-tools\36.0.0\aapt2.exe dump badging "apps\web\dist-apk\NaruReader-0.1.2.apk" | Select-String "package:|sdkVersion"
```

---

## 6. Pasang ke HP

Tidak ada emulator di PC ini — RAM-nya tidak cukup — jadi pengujiannya langsung
di HP:

- **Lewat kabel**, kalau USB debugging menyala:
  ```powershell
  D:\Android\sdk\platform-tools\adb.exe install -r "apps\web\dist-apk\NaruReader-0.1.2.apk"
  ```
  `-r` memasang menimpa yang lama tanpa menghapus datanya.
- **Tanpa kabel**: salin berkasnya ke HP, buka dari aplikasi Berkas, lalu izinkan
  pemasangan dari sumber tak dikenal saat diminta.

---

## 7. Unggah ke GitHub Releases

Rilisnya: <https://github.com/EigaCerion/comic/releases> — tag tetap `APK`,
dipakai ulang setiap kali.

1. Unggah `NaruReader-<versi>.apk` **dengan nama apa adanya**.
2. Tulis catatan rilisnya. Catatan itu yang ditampilkan kabar pembaruan di dalam
   aplikasi, dan **dipotong pada 1.200 karakter** — taruh hal terpenting di
   depan. Sumbernya `CHANGELOG.md`.
3. Buang APK versi lama dari rilis yang sama kalau sudah tidak diperlukan. Satu
   rilis boleh memuat beberapa APK, dan aplikasi memilih versi tertingginya.

---

## 8. Kalau gagal

| Pesan / gejala | Sebab dan jalan keluarnya |
| --- | --- |
| "The argument 'appswebscripts…' does not exist", lalu keluar seolah berhasil | Perintahnya dijalankan di Git Bash, bukan PowerShell: bash memakan backslash di `apps\web\scripts\…`. PowerShell tetap keluar dengan kode 0, jadi kegagalannya tidak terlihat dari kode keluar — yang menandainya hanya tidak adanya APK baru di `dist-apk`. Pakai terminal PowerShell (langkah 1), atau jalur absolut dengan tanda kutip. |
| `Unsupported class file major version` | JDK-nya bukan 21. Ulangi 4.1 di terminal yang sama. |
| `SDK location not found` | `local.properties` belum ada, atau backslash-nya tidak digandakan. Ulangi 4.2. |
| Gradle berhenti sendiri, PC macet | RAM. Tutup browser dan server rumah, pastikan `--no-daemon --max-workers=2` ikut tertulis. |
| `Keystore file not found`, build rilis ditolak | `NARUREAD_KEY_PROPERTIES` belum disetel, atau jalurnya relatif. Pakai jalur absolut. |
| APK jadi, tapi isinya aplikasi versi lama | `cap sync` dilewati. Ulangi 4.4 lalu 4.5. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, "App not installed" | Di HP masih terpasang APK dengan tanda tangan berbeda (biasanya debug). Harus dicopot dulu — dan **mencopot menghapus seluruh chapter tersimpan**. |
| `sdkmanager` menjawab "Package platforms not found" | `sdkmanager.bat` memecah nama paket di tanda `;`. Pakai `D:\Android\sdk\cmdline-tools\latest\bin\android.exe sdk install "platforms;android-36" --sdk=D:\Android\sdk`. |
| `lint` gagal dengan "project ':app' does not specify compileSdk" padahal jelas ada | Masalah konfigurasi Lint yang belum terpecahkan. `assembleRelease` tidak menjalankan Lint, jadi ini tidak menghalangi rilis. |

---

## 9. Sebelum membangun: pastikan yang lain masih hijau

```powershell
npm run lint --workspace apps/web
npm run test:offline
npm run test:rentang
```

Ketiganya jauh lebih cepat daripada satu build Gradle, dan menangkap sebagian
besar hal yang membuat APK-nya rusak di HP.

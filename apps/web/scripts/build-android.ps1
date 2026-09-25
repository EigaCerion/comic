# Bangun APK NaruReader.
#
# Bawaannya RILIS: APK yang ditandatangani kunci rilis dan tidak debuggable.
# Itu yang dibagikan lewat GitHub Releases. Sebelum ini yang dibangun selalu
# debug, dan APK debug ditandatangani sertifikat kunci debug — sertifikat yang
# dimiliki setiap pemasangan Android SDK di dunia — sehingga Play Protect
# menyebut aplikasinya berbahaya saat dipasang. Itu bukan alarm palsu.
#
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\build-android.ps1
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\build-android.ps1 -ModeDebug
#
# -ModeDebug dipakai untuk mencoba di HP sendiri tanpa menyentuh kunci rilis.
# Namanya bukan -Debug: PowerShell memakai nama itu untuk parameter umum.
#
# JDK dan Android SDK TIDAK dipasang sistem-lebar dan tidak ditaruh di PATH
# pengguna. Keduanya hidup di D:\Android, dan skrip ini yang menunjuknya —
# hanya untuk proses ini sendiri. Alasannya bukan kerapian: mesin ini juga
# memakai Node dan alat lain yang punya pendapat sendiri soal JAVA_HOME, dan
# menyetelnya permanen pernah membuat hal-hal yang tidak berhubungan ikut
# rusak. `$env:` di PowerShell hanya berlaku sampai proses ini berakhir.

param(
    [switch]$ModeDebug,
    # -Timpa hanya untuk membangun ulang versi yang berkas APK-nya sudah ada di
    # dist-apk, dan hanya kalau yang lama BELUM terunggah. Bawaannya menolak;
    # alasannya ada di jalur rilis di bawah.
    [switch]$Timpa
)

$ErrorActionPreference = 'Stop'

$akarWeb = Split-Path -Parent $PSScriptRoot
Set-Location $akarWeb

$jdk = 'D:\Android\jdk-21'
$sdk = 'D:\Android\sdk'
$gradleHome = 'D:\Android\gradle-home'

# Gagal di sini dengan kalimat yang jelas jauh lebih baik daripada membiarkan
# Gradle mengeluh soal "Unsupported class file major version" 40 baris kemudian.
if (-not (Test-Path $jdk)) { throw "JDK tidak ada di $jdk. Unduhan JDK belum selesai?" }
if (-not (Test-Path $sdk)) { throw "Android SDK tidak ada di $sdk. Unduhan SDK belum selesai?" }

# Versi APK dan nama berkasnya berasal dari package.json, satu-satunya tempat
# versi ditulis. Dibaca di sini lalu diteruskan ke Gradle sebagai properti,
# supaya build.gradle tidak perlu tahu di mana package.json berada.
$versi = (Get-Content (Join-Path $akarWeb 'package.json') -Raw | ConvertFrom-Json).version

# Minor dan patch dibatasi DUA angka, bukan enam seperti dulu. versionCode di
# android/app/build.gradle dihitung mayor*10000 + minor*100 + patch, jadi 0.1.100
# tidak bisa dipetakan dan build.gradle memang menolaknya — tapi penolakan itu
# baru tiba sesudah vite dan `cap sync` selesai, alasan yang sama dengan
# pemeriksaan berkas kunci di bawah. Pemeriksaannya di build.gradle TETAP ada:
# gradlew bisa dipanggil tanpa skrip ini.
if ($versi -notmatch '^\d{1,6}\.\d{1,2}\.\d{1,2}$') {
    throw "Versi `"$versi`" di apps/web/package.json bukan major.minor.patch dengan minor dan patch di bawah 100."
}

# Versi ditulis terpisah di package.json akar, dan yang menentukan APK hanya yang
# di apps/web — jadi menaikkan yang akar, hal yang paling wajar dilakukan orang,
# tidak mengubah APK sama sekali dan tidak memberi satu pun tanda. Dua angka yang
# boleh berbeda pasti suatu hari berbeda, jadi disamakan di sini.
$akarRepo = Split-Path -Parent (Split-Path -Parent $akarWeb)
$versiAkar = (Get-Content (Join-Path $akarRepo 'package.json') -Raw | ConvertFrom-Json).version
if ($versiAkar -ne $versi) {
    throw @"
Versi tidak sama: package.json akar menyebut $versiAkar, apps/web/package.json menyebut $versi.
Yang menentukan versi APK adalah apps/web/package.json. Samakan keduanya.
"@
}

if ($ModeDebug) {
    $tugasGradle = 'assembleDebug'
    $apkSumber = Join-Path $akarWeb 'android\app\build\outputs\apk\debug\app-debug.apk'
    # Nama berkasnya dibedakan dengan sengaja. Kalau APK debug ikut mendarat
    # sebagai NaruReader-<versi>.apk, ia menimpa hasil rilis di folder yang sama
    # — dan yang terunggah ke GitHub berikutnya adalah APK debug tanpa ada yang
    # menyadarinya, persis masalah yang sedang diperbaiki milestone ini.
    $apkTujuan = Join-Path $akarWeb "dist-apk\NaruReader-$versi-debug.apk"
}
else {
    $tugasGradle = 'assembleRelease'
    $apkSumber = Join-Path $akarWeb 'android\app\build\outputs\apk\release\app-release.apk'
    $apkTujuan = Join-Path $akarWeb "dist-apk\NaruReader-$versi.apk"

    # Tidak ada apa pun di alur ini yang menaikkan versi, jadi membangun ulang
    # tanpa menyentuh package.json akan menimpa APK rilis yang mungkin sudah
    # terunggah — dengan biner BERBEDA di bawah nomor versi yang sama. Pengecek
    # pembaruan di dalam aplikasi hanya membandingkan nomor versinya (0.1.0 vs
    # 0.1.0 berbunyi "sudah versi terbaru"), jadi tidak seorang pun akan pernah
    # diberi tahu bahwa binernya berganti, dan salinan yang sedang beredar sudah
    # hilang dari dist-apk sehingga tidak ada lagi yang bisa dibandingkan.
    if ((Test-Path $apkTujuan) -and -not $Timpa) {
        throw @"
APK untuk versi $versi sudah ada di dist-apk.
Biner baru WAJIB versi baru: naikkan "version" di apps/web/package.json (dan di
package.json akar) — versionCode APK diturunkan dari nomor itu, dan pengecek
pembaruan tidak punya cara lain untuk tahu ada yang berganti.
Kalau yang lama memang belum pernah diunggah, bangun ulang dengan -Timpa.
"@
    }

    # Diperiksa SEBELUM bundel web dibangun. build.gradle juga menolak build
    # rilis tanpa kunci, tapi penolakannya baru terjadi sesudah vite dan
    # `cap sync` selesai — beberapa menit menunggu untuk kegagalan yang sudah
    # bisa diketahui sekarang.
    #
    # Diabsolutkan lebih dulu, karena jalur RELATIF di variabel itu diselesaikan
    # dari dua folder berbeda: Test-Path di sini memakai apps/web (Set-Location di
    # atas), sedangkan build.gradle membungkusnya dengan new File(...) yang
    # diselesaikan dari direktori kerja Gradle, apps/web/android. Tanpa ini,
    # NARUREAD_KEY_PROPERTIES='kunci/key.properties' lolos pemeriksaan di depan
    # untuk berkas yang Gradle tidak akan pernah temukan — tepat kegagalan
    # menit-menitan yang pemeriksaan ini ada untuk mencegah. Variabelnya ditulis
    # ulang supaya kedua sisi memeriksa berkas yang sama persis.
    $propKunci = if ($env:NARUREAD_KEY_PROPERTIES) { $env:NARUREAD_KEY_PROPERTIES } else { 'D:\CODE\key\naruread\key.properties' }
    $propKunci = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($akarWeb, $propKunci))
    $env:NARUREAD_KEY_PROPERTIES = $propKunci
    if (-not (Test-Path $propKunci)) {
        throw @"
Build rilis butuh kunci penandatangan, tapi $propKunci tidak ada.
Isi berkas itu dengan storeFile, storePassword, keyAlias, keyPassword, atau tunjuk
berkas lain lewat variabel lingkungan NARUREAD_KEY_PROPERTIES.
Untuk membangun tanpa kunci: build-android.ps1 -ModeDebug
"@
    }
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = $gradleHome
$env:PATH = "$jdk\bin;$env:PATH"

# local.properties memberi tahu Gradle di mana SDK-nya. Isinya berkas properties
# Java, jadi setiap backslash harus digandakan; tanpa itu "\A" terbaca sebagai
# escape dan path-nya rusak diam-diam. Ditulis ASCII tanpa BOM — BOM membuat
# kunci pertama terbaca sebagai "\uFEFFsdk.dir" dan SDK dianggap tidak ada.
$sdkProps = $sdk.Replace('\', '\\')
Set-Content -Path (Join-Path $akarWeb 'android\local.properties') -Value "sdk.dir=$sdkProps" -Encoding ascii

Write-Host "==> NaruReader $versi ($(if ($ModeDebug) { 'debug' } else { 'rilis' }))"

Write-Host '==> Bundel web (mode android) + cap sync'
npm run build:android
if ($LASTEXITCODE -ne 0) { throw 'Build bundel android gagal.' }

Write-Host "==> gradlew $tugasGradle"
Push-Location (Join-Path $akarWeb 'android')
try {
    # PC ini punya RAM 3,8 GB. Bawaan Gradle (1536m untuk daemon, pekerja
    # sebanyak inti CPU) membuat mesinnya swap sampai build berhenti sendiri.
    # --no-daemon supaya JVM-nya tidak menetap memakan memori setelah selesai.
    $env:GRADLE_OPTS = '-Xmx1g -Dfile.encoding=UTF-8'
    .\gradlew.bat $tugasGradle "-PnaruVersi=$versi" --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx1g'
    if ($LASTEXITCODE -ne 0) { throw 'Gradle gagal.' }
}
finally {
    Pop-Location
}

if (-not (Test-Path $apkSumber)) { throw "Gradle selesai tapi APK tidak ada di $apkSumber" }

$tujuanDir = Join-Path $akarWeb 'dist-apk'
if (-not (Test-Path $tujuanDir)) { New-Item -ItemType Directory -Path $tujuanDir | Out-Null }
Copy-Item $apkSumber $apkTujuan -Force

$ukuran = [math]::Round((Get-Item $apkTujuan).Length / 1MB, 1)
Write-Host "==> Selesai: $apkTujuan ($ukuran MB)"

if (-not $ModeDebug) {
    Write-Host ''
    Write-Host 'Unggah berkas itu ke GitHub Releases DENGAN NAMA APA ADANYA:'
    Write-Host "  NaruReader-$versi.apk"
    Write-Host 'Pengecek pembaruan di dalam aplikasi membaca versinya dari nama berkas itu,'
    Write-Host 'bukan dari nama tag maupun judul rilisnya.'

    # APK debug yang sudah terpasang ditandatangani kunci debug SDK, yang ini
    # ditandatangani kunci rilis. applicationId-nya sama, jadi Android menolak
    # memasangnya di atas yang lama dengan INSTALL_FAILED_UPDATE_INCOMPATIBLE —
    # yang di layar HP hanya berbunyi "App not installed", tanpa menyebut
    # sertifikat sama sekali. Satu-satunya jalan adalah mencopot yang lama, dan
    # mencopot menghapus seluruh chapter yang sudah diunduh (Directory.Data,
    # folder milik aplikasi) beserta alamat dan token servernya. Auto Backup tidak
    # menyelamatkan apa pun: pemulihannya juga menuntut sertifikat yang sama.
    #
    # Dicetak di sini supaya kalimat itu ikut ke CATATAN RILIS GitHub, bukan cuma
    # diketahui pembangunnya: catatan rilis itulah yang ditampilkan kabar
    # pembaruan di dalam aplikasi, jadi ia benar-benar terbaca di HP sebelum
    # orangnya menekan Unduh.
    Write-Host ''
    Write-Host 'TULIS INI DI CATATAN RILISNYA (kabar pembaruan di HP menampilkan catatan itu):'
    Write-Host '  APK ini ditandatangani kunci rilis yang baru. Kalau di HP masih terpasang'
    Write-Host '  APK lama (debug), Android akan MENOLAK memasang yang ini dan hanya berkata'
    Write-Host '  "App not installed" — aplikasi lamanya harus dicopot lebih dulu, dan'
    Write-Host '  MENCOPOT MENGHAPUS seluruh chapter yang sudah diunduh beserta alamat dan'
    Write-Host '  token server. Catat alamat servernya dan unduh ulang chapter setelah'
    Write-Host '  memasang. Pembaruan sesudah ini tidak lagi menuntut pencopotan.'
}

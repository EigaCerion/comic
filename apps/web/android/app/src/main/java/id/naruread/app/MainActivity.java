package id.naruread.app;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Cangkang Android — satu-satunya tugas tambahannya: menjauhkan isi web dari
 * status bar dan bilah navigasi.
 *
 * Android 15 ke atas memaksa aplikasi bertarget SDK 35+ menggambar tepi-ke-tepi
 * (variables.gradle di sini: targetSdkVersion 36). Jendelanya dibentangkan
 * sampai ke belakang status bar, jadi tanpa penanganan inset, TopBar aplikasi
 * berakhir tertimpa jam, ikon notifikasi, dan indikator baterai — breadcrumb dan
 * kotak pencarian jadi separuh terbaca.
 *
 * Kenapa di sini, bukan lewat android:fitsSystemWindows di layout:
 * res/layout/activity_main.xml TIDAK PERNAH diinflasi. BridgeActivity milik
 * Capacitor 8 memanggil setContentView(R.layout.capacitor_bridge_layout_main) —
 * layout dari dalam paket capacitor-android, yang tidak memuat bendera itu.
 * Bendera yang dipasang di activity_main.xml karena itu tidak berpengaruh sama
 * sekali: berkasnya sisa cetakan Capacitor lama, dan perbaikan yang ditulis di
 * sana hanya tampak benar saat dibaca. Menimpa layout perpustakaan dengan
 * berkas bernama sama juga ditolak sebagai jalan keluar — ia menempelkan
 * aplikasi ini pada nama layout internal Capacitor yang boleh berubah kapan pun
 * tanpa peringatan, dan kalau berubah, gejalanya kembali lagi tanpa satu baris
 * pun berubah di repo ini.
 *
 * Yang dipakai: inset diminta langsung pada WebView-nya lewat androidx, lalu
 * dipasang sebagai padding. Padding, bukan margin, supaya WebView tetap
 * mengisi jendela dan warna latarnya (capacitor.config.json: backgroundColor)
 * yang menutup jalur di belakang bilah sistem.
 *
 * Reader tetap memakai seluruh tinggi layar. ModeBacaNatif memanggil
 * StatusBar.hide(), yang di Capacitor 8 berjalan lewat
 * WindowInsetsControllerCompat.hide(statusBars()); begitu bilahnya disembunyikan
 * insetnya menjadi nol, listener ini dipanggil ulang, dan paddingnya ikut hilang
 * sendiri. Tidak ada angka tinggi status bar yang perlu ditebak atau disimpan.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // R milik capacitor-android, bukan R aplikasi: sejak AGP 8 kelas R tidak
        // lagi transitif secara bawaan, jadi id dari modul perpustakaan tidak
        // muncul di id.naruread.app.R. BridgeActivity sendiri merujuknya dengan
        // cara yang sama.
        final View webView = findViewById(com.getcapacitor.android.R.id.webview);

        // super.onCreate() menyerah tanpa WebView (setContentView(R.layout.no_webview)
        // di BridgeActivity) — perangkat tanpa WebView Sistem tidak boleh dijatuhkan
        // lagi di sini oleh NullPointerException.
        if (webView == null) return;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            // displayCutout ikut diminta, bukan hanya systemBars: pada HP
            // berlubang kamera dalam mode lanskap, takiknya berada di tepi KIRI
            // atau KANAN tempat tidak ada bilah sistem sama sekali, dan hanya
            // systemBars() membuat tombol pertama di baris itu tertutup lensa.
            Insets aman = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(aman.left, aman.top, aman.right, aman.bottom);

            // Inset diteruskan apa adanya, tidak dikonsumsi: papan ketik
            // (Type.ime()) berjalan di jalur yang sama, dan mengonsumsi di sini
            // memutus penyesuaian yang membuat kotak pencarian tetap terlihat
            // saat papan ketik terbuka.
            return windowInsets;
        });
    }
}

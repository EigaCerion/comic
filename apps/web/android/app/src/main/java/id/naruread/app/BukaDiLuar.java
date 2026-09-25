package id.naruread.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Buka satu tautan https di browser perangkat, sebagai TUGAS (task) miliknya
 * sendiri.
 *
 * Kenapa perlu ditulis sendiri, padahal Capacitor sudah membuka tautan luar:
 * Bridge.launchIntent() (capacitor-android) memanggil
 * `getContext().startActivity(openIntent)` TANPA FLAG_ACTIVITY_NEW_TASK, dan
 * getContext() di sana adalah Activity ini. Akibatnya browser masuk ke tumpukan
 * tugas NaruReader — bukan tugasnya sendiri. Untuk membuka halaman biasa itu
 * tidak jadi soal, tapi yang dibuka di sini adalah unduhan APK 30-an MB:
 * begitu orangnya kembali ke NaruReader, jendela browser yang sedang mengunduh
 * ikut terdorong ke belakang di dalam tugas yang sama, dan itulah bentuk yang
 * dilaporkan sebagai "unduhan nyangkut di saat-saat terakhir".
 *
 * Dengan FLAG_ACTIVITY_NEW_TASK, browser berdiri sebagai aplikasi terpisah di
 * daftar aplikasi terakhir: unduhannya berjalan di latar belakang, NaruReader
 * boleh dibuka-tutup sesukanya, dan keduanya tidak saling menjatuhkan.
 *
 * Yang SENGAJA tidak dilakukan: memasang APK-nya sendiri. Itu menuntut izin
 * REQUEST_INSTALL_PACKAGES plus FileProvider — persis dua hal yang membuat
 * aplikasi hasil sideload terlihat mencurigakan di mata Play Protect, demi
 * menghemat dua ketukan. Pemasangan tetap dikerjakan Android.
 *
 * Skema dibatasi https DI SINI, bukan hanya di JavaScript. Yang dijalankan
 * fungsi ini adalah Intent sistem: `intent:`, `content:`, dan `file:` di tangan
 * ACTION_VIEW bisa berarti hal yang sangat berbeda dari "buka halaman", dan
 * alamat yang sampai ke sini berasal dari jawaban JSON milik GitHub. Pemeriksaan
 * di lapisan web tetap ada (urlUnduhAman di platform/pembaruan.js), tapi
 * pemeriksaan yang hanya hidup di satu lapisan bukan pemeriksaan.
 */
@CapacitorPlugin(name = "BukaDiLuar")
public class BukaDiLuar extends Plugin {

    @PluginMethod
    public void buka(PluginCall call) {
        String alamat = call.getString("url", "");

        Uri tujuan;
        try {
            tujuan = Uri.parse(alamat);
        } catch (Exception galat) {
            call.reject("Tautan tidak terbaca");
            return;
        }

        String skema = tujuan.getScheme();
        if (skema == null || !skema.equalsIgnoreCase("https")) {
            call.reject("Hanya tautan https yang boleh dibuka");
            return;
        }

        Intent niat = new Intent(Intent.ACTION_VIEW, tujuan);
        niat.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(niat);
            call.resolve();
        } catch (ActivityNotFoundException galat) {
            // Perangkat tanpa browser sama sekali. Ditolak, bukan didiamkan:
            // pemanggilnya menampilkan petunjuk "unduhan sedang berjalan", dan
            // petunjuk itu akan berbohong.
            call.reject("Tidak ada browser yang bisa membuka tautan ini");
        }
    }
}

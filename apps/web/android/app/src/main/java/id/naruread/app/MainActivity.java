package id.naruread.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Cangkang Android. Tidak ada tugas tambahan: seluruh isi aplikasi adalah
 * halaman web yang dijalankan Capacitor.
 *
 * Yang pernah ada di sini — pemasangan inset sistem sebagai padding WebView —
 * sudah DIBUANG, dan kenapa ia tidak bekerja layak dicatat supaya tidak
 * ditulis ulang oleh orang berikutnya (termasuk saya):
 *
 * Capacitor 8 punya plugin bawaan SystemBars
 * (com.getcapacitor.plugin.SystemBars) yang selalu terdaftar, bahkan tanpa satu
 * baris pun konfigurasi. Ia memasang OnApplyWindowInsetsListener-nya sendiri
 * pada decorView jendela, lalu memilih salah satu dari dua perilaku:
 *
 *  - WebView LAMA (< 140): ia memberi jarak setinggi bilah sistem langsung pada
 *    decorView, lalu meneruskan inset bernilai NOL ke anak-anaknya. Listener
 *    apa pun pada WebView karena itu menerima nol dan tidak memberi jarak apa
 *    pun — yang benar, karena jaraknya sudah diberikan di atas.
 *  - WebView BARU (>= 140) pada halaman dengan viewport-fit=cover — keadaan HP
 *    penguji: ia justru BERHENTI memberi jarak dan menyerahkan seluruhnya ke
 *    lapisan web lewat env(safe-area-inset-*) dan variabel CSS
 *    --safe-area-inset-* yang ia suntikkan sendiri.
 *
 * Artinya jarak status bar bukan urusan berkas ini sama sekali, dan menambah
 * padding di sini pada jalur kedua justru berarti menghitungnya DUA KALI.
 * Tempatnya sekarang: --aman-atas/--aman-bawah di apps/web/src/styles/theme.css,
 * dipakai TopBar, Sidebar, dan footer.
 *
 * Satu-satunya setelan yang tersisa ada di capacitor.config.json —
 * plugins.SystemBars.initialViewportFitValueHint = "cover". Berkas JSON tidak
 * bisa memuat komentar, jadi alasannya ditulis di sini: tanpa petunjuk itu
 * SystemBars memulai dengan anggapan halaman tidak memakai viewport-fit=cover,
 * memberi jarak bilah sistem secara native, lalu membatalkannya begitu meta
 * viewport terbaca setelah halaman tampil — seluruh isi aplikasi melompat naik
 * satu tinggi status bar tepat di depan mata, setiap kali aplikasi dibuka.
 * index.html memang selalu memuat viewport-fit=cover, jadi jawabannya sudah
 * diketahui sejak awal.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // WAJIB sebelum super.onCreate(): di situlah BridgeActivity membangun
        // jembatannya dan mengunci daftar plugin. Didaftarkan sesudahnya, plugin
        // ini ada di APK tapi tidak pernah bisa dipanggil dari JavaScript.
        registerPlugin(BukaDiLuar.class);
        super.onCreate(savedInstanceState);
    }
}

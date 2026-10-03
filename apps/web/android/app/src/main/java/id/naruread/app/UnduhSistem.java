package id.naruread.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Unduh berkas lewat DownloadManager milik Android.
 *
 * ── Kenapa ini ada, padahal sudah ada BukaDiLuar ──────────────────────────
 *
 * BukaDiLuar menyerahkan tautannya ke aplikasi lain dan selesai. Untuk halaman
 * biasa itu cukup, tapi yang diserahkan di sini adalah APK 32 MB — dan dua
 * kegagalan nyata sudah tercatat dari jalur itu:
 *
 *  1. Tautan github.com diklaim APLIKASI GITHUB lewat app link, jadi yang
 *     mengunduh adalah pengunduh internal aplikasi itu. Pada 0.1.1 intent-nya
 *     dilepas tanpa FLAG_ACTIVITY_NEW_TASK, sehingga aplikasi GitHub berdiri di
 *     dalam tumpukan tugas NaruReader: kembali ke NaruReader mendorong jendela
 *     yang sedang mengunduh ke latar belakang, dan Android membekukan kerja
 *     jaringannya. Yang terlihat: unduhan berhenti di 99%.
 *  2. Lewat Chrome, unduhan yang terputus lalu dilanjutkan menghasilkan berkas
 *     yang UKURANNYA tepat sampai byte terakhir tetapi isinya rusak di tengah.
 *     Pemasang Android menolaknya dengan "paket tampaknya tidak valid" — pesan
 *     yang menunjuk ke APK, padahal yang rusak berkas unduhannya.
 *
 * DownloadManager menghapus keduanya: unduhannya milik SISTEM, bukan milik
 * proses aplikasi mana pun. Ia tidak bisa terdorong ke latar belakang, ia
 * selamat kalau NaruReader ditutup, ia punya notifikasi progres sendiri, dan ia
 * melanjutkan sendiri saat jaringan putus-nyambung.
 *
 * ── Yang SENGAJA tidak dikerjakan ─────────────────────────────────────────
 *
 * Memasang APK-nya. Itu menuntut izin REQUEST_INSTALL_PACKAGES, persis izin
 * yang membuat aplikasi hasil sideload dicurigai Play Protect — dan aplikasi
 * ini sudah pernah membereskan peringatan itu sekali. Pemasangan tetap dimulai
 * orangnya sendiri dari notifikasi unduhan selesai, yang sudah membuka pemasang
 * sistem karena setMimeType di bawah.
 *
 * ── Izin ──────────────────────────────────────────────────────────────────
 *
 * Tidak ada yang baru. setDestinationInExternalPublicDir menulis ke folder
 * Download publik lewat DownloadManager, dan sejak Android 10 itu tidak
 * memerlukan izin penyimpanan apa pun.
 */
@CapacitorPlugin(name = "UnduhSistem")
public class UnduhSistem extends Plugin {

    /**
     * Nama berkas dibersihkan DI SINI, bukan hanya di JavaScript.
     *
     * Nilainya berasal dari jawaban JSON milik GitHub, dan ia dipakai sebagai
     * nama berkas di penyimpanan bersama. Satu "../" di dalamnya akan berarti
     * hal yang sangat berbeda dari "nama berkas".
     */
    private static String namaAman(String mentah) {
        String nama = mentah == null ? "" : mentah.trim();
        if (nama.isEmpty()) return null;
        if (nama.contains("/") || nama.contains("\\") || nama.contains("..")) return null;
        if (!nama.toLowerCase().endsWith(".apk")) return null;
        return nama;
    }

    private DownloadManager pengunduh() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    /**
     * Baca id unduhan dari panggilan.
     *
     * Lewat optLong, BUKAN call.getLong(). PluginCall.getLong() mengembalikan
     * nilainya hanya kalau objek di dalam JSON-nya kebetulan instance Long:
     *
     *     Object value = this.data.opt(name);
     *     if (value instanceof Long) return (Long) value;
     *     return defaultValue;    // ← null
     *
     * Sementara org.json mengurai angka JSON yang muat di int sebagai INTEGER,
     * bukan Long. Nomor pekerjaan DownloadManager dimulai dari angka kecil, jadi
     * getLong() praktis selalu mengembalikan null — dan metodenya menolak dengan
     * "id unduhan tidak diberikan" padahal id-nya jelas dikirim. Itu bukan
     * dugaan: persis begitu yang terjadi pada percobaan pertama di HP penguji.
     *
     * JSONObject.optLong memaksa Integer, Long, Double, maupun String jadi long.
     */
    private Long idDari(PluginCall call) {
        if (call.getData() == null || !call.getData().has("id")) return null;
        long id = call.getData().optLong("id", Long.MIN_VALUE);
        return id == Long.MIN_VALUE ? null : id;
    }

    /**
     * Antrekan satu unduhan. Mengembalikan id yang dipakai status().
     */
    @PluginMethod
    public void mulai(PluginCall call) {
        String alamat = call.getString("url", "");
        String nama = namaAman(call.getString("nama", ""));

        if (nama == null) {
            call.reject("Nama berkas tidak masuk akal");
            return;
        }

        Uri tujuan;
        try {
            tujuan = Uri.parse(alamat);
        } catch (Exception galat) {
            call.reject("Tautan tidak terbaca");
            return;
        }

        String skema = tujuan.getScheme();
        if (skema == null || !skema.equalsIgnoreCase("https")) {
            call.reject("Hanya tautan https yang boleh diunduh");
            return;
        }

        DownloadManager dm = pengunduh();
        if (dm == null) {
            call.reject("Layanan unduhan sistem tidak tersedia di perangkat ini");
            return;
        }

        try {
            DownloadManager.Request minta = new DownloadManager.Request(tujuan);
            minta.setTitle(nama);
            minta.setDescription("Pembaruan NaruReader");
            // Notifikasi dibiarkan terlihat SELAMA mengunduh, bukan hanya saat
            // selesai: unduhan 32 MB yang tak terlihat di mana pun adalah
            // unduhan yang disangka tidak berjalan, dan ditekan lagi.
            minta.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            // Tipe MIME membuat notifikasi "selesai" membuka pemasang sistem
            // saat diketuk. Tanpa ini ia cuma membuka daftar unduhan.
            minta.setMimeType("application/vnd.android.package-archive");
            minta.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nama);

            long id = dm.enqueue(minta);

            JSObject hasil = new JSObject();
            hasil.put("id", id);
            call.resolve(hasil);
        } catch (Exception galat) {
            call.reject("Tidak bisa memulai unduhan: " + galat.getMessage());
        }
    }

    /**
     * Keadaan satu unduhan.
     *
     * keadaan: "menunggu" | "berjalan" | "jeda" | "selesai" | "gagal" | "hilang"
     *
     * "hilang" berarti id-nya tidak ada lagi di daftar DownloadManager — biasanya
     * karena orangnya menghapus unduhannya. Itu BUKAN kegagalan unduhan, dan
     * pemanggilnya memang memperlakukannya berbeda.
     */
    @PluginMethod
    public void status(PluginCall call) {
        Long id = idDari(call);
        if (id == null) {
            call.reject("id unduhan tidak diberikan");
            return;
        }

        DownloadManager dm = pengunduh();
        if (dm == null) {
            call.reject("Layanan unduhan sistem tidak tersedia di perangkat ini");
            return;
        }

        DownloadManager.Query tanya = new DownloadManager.Query().setFilterById(id);
        Cursor kursor = null;
        try {
            kursor = dm.query(tanya);
            JSObject hasil = new JSObject();

            if (kursor == null || !kursor.moveToFirst()) {
                hasil.put("keadaan", "hilang");
                call.resolve(hasil);
                return;
            }

            int status = kursor.getInt(kursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long terunduh = kursor.getLong(kursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = kursor.getLong(kursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int alasan = kursor.getInt(kursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            String lokal = kursor.getString(kursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));

            String keadaan;
            switch (status) {
                case DownloadManager.STATUS_PENDING:
                    keadaan = "menunggu";
                    break;
                case DownloadManager.STATUS_RUNNING:
                    keadaan = "berjalan";
                    break;
                case DownloadManager.STATUS_PAUSED:
                    keadaan = "jeda";
                    break;
                case DownloadManager.STATUS_SUCCESSFUL:
                    keadaan = "selesai";
                    break;
                default:
                    keadaan = "gagal";
                    break;
            }

            hasil.put("keadaan", keadaan);
            hasil.put("terunduh", terunduh);
            // -1 dari DownloadManager berarti "server tidak menyebut panjangnya".
            hasil.put("total", total < 0 ? 0 : total);
            hasil.put("alasan", alasan);
            hasil.put("berkas", lokal);
            call.resolve(hasil);
        } catch (Exception galat) {
            call.reject("Tidak bisa membaca keadaan unduhan: " + galat.getMessage());
        } finally {
            if (kursor != null) kursor.close();
        }
    }

    /**
     * Buka daftar unduhan sistem.
     *
     * Dipakai tombol "Buka unduhan" sesudah berkasnya selesai: dari sana satu
     * ketukan pada berkasnya memulai pemasangan. Ini jalur yang TIDAK menuntut
     * REQUEST_INSTALL_PACKAGES, karena yang meminta pemasangan adalah aplikasi
     * unduhan sistem, bukan NaruReader.
     */
    @PluginMethod
    public void bukaDaftarUnduhan(PluginCall call) {
        try {
            Intent niat = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
            niat.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(niat);
            call.resolve();
        } catch (Exception galat) {
            call.reject("Tidak ada daftar unduhan yang bisa dibuka");
        }
    }

    /**
     * Batalkan unduhan dan hapus berkas setengah jadi yang ditinggalkannya.
     */
    @PluginMethod
    public void batalkan(PluginCall call) {
        Long id = idDari(call);
        if (id == null) {
            call.reject("id unduhan tidak diberikan");
            return;
        }
        DownloadManager dm = pengunduh();
        if (dm == null) {
            call.reject("Layanan unduhan sistem tidak tersedia di perangkat ini");
            return;
        }
        dm.remove(id);
        call.resolve();
    }
}

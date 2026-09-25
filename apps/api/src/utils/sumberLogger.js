import { pasangLogger } from '@naruread/sumber';
import { createLogger } from './logger.js';

/*
 * Menyambungkan @naruread/sumber ke logger server.
 *
 * Paket sumber sengaja tidak tahu apa-apa soal logger: ia harus bisa dibundel
 * untuk aplikasi Android, tempat node:fs — dan karena itu logger.js — tidak
 * ada. Penyambungannya jadi urusan sisi server, dan modul ini ada supaya
 * pemanggilnya cukup satu baris.
 *
 * Diimpor karena efek sampingnya oleh SETIAP berkas apps/api yang memakai
 * extractor, bukan sekali di server.js. Alasannya: extractor dipanggil dari
 * tiga jenis proses (server, worker standalone, dan skrip di scripts/), dan
 * satu panggilan di satu titik masuk berarti dua titik masuk lain kehilangan
 * baris debug-nya tanpa suara — persis jenis kerusakan yang baru ketahuan saat
 * ada chapter gagal dan catatannya ternyata tidak pernah ditulis.
 *
 * Nama scope-nya dipertahankan apa adanya supaya baris di debug.log sebelum
 * dan sesudah pemindahan ini tetap sama.
 */
pasangLogger(createLogger('naruread:sources'));

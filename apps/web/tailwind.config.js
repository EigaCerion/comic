/*
 * Tidak ada satu pun nilai hex di berkas ini — semuanya menunjuk variabel di
 * src/styles/theme.css. Itu yang membuat tema terang dan gelap berbagi SATU
 * definisi kelas: variabelnya yang berganti, bukan kelasnya.
 *
 * Bentuk `rgb(var(--x) / <alpha-value>)` wajib, bukan gaya penulisan. Ia yang
 * membuat `bg-primary/40` dan `text-txt-2/60` tetap bekerja; dengan hex, setiap
 * kelas ber-opasitas di seluruh aplikasi gagal diam-diam.
 */
const token = (nama) => `rgb(var(${nama}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * ── Token peran ──────────────────────────────────────────────────
         *
         * Dinamai menurut TUGASNYA, bukan warnanya. Kode baru memakai ini, dan
         * cukup satu kelas: `bg-surface` sudah benar di terang maupun gelap,
         * jadi tidak ada kesempatan untuk lupa menulis pasangan `dark:`.
         */
        bg: token('--c-bg'),
        surface: {
          DEFAULT: token('--c-surface'),
          soft: token('--c-surface-soft'),
        },
        line: token('--c-line'),
        txt: {
          DEFAULT: token('--c-txt'),
          2: token('--c-txt-2'),
        },
        primary: {
          DEFAULT: token('--c-primary'),
          hover: token('--c-primary-hover'),
          on: token('--c-on-primary'),
        },
        accent: token('--c-accent'),
        success: token('--c-success'),
        warning: token('--c-warning'),
        danger: token('--c-danger'),

        /*
         * ── Alias nama lama ──────────────────────────────────────────────
         *
         * 471 kelas di seluruh aplikasi masih menyebut nama lama, hampir
         * semuanya berpasangan (`bg-paper-soft dark:bg-night-card`). Alias ini
         * membuat seluruhnya mendarat di palet baru tanpa satu komponen pun
         * disentuh — penggantian namanya dikerjakan bersama perombakan tiap
         * komponen, bukan sebagai satu tambalan besar yang tak bisa ditinjau.
         *
         * Nilainya TETAP, tidak ikut berganti tema, dan itu disengaja: tiap
         * nama lama hanya muncul di satu sisi tema. `text-night` selalu di
         * tema terang (tinta gelap), `dark:bg-night` selalu di tema gelap
         * (latar gelap) — keduanya menuntut nada gelap, jadi satu nilai tetap
         * benar untuk keduanya. Nama yang dipakai di KEDUA tema (naruto, leaf,
         * danger) justru yang ditaruh di variabel.
         */
        night: {
          DEFAULT: '#17161A', // tinta gelap di tema terang · latar gelap di tema gelap
          soft: '#222126', // Surface gelap — navbar, sidebar
          card: '#222126', // Surface gelap — kartu
          raise: '#2A292F', // Surface Soft gelap — hover, bidang kedua
          line: '#35333B', // Border gelap
        },
        paper: {
          DEFAULT: '#EAE7EE', // tinta terang di tema gelap · bidang lembut di tema terang
          soft: '#FFFFFF', // Surface terang
          line: '#E5E1E8', // Border terang
        },
        // Jingga Naruto diturunkan dari identitas: ia aksi utama, dan aksi utama
        // sekarang lavender. Namanya dipertahankan hanya selama kelas lamanya
        // masih ada.
        naruto: {
          DEFAULT: token('--c-primary'),
          light: token('--c-primary-hover'),
          dark: '#7969A8',
        },
        leaf: {
          DEFAULT: token('--c-success'),
          light: token('--c-success'),
          dark: '#5F8F78',
        },
        shinobi: token('--c-accent'),
      },
      fontFamily: {
        /*
         * Inter didahulukan sesuai spesifikasi. Tidak dimuat dari jaringan dan
         * tidak dibundel: aplikasi ini jalan di LAN tanpa internet, dan font
         * yang gagal diambil berarti halaman berkedip ke font cadangan setiap
         * kali dibuka. Yang terpasang dipakai; yang tidak, jatuh ke sistem.
         */
        sans: ['Inter', 'Plus Jakarta Sans', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        /*
         * Bayangan dibuat jauh lebih lembut daripada sebelumnya. Yang lama
         * dirancang untuk latar mendekati hitam dan butuh 75% kehitaman supaya
         * terlihat; di atas warm neutral yang terang, bayangan sepekat itu
         * terbaca sebagai noda.
         */
        card: '0 1px 2px rgb(41 39 46 / 0.04), 0 8px 24px -16px rgb(41 39 46 / 0.18)',
        scroll: '0 12px 32px -20px rgb(41 39 46 / 0.35)',
        glow: '0 0 0 1px rgb(var(--c-primary) / 0.35), 0 8px 24px -14px rgb(var(--c-primary) / 0.45)',
        'glow-leaf': '0 0 0 1px rgb(var(--c-success) / 0.35), 0 8px 24px -14px rgb(var(--c-success) / 0.45)',
      },
      borderRadius: {
        // Satu tangga radius untuk seluruh aplikasi, supaya kartu, tombol, dan
        // input tidak pernah saling bersaing bentuk.
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'slide-up': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 220ms ease-out',
      },
    },
  },
  plugins: [],
};

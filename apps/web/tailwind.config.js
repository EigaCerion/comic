/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Konoha, tapi diterjemahkan ke bahasa antarmuka gelap: hijau dibawa ke
        // arah emerald dan jingga dibuat lebih terang, supaya keduanya tetap
        // terbaca di atas latar mendekati hitam tanpa terasa kusam.
        leaf: {
          DEFAULT: '#0f9d76',
          light: '#18c795',
          dark: '#0a6b51',
        },
        naruto: {
          DEFAULT: '#ff8a2b',
          light: '#ffa758',
          dark: '#e06b00',
        },
        // Skala gelap dibuat kebiruan, bukan abu netral. Latar baca yang sedikit
        // dingin membuat halaman komik (yang hampir selalu hangat) terasa maju
        // ke depan, dan mata lebih tahan lama.
        night: {
          DEFAULT: '#070a0f',
          soft: '#0c111a',
          card: '#101722',
          raise: '#16202d',
          line: '#1e2836',
        },
        paper: {
          DEFAULT: '#f4f6fa',
          soft: '#ffffff',
          line: '#dfe4ee',
        },
        danger: '#f4436c',
        shinobi: '#38bdf8',
      },
      fontFamily: {
        sans: ['Inter', 'Roboto', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Segoe UI', 'Noto Sans', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        scroll: '0 18px 40px -22px rgba(0, 0, 0, 0.75)',
        // Cahaya tipis di sekeliling elemen aktif — pengganti bayangan tebal,
        // yang di latar gelap justru tidak terlihat.
        glow: '0 0 0 1px rgba(255, 138, 43, 0.35), 0 8px 30px -12px rgba(255, 138, 43, 0.45)',
        'glow-leaf': '0 0 0 1px rgba(15, 157, 118, 0.35), 0 8px 30px -12px rgba(15, 157, 118, 0.45)',
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

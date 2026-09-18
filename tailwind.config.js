/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        encryptdrop: {
          bg: 'var(--bg-main)',
          card: 'var(--bg-card)',
          border: 'var(--border-color)',
          accent: 'var(--accent-primary)',
          hover: 'var(--accent-hover)',
          text: 'var(--text-primary)',
          muted: 'var(--text-muted)'
        }
      }
    },
  },
  plugins: [],
}

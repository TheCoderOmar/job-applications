/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#05070d',
        surface: '#0b1220',
        raised: '#111a2e',
        line: '#1e2a44',
        brand: { DEFAULT: '#3b82f6', light: '#60a5fa', dark: '#1d4ed8' },
        fg: '#e5edff',
        muted: '#8aa0c8',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: { glow: '0 0 0 1px #3b82f6, 0 0 18px -2px rgba(59,130,246,.55)' },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/context/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Consolas', 'monospace'],
      },
      /* Varsayılan xs/sm bir tık küçük kalıyordu; okunabilirlik için hafif büyütüldü */
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1rem' }],
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],
        sm: ['0.9375rem', { lineHeight: '1.375rem' }],
      },
    },
  },
  plugins: [],
}

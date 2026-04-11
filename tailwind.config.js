/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /* Projede kullanılan ara değerler (varsayılan ölçekte yoktu → sınıflar boşa düşüyordu) */
      spacing: {
        '1.25': '0.3125rem',
        '2.25': '0.5625rem',
        '2.75': '0.6875rem',
      },
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

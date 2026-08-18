import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-mozilla-headline)', 'Mozilla Headline', 'Helvetica Neue', 'Arial', 'sans-serif'],
        accent: ['var(--font-mozilla-headline)', 'Mozilla Headline', 'Helvetica Neue', 'Arial', 'sans-serif'],
        body: ['var(--font-mozilla-text)', 'Mozilla Text', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        green: {
          950: '#000000',
          900: '#161616',
          800: '#222222',
          700: '#555555',
          600: '#696969',
          500: '#53E17C',
          400: '#FF9E5F',
          300: '#F7EC36',
          200: '#F8F8F8',
          100: '#F7F7F7',
          50: '#FFFFFF',
        },
        amber: {
          600: '#D4A017',
          400: '#F4C842',
          200: '#FDE68A',
        },
        coral: {
          600: '#C0392B',
          400: '#E74C3C',
          200: '#FADBD8',
        },
        sketch: {
          orange: '#FF6B35',
          yellow: '#FFD166',
          lime: '#06D6A0',
          blue: '#118AB2',
        },
      },
      maxWidth: {
        content: '1200px',
      },
      borderWidth: {
        3: '1px',
      },
    },
  },
  plugins: [],
};

export default config;

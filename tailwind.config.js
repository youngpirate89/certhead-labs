/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Lab engine surface tokens. Kept in sync with CertHead design tokens
        // when integration lands; standalone for now.
        terminal: {
          bg: '#0b0f14',
          fg: '#d7dee8',
          dim: '#5a6675',
          prompt: '#5eead4',
          error: '#f87171',
          accent: '#38bdf8',
        },
        panel: {
          bg: '#0f141b',
          border: '#1e2733',
          header: '#141b24',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'monospace'],
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

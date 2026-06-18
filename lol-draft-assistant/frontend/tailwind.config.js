/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        lol: {
          gold: '#C89B3C',
          'gold-light': '#F0E6D3',
          dark: '#010A13',
          'dark-2': '#0A1428',
          'dark-3': '#091428',
          blue: '#0BC4E3',
          'blue-dim': '#1E3A5C',
          red: '#C84B31',
          'red-dim': '#5C1E1E',
        },
      },
      fontFamily: {
        lol: ['"Beaufort for LOL"', 'Beaufort', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

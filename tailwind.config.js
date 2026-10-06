/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./views/**/*.ejs",
    "./public/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        'brim-navy': '#0B3B73',
        'brim-gold': '#C59B27',
        'brim-gray': '#FAFAF9', // warm editorial off-white
        paper: {
          light: '#FCFCFB',
          dark: '#141414',
          cardDark: '#1C1C1C',
          borderLight: '#ECECEB',
          borderDark: '#292929',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Lora', 'Newsreader', 'Merriweather', 'Georgia', 'serif'],
        editorial: ['Newsreader', 'Lora', 'serif'],
      }
    },
  },
  plugins: [],
}

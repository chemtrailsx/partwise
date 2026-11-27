/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b1210", 900: "#0f1916", 850: "#13201c", 800: "#182823", 700: "#22362f", 600: "#2e463d" },
        mint: { 300: "#8ff0c4", 400: "#5ee3a8", 500: "#3ecf8e", 600: "#22a971", 700: "#17784f" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
};

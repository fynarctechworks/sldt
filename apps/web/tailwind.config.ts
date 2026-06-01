import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0F3D2E",
          dark: "#082A20",
          mid: "#1F5C44",
          light: "#4A8A70",
          soft: "#E8E2D3",
          softer: "#F2EDE0",
        },
        navy: "#0F3D2E",
        accentBlue: "#1F5C44",
        gold: "#B08A4A",
        brass: "#B08A4A",
        cream: "#E8E2D3",
        ivory: "#FAF7F0",
        success: "#3F7D4F",
        warning: "#C77A2C",
        danger: "#A33A30",
        // Informational blue — used for the upcoming-arrivals banner.
        // Same visual weight as `danger` but reads "heads up, not
        // emergency".
        info: "#1F4E8A",
        bg: "#FAF7F0",
        surface: "#FFFFFF",
        textPrimary: "#1C2620",
        textSecondary: "#6B6358",
        borderc: "#E2DCCD",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

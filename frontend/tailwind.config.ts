import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0f131a",
        panel: "#18202b",
        accent: "#ffb347",
        accentSoft: "#ffd38f"
      }
    }
  },
  plugins: []
};

export default config;

import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const authServiceUrl = process.env.AUTH_SERVICE_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true
      }
    }),
    viteReact()
  ],
  server: {
    port: 3000,
    proxy: {
      "/api/v1": {
        target: authServiceUrl,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: true,
    port: 3000,
    proxy: {
      "/api/v1": {
        target: authServiceUrl,
        changeOrigin: true
      }
    }
  }
});

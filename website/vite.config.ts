import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tablesPlugin } from "./vite-plugin-tables";

export default defineConfig({
  plugins: [react(), tailwindcss(), tablesPlugin()],
  // The built site goes to the repository root's dist/ (git-ignored), where
  // static hosts look for it by default (Railpack on Coolify serves dist/).
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/model": "http://localhost:3001",
      "/renders": "http://localhost:3001",
    },
  },
});

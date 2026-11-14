import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tablesPlugin } from "./vite-plugin-tables";

export default defineConfig({
  plugins: [react(), tailwindcss(), tablesPlugin()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/model": "http://localhost:3001",
      "/renders": "http://localhost:3001",
    },
  },
});

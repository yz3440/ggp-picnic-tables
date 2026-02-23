import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tablesPlugin } from "./vite-plugin-tables";

export default defineConfig({
  plugins: [react(), tablesPlugin()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/model": "http://localhost:3001",
    },
  },
});

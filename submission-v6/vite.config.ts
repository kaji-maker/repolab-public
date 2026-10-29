import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "apps/web",
  esbuild: { jsx: "automatic" },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4173" } },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        workbench: resolve("apps/web/index.html"),
        native: resolve("apps/web/native.html"),
      },
    },
  },
});

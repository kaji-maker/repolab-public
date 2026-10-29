import base from "./vite.config.ts";
import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({ ...base,
  server: { port: 5174, proxy: { "/api": "http://127.0.0.1:4185" } },
  build: { ...base.build, outDir: "../../dist/qualified-v5", rollupOptions: { input: { qualifiedRepair: resolve("apps/web/native-repair-v9.html") } } },
});

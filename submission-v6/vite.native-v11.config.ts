import base from "./vite.config.ts";
import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({ ...base,
  server: { port: 5175, proxy: { "/api": "http://127.0.0.1:4188" } },
  build: { ...base.build, outDir: "../../dist/qualified-v6", rollupOptions: { input: { qualifiedRepair: resolve("apps/web/native-repair-v10.html") } } },
});

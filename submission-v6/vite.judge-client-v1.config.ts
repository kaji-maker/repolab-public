import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({root:'apps/web',esbuild:{jsx:'automatic'},build:{outDir:'../../dist/web-judge',emptyOutDir:true,
  rollupOptions:{input:{qualifiedRepair:resolve('apps/web/native-repair-v9.html')}}}});

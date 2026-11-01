import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/eval-temp',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/analysis/index.ts'),
      formats: ['es'],
      fileName: () => 'analysis.mjs',
    },
  },
});

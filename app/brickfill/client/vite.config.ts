import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * Writes `.br` and `.gz` next to each script and stylesheet, which server/static-assets.ts sends to browsers that
 * accept them: neither AppKit's static server nor the Apps proxy compresses responses.
 */
function precompress(): Plugin {
  return {
    name: 'brickfill-precompress',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (!/\.(js|css)$/.test(file.fileName)) continue;
        const source = Buffer.from(file.type === 'chunk' ? file.code : file.source);
        if (source.length < 1024) continue;
        this.emitFile({
          type: 'asset',
          fileName: `${file.fileName}.br`,
          source: brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        });
        this.emitFile({ type: 'asset', fileName: `${file.fileName}.gz`, source: gzipSync(source, { level: 9 }) });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss(), precompress()],
  server: {
    middlewareMode: true,
  },
  build: {
    outDir: path.resolve(__dirname, './dist'),
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === 'development',
    rollupOptions: {
      // AppKit UI ships one entry (charts, Genie, file browser and the UI kit) without "sideEffects": false, so
      // echarts, recharts and Apache Arrow ended up in the bundle although the app draws no chart. Its modules only
      // declare components and hooks (the styles come from styles.css): let the bundler drop the unused ones.
      treeshake: { moduleSideEffects: (id) => !id.includes('/@databricks/appkit-ui/dist/react/') },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-dev-runtime', 'react/jsx-runtime', 'recharts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

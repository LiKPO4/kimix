import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: {
        entry: 'electron/main.ts',
        formats: ['cjs'],
        fileName: () => 'index',
      },
      rollupOptions: {
        external: ['electron', /^node:/],
        output: {
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: {
        entry: 'electron/preload.ts',
        formats: ['cjs'],
        fileName: () => 'index',
      },
      rollupOptions: {
        external: ['electron', /^node:/],
        output: {
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'lucide-react',
      ],
    },
  },
})

import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: {
        entry: {
          index: 'electron/main.ts',
          localThinkingTranslatorWorker: 'electron/localThinkingTranslatorWorker.ts',
        },
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron', /^node:/, '@huggingface/transformers'],
        output: {
          entryFileNames: '[name].cjs',
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
    // 生产构建保留函数/类名：React 运行时错误（ErrorBoundary componentStack）与
    // 主进程日志里的组件/函数名不再被压缩成单字母，运行时错误可直接定位到组件。
    esbuild: {
      keepNames: true,
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

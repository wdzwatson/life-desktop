import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electronSimple from 'vite-plugin-electron/simple'
import fs from 'fs'
import path from 'path'

const copyPdfWorker = () => {
  return {
    name: 'copy-pdf-worker',
    closeBundle() {
      const src = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.mjs')
      const destDir = path.resolve(process.cwd(), 'dist-electron')
      const dest = path.resolve(destDir, 'pdf.worker.mjs')
      if (fs.existsSync(src)) {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }
        fs.copyFileSync(src, dest)
        console.log('✓ Successfully copied pdf.worker.mjs to dist-electron/')
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    copyPdfWorker(),
    electronSimple({
      main: {
        // Source file for the main process
        entry: 'electron/main.ts',
        vite: {
          build: {
            rolldownOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rolldownOptions: {
              output: {
                entryFileNames: '[name].cjs',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
})

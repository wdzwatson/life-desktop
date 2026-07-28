import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electronSimple from 'vite-plugin-electron/simple'
import fs from 'fs'
import path from 'path'

const copyPdfWorker = () => {
  const pdfWasmDir = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/wasm')
  const wasmFiles = ['openjpeg.wasm', 'qcms_bg.wasm']

  return {
    name: 'copy-pdf-runtime-files',
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use('/pdfjs/wasm', (request: any, response: any, next: Function) => {
        const fileName = path.basename((request.url || '').split('?')[0])
        if (!wasmFiles.includes(fileName)) return next()
        const source = path.join(pdfWasmDir, fileName)
        if (!fs.existsSync(source)) return next()
        response.setHeader('Content-Type', 'application/wasm')
        fs.createReadStream(source).pipe(response)
      })
    },
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

      const wasmDestDir = path.resolve(process.cwd(), 'dist', 'pdfjs', 'wasm')
      fs.mkdirSync(wasmDestDir, { recursive: true })
      for (const fileName of wasmFiles) {
        const wasmSource = path.join(pdfWasmDir, fileName)
        if (fs.existsSync(wasmSource)) {
          fs.copyFileSync(wasmSource, path.join(wasmDestDir, fileName))
        }
      }
      console.log('✓ Successfully copied PDF.js WASM files to dist/pdfjs/wasm/')
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

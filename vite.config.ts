import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electronSimple from 'vite-plugin-electron/simple'
import fs from 'fs'
import path from 'path'

const copyPdfWorker = () => {
  const pdfWasmDir = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/wasm')
  const wasmFiles = ['openjpeg.wasm', 'qcms_bg.wasm']
  const ocrRuntimeDir = path.resolve(process.cwd(), 'node_modules/tesseract.js-core')
  const ocrFiles = ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm']
  const ocrWorkerPath = path.resolve(process.cwd(), 'node_modules/tesseract.js/dist/worker.min.js')
  const ocrKnownWarning = 'Warning: Parameter not found:'
  const getOcrWorkerSource = () => {
    const runtimePatch = `;(()=>{const suppress=(method)=>{const original=console[method].bind(console);console[method]=(...args)=>{if(args.some((value)=>String(value).includes('${ocrKnownWarning}')))return;original(...args)}};suppress('log');suppress('info');suppress('warn');suppress('error');const primary='https://cdn.jsdelivr.net/npm/@tesseract.js-data/';const fallback='https://unpkg.com/@tesseract.js-data/';const fetchOriginal=globalThis.fetch.bind(globalThis);globalThis.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(!url.startsWith(primary))return fetchOriginal(input,init);try{const response=await fetchOriginal(input,init);if(response.ok)return response}catch{}return fetchOriginal(url.replace(primary,fallback),init)}})();\n`
    return Buffer.concat([Buffer.from(runtimePatch), fs.readFileSync(ocrWorkerPath)])
  }

  return {
    name: 'copy-pdf-runtime-files',
    configureServer(server: { middlewares: { use: (path: string, handler: (request: any, response: any, next: () => void) => void) => void } }) {
      server.middlewares.use('/pdfjs/wasm', (request: any, response: any, next: () => void) => {
        const fileName = path.basename((request.url || '').split('?')[0])
        if (!wasmFiles.includes(fileName)) return next()
        const source = path.join(pdfWasmDir, fileName)
        if (!fs.existsSync(source)) return next()
        response.setHeader('Content-Type', 'application/wasm')
        fs.createReadStream(source).pipe(response)
      })
      server.middlewares.use('/ocr', (request: any, response: any, next: () => void) => {
        const fileName = path.basename((request.url || '').split('?')[0])
        if (fileName === 'worker.min.js') {
          response.setHeader('Content-Type', 'application/javascript')
          response.end(getOcrWorkerSource())
          return
        }
        const source = ocrFiles.includes(fileName) ? path.join(ocrRuntimeDir, fileName) : null
        if (!source || !fs.existsSync(source)) return next()
        response.setHeader(
          'Content-Type',
          fileName.endsWith('.wasm') ? 'application/wasm' : 'application/javascript',
        )
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

      const ocrDestDir = path.resolve(process.cwd(), 'dist', 'ocr')
      fs.mkdirSync(ocrDestDir, { recursive: true })
      fs.writeFileSync(path.join(ocrDestDir, 'worker.min.js'), getOcrWorkerSource())
      for (const fileName of ocrFiles) {
        fs.copyFileSync(path.join(ocrRuntimeDir, fileName), path.join(ocrDestDir, fileName))
      }
      console.log('✓ Successfully copied OCR worker and WASM runtime files to dist/ocr/')
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

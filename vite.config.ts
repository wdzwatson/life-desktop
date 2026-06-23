import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electronSimple from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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

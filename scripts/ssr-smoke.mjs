// Render the app shell on the server with Vite's own SSR pipeline.
// Not a browser test: it proves the components mount and the templates
// reference real data, which catches most wiring mistakes without a browser.
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, '.ssr-build')
rmSync(out, { recursive: true, force: true })

await build({
  root,
  configFile: false,
  plugins: [vue()],
  logLevel: 'error',
  build: {
    ssr: 'tests/smoke.ts',
    outDir: '.ssr-build',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'smoke.mjs' } },
  },
})

const { default: run } = await import(pathToFileURL(resolve(out, 'smoke.mjs')).href)
await run()

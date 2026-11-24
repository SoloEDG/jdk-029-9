// Bundle the pure TypeScript tests with esbuild, then run them with node --test.
// Keeps the test files import-extension-free (same style as the app) while the
// evidence analysis stays plain, dependency-free TypeScript.
import { build } from 'esbuild'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, '.test-build')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

const files = readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.ts'))
await build({
  entryPoints: files.map(name => join(root, 'tests', name)),
  outdir: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  external: ['node:*'],
})

const result = spawnSync(process.execPath, ['--test', ...files.map(name => join(output, name.replace(/\.ts$/, '.js')))], {
  stdio: 'inherit', cwd: root,
})
rmSync(output, { recursive: true, force: true })
process.exit(result.status ?? 1)

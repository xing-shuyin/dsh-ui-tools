/**
 * Build the client bundle.
 *
 * Bundles client/src into a single CJS file (react / react/jsx-runtime stay
 * external — they resolve against the dsh module-loader's seed table) and
 * wraps it in the `window.__ModuleLoader__.load({ id, factory })` protocol
 * that the dsh web shell expects (see dshmarket / modlens for the same shape).
 * CSS files are inlined as text and injected by the plugin at apply time.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outBody = join(root, 'client', 'bundle-body.js')
const outFile = join(root, 'client', 'client.js')

await mkdir(join(root, 'client'), { recursive: true })

await build({
  entryPoints: [join(root, 'client', 'src', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile: outBody,
  external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'text' },
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
})

const body = await readFile(outBody, 'utf8')
const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-ui-tools",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`
await writeFile(outFile, wrapped, 'utf8')
console.log(`client bundle written: ${outFile} (${wrapped.length} bytes)`)

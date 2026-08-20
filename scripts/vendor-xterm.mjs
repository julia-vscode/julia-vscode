// Refreshes the committed xterm.js blobs in `libs/xterm` from `node_modules`.
//
// Webview libraries cannot be loaded from `node_modules` at runtime: `.vscodeignore` excludes
// it, and only `src/extension.ts` goes through esbuild. So, like `libs/ag-grid` and the rest,
// xterm ships as committed files. This script is what keeps them honest — bump the
// devDependencies, run `npm run vendor-xterm`, commit the result.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'libs', 'xterm')

const files = [
    ['@xterm/xterm', 'lib/xterm.js', 'xterm.js'],
    ['@xterm/xterm', 'css/xterm.css', 'xterm.css'],
    ['@xterm/xterm', 'LICENSE', 'LICENSE.txt'],
    ['@xterm/addon-fit', 'lib/addon-fit.js', 'addon-fit.js'],
    ['@xterm/addon-search', 'lib/addon-search.js', 'addon-search.js'],
]

mkdirSync(out, { recursive: true })

const versions = new Map()
for (const [pkg, from, to] of files) {
    const pkgRoot = dirname(require.resolve(`${pkg}/package.json`))
    versions.set(pkg, require(`${pkg}/package.json`).version)
    copyFileSync(join(pkgRoot, from), join(out, to))
    console.log(`${pkg}/${from} -> libs/xterm/${to}`)
}

writeFileSync(
    join(out, 'README.md'),
    `# Vendored xterm.js\n\n` +
        `Do not edit these files by hand. They are the UMD builds copied out of \`node_modules\`\n` +
        `by \`npm run vendor-xterm\`; to update them, bump the devDependencies and rerun it.\n\n` +
        `They live here rather than being loaded from \`node_modules\` because \`.vscodeignore\`\n` +
        `excludes \`node_modules\` from the packaged extension and only \`src/extension.ts\` goes\n` +
        `through esbuild, so every webview library in this repo ships as a committed blob under\n` +
        `\`libs/\`.\n\n` +
        `| Package | Version |\n| --- | --- |\n` +
        [...versions].map(([p, v]) => `| \`${p}\` | ${v} |\n`).join('') +
        `\nLicensed MIT; see \`LICENSE.txt\`.\n`
)
console.log('wrote libs/xterm/README.md')

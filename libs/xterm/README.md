# Vendored xterm.js

Do not edit these files by hand. They are the UMD builds copied out of `node_modules`
by `npm run vendor-xterm`; to update them, bump the devDependencies and rerun it.

They live here rather than being loaded from `node_modules` because `.vscodeignore`
excludes `node_modules` from the packaged extension and only `src/extension.ts` goes
through esbuild, so every webview library in this repo ships as a committed blob under
`libs/`.

| Package | Version |
| --- | --- |
| `@xterm/xterm` | 5.5.0 |
| `@xterm/addon-fit` | 0.10.0 |
| `@xterm/addon-search` | 0.15.0 |

Licensed MIT; see `LICENSE.txt`.

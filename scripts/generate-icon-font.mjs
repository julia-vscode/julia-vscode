// Regenerates images/julia-icons.woff, the icon font behind the
// `$(julia-logo)` status bar icon contributed in package.json. The generated
// font is committed so builds do not depend on this script; re-run it (npm
// run generate-icon-font) only when a glyph in images/icon-font changes.
//
// fantasticon would do all of this in one call, but its input globbing breaks
// on Windows paths, so the three underlying libraries are driven directly
// with an explicit file list.
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont'
import svg2ttf from 'svg2ttf'
import ttf2woff from 'ttf2woff'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)))

// glyph name -> codepoint; must stay in sync with `contributes.icons` in
// package.json.
const glyphs = { 'julia-logo': 0xe900 }

const fontStream = new SVGIcons2SVGFontStream({
    fontName: 'julia-icons',
    fontHeight: 1000,
    normalize: true,
    log: () => {},
})

const chunks = []
fontStream.on('data', (chunk) => chunks.push(chunk))
fontStream.on('finish', () => {
    const svgFont = chunks.join('')
    const ttf = svg2ttf(svgFont, {})
    const woff = ttf2woff(Buffer.from(ttf.buffer))
    const outPath = path.join(root, 'images', 'julia-icons.woff')
    fs.writeFileSync(outPath, woff)
    console.log(`Wrote ${outPath} (${woff.length} bytes)`)
})

for (const [name, codepoint] of Object.entries(glyphs)) {
    const glyph = fs.createReadStream(path.join(root, 'images', 'icon-font', `${name}.svg`))
    glyph.metadata = { unicode: [String.fromCodePoint(codepoint)], name }
    fontStream.write(glyph)
}
fontStream.end()

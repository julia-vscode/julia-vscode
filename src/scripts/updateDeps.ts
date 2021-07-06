import * as cp from 'child-process-promise'
import * as download from 'download'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'process'
import * as semver from 'semver'

async function our_download(url: string, destination: string) {
    const dest_path = path.join(process.cwd(), path.dirname(destination))

    try {
        await fs.access(path.join(dest_path, path.basename(destination)))
        await fs.unlink(path.join(dest_path, path.basename(destination)))
    }
    catch (err) {
        console.log(`Could not delete file '${path.join(dest_path, path.basename(destination))}'.`)
    }

    await download(url, dest_path)

    await fs.rename(path.join(dest_path, path.basename(url)), path.join(dest_path, path.basename(destination)))

    return
}

async function main() {
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@2', 'libs/vega-lite-2/vega-lite.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@3', 'libs/vega-lite-3/vega-lite.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@4', 'libs/vega-lite-4/vega-lite.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega@3', 'libs/vega-3/vega.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega@4', 'libs/vega-4/vega.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega@5', 'libs/vega-5/vega.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega-embed@6', 'libs/vega-embed/vega-embed.min.js')

    await our_download('https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js', 'libs/webfont/webfont.js')

    await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/fontawesome.min.css', 'libs/fontawesome/fontawesome.min.css')
    await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/solid.min.css', 'libs/fontawesome/solid.min.css')
    await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/brands.min.css', 'libs/fontawesome/brands.min.css')

    await our_download('https://raw.githubusercontent.com/bumbu/svg-pan-zoom/master/dist/svg-pan-zoom.min.js', 'libs/svg-pan-zoom/svg-pan-zoom.min.js')

    for (const pkg of ['JSONRPC', 'CSTParser', 'LanguageServer', 'DocumentFormat', 'StaticLint', 'SymbolServer', 'DebugAdapter', 'ChromeProfileFormat']) {
        await cp.exec('git checkout master', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
        await cp.exec('git pull', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }

    for (const pkg of ['IJuliaCore']) {
        await cp.exec('git checkout main', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
        await cp.exec('git pull', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }


    for (const pkg of ['CodeTracking', 'CoverageTools', 'FilePathsBase', 'JuliaInterpreter', 'LoweredCodeUtils', 'OrderedCollections', 'PackageCompiler', 'Revise', 'Tokenize', 'URIParser']) {
        const tags = await cp.exec('git tag', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })

        const newestTag = tags.stdout.split(/\r?\n/).map(i => { return { original: i, parsed: semver.valid(i) } }).filter(i => i.parsed !== null).sort((a, b) => semver.compare(b.parsed, a.parsed))[0]

        await cp.exec(`git checkout ${newestTag.original}`, { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }

    // Note that this "+1.3.1" argument currently only works on Windows with a juliaup installation
    await cp.exec(`julia "+1.3.1" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/development') })
    await cp.exec(`julia "+1.3.1" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/languageserver') })
    await cp.exec(`julia "+1.3.1" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/sysimagecompile') })
    await cp.exec(`julia "+1.3.1" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/debugadapter') })
    await cp.exec(`julia "+1.3.1" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger') })
    await cp.exec(`julia "+1.3.1" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/vscodeserver') })
    await cp.exec(`julia "+1.3.1" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/chromeprofileformat') })

    await cp.exec(`julia --project=. -e "using Pkg; Pkg.update()"`, { cwd: path.join(process.cwd(), 'scripts/environments/pkgdev') })

    await cp.exec('npm update', { cwd: process.cwd() })
}

main()

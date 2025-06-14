import download from 'download'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'process'
import * as cp from 'promisify-child-process'
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

async function replace_backslash_in_manifest(project_path: string) {
    const manifest_content = await fs.readFile(path.join(project_path, 'Manifest.toml'))
    await fs.writeFile(path.join(project_path, 'Manifest.toml'), manifest_content.toString().replace (/\\\\/g, '/'))
}

async function main() {
    await our_download('https://raw.githubusercontent.com/JuliaEditorSupport/atom-language-julia/master/grammars/julia_vscode.json', 'syntaxes/julia_vscode.json')

    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@2', 'libs/vega-lite-2/vega-lite.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@3', 'libs/vega-lite-3/vega-lite.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@4', 'libs/vega-lite-4/vega-lite.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@5', 'libs/vega-lite-5/vega-lite.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega@3', 'libs/vega-3/vega.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega@4', 'libs/vega-4/vega.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega@5', 'libs/vega-5/vega.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/vega-embed@6', 'libs/vega-embed/vega-embed.min.js')
    await our_download('https://cdn.jsdelivr.net/npm/plotly.js@2/dist/plotly.min.js', 'libs/plotly/plotly.min.js')

    await our_download('https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js', 'libs/webfont/webfont.js')

    await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/fontawesome.min.css', 'libs/fontawesome/fontawesome.min.css')
    await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/solid.min.css', 'libs/fontawesome/solid.min.css')
    await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/brands.min.css', 'libs/fontawesome/brands.min.css')

    for (const pkg of ['StaticLint', 'SymbolServer']) {
        console.log(`Updating ${pkg} to latest master`)
        await cp.exec('git checkout master', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
        await cp.exec('git pull', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }

    for (const pkg of ['LanguageServer', 'CSTParser', 'JSONRPC', 'IJuliaCore', 'JuliaWorkspaces', 'TestItemControllers', 'TestItemDetection', 'DebugAdapter', 'Salsa']) {
        console.log(`Updating ${pkg} to latest main`)
        await cp.exec('git checkout main', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
        await cp.exec('git pull', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }


    for (const pkg of [
        'AutoHashEquals',
        'ExceptionUnwrapping',
        'MacroTools',
        'CancellationTokens',
        'CodeTracking',
        'CoverageTools',
        'FilePathsBase',
        'JuliaInterpreter',
        'JuliaSyntax',
        'Glob',
        'LoweredCodeUtils',
        'OrderedCollections',
        'Tokenize',
        'URIParser',
        // need 0.8 for JuliaFormatter compat
        // 'CommonMark',
        'Compat',
        'Crayons',
        'DataStructures',
        // 'JuliaFormatter', Need more time to do the v2 transition
        // 'URIs', Not compatible with earlier than Julia 1.6 versions
        'Revise',
        'DelimitedFiles',
        'Preferences',
        // 1.3 only works on 1.12
        // 'PrecompileTools',
        'TestEnv',
    ]) {
        const opts = { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) }
        await cp.exec('git fetch', opts)
        await cp.exec('git fetch --tags', opts)
        const tags = await cp.exec('git tag', opts)
        const tagsSorted = tags.stdout.toString().split(/\r?\n/).map(i => { return { original: i, parsed: semver.valid(i) } }).filter(i => i.parsed !== null).sort((a, b) => semver.compare(b.parsed, a.parsed))
        const newestTag = tagsSorted[0]

        console.log(`Updating ${pkg} to latest tag: ${newestTag.original}`)
        await cp.exec(`git checkout ${newestTag.original}`, opts)
    }

    // Update various project files
    // ============================

    await fs.rm(path.join(process.cwd(), 'scripts/environments/languageserver'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/environments/pkgdev'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/environments/terminalserver'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/testenvironments/debugadapter'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/testenvironments/vscodeserver'), { recursive: true })
    for (const v of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '1.10', '1.11', '1.12']) {
        console.log(`Adding Julia ${v} via juliaup`)
        try {
            await cp.exec(`juliaup add ${v}`)
        }
        catch (err) {
        }

        console.log(`Updating environments for Julia ${v}...`)

        try {
            if(semver.gte(new semver.SemVer(`${v}.0`), new semver.SemVer('1.10.0'))) {
                const env_path_ls = path.join(process.cwd(), 'scripts/environments/languageserver', `v${v}`)
                await fs.mkdir(env_path_ls, { recursive: true })
                await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_ls_project.jl')}`, { cwd: env_path_ls })

                const env_path_testitemcontroller = path.join(process.cwd(), 'scripts/environments/testitemcontroller', `v${v}`)
                await fs.mkdir(env_path_testitemcontroller, { recursive: true })
                await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_testitemcontroller_project.jl')}`, { cwd: env_path_testitemcontroller })

                const env_path_pkgdev = path.join(process.cwd(), 'scripts/environments/pkgdev', `v${v}`)
                await fs.mkdir(env_path_pkgdev, { recursive: true })
                await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_pkgdev_project.jl')}`, { cwd: env_path_pkgdev })
            }

            const env_path_terminalserver = path.join(process.cwd(), 'scripts/environments/terminalserver', `v${v}`)
            await fs.mkdir(env_path_terminalserver, { recursive: true })
            await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_terminalserver_project.jl')}`, { cwd: env_path_terminalserver })

            const env_path_test_debugadapter = path.join(process.cwd(), 'scripts/testenvironments/debugadapter', `v${v}`)
            await fs.mkdir(env_path_test_debugadapter, { recursive: true })
            await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_test_debugadapter_project.jl')}`, { cwd: env_path_test_debugadapter })

            const env_path_test_vscodedebugger = path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger', `v${v}`)
            await fs.mkdir(env_path_test_vscodedebugger, { recursive: true })
            await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_test_vscodedebugger_project.jl')}`, { cwd: env_path_test_vscodedebugger })

            const env_path_test_vscodeserver = path.join(process.cwd(), 'scripts/testenvironments/vscodeserver', `v${v}`)
            await fs.mkdir(env_path_test_vscodeserver, { recursive: true })
            await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_test_vscodeserver_project.jl')}`, { cwd: env_path_test_vscodeserver })

        } catch (err) {
            console.log(err)
        }
    }

    try {
        await cp.exec(`juliaup add release`)
    }
    catch (err) {

    }

    try {
        await cp.exec(`juliaup add nightly`)
    }
    catch (err) {
    }

    // We also add a fallback release env in case a user has a Julia version we don't know about
    await fs.mkdir(path.join(process.cwd(), 'scripts/environments/languageserver/fallback'), { recursive: true })
    await fs.mkdir(path.join(process.cwd(), 'scripts/environments/terminalserver/fallback'), { recursive: true })
    await fs.mkdir(path.join(process.cwd(), 'scripts/environments/testitemcontroller/fallback'), { recursive: true })
    await fs.mkdir(path.join(process.cwd(), 'scripts/environments/pkgdev/fallback'), { recursive: true })
    await cp.exec(`julia "+nightly" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_ls_project.jl')}`, { cwd: path.join(process.cwd(), 'scripts/environments/languageserver/fallback') })
    await cp.exec(`julia "+nightly" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_terminalserver_project.jl')}`, { cwd: path.join(process.cwd(), 'scripts/environments/terminalserver/fallback') })
    await cp.exec(`julia "+nightly" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_testitemcontroller_project.jl')}`, { cwd: path.join(process.cwd(), 'scripts/environments/testitemcontroller/fallback') })
    await cp.exec(`julia "+nightly" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_pkgdev_project.jl')}`, { cwd: path.join(process.cwd(), 'scripts/environments/pkgdev/fallback') })

    // Julia 1.0 and 1.1 write backslash in relative paths in Manifest files, which we don't want
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/debugadapter/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/debugadapter/v1.1'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger/v1.1'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodeserver/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodeserver/v1.1'))

    // We keep the dev environment on the latest release version always
    await cp.exec(`julia "+release" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/development') })

    console.log('npm update')
    await cp.exec('npm update', { cwd: process.cwd() })
}

main()

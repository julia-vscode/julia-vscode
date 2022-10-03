import * as download from 'download'
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

    for (const pkg of ['JSONRPC', 'CSTParser', 'LanguageServer', 'StaticLint', 'SymbolServer', 'DebugAdapter']) {
        await cp.exec('git checkout master', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
        await cp.exec('git pull', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }

    for (const pkg of ['IJuliaCore', 'TestItemDetection']) {
        await cp.exec('git checkout main', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
        await cp.exec('git pull', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }


    for (const pkg of [
        'CodeTracking',
        'CoverageTools',
        'FilePathsBase',
        'JuliaInterpreter',
        'LoweredCodeUtils',
        'OrderedCollections',
        'PackageCompiler',
        'Tokenize',
        'URIParser',
        'CommonMark',
        // 'Compat', # Compat 4 dropped Julia 1.0 support, so we keep it on an older version
        // 'Crayons', # Crayons 4.1 dropped Julia 1.0 support, so we keep it on an older version
        'DataStructures',
        'JuliaFormatter',
        'URIs',
        'Revise'
    ]) {
        await cp.exec('git fetch')
        const tags = await cp.exec('git tag', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })

        const newestTag = tags.stdout.toString().split(/\r?\n/).map(i => { return { original: i, parsed: semver.valid(i) } }).filter(i => i.parsed !== null).sort((a, b) => semver.compare(b.parsed, a.parsed))[0]

        await cp.exec(`git checkout ${newestTag.original}`, { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) })
    }

    // Update various project files
    // ============================

    await fs.rm(path.join(process.cwd(), 'scripts/environments/languageserver'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/environments/pkgdev'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/environments/sysimagecompile'), { recursive: true })

    await fs.rm(path.join(process.cwd(), 'scripts/testenvironments/debugadapter'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger'), { recursive: true })
    await fs.rm(path.join(process.cwd(), 'scripts/testenvironments/vscodeserver'), { recursive: true })
    for (const v of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8']) {
        const env_path_ls = path.join(process.cwd(), 'scripts/environments/languageserver', `v${v}`)
        await fs.mkdir(env_path_ls, { recursive: true })
        await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_ls_project.jl')}`, { cwd: env_path_ls })

        if(new semver.SemVer(`${v}.0`)>=new semver.SemVer('1.6.0')) {
            const env_path_pkgdev = path.join(process.cwd(), 'scripts/environments/pkgdev', `v${v}`)
            await fs.mkdir(env_path_pkgdev, { recursive: true })
            await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_pkgdev_project.jl')}`, { cwd: env_path_pkgdev })
        }

        const env_path_sysimagecompile = path.join(process.cwd(), 'scripts/environments/sysimagecompile', `v${v}`)
        await fs.mkdir(env_path_sysimagecompile, { recursive: true })
        await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_sysimagecompile_project.jl')}`, { cwd: env_path_sysimagecompile })

        const env_path_test_debugadapter = path.join(process.cwd(), 'scripts/testenvironments/debugadapter', `v${v}`)
        await fs.mkdir(env_path_test_debugadapter, { recursive: true })
        await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_test_debugadapter_project.jl')}`, { cwd: env_path_test_debugadapter })

        const env_path_test_vscodedebugger = path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger', `v${v}`)
        await fs.mkdir(env_path_test_vscodedebugger, { recursive: true })
        await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_test_vscodedebugger_project.jl')}`, { cwd: env_path_test_vscodedebugger })

        const env_path_test_vscodeserver = path.join(process.cwd(), 'scripts/testenvironments/vscodeserver', `v${v}`)
        await fs.mkdir(env_path_test_vscodeserver, { recursive: true })
        await cp.exec(`julia "+${v}" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_test_vscodeserver_project.jl')}`, { cwd: env_path_test_vscodeserver })

    }

    // We also add a fallback release env in case a user has a Julia version we don't know about
    await fs.mkdir(path.join(process.cwd(), 'scripts/environments/languageserver/fallback'), { recursive: true })
    await fs.mkdir(path.join(process.cwd(), 'scripts/environments/pkgdev/fallback'), { recursive: true })
    await fs.mkdir(path.join(process.cwd(), 'scripts/environments/sysimagecompile/fallback'), { recursive: true })
    await cp.exec(`julia "+release" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_ls_project.jl')}`, { cwd: path.join(process.cwd(), 'scripts/environments/languageserver/fallback') })
    await cp.exec(`julia "+release" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_pkgdev_project.jl')}`, { cwd: path.join(process.cwd(), 'scripts/environments/pkgdev/fallback') })
    await cp.exec(`julia "+release" --project=. ${path.join(process.cwd(), 'src/scripts/juliaprojectcreatescripts/create_sysimagecompile_project.jl')}`, { cwd: path.join(process.cwd(), 'scripts/environments/sysimagecompile/fallback') })

    // Julia 1.0 and 1.1 write backslash in relative paths in Manifest files, which we don't want
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/environments/languageserver/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/environments/languageserver/v1.1'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/environments/sysimagecompile/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/debugadapter/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/debugadapter/v1.1'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger/v1.1'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodeserver/v1.0'))
    await replace_backslash_in_manifest(path.join(process.cwd(), 'scripts/testenvironments/vscodeserver/v1.1'))

    // We keep the dev environment on the latest release version always
    await cp.exec(`julia "+release" --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/development') })

    await cp.exec('npm update', { cwd: process.cwd() })
}

main()

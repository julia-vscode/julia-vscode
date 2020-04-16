import * as download from 'download';
import * as path from 'path';
import * as process from 'process';
import {promises as fs, openSync} from 'fs';
import * as cp from 'child-process-promise';
import { homedir } from 'os';

async function our_download(url: string, destination: string) {
    const dest_path = path.join(process.cwd(), path.dirname(destination));

    try {
        await fs.access(path.join(dest_path, path.basename(destination)));
        await fs.unlink(path.join(dest_path, path.basename(destination)));
    }
    catch (err) {
        console.log(`Could not delete file '${path.join(dest_path, path.basename(destination))}'.`)
    }

    await download(url, dest_path);

    await fs.rename(path.join(dest_path, path.basename(url)), path.join(dest_path, path.basename(destination))); 

    return
}

async function main() {
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@2', 'libs/vega-lite-2/vega-lite.min.js');
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@3', 'libs/vega-lite-3/vega-lite.min.js');
    await our_download('https://cdn.jsdelivr.net/npm/vega-lite@4', 'libs/vega-lite-4/vega-lite.min.js');
    await our_download('https://cdn.jsdelivr.net/npm/vega@3', 'libs/vega-3/vega.min.js');
    await our_download('https://cdn.jsdelivr.net/npm/vega@4', 'libs/vega-4/vega.min.js');
    await our_download('https://cdn.jsdelivr.net/npm/vega@5', 'libs/vega-5/vega.min.js');
    await our_download('https://cdn.jsdelivr.net/npm/vega-embed@6', 'libs/vega-embed/vega-embed.min.js');

    for(var pkg of ['CSTParser', 'LanguageServer', 'DocumentFormat', 'StaticLint', 'SymbolServer']) {
        await cp.exec('git checkout master', {cwd: path.join(process.cwd(), `scripts/languageserver/packages/${pkg}`)});
        await cp.exec('git pull', {cwd: path.join(process.cwd(), `scripts/languageserver/packages/${pkg}`)})    
    }

    let juliaPath = path.join(homedir(), "AppData", "Local", "Julia-1.3.1", "bin", "julia.exe");

    await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, {cwd: path.join(process.cwd(), 'scripts/languageserver/packages')})

    await cp.exec('npm update', {cwd: process.cwd()})
}

main();

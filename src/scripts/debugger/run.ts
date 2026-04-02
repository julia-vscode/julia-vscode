#!/usr/bin/env node
// Run higher_order_examples.jl on each minor Julia version from 1.6 to 1.13,
// then take the union of all generated hofs_*.txt files into hofs_union.txt.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const scriptDir: string = join(process.cwd(), 'src', 'scripts', 'debugger')

for (let minor = 6; minor <= 13; minor++) {
    const version = `1.${minor}`
    console.log(`=== Julia ${version} ===`)

    try {
        execSync(`juliaup add ${version}`, { stdio: 'ignore' })
    } catch {
        console.log(`  Skipping: could not install Julia ${version}\n`)
        continue
    }

    try {
        execSync(`julia +${version} --startup-file=no ${join(scriptDir, 'main.jl')}`, {
            stdio: 'inherit',
        })
    } catch (e: unknown) {
        console.error(`  Error running Julia ${version}: ${(e as Error).message}`)
    }
    console.log()
}

// --- Part 2: Union of hofs_*.txt files ---

const hofsFiles: string[] = readdirSync(scriptDir).filter((f) => /^hofs_.*\.txt$/.test(f))
const lines = new Set<string>()

for (const file of hofsFiles) {
    const content: string = readFileSync(join(scriptDir, file), 'utf-8')
    for (const line of content.split('\n')) {
        if (line) {
            lines.add(line)
        }
    }
}

const sorted: string[] = [...lines].sort()
const outPath: string = join(scriptDir, 'hofs_union.txt')
writeFileSync(outPath, sorted.join('\n') + '\n')
console.log(`Wrote ${sorted.length} unique lines to hofs_union.txt`)

// --- Part 3: Update debuggerDefaultCompiled in package.json ---

const hardcoded: string[] = [
    'Base.',
    'Core.',
    'Core.Compiler.',
    'Core.IR',
    'Core.Intrinsics',
    'DelimitedFiles',
    'Distributed',
    'LinearAlgebra.',
    'Serialization',
    'SparseArrays',
    'Mmap',
]

const compiled: string[] = [...hardcoded, ...sorted.map((name) => `-${name}`)]

const pkgPath: string = join(process.cwd(), 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
pkg.contributes.configuration.properties['julia.debuggerDefaultCompiled'].default = compiled
writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n')
console.log(`Updated debuggerDefaultCompiled in package.json with ${compiled.length} entries`)

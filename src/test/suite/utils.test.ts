import * as assert from 'assert'
import * as utils from '../../utils'

suite('parseVSCodeVariables', () => {
    test('returns empty string for ${workspaceFolder} when no workspace', () => {
        const result = utils.parseVSCodeVariables('--project=${workspaceFolder}')
        assert.strictEqual(result, '--project=')
    })

    test('returns empty string for ${workspaceFolderBasename} when no workspace', () => {
        const result = utils.parseVSCodeVariables('${workspaceFolderBasename}')
        assert.strictEqual(result, '')
    })

    test('handles multiple variables in one string', () => {
        const result = utils.parseVSCodeVariables('${workspaceFolder}/src/${workspaceFolderBasename}')
        assert.strictEqual(result, '/src/')
    })

    test('preserves string when no variables present', () => {
        const result = utils.parseVSCodeVariables('--project=.')
        assert.strictEqual(result, '--project=.')
    })

    test('returns input when undefined', () => {
        const result = utils.parseVSCodeVariables(undefined)
        assert.strictEqual(result, undefined)
    })
})

// TODO figure out how to mock vscode.workspace.getConfiguration("julia")
// suite('Test JULIA_NUM_THREADS config', () => {
//     test('null config and defined environment var', () => {
//         assert.equal(utils.inferJuliaNumThreads(), undefined)
//     })

//     test('null config and defined environment var', () => {
//         assert.equal(utils.inferJuliaNumThreads(), undefined)

//     })
//     test('not null config and defined environment var', () => {
//         assert.equal(utils.inferJuliaNumThreads(), undefined)
//     })
//     test('not null config and undefined environment var', () => {
//         assert.equal(utils.inferJuliaNumThreads(), undefined)
//     })

// })

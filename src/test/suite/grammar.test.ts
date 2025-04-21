import * as assert from 'assert'
import * as path from 'path'
import * as fs from 'fs'
import { Registry, parseRawGrammar } from 'vscode-textmate'
import * as oniguruma from 'vscode-oniguruma'

// Test case interface
interface TestCase {
    name: string;
    code: string;
    expectedScope: string;
    targetToken?: number;
}

// All test cases by category
interface TestCases {
    keywords: TestCase[];
    literals: TestCase[];
    comments: TestCase[];
    operators: TestCase[];
    functions: TestCase[];
    types: TestCase[];
    macros: TestCase[];
}

// Helper to check if token contains a specific scope
function tokenIncludesScope(scopes: string[], targetScope: string): boolean {
    return scopes.some(scope => scope.includes(targetScope))
}

suite('TextMate Grammar Tests', () => {
    let registry: Registry
    let testCases: TestCases

    suiteSetup(async function() {
        this.timeout(10000) // Allow more time for setup

        try {
            // Load test cases
            const testCasesPath = path.join(__dirname, '..', 'fixtures', 'test-cases.json')
            testCases = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'))

            // Load the Oniguruma WebAssembly file
            const wasmPath = path.join(__dirname, '..', '..', '..', 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm')
            const onigurumaWasm = fs.readFileSync(wasmPath).buffer

            // Initialize Oniguruma
            const vscodeOnigurumaLib = await oniguruma.loadWASM(onigurumaWasm).then(() => {
                return {
                    createOnigScanner(patterns: string[]) { return new oniguruma.OnigScanner(patterns) },
                    createOnigString(s: string) { return new oniguruma.OnigString(s) }
                }
            })

            // Setup the registry
            registry = new Registry({
                onigLib: Promise.resolve(vscodeOnigurumaLib),
                loadGrammar: async (scopeName) => {
                    if (scopeName === 'source.julia') {
                        const grammarPath = path.join(__dirname, '..', '..', '..', 'syntaxes', 'julia_vscode.json')
                        const content = fs.readFileSync(grammarPath).toString()
                        return parseRawGrammar(content, grammarPath)
                    }
                    return null
                }
            })
        } catch (err) {
            console.error('Failed to setup grammar tests:', err)
            throw err
        }
    })

    // Helper function to get tokens for a given line of code
    async function getTokensForLine(text: string) {
        const grammar = await registry.loadGrammar('source.julia')
        if (!grammar) {
            throw new Error('Failed to load Julia grammar')
        }

        const lineTokens = grammar.tokenizeLine(text, undefined)
        return lineTokens.tokens
    }

    // Helper to run tests for a category of test cases
    async function runTestsForCategory(category: TestCase[], description: string) {
        suite(description, () => {
            for (const testCase of category) {
                test(testCase.name, async function() {
                    const tokens = await getTokensForLine(testCase.code)

                    let targetTokenIndex = 0
                    if (testCase.targetToken !== undefined) {
                        targetTokenIndex = testCase.targetToken < 0
                            ? tokens.length + testCase.targetToken  // Negative index counts from end
                            : testCase.targetToken
                    }

                    // Find a token that matches the expected scope
                    const matchingToken = targetTokenIndex !== undefined
                        ? tokens[targetTokenIndex]
                        : tokens.find(token => tokenIncludesScope(token.scopes, testCase.expectedScope))

                    assert.ok(
                        matchingToken && tokenIncludesScope(matchingToken.scopes, testCase.expectedScope),
                        `${testCase.name} should be highlighted with scope ${testCase.expectedScope}`
                    )
                })
            }
        })
    }

    // Run tests for each category
    test('Grammar is loaded', async function() {
        const grammar = await registry.loadGrammar('source.julia')
        assert.ok(grammar, 'Julia grammar should be loaded successfully')
    })

    suite('Test categories', async function() {
        // Dynamically run tests for each category
        this.timeout(30000) // Allow enough time for all tests

        // Only run if test cases were loaded successfully
        if (testCases) {
            for (const [category, cases] of Object.entries(testCases)) {
                // Skip empty categories
                if (!cases || cases.length === 0) {continue}

                // Run tests for this category
                await runTestsForCategory(cases, category.charAt(0).toUpperCase() + category.slice(1))
            }
        }
    })
})

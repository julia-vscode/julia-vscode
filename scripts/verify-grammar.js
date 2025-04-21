#!/usr/bin/env node
/**
 * Grammar validation utility
 *
 * This script unit-tests the Julia TextMate grammar.
 *
 * Usage in tests:
 *   npm run verify-grammar
 */

const fs = require('fs');
const path = require('path');
const { Registry, parseRawGrammar, INITIAL } = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

// ANSI color codes for colorful output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

// Get command line args
const args = process.argv.slice(2);
let testFile = path.resolve(__dirname, '../src/test/fixtures/test-cases.json');

// Parse args
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
        testFile = path.resolve(process.cwd(), args[i + 1]);
        i++;
    } else if (args[i] === '--help') {
        console.log(`
${colors.bright}Julia TextMate Grammar Validation Tool${colors.reset}

Usage:
  node scripts/verify-grammar.js [options]

Options:
  --file <path>    Path to test cases JSON file
  --help           Show this help message
        `);
        process.exit(0);
    }
}

// Helper to check if token contains a specific scope
function tokenIncludesScope(scopes, targetScope) {
    return scopes.some(scope => scope.includes(targetScope));
}

// Runs all tests for a category
async function runCategoryTests(grammar, category, testCases) {
    console.log(`\n${colors.bright}${colors.blue}Testing ${category}${colors.reset}`);

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        try {
            // Tokenize the line
            const lineTokens = grammar.tokenizeLine(testCase.code, INITIAL);
            const tokens = lineTokens.tokens;

            // Determine which token to test
            let targetTokenIndex = 0;
            if (testCase.targetToken !== undefined) {
                targetTokenIndex = testCase.targetToken < 0
                    ? tokens.length + testCase.targetToken  // Negative index counts from end
                    : testCase.targetToken;
            }

            // Find a token that matches the expected scope
            const matchingToken = targetTokenIndex !== undefined
                ? tokens[targetTokenIndex]
                : tokens.find(token => tokenIncludesScope(token.scopes, testCase.expectedScope));

            // Check if token has expected scope
            if (matchingToken && tokenIncludesScope(matchingToken.scopes, testCase.expectedScope)) {
                console.log(`  ${colors.green}✓${colors.reset} ${testCase.name}`);
                // Always show tokens for debugging
                console.log(`    Code: ${colors.dim}${testCase.code}${colors.reset}`);
                passed++;
            } else {
                console.log(`  ${colors.red}✗${colors.reset} ${testCase.name}`);
                console.log(`    Expected: ${colors.cyan}${testCase.expectedScope}${colors.reset}`);
                console.log(`    Token: ${targetTokenIndex !== undefined ? `#${targetTokenIndex}` : 'any'}`);
                console.log(`    Code: ${colors.dim}${testCase.code}${colors.reset}`);

                if (matchingToken) {
                    console.log(`    Found scopes: ${colors.yellow}${matchingToken.scopes.join(', ')}${colors.reset}`);
                } else {
                    console.log(`    ${colors.red}No matching token found${colors.reset}`);
                }

                // Always list all tokens for debugging
                console.log(`    Available tokens:`);
                tokens.forEach((token, i) => {
                    console.log(`      #${i}: ${colors.yellow}${token.scopes.join(', ')}${colors.reset}`);
                });

                failed++;
            }
        } catch (err) {
            console.log(`  ${colors.red}✗${colors.reset} ${testCase.name}`);
            console.log(`    Error: ${err.message}`);
            failed++;
        }
    }

    return { passed, failed };
}

// Main function
async function main() {
    try {
        console.log(`${colors.bright}Julia TextMate Grammar Validation${colors.reset}`);
        console.log(`Loading test cases from: ${colors.yellow}${testFile}${colors.reset}`);

        // Load test cases
        if (!fs.existsSync(testFile)) {
            console.error(`${colors.red}Error: Test cases file not found${colors.reset}`);
            process.exit(1);
        }

        const testCases = JSON.parse(fs.readFileSync(testFile, 'utf8'));

        // Load the grammar
        const grammarPath = path.resolve(__dirname, '../syntaxes/julia_vscode.json');
        console.log(`Loading grammar from: ${colors.yellow}${grammarPath}${colors.reset}`);

        if (!fs.existsSync(grammarPath)) {
            console.error(`${colors.red}Error: Grammar file not found${colors.reset}`);
            process.exit(1);
        }

        // Load oniguruma wasm
        const wasmPath = path.resolve(__dirname, '../node_modules/vscode-oniguruma/release/onig.wasm');

        if (!fs.existsSync(wasmPath)) {
            console.error(`${colors.red}Error: onig.wasm not found. Run: npm install${colors.reset}`);
            process.exit(1);
        }

        // Setup textmate
        const wasmBin = fs.readFileSync(wasmPath).buffer;
        const vscodeOnigurumaLib = await oniguruma.loadWASM(wasmBin).then(() => {
            return {
                createOnigScanner(patterns) { return new oniguruma.OnigScanner(patterns); },
                createOnigString(s) { return new oniguruma.OnigString(s); }
            };
        });

        // Create registry and load grammar
        const registry = new Registry({
            onigLib: vscodeOnigurumaLib,
            loadGrammar: (scopeName) => {
                if (scopeName === 'source.julia') {
                    const content = fs.readFileSync(grammarPath).toString();
                    return parseRawGrammar(content, grammarPath);
                }
                return null;
            }
        });

        const grammar = await registry.loadGrammar('source.julia');
        if (!grammar) {
            console.error(`${colors.red}Error: Failed to load grammar${colors.reset}`);
            process.exit(1);
        }

        console.log(`${colors.green}Grammar loaded successfully${colors.reset}`);

        // Run tests for each category
        let totalPassed = 0;
        let totalFailed = 0;

        for (const [category, cases] of Object.entries(testCases)) {
            if (!cases || cases.length === 0) continue;

            const { passed, failed } = await runCategoryTests(grammar, category, cases);
            totalPassed += passed;
            totalFailed += failed;
        }

        // Print summary
        console.log(`\n${colors.bright}Summary:${colors.reset}`);
        console.log(`  ${colors.green}Passed: ${totalPassed}${colors.reset}`);
        console.log(`  ${colors.red}Failed: ${totalFailed}${colors.reset}`);
        console.log(`  ${colors.blue}Total: ${totalPassed + totalFailed}${colors.reset}`);

        // Exit with non-zero code if any tests failed
        process.exit(totalFailed > 0 ? 1 : 0);

    } catch (err) {
        console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
        console.error(err);
        process.exit(1);
    }
}

// Run the main function
main().catch(err => {
    console.error(`${colors.red}Unhandled error: ${err.message}${colors.reset}`);
    console.error(err);
    process.exit(1);
});

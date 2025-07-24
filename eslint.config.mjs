import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
    {
        ignores: ['out/', 'libs/', 'dist/', '.vscode-test/']
    },
    {
        files: ['**/*.ts'],
        plugins: {
            '@typescript-eslint': typescriptEslint,
        },

        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },

        rules: {
            '@typescript-eslint/naming-convention': ['warn', {
                selector: 'import',
                format: ['camelCase', 'PascalCase'],
            }],

            curly: 'warn',
            eqeqeq: 'error',
            'no-throw-literal': 'warn',
            semi: ['error', 'never'],
            'prefer-const': 'warn',
            'no-extra-semi': 'warn',
            'no-var': 'warn',
            quotes: ['warn', 'single', {allowTemplateLiterals: true}],
            indent: ['warn', 4],
        },
    }
]

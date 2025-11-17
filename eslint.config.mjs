import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier/flat'

export default defineConfig(
    {
        ignores: ['out/', 'libs/', 'dist/', '.vscode-test/', 'scripts/'],
    },
    eslint.configs.recommended,
    tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        files: ['**/*.ts'],
        rules: {
            curly: 'warn',
            eqeqeq: 'error',
            'no-throw-literal': 'warn',
            'prefer-const': 'warn',
            'no-extra-semi': 'warn',
            'no-var': 'warn',
        },
    }
)

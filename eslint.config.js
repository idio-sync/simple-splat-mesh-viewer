import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default [
    // Apply to all JS/TS files in src/
    {
        files: ['src/**/*.{js,ts}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                navigator: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                prompt: 'readonly',
                fetch: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                Blob: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                FormData: 'readonly',
                HTMLElement: 'readonly',
                HTMLInputElement: 'readonly',
                HTMLCanvasElement: 'readonly',
                HTMLImageElement: 'readonly',
                Event: 'readonly',
                CustomEvent: 'readonly',
                MouseEvent: 'readonly',
                KeyboardEvent: 'readonly',
                DOMMatrix: 'readonly',
                Image: 'readonly',
                atob: 'readonly',
                btoa: 'readonly',
                screen: 'readonly',
                getComputedStyle: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                performance: 'readonly',
                crypto: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                AbortController: 'readonly',
                MutationObserver: 'readonly',
                ResizeObserver: 'readonly',
                IntersectionObserver: 'readonly',
                Worker: 'readonly',
                WebAssembly: 'readonly'
            }
        }
    },
    // ESLint recommended rules
    js.configs.recommended,
    // TypeScript ESLint recommended rules
    ...tseslint.configs.recommended,
    // Prettier config (disables formatting rules)
    prettierConfig,
    // Custom rule overrides
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ],
            'no-console': 'off',
            'no-useless-escape': 'warn',
            'no-useless-assignment': 'warn',
            'preserve-caught-error': 'off',
            semi: ['error', 'always'],
            'no-var': 'error'
        }
    },
    // Ignore patterns
    {
        ignores: [
            'dist/**',
            'src/config.js',
            'src/pre-module.js',
            'src/themes/editorial/layout.js',
            'node_modules/**',
            'src-tauri/target/**'
        ]
    }
];

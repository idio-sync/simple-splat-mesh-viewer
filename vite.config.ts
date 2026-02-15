import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { transformSync } from 'esbuild';

// Kiosk viewer fetches these as raw text at runtime to inline into offline HTML.
// They must exist as individual .js files in dist/modules/ after build.
// Entries can be .js (copied as-is) or .ts (compiled to JS via esbuild before copying).
const KIOSK_MODULES = [
    'constants.ts', 'logger.ts', 'utilities.ts', 'archive-loader.js',
    'ui-controller.js', 'scene-manager.js', 'fly-controls.ts',
    'annotation-system.js', 'file-handlers.js', 'metadata-manager.js',
    'theme-loader.js', 'quality-tier.ts', 'kiosk-main.js'
];

/**
 * Vite plugin that copies files needed at runtime but not imported at build time.
 * These include kiosk module source files, non-bundled scripts, themes, and raw CSS.
 * TypeScript files are compiled to JavaScript via esbuild before copying.
 */
function copyRuntimeAssets() {
    return {
        name: 'copy-runtime-assets',
        writeBundle() {
            const srcDir = resolve(__dirname, 'src');
            const distDir = resolve(__dirname, 'dist');

            // Ensure directories exist
            mkdirSync(resolve(distDir, 'modules'), { recursive: true });

            // Copy kiosk module source files (raw .js for runtime fetching)
            for (const mod of KIOSK_MODULES) {
                const src = resolve(srcDir, 'modules', mod);
                // Output is always .js regardless of source extension
                const destName = mod.replace(/\.ts$/, '.js');
                const dest = resolve(distDir, 'modules', destName);
                if (!existsSync(src)) continue;

                if (mod.endsWith('.ts')) {
                    // Compile TypeScript to JavaScript using esbuild (strip types only)
                    const tsSource = readFileSync(src, 'utf-8');
                    const { code } = transformSync(tsSource, {
                        loader: 'ts',
                        target: 'es2020',
                        format: 'esm',
                    });
                    writeFileSync(dest, code);
                } else {
                    copyFileSync(src, dest);
                }
            }

            // Copy non-bundled scripts
            copyFileSync(resolve(srcDir, 'config.js'), resolve(distDir, 'config.js'));
            copyFileSync(resolve(srcDir, 'pre-module.js'), resolve(distDir, 'pre-module.js'));

            // Copy raw styles.css for kiosk viewer inlining
            copyFileSync(resolve(srcDir, 'styles.css'), resolve(distDir, 'styles.css'));

            // Copy themes directory for dynamic loading
            const themesDir = resolve(srcDir, 'themes');
            if (existsSync(themesDir)) {
                cpSync(themesDir, resolve(distDir, 'themes'), { recursive: true });
            }
        }
    };
}

export default defineConfig({
    root: 'src',
    base: './',

    build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/index.html'),
            },
        },
    },

    server: {
        port: 8080,
        strictPort: true,
    },

    resolve: {
        alias: {
            // Current code uses three/addons/ (from import map).
            // npm three uses three/examples/jsm/. This alias bridges the gap.
            'three/addons/': 'three/examples/jsm/',
        },
    },

    optimizeDeps: {
        // Spark.js uses eval() for WASM — excluding prevents esbuild from breaking it
        exclude: ['@sparkjsdev/spark'],
    },

    plugins: [
        copyRuntimeAssets(),
    ],
});

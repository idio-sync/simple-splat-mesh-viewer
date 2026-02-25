import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, createReadStream } from 'fs';
import { transformSync } from 'esbuild';

// Kiosk viewer fetches these as raw text at runtime to inline into offline HTML.
// They must exist as individual .js files in dist/modules/ after build.
// Entries can be .js (copied as-is) or .ts (compiled to JS via esbuild before copying).
const KIOSK_MODULES = [
    'constants.ts', 'logger.ts', 'utilities.ts', 'archive-loader.ts',
    'ui-controller.ts', 'scene-manager.ts', 'fly-controls.ts',
    'annotation-system.ts', 'measurement-system.ts', 'file-handlers.ts', 'metadata-manager.ts',
    'theme-loader.ts', 'quality-tier.ts', 'metadata-profile.ts', 'walkthrough-engine.ts', 'kiosk-main.ts'
];

/**
 * Vite plugin that serves occt-import-js WASM in dev and copies it to dist/ at build time.
 * occt-import-js uses a locateFile override to fetch from '/occt-import-js.wasm' (server root).
 */
function serveOcctWasm() {
    return {
        name: 'serve-occt-wasm',
        configureServer(server: any) {
            const wasmPath = resolve(__dirname, 'node_modules/occt-import-js/dist/occt-import-js.wasm');
            server.middlewares.use('/occt-import-js.wasm', (_req: any, res: any) => {
                res.setHeader('Content-Type', 'application/wasm');
                createReadStream(wasmPath).pipe(res);
            });
        },
        writeBundle() {
            const wasmSrc = resolve(__dirname, 'node_modules/occt-import-js/dist/occt-import-js.wasm');
            const wasmDest = resolve(__dirname, 'dist/occt-import-js.wasm');
            if (existsSync(wasmSrc)) {
                copyFileSync(wasmSrc, wasmDest);
            }
        }
    };
}

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

            // Copy raw CSS for kiosk viewer inlining
            copyFileSync(resolve(srcDir, 'styles.css'), resolve(distDir, 'styles.css'));
            copyFileSync(resolve(srcDir, 'kiosk.css'), resolve(distDir, 'kiosk.css'));

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
            // Path alias: @/ maps to src/ for cleaner cross-directory imports
            '@': resolve(__dirname, 'src'),
            // Spark.js 2.0.0-preview vendored from CDN (no npm release yet).
            // CDN source: https://sparkjs.dev/releases/spark/preview/2.0.0/spark.module.js
            '@sparkjsdev/spark': resolve(__dirname, 'src/vendor/spark-2.0.0-preview.module.js'),
        },
    },

    optimizeDeps: {
        // Spark.js uses eval() for WASM — excluding prevents esbuild from breaking it.
        // occt-import-js uses dynamic import + locateFile for WASM — exclude to prevent esbuild inlining.
        exclude: ['@sparkjsdev/spark', 'occt-import-js'],
    },

    plugins: [
        copyRuntimeAssets(),
        serveOcctWasm(),
    ],
});

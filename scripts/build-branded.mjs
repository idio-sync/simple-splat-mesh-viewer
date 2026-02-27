#!/usr/bin/env node
/**
 * build-branded.mjs — GUI tool for building branded Tauri executables.
 *
 * Presents native file/text dialogs (PowerShell on Windows, readline fallback elsewhere)
 * to collect an archive file, product name, and optional icon, then automates the
 * full Tauri build pipeline with those settings.
 *
 * Usage:
 *   node scripts/build-branded.mjs
 *   node scripts/build-branded.mjs --archive path/to/scene.a3z --name "Acme Site Tour"
 *   node scripts/build-branded.mjs --archive scene.a3z --name "Tour" --icon icon.png
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const ROOT = join(__dirname, '..');
const TAURI_CONF = join(ROOT, 'src-tauri', 'tauri.conf.json');
const TAURI_CONF_BAK = TAURI_CONF + '.bak';
const DIST = join(ROOT, 'dist');

const isWindows = process.platform === 'win32';

// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--archive' && args[i + 1]) parsed.archive = args[++i];
        else if (args[i] === '--name' && args[i + 1]) parsed.name = args[++i];
        else if (args[i] === '--icon' && args[i + 1]) parsed.icon = args[++i];
        else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
  build-branded — Build a branded Tauri executable with a bundled archive.

  Usage:
    node scripts/build-branded.mjs                          (interactive GUI)
    node scripts/build-branded.mjs --archive <file> --name <name> [--icon <png>]

  Options:
    --archive <path>   Path to .a3d or .a3z archive to bundle
    --name <string>    Product name (e.g. "Acme Site Tour")
    --icon <path>      Optional .png icon (1024x1024 recommended)
    --help             Show this help
`);
            process.exit(0);
        }
    }
    return parsed;
}

// =============================================================================
// GUI DIALOGS (PowerShell on Windows, readline fallback)
// =============================================================================

function psExec(command) {
    try {
        return execSync(`powershell -NoProfile -Command "${command}"`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch {
        return '';
    }
}

function guiOpenFile(title, filter) {
    if (isWindows) {
        const ps = `
            Add-Type -AssemblyName System.Windows.Forms;
            $d = New-Object System.Windows.Forms.OpenFileDialog;
            $d.Title = '${title}';
            $d.Filter = '${filter}';
            if($d.ShowDialog() -eq 'OK'){$d.FileName}
        `.replace(/\n/g, ' ');
        return psExec(ps);
    }
    return null; // fallback handled by caller
}

function guiInputBox(prompt, title, defaultValue) {
    if (isWindows) {
        const ps = `
            Add-Type -AssemblyName Microsoft.VisualBasic;
            [Microsoft.VisualBasic.Interaction]::InputBox('${prompt}', '${title}', '${defaultValue}')
        `.replace(/\n/g, ' ');
        return psExec(ps);
    }
    return null; // fallback handled by caller
}

function guiConfirm(message) {
    if (isWindows) {
        const ps = `
            Add-Type -AssemblyName System.Windows.Forms;
            $r = [System.Windows.Forms.MessageBox]::Show('${message}', 'Confirm Build', 'YesNo', 'Question');
            if($r -eq 'Yes'){'yes'}else{'no'}
        `.replace(/\n/g, ' ');
        return psExec(ps) === 'yes';
    }
    return true; // fallback assumes yes
}

async function readlinePrompt(question, defaultValue = '') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue);
        });
    });
}

// =============================================================================
// COLLECT INPUTS (GUI or CLI)
// =============================================================================

async function collectInputs(cliArgs) {
    let archivePath = cliArgs.archive;
    let productName = cliArgs.name;
    let iconPath = cliArgs.icon;

    // Archive file
    if (!archivePath) {
        archivePath = guiOpenFile(
            'Select 3D Archive to Bundle',
            '3D Archives (*.a3d;*.a3z)|*.a3d;*.a3z|All Files (*.*)|*.*'
        );
        if (!archivePath) {
            archivePath = await readlinePrompt('Path to .a3d/.a3z archive');
        }
    }

    if (!archivePath || !existsSync(archivePath)) {
        console.error(`Error: Archive file not found: ${archivePath || '(none selected)'}`);
        process.exit(1);
    }
    archivePath = resolve(archivePath);

    // Product name
    if (!productName) {
        const defaultName = basename(archivePath, extname(archivePath))
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        productName = guiInputBox(
            'Enter a product name for the branded executable:',
            'Product Name',
            defaultName
        );
        if (!productName) {
            productName = await readlinePrompt('Product name', defaultName);
        }
    }

    if (!productName) {
        console.error('Error: Product name is required.');
        process.exit(1);
    }

    // Icon (optional)
    if (!iconPath) {
        if (isWindows) {
            iconPath = guiOpenFile(
                'Select Icon (optional — Cancel to skip)',
                'PNG Images (*.png)|*.png|All Files (*.*)|*.*'
            );
        }
        // Don't prompt on CLI fallback — icon is truly optional
    }

    if (iconPath && !existsSync(iconPath)) {
        console.warn(`Warning: Icon file not found: ${iconPath} — skipping.`);
        iconPath = null;
    }
    if (iconPath) iconPath = resolve(iconPath);

    return { archivePath, productName, iconPath };
}

// =============================================================================
// BUILD PIPELINE
// =============================================================================

async function build({ archivePath, productName, iconPath }) {
    const archiveFilename = 'bundled-archive' + extname(archivePath);

    // Summary
    console.log('\n=== Branded Build Configuration ===\n');
    console.log(`  Archive:  ${archivePath}`);
    console.log(`  Name:     ${productName}`);
    console.log(`  Icon:     ${iconPath || '(default)'}`);
    console.log(`  Bundled:  dist/${archiveFilename}`);
    console.log('');

    // Confirm (GUI only, CLI args skip confirmation)
    if (!process.argv.includes('--archive')) {
        const confirmed = guiConfirm(
            `Build branded executable?\\n\\nArchive: ${basename(archivePath)}\\nName: ${productName}\\nIcon: ${iconPath ? basename(iconPath) : '(default)'}`
        );
        if (!confirmed) {
            console.log('Build cancelled.');
            process.exit(0);
        }
    }

    // Step 1: Backup tauri.conf.json
    console.log('[1/7] Backing up tauri.conf.json...');
    copyFileSync(TAURI_CONF, TAURI_CONF_BAK);

    try {
        // Step 2: Patch tauri.conf.json
        console.log('[2/7] Patching tauri.conf.json...');
        const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
        conf.productName = productName;
        conf.app.windows[0].title = productName;
        conf.app.windows[0].url = `index.html?kiosk=true&theme=editorial&archive=${archiveFilename}`;
        // Skip beforeBuildCommand since we run vite build ourselves
        conf.build.beforeBuildCommand = '';
        writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + '\n', 'utf8');

        // Step 3: Run Vite build
        console.log('[3/7] Building frontend with Vite...');
        execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

        // Step 4: Copy archive into dist/
        console.log(`[4/7] Copying archive to dist/${archiveFilename}...`);
        copyFileSync(archivePath, join(DIST, archiveFilename));

        // Step 5: Generate icons (if provided)
        if (iconPath) {
            console.log('[5/7] Generating icons from custom icon...');
            const cargoTauri = isWindows
                ? join(process.env.USERPROFILE || '', '.cargo', 'bin', 'cargo-tauri.exe')
                : 'cargo-tauri';
            execSync(`"${cargoTauri}" icon "${iconPath}"`, { cwd: join(ROOT, 'src-tauri'), stdio: 'inherit' });
        } else {
            console.log('[5/7] Using default icons (no custom icon provided).');
        }

        // Step 6: Build
        console.log('[6/7] Building Tauri application (this may take several minutes)...');
        const cargoTauri = isWindows
            ? join(process.env.USERPROFILE || '', '.cargo', 'bin', 'cargo-tauri.exe')
            : 'cargo-tauri';
        execSync(`"${cargoTauri}" build`, { cwd: ROOT, stdio: 'inherit' });

        // Step 7: Report output
        const bundleDir = join(ROOT, 'src-tauri', 'target', 'release', 'bundle');
        console.log('\n=== Build Complete! ===\n');
        console.log(`  Product:  ${productName}`);
        console.log(`  Output:   ${bundleDir}`);

        if (isWindows) {
            const nsis = join(bundleDir, 'nsis');
            const msi = join(bundleDir, 'msi');
            if (existsSync(nsis)) console.log(`  NSIS:     ${nsis}`);
            if (existsSync(msi)) console.log(`  MSI:      ${msi}`);
        }

        console.log('');

    } finally {
        // Always restore tauri.conf.json
        console.log('[7/7] Restoring original tauri.conf.json...');
        if (existsSync(TAURI_CONF_BAK)) {
            copyFileSync(TAURI_CONF_BAK, TAURI_CONF);
            unlinkSync(TAURI_CONF_BAK);
        }
    }
}

// =============================================================================
// MAIN
// =============================================================================

const cliArgs = parseArgs();
const inputs = await collectInputs(cliArgs);
await build(inputs);

/**
 * Share Dialog Module
 * Provides a tabbed dialog for creating customized share links and embed codes,
 * with QR code generation. Ported from docker/admin.html share dialog design.
 *
 * URL Parameters supported:
 *   ?toolbar=show|hide     - Show/hide the left toolbar buttons
 *   ?sidebar=closed|view|edit - Metadata sidebar state on load
 *   ?ui=full|viewer|kiosk  - Preset UI modes (overrides individual settings)
 */

import { Logger, notify } from './utilities.js';
import type { AppState, Transform } from '@/types.js';
import { normalizeScale } from '@/types.js';

const log = Logger.getLogger('ShareDialog');

// =============================================================================
// STATE
// =============================================================================

let currentState: ShareState | null = null;

// =============================================================================
// TYPES
// =============================================================================

interface ShareState {
    archiveUrl?: string | null;
    archiveHash?: string | null;
    archiveUuid?: string | null;
    archiveTitle?: string | null;
    splatUrl?: string | null;
    modelUrl?: string | null;
    pointcloudUrl?: string | null;
    displayMode?: string;
    splatTransform?: Transform | null;
    modelTransform?: Transform | null;
    pointcloudTransform?: Transform | null;
}

// =============================================================================
// QR CODE ENCODER (Byte mode, EC Level L, versions 1-7)
// Generates SVG QR codes entirely client-side, zero dependencies.
// =============================================================================

const generateQR: (text: string) => string = (() => {
    const EXP = new Uint8Array(256), LOG = new Uint8Array(256);
    let v = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = v; LOG[v] = i;
        v = (v << 1) ^ (v & 128 ? 0x11d : 0);
    }
    EXP[255] = EXP[0];

    function gfMul(a: number, b: number): number {
        return a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255];
    }

    function rsGenPoly(n: number): number[] {
        let g = [1];
        for (let i = 0; i < n; i++) {
            const ng = new Array(g.length + 1).fill(0);
            const root = EXP[i];
            for (let j = 0; j < g.length; j++) {
                ng[j] ^= g[j];
                ng[j + 1] ^= gfMul(g[j], root);
            }
            g = ng;
        }
        return g;
    }

    function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
        const gen = rsGenPoly(ecLen);
        const msg = new Uint8Array(data.length + ecLen);
        msg.set(data);
        for (let i = 0; i < data.length; i++) {
            const coef = msg[i];
            if (coef === 0) continue;
            for (let j = 0; j < gen.length; j++) {
                msg[i + j] ^= gfMul(gen[j], coef);
            }
        }
        return msg.slice(data.length);
    }

    // Version params: [size, totalDataCodewords, ecCodewordsPerBlock]
    const VERSIONS: (null | [number, number, number])[] = [
        null,
        [21, 19, 7],    // v1
        [25, 34, 10],   // v2
        [29, 55, 15],   // v3
        [33, 80, 20],   // v4
        [37, 108, 26],  // v5
        [41, 136, 18],  // v6 (2 blocks)
        [45, 156, 20],  // v7 (2 blocks)
    ];

    const ALIGN: (null | number[])[] = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38]];
    const FORMAT_BITS = [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976];
    const VERSION_BITS: (null | number)[] = [null, null, null, null, null, null, null, 0x07c94];

    function pickVersion(len: number): number {
        for (let ver = 1; ver < VERSIONS.length; ver++) {
            const cap = VERSIONS[ver]![1] - 2;
            if (len <= cap) return ver;
        }
        return 0;
    }

    function encodeData(bytes: Uint8Array, ver: number): Uint8Array {
        const totalDC = VERSIONS[ver]![1];
        const bits: number[] = [];
        function push(val: number, len: number) {
            for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
        }
        push(0b0100, 4);
        push(bytes.length, 8);
        for (const b of bytes) push(b, 8);
        const rem = totalDC * 8 - bits.length;
        push(0, Math.min(4, rem));
        while (bits.length % 8 !== 0) bits.push(0);
        let padIdx = 0;
        while (bits.length < totalDC * 8) {
            push(padIdx % 2 === 0 ? 0xec : 0x11, 8);
            padIdx++;
        }
        const data = new Uint8Array(totalDC);
        for (let i = 0; i < totalDC; i++) {
            let byte = 0;
            for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
            data[i] = byte;
        }
        return data;
    }

    function buildCodewords(data: Uint8Array, ver: number): Uint8Array {
        const [, totalDC, ecPerBlock] = VERSIONS[ver]!;
        if (ver <= 5) {
            const ec = rsEncode(data, ecPerBlock);
            const result = new Uint8Array(totalDC + ecPerBlock);
            result.set(data);
            result.set(ec, totalDC);
            return result;
        }
        const blockSize = totalDC / 2;
        const block1 = data.slice(0, blockSize);
        const block2 = data.slice(blockSize);
        const ec1 = rsEncode(block1, ecPerBlock);
        const ec2 = rsEncode(block2, ecPerBlock);
        const result: number[] = [];
        for (let i = 0; i < blockSize; i++) { result.push(block1[i]); result.push(block2[i]); }
        for (let i = 0; i < ecPerBlock; i++) { result.push(ec1[i]); result.push(ec2[i]); }
        return new Uint8Array(result);
    }

    function createMatrix(ver: number): Uint8Array[] {
        const size = VERSIONS[ver]![0];
        return Array.from({ length: size }, () => new Uint8Array(size));
    }

    function placeFinders(m: Uint8Array[], size: number) {
        function placeOne(r: number, c: number) {
            for (let dr = -1; dr <= 7; dr++) {
                for (let dc = -1; dc <= 7; dc++) {
                    const rr = r + dr, cc = c + dc;
                    if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
                    if (dr === -1 || dr === 7 || dc === -1 || dc === 7) m[rr][cc] = 2;
                    else if (dr === 0 || dr === 6 || dc === 0 || dc === 6) m[rr][cc] = 1;
                    else if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) m[rr][cc] = 1;
                    else m[rr][cc] = 2;
                }
            }
        }
        placeOne(0, 0);
        placeOne(0, size - 7);
        placeOne(size - 7, 0);
    }

    function placeAlignment(m: Uint8Array[], ver: number) {
        const positions = ALIGN[ver];
        if (!positions || positions.length < 2) return;
        for (const r of positions) {
            for (const c of positions) {
                if (m[r][c] !== 0) continue;
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const isDark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
                        m[r + dr][c + dc] = isDark ? 1 : 2;
                    }
                }
            }
        }
    }

    function placeTiming(m: Uint8Array[], size: number) {
        for (let i = 8; i < size - 8; i++) {
            if (m[6][i] === 0) m[6][i] = (i % 2 === 0) ? 1 : 2;
            if (m[i][6] === 0) m[i][6] = (i % 2 === 0) ? 1 : 2;
        }
    }

    function reserveFormatAreas(m: Uint8Array[], size: number) {
        for (let i = 0; i <= 8; i++) {
            if (m[8][i] === 0) m[8][i] = 2;
            if (m[i][8] === 0) m[i][8] = 2;
        }
        for (let i = 0; i <= 7; i++) {
            if (m[8][size - 1 - i] === 0) m[8][size - 1 - i] = 2;
        }
        for (let i = 0; i <= 7; i++) {
            if (m[size - 1 - i][8] === 0) m[size - 1 - i][8] = 2;
        }
        m[size - 8][8] = 1;
    }

    function placeVersionInfo(m: Uint8Array[], ver: number, size: number) {
        if (ver < 7) return;
        const bits = VERSION_BITS[ver];
        if (!bits) return;
        for (let i = 0; i < 18; i++) {
            const bit = (bits >> i) & 1;
            const r = Math.floor(i / 3);
            const c = size - 11 + (i % 3);
            m[r][c] = bit ? 1 : 2;
            m[c][r] = bit ? 1 : 2;
        }
    }

    function placeData(m: Uint8Array[], codewords: Uint8Array, size: number) {
        let bitIdx = 0;
        const totalBits = codewords.length * 8;
        let col = size - 1;
        while (col >= 0) {
            if (col === 6) col--;
            for (let row = 0; row < size; row++) {
                for (let dx = 0; dx <= 1; dx++) {
                    const c = col - dx;
                    const isUpward = ((size - 1 - col) >> 1) % 2 === 0;
                    const r = isUpward ? size - 1 - row : row;
                    if (c < 0 || m[r][c] !== 0) continue;
                    if (bitIdx < totalBits) {
                        const byte = codewords[bitIdx >> 3];
                        const bit = (byte >> (7 - (bitIdx & 7))) & 1;
                        m[r][c] = bit ? 3 : 4;
                        bitIdx++;
                    } else {
                        m[r][c] = 4;
                    }
                }
            }
            col -= 2;
        }
    }

    const MASKS: ((r: number, c: number) => boolean)[] = [
        (r, c) => (r + c) % 2 === 0,
        (r) => r % 2 === 0,
        (_r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
        (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
        (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
    ];

    function applyMask(m: Uint8Array[], size: number, maskIdx: number): Uint8Array[] {
        const fn = MASKS[maskIdx];
        const copy = m.map(row => row.slice());
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (copy[r][c] < 3) continue;
                const isDark = copy[r][c] === 3;
                if (fn(r, c)) copy[r][c] = isDark ? 4 : 3;
            }
        }
        return copy;
    }

    function writeFormatInfo(m: Uint8Array[], size: number, maskIdx: number) {
        const bits = FORMAT_BITS[maskIdx];
        const positions1: [number, number][] = [
            [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
            [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
        ];
        const positions2: [number, number][] = [];
        for (let i = 0; i < 7; i++) positions2.push([size - 1 - i, 8]);
        for (let i = 7; i < 15; i++) positions2.push([8, size - 15 + i]);
        for (let i = 0; i < 15; i++) {
            const bit = (bits >> (14 - i)) & 1;
            const val = bit ? 1 : 2;
            m[positions1[i][0]][positions1[i][1]] = val;
            m[positions2[i][0]][positions2[i][1]] = val;
        }
    }

    function penalty(m: Uint8Array[], size: number): number {
        let score = 0;
        const isDark = (r: number, c: number) => m[r][c] === 1 || m[r][c] === 3;
        for (let r = 0; r < size; r++) {
            let run = 1;
            for (let c = 1; c < size; c++) {
                if (isDark(r, c) === isDark(r, c - 1)) run++;
                else { if (run >= 5) score += run - 2; run = 1; }
            }
            if (run >= 5) score += run - 2;
        }
        for (let c = 0; c < size; c++) {
            let run = 1;
            for (let r = 1; r < size; r++) {
                if (isDark(r, c) === isDark(r - 1, c)) run++;
                else { if (run >= 5) score += run - 2; run = 1; }
            }
            if (run >= 5) score += run - 2;
        }
        for (let r = 0; r < size - 1; r++) {
            for (let c = 0; c < size - 1; c++) {
                const d = isDark(r, c);
                if (d === isDark(r, c + 1) && d === isDark(r + 1, c) && d === isDark(r + 1, c + 1)) score += 3;
            }
        }
        return score;
    }

    function toSvg(m: Uint8Array[], size: number): string {
        const q = 4;
        const total = size + q * 2;
        const isDark = (r: number, c: number) => m[r][c] === 1 || m[r][c] === 3;
        let paths = '';
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (isDark(r, c)) paths += 'M' + (c + q) + ',' + (r + q) + 'h1v1h-1z';
            }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
            '" shape-rendering="crispEdges">' +
            '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
            '<path d="' + paths + '" fill="#000"/></svg>';
    }

    return function qrSvg(text: string): string {
        const bytes = new TextEncoder().encode(text);
        const ver = pickVersion(bytes.length);
        if (ver === 0) return '';
        const size = VERSIONS[ver]![0];
        const data = encodeData(bytes, ver);
        const codewords = buildCodewords(data, ver);
        const m = createMatrix(ver);
        placeFinders(m, size);
        placeAlignment(m, ver);
        placeTiming(m, size);
        reserveFormatAreas(m, size);
        placeVersionInfo(m, ver, size);
        placeData(m, codewords, size);
        let bestScore = Infinity, bestMatrix: Uint8Array[] | null = null, bestMask = 0;
        for (let i = 0; i < 8; i++) {
            const masked = applyMask(m, size, i);
            writeFormatInfo(masked, size, i);
            const s = penalty(masked, size);
            if (s < bestScore) { bestScore = s; bestMask = i; bestMatrix = masked; }
        }
        writeFormatInfo(bestMatrix!, size, bestMask);
        return toSvg(bestMatrix!, size);
    };
})();

// =============================================================================
// URL GENERATION
// =============================================================================

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getActivePreset(dialog: Element): string | null {
    const active = dialog.querySelector('.share-preset.active') as HTMLElement | null;
    return active?.dataset.preset || null;
}

function buildShareUrl(state: ShareState, dialog: Element): string {
    const preset = getActivePreset(dialog);
    const theme = (dialog.querySelector('[data-opt="theme"]') as HTMLSelectElement | null)?.value || 'editorial';
    const isKiosk = preset === 'kiosk' || preset === 'minimal';

    // Kiosk mode with UUID or hash → clean URL /view/{uuid|hash}
    const viewId = state.archiveUuid || state.archiveHash;
    if (isKiosk && viewId) {
        const base = window.location.origin + '/view/' + viewId;
        const params: string[] = [];
        if (theme && theme !== 'default' && theme !== 'editorial') params.push('theme=' + theme);
        return base + (params.length ? '?' + params.join('&') : '');
    }

    // Editor mode or no hash → standard URL with params
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();

    if (state.archiveUrl) {
        params.set('archive', state.archiveUrl);
    } else {
        if (state.splatUrl) params.set('splat', state.splatUrl);
        if (state.modelUrl) params.set('model', state.modelUrl);
        if (state.pointcloudUrl) params.set('pointcloud', state.pointcloudUrl);
    }

    const mode = (dialog.querySelector('[data-opt="displayMode"]') as HTMLSelectElement | null)?.value;
    if (mode && mode !== 'both') params.set('mode', mode);

    // Always include alignment for non-archive URLs
    if (!state.archiveUrl) {
        addAlignmentParams(params, state);
    }

    return baseUrl + '?' + params.toString();
}

function addAlignmentParams(params: URLSearchParams, state: ShareState): void {
    const formatVec3 = (arr: [number, number, number]): string => arr.map(n => parseFloat(n.toFixed(4))).join(',');

    if (state.splatTransform) {
        const t = state.splatTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];
        if (pos.some(v => v !== 0)) params.set('sp', formatVec3(pos));
        if (rot.some(v => v !== 0)) params.set('sr', formatVec3(rot));
        const s = normalizeScale(t.scale);
        if (s.some(v => v !== 1)) params.set('ss', formatVec3(s));
    }

    if (state.modelTransform) {
        const t = state.modelTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];
        if (pos.some(v => v !== 0)) params.set('mp', formatVec3(pos));
        if (rot.some(v => v !== 0)) params.set('mr', formatVec3(rot));
        const s = normalizeScale(t.scale);
        if (s.some(v => v !== 1)) params.set('ms', formatVec3(s));
    }

    if (state.pointcloudTransform) {
        const t = state.pointcloudTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];
        if (pos.some(v => v !== 0)) params.set('pp', formatVec3(pos));
        if (rot.some(v => v !== 0)) params.set('pr', formatVec3(rot));
        const s = normalizeScale(t.scale);
        if (s.some(v => v !== 1)) params.set('ps', formatVec3(s));
    }
}

function buildEmbedCode(url: string, dims: { width: number; height: number; responsive: boolean }): string {
    if (dims.responsive) {
        return '<div style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden">' +
            '<iframe src="' + escapeHtml(url) + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" ' +
            'allow="fullscreen" loading="lazy"></iframe></div>';
    }
    return '<iframe src="' + escapeHtml(url) + '" width="' + dims.width + '" height="' + dims.height +
        '" style="border:0" allow="fullscreen" loading="lazy"></iframe>';
}

// =============================================================================
// PRESETS
// =============================================================================

interface PresetConfig {
    theme: string;
    kiosk: boolean;
}

const PRESETS: Record<string, PresetConfig> = {
    kiosk: { theme: 'editorial', kiosk: true },
    minimal: { theme: 'editorial', kiosk: true },
    editor: { theme: 'default', kiosk: false },
};

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Initialize the share dialog (call once on app startup).
 * Now a no-op — dialog is created on demand by showShareDialog.
 */
export function initShareDialog(): void {
    // Kept for backward compatibility with main.ts calls
}

/**
 * Show the share dialog
 */
export function showShareDialog(state: ShareState | AppState): void {
    // Validate shareable content
    if (!state.archiveUrl && !state.splatUrl && !state.modelUrl) {
        notify.warning('Cannot share: No files loaded from URL. Share links only work for files loaded via URL, not local uploads.');
        return;
    }

    currentState = state as ShareState;

    // Create backdrop + dialog
    const backdrop = document.createElement('div');
    backdrop.className = 'share-backdrop';

    backdrop.innerHTML =
        '<div class="share-dialog">' +
            '<div class="share-dialog-header">' +
                '<span class="share-dialog-title">Share' +
                    (currentState?.archiveTitle ? ' <span class="share-archive-name">' + escapeHtml(currentState.archiveTitle) + '</span>' : '') +
                '</span>' +
                '<button class="share-dialog-close" title="Close">&times;</button>' +
            '</div>' +
            '<div class="share-dialog-body">' +
                // Tabs
                '<div class="share-tabs">' +
                    '<button class="share-tab active" data-tab="link">Link</button>' +
                    '<button class="share-tab" data-tab="embed">Embed</button>' +
                '</div>' +

                // ── Link Panel ──
                '<div class="share-panel active" data-panel="link">' +
                    '<div class="share-presets">' +
                        '<button class="share-preset active" data-preset="kiosk">Kiosk</button>' +
                        '<button class="share-preset" data-preset="minimal">Minimal</button>' +
                        '<button class="share-preset" data-preset="editor">Editor</button>' +
                    '</div>' +
                    '<div class="share-grid" data-ref="theme-grid">' +
                        '<div class="share-field"><label>Theme</label>' +
                            '<select class="share-select" data-opt="theme">' +
                                '<option value="editorial">Editorial</option>' +
                                '<option value="museum">Museum</option>' +
                                '<option value="technical">Technical</option>' +
                                '<option value="default">Default</option>' +
                            '</select></div>' +
                        '<div class="share-field"><label>Display Mode</label>' +
                            '<select class="share-select" data-opt="displayMode">' +
                                '<option value="model">Model Only</option>' +
                                '<option value="both">Model/Splat</option>' +
                                '<option value="splat">Splat Only</option>' +
                                '<option value="pointcloud">Point Cloud Only</option>' +
                                '<option value="split">Split View</option>' +
                            '</select></div>' +
                    '</div>' +
                    '<div class="share-output-row">' +
                        '<input class="share-output" data-ref="url-output" readonly>' +
                        '<button class="share-copy-btn" data-ref="copy-url">Copy</button>' +
                    '</div>' +
                    '<div class="share-qr" data-ref="qr-container"></div>' +
                '</div>' +

                // ── Embed Panel ──
                '<div class="share-panel" data-panel="embed">' +
                    '<div class="embed-dims">' +
                        '<span class="embed-dim-label">Size</span>' +
                        '<input class="embed-dim-input" data-ref="embed-w" type="number" value="800" min="200" max="3840">' +
                        '<span class="embed-dim-x">&times;</span>' +
                        '<input class="embed-dim-input" data-ref="embed-h" type="number" value="450" min="200" max="2160">' +
                        '<span class="embed-dim-label">px</span>' +
                        '<label class="share-check" style="margin-left:auto"><input type="checkbox" data-ref="embed-responsive"> Responsive</label>' +
                    '</div>' +
                    '<div class="share-output-row">' +
                        '<textarea class="share-output-code" data-ref="embed-output" readonly></textarea>' +
                        '<button class="share-copy-btn" data-ref="copy-embed">Copy</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="share-dialog-footer">' +
                '<button class="share-footer-btn" data-action="close">Close</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));

    const dialog = backdrop.querySelector('.share-dialog')!;
    const urlOutput = dialog.querySelector('[data-ref="url-output"]') as HTMLInputElement;
    const qrContainer = dialog.querySelector('[data-ref="qr-container"]') as HTMLElement;
    const embedOutput = dialog.querySelector('[data-ref="embed-output"]') as HTMLTextAreaElement;
    const embedW = dialog.querySelector('[data-ref="embed-w"]') as HTMLInputElement;
    const embedH = dialog.querySelector('[data-ref="embed-h"]') as HTMLInputElement;
    const embedResponsive = dialog.querySelector('[data-ref="embed-responsive"]') as HTMLInputElement;

    function updateOutputs() {
        if (!currentState) return;
        const url = buildShareUrl(currentState, dialog);
        urlOutput.value = url;

        // QR code
        const svg = generateQR(url);
        qrContainer.innerHTML = svg || '<span style="color:var(--text-muted);font-size:10px">URL too long for QR</span>';

        // Embed code
        const dims = {
            width: parseInt(embedW.value) || 800,
            height: parseInt(embedH.value) || 450,
            responsive: embedResponsive.checked,
        };
        embedOutput.value = buildEmbedCode(url, dims);
        embedW.disabled = embedResponsive.checked;
        embedH.disabled = embedResponsive.checked;
    }

    function applyPreset(name: string) {
        const p = PRESETS[name];
        if (!p) return;
        dialog.querySelectorAll('.share-preset').forEach(b =>
            b.classList.toggle('active', (b as HTMLElement).dataset.preset === name));
        (dialog.querySelector('[data-opt="theme"]') as HTMLSelectElement).value = p.theme;
        // Show theme picker only for kiosk presets
        const themeGrid = dialog.querySelector('[data-ref="theme-grid"]') as HTMLElement | null;
        if (themeGrid) themeGrid.style.display = p.kiosk ? '' : 'none';
        updateOutputs();
    }

    // Set initial display mode from state
    if (state.displayMode) {
        (dialog.querySelector('[data-opt="displayMode"]') as HTMLSelectElement).value = state.displayMode;
    }

    // Tab switching
    dialog.querySelector('.share-tabs')!.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).closest('.share-tab') as HTMLElement | null;
        if (!tab) return;
        dialog.querySelectorAll('.share-tab').forEach(t => t.classList.remove('active'));
        dialog.querySelectorAll('.share-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        dialog.querySelector('[data-panel="' + tab.dataset.tab + '"]')?.classList.add('active');
    });

    // Presets
    dialog.querySelector('.share-presets')!.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.share-preset') as HTMLElement | null;
        if (btn) applyPreset(btn.dataset.preset || '');
    });

    // Theme change clears active preset; display mode just updates outputs
    dialog.querySelector('[data-opt="theme"]')?.addEventListener('change', () => {
        dialog.querySelectorAll('.share-preset').forEach(b => b.classList.remove('active'));
        updateOutputs();
    });
    dialog.querySelector('[data-opt="displayMode"]')?.addEventListener('change', updateOutputs);

    // Embed dimension changes
    embedW.addEventListener('input', updateOutputs);
    embedH.addEventListener('input', updateOutputs);
    embedResponsive.addEventListener('change', updateOutputs);

    // Copy buttons
    dialog.querySelector('[data-ref="copy-url"]')!.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(urlOutput.value);
            notify.success('URL copied');
        } catch { notify.error('Copy failed'); }
    });

    dialog.querySelector('[data-ref="copy-embed"]')!.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(embedOutput.value);
            notify.success('Embed code copied');
        } catch { notify.error('Copy failed'); }
    });

    // Close
    function close() {
        backdrop.classList.remove('show');
        setTimeout(() => backdrop.remove(), 150);
        currentState = null;
    }

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop || (e.target as HTMLElement).dataset.action === 'close') close();
    });
    dialog.querySelector('.share-dialog-close')!.addEventListener('click', close);
    backdrop.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Escape') close();
    });

    // Initial render — kiosk is default
    applyPreset('kiosk');
    log.info('Share dialog opened');
}

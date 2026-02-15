/**
 * Screenshot Manager Module
 *
 * Handles screenshot capture, viewfinder overlay, and screenshot list management.
 * Extracted from main.js — manages state.screenshots and state.manualPreviewBlob.
 */

import { captureScreenshot } from './archive-creator.js';
import { Logger, notify } from './utilities.js';

const log = Logger.getLogger('screenshot-manager');

/**
 * Capture a screenshot and add it to the screenshots list.
 * @param {Object} deps - { renderer, scene, camera, state }
 */
export async function captureScreenshotToList(deps) {
    const { renderer, scene, camera, state } = deps;
    if (!renderer) {
        notify.error('Renderer not ready');
        return;
    }
    try {
        renderer.render(scene, camera);
        const blob = await captureScreenshot(renderer.domElement, { width: 1024, height: 1024 });
        if (!blob) {
            notify.error('Screenshot capture failed');
            return;
        }
        const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        state.screenshots.push({
            id: Date.now(),
            blob,
            dataUrl,
            timestamp: new Date().toISOString()
        });
        renderScreenshotsList(state);
        notify.success('Screenshot captured');
    } catch (e) {
        log.error('Screenshot capture error:', e);
        notify.error('Failed to capture screenshot');
    }
}

/**
 * Show the viewfinder overlay for manual preview capture.
 */
export function showViewfinder() {
    const overlay = document.getElementById('viewfinder-overlay');
    const frame = document.getElementById('viewfinder-frame');
    const controls = document.getElementById('viewfinder-controls');
    const dim = document.getElementById('viewfinder-dim');
    if (!overlay || !frame || !controls) return;

    const container = document.getElementById('viewer-container');
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const size = Math.min(cw, ch) * 0.8;
    const left = (cw - size) / 2;
    const top = (ch - size) / 2;

    // Hide the dim layer — the frame's box-shadow creates the dimming effect
    if (dim) dim.style.display = 'none';

    frame.style.left = left + 'px';
    frame.style.top = top + 'px';
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';

    controls.style.top = (top + size + 15) + 'px';

    overlay.classList.remove('hidden');
}

/**
 * Hide the viewfinder overlay.
 */
export function hideViewfinder() {
    const overlay = document.getElementById('viewfinder-overlay');
    if (overlay) overlay.classList.add('hidden');
}

/**
 * Capture a manual preview image and store it in state.
 * @param {Object} deps - { renderer, scene, camera, state }
 */
export async function captureManualPreview(deps) {
    const { renderer, scene, camera, state } = deps;
    if (!renderer) return;
    try {
        renderer.render(scene, camera);
        const blob = await captureScreenshot(renderer.domElement, { width: 512, height: 512 });
        if (blob) {
            state.manualPreviewBlob = blob;
            hideViewfinder();
            const status = document.getElementById('manual-preview-status');
            if (status) status.style.display = '';
            notify.success('Manual preview captured');
        }
    } catch (e) {
        log.error('Manual preview capture error:', e);
        notify.error('Failed to capture preview');
    }
}

/**
 * Render the screenshots list in the DOM.
 * @param {Object} state - App state with screenshots array
 */
export function renderScreenshotsList(state) {
    const list = document.getElementById('screenshots-list');
    if (!list) return;
    list.innerHTML = '';

    if (state.screenshots.length === 0) return;

    state.screenshots.forEach((shot) => {
        const item = document.createElement('div');
        item.className = 'screenshot-item';

        const img = document.createElement('img');
        img.src = shot.dataUrl;
        img.alt = 'Screenshot';
        item.appendChild(img);

        const del = document.createElement('button');
        del.className = 'screenshot-delete';
        del.textContent = '\u00D7';
        del.title = 'Remove screenshot';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            removeScreenshot(shot.id, state);
        });
        item.appendChild(del);

        list.appendChild(item);
    });
}

/**
 * Remove a screenshot by ID from state and re-render the list.
 * @param {number} id - Screenshot ID
 * @param {Object} state - App state with screenshots array
 */
export function removeScreenshot(id, state) {
    state.screenshots = state.screenshots.filter(s => s.id !== id);
    renderScreenshotsList(state);
}

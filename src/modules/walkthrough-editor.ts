/**
 * Walkthrough Editor — Props Pane UI
 *
 * Manages the stop list, inline editor, and drag-to-reorder
 * in the walkthrough properties pane.
 */

import { Logger } from './logger.js';
import { WALKTHROUGH } from './constants.js';
import type { Walkthrough, WalkthroughTransition } from '../types.js';

const log = Logger.getLogger('walkthrough-editor');

// =============================================================================
// DEPS
// =============================================================================

export interface WalkthroughEditorDeps {
    getAnnotations: () => Array<{ id: string; title: string }>;
}

// =============================================================================
// STATE
// =============================================================================

let editorDeps: WalkthroughEditorDeps | null = null;
let selectedStopIndex = -1;

/** The working walkthrough data — mutated in place by the editor. */
let walkthrough: Walkthrough = {
    title: 'Building Tour',
    stops: [],
    auto_play: true,
    loop: false,
};

// =============================================================================
// INIT
// =============================================================================

export function initWalkthroughEditor(deps: WalkthroughEditorDeps): void {
    editorDeps = deps;
    wireSettingsFields();
    wireStopEditorFields();
    log.info('Walkthrough editor initialized');
}

// =============================================================================
// PUBLIC DATA ACCESS
// =============================================================================

export function getWalkthroughData(): Walkthrough {
    syncSettingsFromDOM();
    return walkthrough;
}

export function setWalkthroughData(wt: Walkthrough): void {
    walkthrough = wt;
    syncSettingsToDOM();
    renderStopList();
}

// =============================================================================
// SETTINGS — title, auto_play, loop
// =============================================================================

function wireSettingsFields(): void {
    const titleInput = document.getElementById('walkthrough-title') as HTMLInputElement | null;
    const autoPlayCb = document.getElementById('walkthrough-auto-play') as HTMLInputElement | null;
    const loopCb = document.getElementById('walkthrough-loop') as HTMLInputElement | null;

    titleInput?.addEventListener('change', () => {
        walkthrough.title = titleInput.value || 'Walkthrough';
    });
    autoPlayCb?.addEventListener('change', () => {
        walkthrough.auto_play = autoPlayCb.checked;
    });
    loopCb?.addEventListener('change', () => {
        walkthrough.loop = loopCb.checked;
    });
}

function syncSettingsFromDOM(): void {
    const titleInput = document.getElementById('walkthrough-title') as HTMLInputElement | null;
    const autoPlayCb = document.getElementById('walkthrough-auto-play') as HTMLInputElement | null;
    const loopCb = document.getElementById('walkthrough-loop') as HTMLInputElement | null;

    if (titleInput) walkthrough.title = titleInput.value || 'Walkthrough';
    if (autoPlayCb) walkthrough.auto_play = autoPlayCb.checked;
    if (loopCb) walkthrough.loop = loopCb.checked;
}

function syncSettingsToDOM(): void {
    const titleInput = document.getElementById('walkthrough-title') as HTMLInputElement | null;
    const autoPlayCb = document.getElementById('walkthrough-auto-play') as HTMLInputElement | null;
    const loopCb = document.getElementById('walkthrough-loop') as HTMLInputElement | null;

    if (titleInput) titleInput.value = walkthrough.title || 'Walkthrough';
    if (autoPlayCb) autoPlayCb.checked = walkthrough.auto_play !== false;
    if (loopCb) loopCb.checked = walkthrough.loop === true;
}

// =============================================================================
// STOP LIST RENDERING
// =============================================================================

export function renderStopList(): void {
    const container = document.getElementById('walkthrough-stop-list');
    const countEl = document.getElementById('wt-stop-count');
    if (!container) return;

    if (countEl) {
        countEl.textContent = walkthrough.stops.length > 0 ? `${walkthrough.stops.length}` : '';
    }

    if (walkthrough.stops.length === 0) {
        container.innerHTML = '<p style="font-size:11px; color:var(--text-muted); margin:4px 0;">No stops yet. Position your camera and click "+ Add Stop".</p>';
        hideStopEditor();
        return;
    }

    container.innerHTML = walkthrough.stops.map((stop, i) => `
        <div class="wt-stop-item${i === selectedStopIndex ? ' selected' : ''}" data-index="${i}" draggable="true">
            <span class="wt-stop-badge">${i + 1}</span>
            <div class="wt-stop-info">
                <span class="wt-stop-name">${escapeHtml(stop.title || 'Untitled')}</span>
                <span class="wt-stop-meta">${stop.transition}${stop.annotation_id ? ' \u00b7 linked' : ''}</span>
            </div>
            <span class="wt-stop-drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
        </div>
    `).join('');

    // Wire click handlers
    container.querySelectorAll('.wt-stop-item').forEach((el) => {
        el.addEventListener('click', () => {
            const idx = parseInt((el as HTMLElement).dataset.index || '0', 10);
            selectStop(idx);
        });
    });

    // Wire drag-to-reorder
    wireDragReorder(container);
}

// =============================================================================
// STOP SELECTION + INLINE EDITOR
// =============================================================================

export function selectStop(index: number): void {
    if (index < 0 || index >= walkthrough.stops.length) {
        hideStopEditor();
        return;
    }

    selectedStopIndex = index;
    const stop = walkthrough.stops[index];

    // Highlight in list
    document.querySelectorAll('.wt-stop-item').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });

    // Populate inline editor
    const editor = document.getElementById('walkthrough-stop-editor');
    if (!editor) return;
    editor.classList.remove('hidden');

    (document.getElementById('wt-stop-title') as HTMLInputElement).value = stop.title || '';
    (document.getElementById('wt-stop-description') as HTMLTextAreaElement).value = stop.description || '';
    (document.getElementById('wt-stop-transition') as HTMLSelectElement).value = stop.transition;
    (document.getElementById('wt-stop-fly-duration') as HTMLInputElement).value = String(stop.fly_duration ?? WALKTHROUGH.DEFAULT_FLY_DURATION);
    (document.getElementById('wt-stop-fade-duration') as HTMLInputElement).value = String(stop.fade_duration ?? WALKTHROUGH.DEFAULT_FADE_DURATION);
    (document.getElementById('wt-stop-dwell') as HTMLInputElement).value = String(stop.dwell_time);

    // Show/hide duration rows based on transition type
    updateDurationRowVisibility(stop.transition);

    // Populate annotation dropdown
    populateAnnotationDropdown(stop.annotation_id);
}

function hideStopEditor(): void {
    selectedStopIndex = -1;
    const editor = document.getElementById('walkthrough-stop-editor');
    if (editor) editor.classList.add('hidden');
}

function updateDurationRowVisibility(transition: WalkthroughTransition): void {
    const flyRow = document.getElementById('wt-fly-duration-row');
    const fadeRow = document.getElementById('wt-fade-duration-row');
    if (flyRow) flyRow.classList.toggle('hidden', transition !== 'fly');
    if (fadeRow) fadeRow.classList.toggle('hidden', transition !== 'fade');
}

function populateAnnotationDropdown(currentAnnotationId?: string): void {
    const select = document.getElementById('wt-stop-annotation') as HTMLSelectElement | null;
    if (!select || !editorDeps) return;

    const annotations = editorDeps.getAnnotations();
    select.innerHTML = '<option value="">None</option>';
    for (const anno of annotations) {
        const opt = document.createElement('option');
        opt.value = anno.id;
        opt.textContent = `${anno.id}: ${anno.title}`;
        if (anno.id === currentAnnotationId) opt.selected = true;
        select.appendChild(opt);
    }
}

// =============================================================================
// STOP EDITOR FIELD WIRING
// =============================================================================

function wireStopEditorFields(): void {
    const titleInput = document.getElementById('wt-stop-title') as HTMLInputElement;
    const descInput = document.getElementById('wt-stop-description') as HTMLTextAreaElement;
    const transSelect = document.getElementById('wt-stop-transition') as HTMLSelectElement;
    const flyDurInput = document.getElementById('wt-stop-fly-duration') as HTMLInputElement;
    const fadeDurInput = document.getElementById('wt-stop-fade-duration') as HTMLInputElement;
    const dwellInput = document.getElementById('wt-stop-dwell') as HTMLInputElement;
    const annoSelect = document.getElementById('wt-stop-annotation') as HTMLSelectElement;

    titleInput?.addEventListener('change', () => {
        if (selectedStopIndex < 0) return;
        walkthrough.stops[selectedStopIndex].title = titleInput.value;
        renderStopList();
    });

    descInput?.addEventListener('change', () => {
        if (selectedStopIndex < 0) return;
        walkthrough.stops[selectedStopIndex].description = descInput.value || undefined;
    });

    transSelect?.addEventListener('change', () => {
        if (selectedStopIndex < 0) return;
        const val = transSelect.value as WalkthroughTransition;
        walkthrough.stops[selectedStopIndex].transition = val;
        updateDurationRowVisibility(val);
        renderStopList();
    });

    flyDurInput?.addEventListener('change', () => {
        if (selectedStopIndex < 0) return;
        walkthrough.stops[selectedStopIndex].fly_duration = parseInt(flyDurInput.value, 10) || WALKTHROUGH.DEFAULT_FLY_DURATION;
    });

    fadeDurInput?.addEventListener('change', () => {
        if (selectedStopIndex < 0) return;
        walkthrough.stops[selectedStopIndex].fade_duration = parseInt(fadeDurInput.value, 10) || WALKTHROUGH.DEFAULT_FADE_DURATION;
    });

    dwellInput?.addEventListener('change', () => {
        if (selectedStopIndex < 0) return;
        walkthrough.stops[selectedStopIndex].dwell_time = parseInt(dwellInput.value, 10) || 0;
    });

    annoSelect?.addEventListener('change', () => {
        if (selectedStopIndex < 0) return;
        walkthrough.stops[selectedStopIndex].annotation_id = annoSelect.value || undefined;
        renderStopList();
    });
}

// =============================================================================
// STOP ACTIONS
// =============================================================================

export function deleteSelectedStop(): void {
    if (selectedStopIndex < 0 || selectedStopIndex >= walkthrough.stops.length) return;
    walkthrough.stops.splice(selectedStopIndex, 1);
    selectedStopIndex = -1;
    hideStopEditor();
    renderStopList();
    log.info('Deleted stop');
}

export function updateSelectedStopCamera(camera: any, controls: any): void {
    if (selectedStopIndex < 0 || selectedStopIndex >= walkthrough.stops.length) return;
    const stop = walkthrough.stops[selectedStopIndex];
    stop.camera_position = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    stop.camera_target = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    stop.camera_quaternion = { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w };
    log.info(`Updated camera for stop ${selectedStopIndex + 1}`);
}

// =============================================================================
// DRAG-TO-REORDER
// =============================================================================

function wireDragReorder(container: HTMLElement): void {
    let dragIndex = -1;

    container.querySelectorAll('.wt-stop-item').forEach((el) => {
        const htmlEl = el as HTMLElement;

        htmlEl.addEventListener('dragstart', (e) => {
            dragIndex = parseInt(htmlEl.dataset.index || '0', 10);
            htmlEl.classList.add('dragging');
            if (e instanceof DragEvent && e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        htmlEl.addEventListener('dragend', () => {
            htmlEl.classList.remove('dragging');
            container.querySelectorAll('.wt-stop-item').forEach(el2 => el2.classList.remove('drag-over'));
        });

        htmlEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e instanceof DragEvent && e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            container.querySelectorAll('.wt-stop-item').forEach(el2 => el2.classList.remove('drag-over'));
            htmlEl.classList.add('drag-over');
        });

        htmlEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const dropIndex = parseInt(htmlEl.dataset.index || '0', 10);
            if (dragIndex !== dropIndex && dragIndex >= 0) {
                reorderStop(dragIndex, dropIndex);
            }
        });
    });
}

function reorderStop(fromIndex: number, toIndex: number): void {
    const [moved] = walkthrough.stops.splice(fromIndex, 1);
    walkthrough.stops.splice(toIndex, 0, moved);

    // Adjust selected index
    if (selectedStopIndex === fromIndex) {
        selectedStopIndex = toIndex;
    } else if (fromIndex < selectedStopIndex && toIndex >= selectedStopIndex) {
        selectedStopIndex--;
    } else if (fromIndex > selectedStopIndex && toIndex <= selectedStopIndex) {
        selectedStopIndex++;
    }

    renderStopList();
    log.info(`Reordered stop ${fromIndex + 1} → ${toIndex + 1}`);
}

// =============================================================================
// UTILITIES
// =============================================================================

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Walkthrough Controller — Thin Orchestration Layer
 *
 * Bridges walkthrough-editor.ts and walkthrough-engine.ts with main.ts
 * via the deps pattern. Handles preview playback in the editor.
 */

import { Logger } from './logger.js';
import { WALKTHROUGH } from './constants.js';
import { WalkthroughEngine } from './walkthrough-engine.js';
import type { WalkthroughCallbacks } from './walkthrough-engine.js';
import type { Walkthrough, WalkthroughStop } from '../types.js';
import {
    initWalkthroughEditor,
    getWalkthroughData,
    setWalkthroughData,
    selectStop as editorSelectStop,
    renderStopList,
    deleteSelectedStop as editorDeleteStop,
    updateSelectedStopCamera as editorUpdateCamera,
} from './walkthrough-editor.js';

const log = Logger.getLogger('walkthrough-controller');

// =============================================================================
// DEPS INTERFACE
// =============================================================================

export interface WalkthroughControllerDeps {
    camera: any;            // THREE.PerspectiveCamera
    controls: any;          // OrbitControls
    annotationSystem: any;  // AnnotationSystem | null
    getAnnotations: () => Array<{ id: string; title: string }>;
}

// =============================================================================
// MODULE STATE
// =============================================================================

let deps: WalkthroughControllerDeps | null = null;
let previewEngine: WalkthroughEngine | null = null;
let previewAnimating = false;

/** True when the walkthrough preview is playing in the editor. */
export function isPreviewAnimating(): boolean {
    return previewAnimating;
}

// =============================================================================
// INIT
// =============================================================================

export function initWalkthroughController(d: WalkthroughControllerDeps): void {
    deps = d;
    initWalkthroughEditor({
        getAnnotations: d.getAnnotations,
    });
    log.info('Walkthrough controller initialized');
}

// =============================================================================
// PUBLIC API — called from event-wiring / main.ts
// =============================================================================

export function addStop(): void {
    if (!deps) return;
    const cam = deps.camera;
    const ctrl = deps.controls;

    const wt = getWalkthroughData();
    const stopNum = wt.stops.length + 1;

    const stop: WalkthroughStop = {
        id: `stop_${Date.now()}`,
        title: `Stop ${stopNum}`,
        camera_position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        camera_target: { x: ctrl.target.x, y: ctrl.target.y, z: ctrl.target.z },
        camera_quaternion: { x: cam.quaternion.x, y: cam.quaternion.y, z: cam.quaternion.z, w: cam.quaternion.w },
        transition: WALKTHROUGH.DEFAULT_TRANSITION,
        fly_duration: WALKTHROUGH.DEFAULT_FLY_DURATION,
        dwell_time: WALKTHROUGH.DEFAULT_DWELL_TIME,
    };

    wt.stops.push(stop);
    setWalkthroughData(wt);
    renderStopList();
    editorSelectStop(wt.stops.length - 1);
    log.info(`Added stop ${stop.id}: "${stop.title}"`);
}

export function addStopFromAnnotation(): void {
    if (!deps) return;

    const annotations = deps.getAnnotations();
    if (annotations.length === 0) {
        log.warn('No annotations available to create stop from');
        return;
    }

    // Show a selection UI — populate the annotation dropdown and let the editor handle it
    // For now, use the first unlinked annotation or show a prompt
    const wt = getWalkthroughData();
    const linkedIds = new Set(wt.stops.filter(s => s.annotation_id).map(s => s.annotation_id));
    const available = annotations.filter(a => !linkedIds.has(a.id));

    if (available.length === 0) {
        log.info('All annotations are already linked to stops');
        return;
    }

    // Use the annotation dropdown in the stop editor
    // First add a stop from current camera, then let user pick annotation in the editor
    addStop();
    // The editor will show the stop editor with the annotation dropdown
}

export function deleteStop(): void {
    editorDeleteStop();
}

export function updateStopCamera(): void {
    if (!deps) return;
    editorUpdateCamera(deps.camera, deps.controls);
}

export function playPreview(): void {
    if (!deps) return;
    const wt = getWalkthroughData();
    if (wt.stops.length === 0) {
        log.warn('No stops to preview');
        return;
    }

    stopPreview(); // clean up any existing preview

    const fadeEl = document.getElementById('walkthrough-fade-overlay');

    const callbacks: WalkthroughCallbacks = {
        flyCamera(endPos, endTarget, duration, onComplete) {
            if (!deps) { onComplete(); return; }
            previewAnimating = true;
            const cam = deps.camera;
            const ctrl = deps.controls;
            const startPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
            const startTarget = { x: ctrl.target.x, y: ctrl.target.y, z: ctrl.target.z };
            const startTime = performance.now();

            function step() {
                const elapsed = performance.now() - startTime;
                const t = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic

                cam.position.set(
                    startPos.x + (endPos.x - startPos.x) * eased,
                    startPos.y + (endPos.y - startPos.y) * eased,
                    startPos.z + (endPos.z - startPos.z) * eased
                );
                ctrl.target.set(
                    startTarget.x + (endTarget.x - startTarget.x) * eased,
                    startTarget.y + (endTarget.y - startTarget.y) * eased,
                    startTarget.z + (endTarget.z - startTarget.z) * eased
                );

                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    previewAnimating = false;
                    onComplete();
                }
            }
            requestAnimationFrame(step);
        },

        fadeOut(duration, onComplete) {
            if (!fadeEl) { onComplete(); return; }
            fadeEl.style.transition = `opacity ${duration}ms ease`;
            fadeEl.style.opacity = '1';
            fadeEl.style.pointerEvents = 'auto';
            setTimeout(onComplete, duration);
        },

        fadeIn(duration, onComplete) {
            if (!fadeEl) { onComplete(); return; }
            fadeEl.style.transition = `opacity ${duration}ms ease`;
            fadeEl.style.opacity = '0';
            fadeEl.style.pointerEvents = 'none';
            setTimeout(onComplete, duration);
        },

        setCameraImmediate(pos, target) {
            if (!deps) return;
            deps.camera.position.set(pos.x, pos.y, pos.z);
            deps.controls.target.set(target.x, target.y, target.z);
            deps.controls.update();
        },

        showAnnotation(annotationId) {
            deps?.annotationSystem?.goToAnnotation?.(annotationId, 0); // instant
        },

        hideAnnotation() {
            // Deselect annotation
            if (deps?.annotationSystem?.selectedAnnotation) {
                deps.annotationSystem.selectedAnnotation = null;
            }
            const popup = document.getElementById('annotation-info-popup');
            if (popup) popup.classList.add('hidden');
        },

        onStopChange(stopIndex, _stop) {
            editorSelectStop(stopIndex);
        },

        onStateChange(state) {
            const playBtn = document.getElementById('btn-wt-preview');
            const stopBtn = document.getElementById('btn-wt-stop-preview');
            if (playBtn && stopBtn) {
                const isActive = state !== 'idle';
                playBtn.classList.toggle('hidden', isActive);
                stopBtn.classList.toggle('hidden', !isActive);
            }
        },

        onComplete() {
            previewAnimating = false;
            const playBtn = document.getElementById('btn-wt-preview');
            const stopBtn = document.getElementById('btn-wt-stop-preview');
            if (playBtn) playBtn.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.add('hidden');
            log.info('Preview complete');
        },
    };

    previewEngine = new WalkthroughEngine(callbacks);
    previewEngine.load(wt);
    previewEngine.play();
    log.info('Preview started');
}

export function stopPreview(): void {
    if (previewEngine) {
        previewEngine.stop();
        previewEngine = null;
    }
    previewAnimating = false;

    // Reset fade overlay
    const fadeEl = document.getElementById('walkthrough-fade-overlay');
    if (fadeEl) {
        fadeEl.style.opacity = '0';
        fadeEl.style.pointerEvents = 'none';
    }
}

// =============================================================================
// ARCHIVE BRIDGE
// =============================================================================

export function captureWalkthroughForArchive(): Walkthrough | null {
    const wt = getWalkthroughData();
    if (wt.stops.length === 0) return null;
    return wt;
}

export function loadWalkthroughFromArchive(data: Walkthrough | null): void {
    if (data && data.stops.length > 0) {
        setWalkthroughData(data);
        renderStopList();
        log.info(`Loaded walkthrough "${data.title}" with ${data.stops.length} stops`);
    }
}

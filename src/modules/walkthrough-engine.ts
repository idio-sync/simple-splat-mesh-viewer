/**
 * Walkthrough Engine — Core Playback State Machine
 *
 * Pure logic, zero DOM / Three.js dependencies. All side effects happen
 * through the callbacks interface injected by the host (main.ts or kiosk-main.ts).
 * Shared between editor preview and kiosk playback.
 */

import { WALKTHROUGH } from './constants.js';
import type { Walkthrough, WalkthroughStop, WalkthroughTransition } from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

export type WalkthroughPlaybackState = 'idle' | 'transitioning' | 'dwelling' | 'paused';

export interface Vec3 {
    x: number; y: number; z: number;
}

export interface WalkthroughCallbacks {
    /** Animate camera from current position to target. MUST call onComplete when done. */
    flyCamera(endPos: Vec3, endTarget: Vec3, duration: number, onComplete: () => void): void;
    /** Fade viewport to black. MUST call onComplete when fully opaque. */
    fadeOut(duration: number, onComplete: () => void): void;
    /** Fade viewport from black to transparent. MUST call onComplete when fully transparent. */
    fadeIn(duration: number, onComplete: () => void): void;
    /** Instantly set camera position + target (used after fade-out and for 'cut'). */
    setCameraImmediate(pos: Vec3, target: Vec3): void;
    /** Show annotation marker + popup for the given ID. */
    showAnnotation?(annotationId: string): void;
    /** Hide any currently shown annotation popup. */
    hideAnnotation?(): void;
    /** Called when the current stop changes (for UI updates). */
    onStopChange(stopIndex: number, stop: WalkthroughStop): void;
    /** Called when playback state changes (for play/pause button sync). */
    onStateChange(state: WalkthroughPlaybackState): void;
    /** Called when walkthrough completes (reached end without loop, or stopped). */
    onComplete(): void;
}

// =============================================================================
// ENGINE
// =============================================================================

export class WalkthroughEngine {
    private _walkthrough: Walkthrough | null = null;
    private _callbacks: WalkthroughCallbacks;
    private _state: WalkthroughPlaybackState = 'idle';
    private _currentIndex = -1;
    private _dwellTimer = 0;
    private _pausedRemainingDwell = 0;
    private _pauseAfterTransition = false;
    private _reducedMotion = false;

    constructor(callbacks: WalkthroughCallbacks) {
        this._callbacks = callbacks;
        // Detect reduced motion preference
        if (typeof window !== 'undefined' && window.matchMedia) {
            this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }
    }

    // =========================================================================
    // PUBLIC API — Getters
    // =========================================================================

    get state(): WalkthroughPlaybackState { return this._state; }
    get currentIndex(): number { return this._currentIndex; }
    get currentStop(): WalkthroughStop | null {
        if (!this._walkthrough || this._currentIndex < 0) return null;
        return this._walkthrough.stops[this._currentIndex] ?? null;
    }
    get stopCount(): number { return this._walkthrough?.stops.length ?? 0; }
    get isPlaying(): boolean { return this._state === 'transitioning' || this._state === 'dwelling'; }
    get walkthrough(): Walkthrough | null { return this._walkthrough; }

    // =========================================================================
    // PUBLIC API — Actions
    // =========================================================================

    load(walkthrough: Walkthrough): void {
        this.stop();
        this._walkthrough = walkthrough;
        this._currentIndex = -1;
    }

    play(fromIndex = 0): void {
        if (!this._walkthrough || this._walkthrough.stops.length === 0) return;
        const idx = Math.max(0, Math.min(fromIndex, this._walkthrough.stops.length - 1));
        this._pauseAfterTransition = false;
        this._transitionToStop(idx);
    }

    pause(): void {
        if (this._state === 'dwelling') {
            // Save remaining dwell time
            this._cancelDwell();
            this._setState('paused');
        } else if (this._state === 'transitioning') {
            // Can't interrupt mid-fly/fade — mark to pause once transition completes
            this._pauseAfterTransition = true;
        }
    }

    resume(): void {
        if (this._state !== 'paused') return;
        this._pauseAfterTransition = false;
        if (this._pausedRemainingDwell > 0) {
            // Resume dwell with remaining time
            this._setState('dwelling');
            this._startDwellTimer(this._pausedRemainingDwell);
            this._pausedRemainingDwell = 0;
        } else {
            // Advance to next stop
            this._advanceOrComplete();
        }
    }

    stop(): void {
        this._cancelDwell();
        this._pauseAfterTransition = false;
        this._pausedRemainingDwell = 0;
        if (this._state !== 'idle') {
            this._setState('idle');
            this._callbacks.hideAnnotation?.();
            this._callbacks.onComplete();
        }
    }

    next(): void {
        if (!this._walkthrough || this._walkthrough.stops.length === 0) return;
        this._cancelDwell();
        this._pauseAfterTransition = false;
        this._pausedRemainingDwell = 0;
        const nextIdx = this._currentIndex + 1;
        if (nextIdx < this._walkthrough.stops.length) {
            this._transitionToStop(nextIdx);
        } else if (this._walkthrough.loop) {
            this._transitionToStop(0);
        }
        // else: at the end, no loop — do nothing
    }

    prev(): void {
        if (!this._walkthrough || this._walkthrough.stops.length === 0) return;
        this._cancelDwell();
        this._pauseAfterTransition = false;
        this._pausedRemainingDwell = 0;
        const prevIdx = this._currentIndex - 1;
        if (prevIdx >= 0) {
            this._transitionToStop(prevIdx);
        } else if (this._walkthrough.loop) {
            this._transitionToStop(this._walkthrough.stops.length - 1);
        }
        // else: at the start, no loop — do nothing
    }

    goToStop(index: number): void {
        if (!this._walkthrough || index < 0 || index >= this._walkthrough.stops.length) return;
        this._cancelDwell();
        this._pauseAfterTransition = false;
        this._pausedRemainingDwell = 0;
        this._transitionToStop(index);
    }

    // =========================================================================
    // PRIVATE — State Management
    // =========================================================================

    private _setState(newState: WalkthroughPlaybackState): void {
        if (this._state === newState) return;
        this._state = newState;
        this._callbacks.onStateChange(newState);
    }

    // =========================================================================
    // PRIVATE — Transition Logic
    // =========================================================================

    private _transitionToStop(index: number): void {
        if (!this._walkthrough) return;
        const stop = this._walkthrough.stops[index];
        if (!stop) return;

        // Hide annotation from previous stop
        this._callbacks.hideAnnotation?.();

        this._currentIndex = index;
        this._callbacks.onStopChange(index, stop);
        this._setState('transitioning');

        // Determine effective transition type
        let transition: WalkthroughTransition = stop.transition;
        if (this._reducedMotion && transition === 'fly') {
            transition = 'cut';
        }

        const onTransitionDone = () => {
            // Show linked annotation after arriving
            if (stop.annotation_id) {
                this._callbacks.showAnnotation?.(stop.annotation_id);
            }

            // Check if we should pause instead of dwelling
            if (this._pauseAfterTransition) {
                this._pauseAfterTransition = false;
                this._pausedRemainingDwell = stop.dwell_time;
                this._setState('paused');
                return;
            }

            this._startDwell(stop);
        };

        this._executeTransition(transition, stop, onTransitionDone);
    }

    private _executeTransition(
        transition: WalkthroughTransition,
        stop: WalkthroughStop,
        onDone: () => void
    ): void {
        switch (transition) {
            case 'fly': {
                const duration = stop.fly_duration ?? WALKTHROUGH.DEFAULT_FLY_DURATION;
                this._callbacks.flyCamera(
                    stop.camera_position,
                    stop.camera_target,
                    duration,
                    onDone
                );
                break;
            }

            case 'fade': {
                const fadeDuration = stop.fade_duration ?? WALKTHROUGH.DEFAULT_FADE_DURATION;
                this._callbacks.fadeOut(fadeDuration, () => {
                    // Teleport while screen is black
                    this._callbacks.setCameraImmediate(stop.camera_position, stop.camera_target);
                    this._callbacks.fadeIn(fadeDuration, onDone);
                });
                break;
            }

            case 'cut':
                this._callbacks.setCameraImmediate(stop.camera_position, stop.camera_target);
                onDone();
                break;
        }
    }

    // =========================================================================
    // PRIVATE — Dwell Logic
    // =========================================================================

    private _startDwell(stop: WalkthroughStop): void {
        if (stop.dwell_time <= 0) {
            // Manual advance only — pause and wait
            this._pausedRemainingDwell = 0;
            this._setState('paused');
            return;
        }

        this._setState('dwelling');
        this._startDwellTimer(stop.dwell_time);
    }

    private _startDwellTimer(duration: number): void {
        const dwellStart = performance.now();
        this._pausedRemainingDwell = duration;

        this._dwellTimer = window.setTimeout(() => {
            this._dwellTimer = 0;
            this._pausedRemainingDwell = 0;
            this._advanceOrComplete();
        }, duration);

        // Track remaining time for pause/resume
        const trackRemaining = () => {
            if (this._state === 'dwelling' && this._dwellTimer !== 0) {
                this._pausedRemainingDwell = Math.max(0, duration - (performance.now() - dwellStart));
            }
        };
        // Update remaining time periodically for accurate pause
        const interval = window.setInterval(() => {
            trackRemaining();
            if (this._state !== 'dwelling') {
                clearInterval(interval);
            }
        }, 100);
    }

    private _cancelDwell(): void {
        if (this._dwellTimer) {
            clearTimeout(this._dwellTimer);
            this._dwellTimer = 0;
        }
    }

    private _advanceOrComplete(): void {
        if (!this._walkthrough) return;

        const nextIdx = this._currentIndex + 1;
        if (nextIdx < this._walkthrough.stops.length) {
            this._transitionToStop(nextIdx);
        } else if (this._walkthrough.loop) {
            this._transitionToStop(0);
        } else {
            // Walkthrough complete
            this._setState('idle');
            this._callbacks.onComplete();
        }
    }
}

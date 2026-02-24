/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WalkthroughEngine } from '../walkthrough-engine.js';
import type { WalkthroughCallbacks, WalkthroughPlaybackState } from '../walkthrough-engine.js';
import type { Walkthrough } from '../../types.js';

// =============================================================================
// HELPERS
// =============================================================================

function createMockCallbacks(): WalkthroughCallbacks {
    return {
        flyCamera: vi.fn((_pos, _target, _dur, onComplete) => { onComplete(); }),
        fadeOut: vi.fn((_dur, onComplete) => { onComplete(); }),
        fadeIn: vi.fn((_dur, onComplete) => { onComplete(); }),
        setCameraImmediate: vi.fn(),
        showAnnotation: vi.fn(),
        hideAnnotation: vi.fn(),
        onStopChange: vi.fn(),
        onStateChange: vi.fn(),
        onComplete: vi.fn(),
    };
}

function createTestWalkthrough(overrides?: Partial<Walkthrough>): Walkthrough {
    return {
        title: 'Test Tour',
        stops: [
            {
                id: 'stop_1',
                title: 'First',
                transition: 'fly',
                dwell_time: 3000,
                camera_position: { x: 0, y: 0, z: 10 },
                camera_target: { x: 0, y: 0, z: 0 },
            },
            {
                id: 'stop_2',
                title: 'Second',
                transition: 'fade',
                dwell_time: 2000,
                camera_position: { x: 5, y: 2, z: 0 },
                camera_target: { x: 0, y: 0, z: 0 },
                annotation_id: 'anno_1',
            },
            {
                id: 'stop_3',
                title: 'Third',
                transition: 'cut',
                dwell_time: 0,
                camera_position: { x: -5, y: 3, z: 5 },
                camera_target: { x: 0, y: 1, z: 0 },
            },
        ],
        ...overrides,
    };
}

// =============================================================================
// BASIC LIFECYCLE
// =============================================================================

describe('WalkthroughEngine — basic lifecycle', () => {
    let cb: WalkthroughCallbacks;
    let engine: WalkthroughEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        cb = createMockCallbacks();
        engine = new WalkthroughEngine(cb);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts in idle state with no walkthrough loaded', () => {
        expect(engine.state).toBe('idle');
        expect(engine.walkthrough).toBeNull();
        expect(engine.currentIndex).toBe(-1);
        expect(engine.currentStop).toBeNull();
        expect(engine.stopCount).toBe(0);
    });

    it('load() sets the walkthrough and resets state to idle', () => {
        const wt = createTestWalkthrough();
        engine.load(wt);

        expect(engine.walkthrough).toBe(wt);
        expect(engine.state).toBe('idle');
        expect(engine.currentIndex).toBe(-1);
        expect(engine.stopCount).toBe(3);
    });

    it('load() on a playing engine stops first', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        // Advance past dwell for stop 1
        vi.advanceTimersByTime(3000);

        const wt2 = createTestWalkthrough({ title: 'Tour 2' });
        engine.load(wt2);

        expect(engine.state).toBe('idle');
        expect(engine.walkthrough).toBe(wt2);
        expect(engine.currentIndex).toBe(-1);
    });

    it('play() transitions to first stop', () => {
        engine.load(createTestWalkthrough());
        engine.play();

        expect(engine.currentIndex).toBe(0);
        expect(engine.state).toBe('dwelling');
    });

    it('play() with empty walkthrough does nothing', () => {
        engine.load(createTestWalkthrough({ stops: [] }));
        engine.play();

        expect(engine.state).toBe('idle');
        expect(engine.currentIndex).toBe(-1);
    });

    it('play() without any walkthrough loaded does nothing', () => {
        engine.play();

        expect(engine.state).toBe('idle');
        expect(cb.flyCamera).not.toHaveBeenCalled();
    });

    it('stop() from dwelling returns to idle and calls onComplete', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        expect(engine.state).toBe('dwelling');

        engine.stop();

        expect(engine.state).toBe('idle');
        expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('stop() from idle does not call onComplete again', () => {
        engine.load(createTestWalkthrough());
        engine.stop(); // already idle

        expect(cb.onComplete).not.toHaveBeenCalled();
    });

    it('isPlaying returns true during transitioning and dwelling', () => {
        // Freeze flyCamera so transition doesn't complete immediately
        (cb.flyCamera as ReturnType<typeof vi.fn>).mockImplementation(() => {
            // never calls onComplete
        });
        engine.load(createTestWalkthrough());
        engine.play();

        // flyCamera was called but onComplete not yet — should be transitioning
        expect(engine.state).toBe('transitioning');
        expect(engine.isPlaying).toBe(true);
    });

    it('isPlaying returns false when idle or paused', () => {
        engine.load(createTestWalkthrough());
        expect(engine.isPlaying).toBe(false);

        engine.play();
        engine.pause();

        expect(engine.isPlaying).toBe(false);
    });
});

// =============================================================================
// STATE MACHINE TRANSITIONS
// =============================================================================

describe('WalkthroughEngine — state machine', () => {
    let cb: WalkthroughCallbacks;
    let engine: WalkthroughEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        cb = createMockCallbacks();
        engine = new WalkthroughEngine(cb);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('play: idle → transitioning → dwelling (fly completes synchronously in mock)', () => {
        const states: WalkthroughPlaybackState[] = [];
        (cb.onStateChange as ReturnType<typeof vi.fn>).mockImplementation((s) => states.push(s));

        engine.load(createTestWalkthrough());
        engine.play();

        // fly mock calls onComplete immediately → transitioning then dwelling
        expect(states).toContain('transitioning');
        expect(states).toContain('dwelling');
        expect(engine.state).toBe('dwelling');
    });

    it('pause during dwell: dwelling → paused', () => {
        engine.load(createTestWalkthrough());
        engine.play(); // reaches dwelling at stop_1

        engine.pause();

        expect(engine.state).toBe('paused');
        expect(cb.onStateChange).toHaveBeenCalledWith('paused');
    });

    it('resume after pause: paused → dwelling', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        engine.pause();

        engine.resume();

        expect(engine.state).toBe('dwelling');
    });

    it('resume when not paused is a no-op', () => {
        engine.load(createTestWalkthrough());
        engine.play(); // dwelling
        // Don't pause — just call resume
        const statesBefore = (cb.onStateChange as ReturnType<typeof vi.fn>).mock.calls.length;
        engine.resume();

        expect((cb.onStateChange as ReturnType<typeof vi.fn>).mock.calls.length).toBe(statesBefore);
    });

    it('pause during transition: marks pauseAfterTransition, enters paused after transition completes', () => {
        let capturedOnComplete: (() => void) | null = null;
        (cb.flyCamera as ReturnType<typeof vi.fn>).mockImplementation((_p, _t, _d, onComplete) => {
            capturedOnComplete = onComplete; // capture, don't call yet
        });

        engine.load(createTestWalkthrough());
        engine.play(); // transitioning, fly has not completed

        expect(engine.state).toBe('transitioning');

        engine.pause(); // sets pauseAfterTransition flag

        // Transition is still running — still transitioning
        expect(engine.state).toBe('transitioning');

        // Now complete the transition
        capturedOnComplete!();

        expect(engine.state).toBe('paused');
    });

    it('stop from any state returns to idle', () => {
        engine.load(createTestWalkthrough());

        // From dwelling
        engine.play();
        engine.stop();
        expect(engine.state).toBe('idle');

        // From paused
        engine.play();
        engine.pause();
        engine.stop();
        expect(engine.state).toBe('idle');
    });

    it('walkthrough completes and transitions to idle at the end without loop', () => {
        // Use a single-stop walkthrough with dwell_time so we can control the timer
        engine.load(createTestWalkthrough({
            stops: [
                {
                    id: 's1', title: 'Only', transition: 'cut', dwell_time: 1000,
                    camera_position: { x: 0, y: 0, z: 0 },
                    camera_target: { x: 0, y: 0, z: 0 },
                },
            ],
            loop: false,
        }));

        engine.play();
        expect(engine.state).toBe('dwelling');

        vi.advanceTimersByTime(1000);

        expect(engine.state).toBe('idle');
        expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('onStateChange fires for every state transition', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        engine.pause();
        engine.resume();
        engine.stop();

        const calls = (cb.onStateChange as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        expect(calls).toContain('transitioning');
        expect(calls).toContain('dwelling');
        expect(calls).toContain('paused');
        expect(calls).toContain('idle');
    });
});

// =============================================================================
// NAVIGATION
// =============================================================================

describe('WalkthroughEngine — navigation', () => {
    let cb: WalkthroughCallbacks;
    let engine: WalkthroughEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        cb = createMockCallbacks();
        engine = new WalkthroughEngine(cb);
        engine.load(createTestWalkthrough());
        engine.play(); // starts at stop 0, dwelling (dwell_time=3000)
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('next() advances to next stop', () => {
        engine.next();

        expect(engine.currentIndex).toBe(1);
    });

    it('prev() goes to previous stop', () => {
        engine.next(); // index 1
        engine.next(); // index 2

        engine.prev();

        expect(engine.currentIndex).toBe(1);
    });

    it('next() at last stop without loop does nothing', () => {
        engine.next(); // 1
        engine.next(); // 2 (last)
        engine.next(); // should stay at 2

        expect(engine.currentIndex).toBe(2);
    });

    it('next() at last stop with loop=true wraps to first', () => {
        engine.load(createTestWalkthrough({ loop: true }));
        engine.play(); // index 0
        engine.next(); // 1
        engine.next(); // 2
        engine.next(); // wraps to 0

        expect(engine.currentIndex).toBe(0);
    });

    it('prev() at first stop without loop does nothing', () => {
        // Currently at index 0
        engine.prev();

        expect(engine.currentIndex).toBe(0);
    });

    it('prev() at first stop with loop=true wraps to last', () => {
        engine.load(createTestWalkthrough({ loop: true }));
        engine.play(); // index 0

        engine.prev(); // wraps to last (2)

        expect(engine.currentIndex).toBe(2);
    });

    it('goToStop(index) jumps to specific stop', () => {
        engine.goToStop(2);

        expect(engine.currentIndex).toBe(2);
        expect(engine.currentStop?.id).toBe('stop_3');
    });

    it('goToStop out of bounds does nothing', () => {
        engine.goToStop(99);
        expect(engine.currentIndex).toBe(0); // unchanged

        engine.goToStop(-1);
        expect(engine.currentIndex).toBe(0);
    });

    it('currentStop returns correct stop data', () => {
        expect(engine.currentStop?.id).toBe('stop_1');

        engine.next();
        expect(engine.currentStop?.id).toBe('stop_2');
    });

    it('onStopChange fires with correct index and stop data', () => {
        engine.next();

        const calls = (cb.onStopChange as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(1);
        expect(lastCall[1].id).toBe('stop_2');
    });
});

// =============================================================================
// TRANSITIONS
// =============================================================================

describe('WalkthroughEngine — transitions', () => {
    let cb: WalkthroughCallbacks;
    let engine: WalkthroughEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        cb = createMockCallbacks();
        engine = new WalkthroughEngine(cb);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("'fly' calls flyCamera with correct position, target, and duration", () => {
        engine.load(createTestWalkthrough());
        engine.play(); // stop_1 uses fly

        expect(cb.flyCamera).toHaveBeenCalledWith(
            { x: 0, y: 0, z: 10 },
            { x: 0, y: 0, z: 0 },
            expect.any(Number),
            expect.any(Function),
        );
    });

    it("'fly' uses custom fly_duration when provided", () => {
        engine.load(createTestWalkthrough({
            stops: [
                {
                    id: 's1', title: 'S1', transition: 'fly', dwell_time: 1000,
                    fly_duration: 2500,
                    camera_position: { x: 1, y: 1, z: 1 },
                    camera_target: { x: 0, y: 0, z: 0 },
                },
            ],
        }));
        engine.play();

        expect(cb.flyCamera).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), 2500, expect.any(Function),
        );
    });

    it("'fade' calls fadeOut, then setCameraImmediate, then fadeIn in order", () => {
        const callOrder: string[] = [];
        (cb.fadeOut as ReturnType<typeof vi.fn>).mockImplementation((_dur, onComplete) => {
            callOrder.push('fadeOut');
            onComplete();
        });
        (cb.setCameraImmediate as ReturnType<typeof vi.fn>).mockImplementation(() => {
            callOrder.push('setCameraImmediate');
        });
        (cb.fadeIn as ReturnType<typeof vi.fn>).mockImplementation((_dur, onComplete) => {
            callOrder.push('fadeIn');
            onComplete();
        });

        engine.load(createTestWalkthrough());
        engine.play();   // stop_1: fly — advance to stop_2 (fade)
        engine.next();   // stop_2: fade

        expect(callOrder).toEqual(
            expect.arrayContaining(['fadeOut', 'setCameraImmediate', 'fadeIn']),
        );
        const fadeOutIdx = callOrder.indexOf('fadeOut');
        const setCamIdx  = callOrder.indexOf('setCameraImmediate', fadeOutIdx);
        const fadeInIdx  = callOrder.indexOf('fadeIn', setCamIdx);
        expect(fadeOutIdx).toBeLessThan(setCamIdx);
        expect(setCamIdx).toBeLessThan(fadeInIdx);
    });

    it("'fade' uses custom fade_duration when provided", () => {
        engine.load(createTestWalkthrough({
            stops: [
                {
                    id: 's1', title: 'S1', transition: 'fade', dwell_time: 1000,
                    fade_duration: 800,
                    camera_position: { x: 1, y: 1, z: 1 },
                    camera_target: { x: 0, y: 0, z: 0 },
                },
            ],
        }));
        engine.play();

        expect(cb.fadeOut).toHaveBeenCalledWith(800, expect.any(Function));
        expect(cb.fadeIn).toHaveBeenCalledWith(800, expect.any(Function));
    });

    it("'cut' calls setCameraImmediate directly, no fly or fade", () => {
        engine.load(createTestWalkthrough());
        engine.play();  // fly (stop_1)
        engine.next();  // fade (stop_2)
        engine.next();  // cut  (stop_3)

        // setCameraImmediate should have been called for stop_3's cut
        expect(cb.setCameraImmediate).toHaveBeenCalledWith(
            { x: -5, y: 3, z: 5 },
            { x: 0, y: 1, z: 0 },
        );
    });

    it("'cut' does not call flyCamera or fade callbacks", () => {
        engine.load(createTestWalkthrough({
            stops: [
                {
                    id: 's1', title: 'S1', transition: 'cut', dwell_time: 1000,
                    camera_position: { x: 1, y: 0, z: 0 },
                    camera_target: { x: 0, y: 0, z: 0 },
                },
            ],
        }));
        engine.play();

        expect(cb.flyCamera).not.toHaveBeenCalled();
        expect(cb.fadeOut).not.toHaveBeenCalled();
        expect(cb.fadeIn).not.toHaveBeenCalled();
    });
});

// =============================================================================
// ANNOTATION LINKING
// =============================================================================

describe('WalkthroughEngine — annotation linking', () => {
    let cb: WalkthroughCallbacks;
    let engine: WalkthroughEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        cb = createMockCallbacks();
        engine = new WalkthroughEngine(cb);
        engine.load(createTestWalkthrough());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stop without annotation_id does not call showAnnotation', () => {
        engine.play(); // stop_1 — no annotation_id

        expect(cb.showAnnotation).not.toHaveBeenCalled();
    });

    it('stop with annotation_id calls showAnnotation after transition completes', () => {
        engine.play();  // stop_1
        engine.next();  // stop_2 has annotation_id: 'anno_1'

        expect(cb.showAnnotation).toHaveBeenCalledWith('anno_1');
    });

    it('transitioning away from annotated stop calls hideAnnotation', () => {
        engine.play();  // stop_1
        engine.next();  // stop_2 — arrives, showAnnotation called
        engine.next();  // stop_3 — should call hideAnnotation before transition

        expect(cb.hideAnnotation).toHaveBeenCalled();
    });

    it('hideAnnotation is called at start of each transition', () => {
        engine.play(); // entering stop_1 calls hideAnnotation

        // hideAnnotation is called at the beginning of _transitionToStop
        expect(cb.hideAnnotation).toHaveBeenCalled();
    });

    it('showAnnotation not called when callbacks omit it', () => {
        const cbNoAnnotation: WalkthroughCallbacks = {
            ...createMockCallbacks(),
            showAnnotation: undefined,
            hideAnnotation: undefined,
        };
        const eng2 = new WalkthroughEngine(cbNoAnnotation);
        eng2.load(createTestWalkthrough());

        // Should not throw even without showAnnotation / hideAnnotation
        expect(() => {
            eng2.play();
            eng2.next(); // stop_2 has annotation_id
        }).not.toThrow();
    });
});

// =============================================================================
// DWELL TIMER
// =============================================================================

describe('WalkthroughEngine — dwell timer', () => {
    let cb: WalkthroughCallbacks;
    let engine: WalkthroughEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        cb = createMockCallbacks();
        engine = new WalkthroughEngine(cb);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('auto-advances after dwell_time elapses', () => {
        engine.load(createTestWalkthrough());
        engine.play(); // stop_1 dwell_time=3000

        expect(engine.currentIndex).toBe(0);
        vi.advanceTimersByTime(3000);
        expect(engine.currentIndex).toBe(1);
    });

    it('dwell_time=0 enters paused state (manual advance only)', () => {
        engine.load(createTestWalkthrough({
            stops: [
                {
                    id: 's1', title: 'S1', transition: 'cut', dwell_time: 0,
                    camera_position: { x: 0, y: 0, z: 0 },
                    camera_target: { x: 0, y: 0, z: 0 },
                },
            ],
        }));
        engine.play();

        expect(engine.state).toBe('paused');
        // Advancing time should not auto-advance
        vi.advanceTimersByTime(10000);
        expect(engine.state).toBe('paused');
        expect(engine.currentIndex).toBe(0);
    });

    it('pausing cancels the dwell timer so it does not fire while paused', () => {
        engine.load(createTestWalkthrough());
        engine.play(); // stop_1, 3000ms dwell
        engine.pause();

        vi.advanceTimersByTime(3000); // would normally advance to stop_2

        expect(engine.state).toBe('paused');
        expect(engine.currentIndex).toBe(0);
    });

    it('resume continues with remaining dwell time', () => {
        engine.load(createTestWalkthrough());
        engine.play(); // stop_1, 3000ms dwell

        vi.advanceTimersByTime(1500); // halfway through
        engine.pause();

        vi.advanceTimersByTime(5000); // time passes while paused — should NOT advance
        expect(engine.state).toBe('paused');

        engine.resume();
        // Remaining ~1500ms should elapse and advance
        vi.advanceTimersByTime(1500);
        expect(engine.currentIndex).toBe(1);
    });

    it('onComplete fires when last stop dwell expires without loop', () => {
        engine.load(createTestWalkthrough({ loop: false }));
        engine.play(); // stop_1

        vi.advanceTimersByTime(3000); // advance to stop_2
        vi.advanceTimersByTime(2000); // advance to stop_3 (dwell=0, enters paused)

        // stop_3 has dwell_time=0 — enters paused, must manual advance
        expect(engine.state).toBe('paused');
        engine.resume(); // no remaining dwell → _advanceOrComplete → complete

        expect(engine.state).toBe('idle');
        expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('loops back to first stop after last stop when loop=true', () => {
        engine.load(createTestWalkthrough({ loop: true }));
        engine.play(); // stop_1

        vi.advanceTimersByTime(3000); // advance to stop_2
        vi.advanceTimersByTime(2000); // advance to stop_3 (dwell=0, paused)

        expect(engine.currentIndex).toBe(2);
        engine.resume(); // _advanceOrComplete → loop → stop_1

        expect(engine.currentIndex).toBe(0);
        expect(engine.state).toBe('dwelling');
    });
});

// =============================================================================
// CALLBACKS
// =============================================================================

describe('WalkthroughEngine — callbacks', () => {
    let cb: WalkthroughCallbacks;
    let engine: WalkthroughEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        cb = createMockCallbacks();
        engine = new WalkthroughEngine(cb);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('onStopChange fires with correct index and stop on play()', () => {
        engine.load(createTestWalkthrough());
        engine.play();

        expect(cb.onStopChange).toHaveBeenCalledWith(0, expect.objectContaining({ id: 'stop_1' }));
    });

    it('onStopChange fires on next()', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        engine.next();

        expect(cb.onStopChange).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'stop_2' }));
    });

    it('onStopChange fires on goToStop()', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        engine.goToStop(2);

        expect(cb.onStopChange).toHaveBeenCalledWith(2, expect.objectContaining({ id: 'stop_3' }));
    });

    it('onStateChange fires on each state transition', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        engine.pause();
        engine.stop();

        const states = (cb.onStateChange as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        expect(states).toContain('transitioning');
        expect(states).toContain('dwelling');
        expect(states).toContain('paused');
        expect(states).toContain('idle');
    });

    it('onStateChange is not fired when state does not change', () => {
        engine.load(createTestWalkthrough());
        engine.play(); // transitioning then dwelling

        const callsBefore = (cb.onStateChange as ReturnType<typeof vi.fn>).mock.calls.length;

        // Calling resume when not paused is a no-op — no state change
        engine.resume();

        expect((cb.onStateChange as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });

    it('onComplete fires when walkthrough reaches end without loop', () => {
        engine.load(createTestWalkthrough({
            stops: [
                {
                    id: 's1', title: 'Only', transition: 'cut', dwell_time: 500,
                    camera_position: { x: 0, y: 0, z: 0 },
                    camera_target: { x: 0, y: 0, z: 0 },
                },
            ],
            loop: false,
        }));

        engine.play();
        vi.advanceTimersByTime(500);

        expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('onComplete fires when stop() is called', () => {
        engine.load(createTestWalkthrough());
        engine.play();
        engine.stop();

        expect(cb.onComplete).toHaveBeenCalledTimes(1);
    });

    it('onComplete does not fire when loop=true completes a cycle', () => {
        engine.load(createTestWalkthrough({
            stops: [
                {
                    id: 's1', title: 'S1', transition: 'cut', dwell_time: 500,
                    camera_position: { x: 0, y: 0, z: 0 },
                    camera_target: { x: 0, y: 0, z: 0 },
                },
            ],
            loop: true,
        }));

        engine.play();
        vi.advanceTimersByTime(500); // wraps back to stop 0

        expect(cb.onComplete).not.toHaveBeenCalled();
        expect(engine.state).toBe('dwelling');
    });
});

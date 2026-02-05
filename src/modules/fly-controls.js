/**
 * Fly Camera Controls Module
 *
 * WASD + mouse fly camera inspired by SuperSplat's implementation:
 * - WASD for forward/left/backward/right movement
 * - Q/E for down/up vertical movement
 * - Right-click + drag for mouse look (yaw/pitch)
 * - Shift for faster movement
 * - Scroll wheel for speed adjustment
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';

const log = Logger.getLogger('fly-controls');

// Default configuration
const DEFAULTS = {
    moveSpeed: 3.0,          // Base movement speed (units/sec)
    lookSpeed: 0.002,        // Mouse look sensitivity (rad/pixel)
    fastMultiplier: 3.0,     // Shift speed multiplier
    slowMultiplier: 0.25,    // Ctrl speed multiplier
    speedStep: 1.2,          // Scroll wheel speed change factor
    minSpeed: 0.1,
    maxSpeed: 50.0
};

export class FlyControls {
    /**
     * @param {THREE.Camera} camera - The camera to control
     * @param {HTMLElement} domElement - The canvas/element to listen on
     */
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.enabled = false;

        // Movement state
        this.moveSpeed = DEFAULTS.moveSpeed;
        this.lookSpeed = DEFAULTS.lookSpeed;
        this.keysDown = new Set();
        this.isRightMouseDown = false;
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.moveVector = new THREE.Vector3();
        this.lastTime = performance.now();

        // Bind handlers (so we can remove them later)
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onPointerLockChange = this._onPointerLockChange.bind(this);
    }

    /**
     * Enable fly controls — attach event listeners
     */
    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.keysDown.clear();
        this.isRightMouseDown = false;
        this.lastTime = performance.now();

        // Sync euler from current camera orientation
        this.euler.setFromQuaternion(this.camera.quaternion);

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        this.domElement.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('mousemove', this._onMouseMove);
        this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
        this.domElement.addEventListener('contextmenu', this._onContextMenu);
        document.addEventListener('pointerlockchange', this._onPointerLockChange);

        log.info('Fly controls enabled, speed:', this.moveSpeed.toFixed(1));
    }

    /**
     * Disable fly controls — remove event listeners
     */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.keysDown.clear();
        this.isRightMouseDown = false;

        // Exit pointer lock if active
        if (document.pointerLockElement === this.domElement) {
            document.exitPointerLock();
        }

        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        this.domElement.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('mousemove', this._onMouseMove);
        this.domElement.removeEventListener('wheel', this._onWheel);
        this.domElement.removeEventListener('contextmenu', this._onContextMenu);
        document.removeEventListener('pointerlockchange', this._onPointerLockChange);

        log.info('Fly controls disabled');
    }

    /**
     * Call each frame to move the camera based on held keys.
     * @returns {boolean} Whether the camera was moved this frame
     */
    update() {
        if (!this.enabled) return false;

        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms
        this.lastTime = now;

        if (this.keysDown.size === 0) return false;

        // Compute speed with modifiers
        let speed = this.moveSpeed;
        if (this.keysDown.has('shift')) speed *= DEFAULTS.fastMultiplier;
        if (this.keysDown.has('ctrl')) speed *= DEFAULTS.slowMultiplier;

        // Build movement vector in camera-local space
        this.moveVector.set(0, 0, 0);

        if (this.keysDown.has('w')) this.moveVector.z -= 1;
        if (this.keysDown.has('s')) this.moveVector.z += 1;
        if (this.keysDown.has('a')) this.moveVector.x -= 1;
        if (this.keysDown.has('d')) this.moveVector.x += 1;
        if (this.keysDown.has('e')) this.moveVector.y += 1;
        if (this.keysDown.has('q')) this.moveVector.y -= 1;

        if (this.moveVector.lengthSq() === 0) return false;

        // Normalize so diagonal movement isn't faster
        this.moveVector.normalize().multiplyScalar(speed * dt);

        // Transform movement vector from camera-local to world space
        this.moveVector.applyQuaternion(this.camera.quaternion);
        this.camera.position.add(this.moveVector);

        return true;
    }

    /**
     * Dispose — clean up all listeners
     */
    dispose() {
        this.disable();
    }

    // =========================================================================
    // INTERNAL EVENT HANDLERS
    // =========================================================================

    _onKeyDown(event) {
        // Don't capture keys when typing in inputs
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        const key = event.key.toLowerCase();
        if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
            this.keysDown.add(key);
            event.preventDefault();
            event.stopPropagation();
        }
        if (event.shiftKey) this.keysDown.add('shift');
        if (event.ctrlKey || event.metaKey) this.keysDown.add('ctrl');
    }

    _onKeyUp(event) {
        const key = event.key.toLowerCase();
        this.keysDown.delete(key);
        if (!event.shiftKey) this.keysDown.delete('shift');
        if (!event.ctrlKey && !event.metaKey) this.keysDown.delete('ctrl');
    }

    _onMouseDown(event) {
        if (event.button === 2) { // right click
            this.isRightMouseDown = true;
            this.domElement.requestPointerLock();
            event.preventDefault();
        }
    }

    _onMouseUp(event) {
        if (event.button === 2) {
            this.isRightMouseDown = false;
            if (document.pointerLockElement === this.domElement) {
                document.exitPointerLock();
            }
        }
    }

    _onMouseMove(event) {
        if (!this.isRightMouseDown) return;

        const dx = event.movementX || 0;
        const dy = event.movementY || 0;

        // Yaw (rotate around world Y axis)
        this.euler.y -= dx * this.lookSpeed;
        // Pitch (rotate around local X axis), clamped to avoid gimbal lock
        this.euler.x -= dy * this.lookSpeed;
        this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));

        this.camera.quaternion.setFromEuler(this.euler);
    }

    _onWheel(event) {
        event.preventDefault();
        // Adjust movement speed with scroll
        if (event.deltaY < 0) {
            this.moveSpeed = Math.min(this.moveSpeed * DEFAULTS.speedStep, DEFAULTS.maxSpeed);
        } else {
            this.moveSpeed = Math.max(this.moveSpeed / DEFAULTS.speedStep, DEFAULTS.minSpeed);
        }
        log.debug('Fly speed:', this.moveSpeed.toFixed(2));
    }

    _onContextMenu(event) {
        event.preventDefault();
    }

    _onPointerLockChange() {
        if (document.pointerLockElement !== this.domElement) {
            this.isRightMouseDown = false;
        }
    }
}

export default FlyControls;

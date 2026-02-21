/**
 * Alignment Module
 *
 * Handles 3D object alignment:
 * - Interactive 3-point landmark alignment (LandmarkAlignment class)
 * - Simple center matching on load (autoCenterAlign)
 * - Fit-to-view camera positioning
 * - Alignment save/load/reset
 */

import * as THREE from 'three';
import type {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    Group,
    Object3D,
    Vector3,
    Matrix4,
    Raycaster,
    Vector2
} from 'three';
import { Logger, notify } from './utilities.js';

const log = Logger.getLogger('alignment');

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/** 3D point with x, y, z coordinates */
export interface Point3D {
    x: number;
    y: number;
    z: number;
}

/** Splat bounding box result */
interface SplatBounds {
    min: Vector3;
    max: Vector3;
    center: Vector3;
    found: boolean;
}

/** Alignment data JSON format */
export interface AlignmentData {
    version: number;
    splat?: {
        position: [number, number, number];
        rotation: [number, number, number];
        scale: number;
    } | null;
    model?: {
        position: [number, number, number];
        rotation: [number, number, number];
        scale: number;
    } | null;
    pointcloud?: {
        position: [number, number, number];
        rotation: [number, number, number];
        scale: number;
    } | null;
}

/** Dependencies for autoCenterAlign */
export interface AutoCenterAlignDeps {
    splatMesh: Object3D | null;
    modelGroup: Group | null;
    updateTransformInputs: () => void;
    storeLastPositions: () => void;
}

/** Dependencies for LandmarkAlignment constructor */
export interface LandmarkAlignmentDeps {
    scene: Scene;
    camera: PerspectiveCamera;
    renderer: WebGLRenderer;
    controls: any; // OrbitControls type not available
    splatMesh?: Object3D | null;
    modelGroup?: Group | null;
    updateTransformInputs: () => void;
    storeLastPositions: () => void;
}

/** Dependencies for fitToView */
export interface FitToViewDeps {
    splatMesh: Object3D | null;
    modelGroup: Group | null;
    pointcloudGroup: Group | null;
    camera: PerspectiveCamera;
    controls: any; // OrbitControls type
}

/** Dependencies for alignment data operations */
export interface AlignmentDataDeps {
    splatMesh: Object3D | null;
    modelGroup: Group | null;
    pointcloudGroup: Group | null;
    updateTransformInputs: () => void;
    storeLastPositions?: () => void;
}

/** Dependencies for resetCamera */
export interface ResetCameraDeps {
    camera: PerspectiveCamera;
    controls: any; // OrbitControls type
    initialPosition: { x: number; y: number; z: number };
}

/** Dependencies for saveAlignment */
export interface SaveAlignmentDeps {
    splatMesh: Object3D | null;
    modelGroup: Group | null;
    pointcloudGroup: Group | null;
    tauriBridge?: any;
}

/** Dependencies for loadAlignment */
export type LoadAlignmentDeps = AlignmentDataDeps;

/** Marker data for landmark alignment */
interface MarkerData {
    element: HTMLDivElement;
    position: Vector3;
    phase: 'anchor' | 'mover';
    pairIndex: number;
    colorClass: string;
}

/** A single anchor-mover point pair */
interface AlignmentPair {
    anchor: Vector3;
    mover: Vector3 | null;
}

/** Undo stack entry */
interface UndoAction {
    type: 'anchor' | 'mover';
    pairIndex: number;
    point: Vector3;
    marker: MarkerData;
}

/** Saved transform for restoring mover on cancel */
interface SavedTransform {
    position: Vector3;
    quaternion: THREE.Quaternion;
    scale: Vector3;
}

/** SplatMesh interface (minimal, for Spark.js internals) */
interface SplatMesh extends Object3D {
    packedSplats?: {
        splatCount?: number;
        forEachSplat?: (callback: (index: number, center: Point3D) => void) => void;
    };
}

// =============================================================================
// CENTROID AND ROTATION COMPUTATION
// =============================================================================

/**
 * Compute centroid of points
 */
function computeCentroid(points: Point3D[]): Point3D {
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
    }
    const n = points.length;
    return { x: cx / n, y: cy / n, z: cz / n };
}

/**
 * Compute optimal rotation using SVD-like approach (Kabsch algorithm / Horn's method)
 * Returns a rotation matrix that best aligns source to target
 */
function computeOptimalRotation(
    sourcePoints: Point3D[],
    targetPoints: Point3D[],
    sourceCentroid: Point3D,
    targetCentroid: Point3D
): Matrix4 {
    // Build the covariance matrix H
    const h = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
    ];

    for (let i = 0; i < sourcePoints.length; i++) {
        const s = sourcePoints[i];
        const t = targetPoints[i];

        const sx = s.x - sourceCentroid.x;
        const sy = s.y - sourceCentroid.y;
        const sz = s.z - sourceCentroid.z;

        const tx = t.x - targetCentroid.x;
        const ty = t.y - targetCentroid.y;
        const tz = t.z - targetCentroid.z;

        h[0][0] += sx * tx;
        h[0][1] += sx * ty;
        h[0][2] += sx * tz;
        h[1][0] += sy * tx;
        h[1][1] += sy * ty;
        h[1][2] += sy * tz;
        h[2][0] += sz * tx;
        h[2][1] += sz * ty;
        h[2][2] += sz * tz;
    }

    // Compute SVD using quaternion-based Horn's method
    const n11 = h[0][0], n12 = h[0][1], n13 = h[0][2];
    const n21 = h[1][0], n22 = h[1][1], n23 = h[1][2];
    const n31 = h[2][0], n32 = h[2][1], n33 = h[2][2];

    // Build the 4x4 matrix for quaternion-based solution
    const n = [
        [n11 + n22 + n33, n23 - n32, n31 - n13, n12 - n21],
        [n23 - n32, n11 - n22 - n33, n12 + n21, n31 + n13],
        [n31 - n13, n12 + n21, -n11 + n22 - n33, n23 + n32],
        [n12 - n21, n31 + n13, n23 + n32, -n11 - n22 + n33]
    ];

    // Find largest eigenvalue/eigenvector using power iteration
    let q = [1, 0, 0, 0]; // Initial quaternion guess
    for (let iter = 0; iter < 50; iter++) {
        const newQ = [
            n[0][0] * q[0] + n[0][1] * q[1] + n[0][2] * q[2] + n[0][3] * q[3],
            n[1][0] * q[0] + n[1][1] * q[1] + n[1][2] * q[2] + n[1][3] * q[3],
            n[2][0] * q[0] + n[2][1] * q[1] + n[2][2] * q[2] + n[2][3] * q[3],
            n[3][0] * q[0] + n[3][1] * q[1] + n[3][2] * q[2] + n[3][3] * q[3]
        ];

        const len = Math.sqrt(newQ[0] * newQ[0] + newQ[1] * newQ[1] + newQ[2] * newQ[2] + newQ[3] * newQ[3]);
        if (len < 1e-10) break;
        q = [newQ[0] / len, newQ[1] / len, newQ[2] / len, newQ[3] / len];
    }

    // Convert quaternion to rotation matrix
    const qw = q[0], qx = q[1], qy = q[2], qz = q[3];
    const rotMatrix = new THREE.Matrix4();
    rotMatrix.set(
        1 - 2 * qy * qy - 2 * qz * qz, 2 * qx * qy - 2 * qz * qw, 2 * qx * qz + 2 * qy * qw, 0,
        2 * qx * qy + 2 * qz * qw, 1 - 2 * qx * qx - 2 * qz * qz, 2 * qy * qz - 2 * qx * qw, 0,
        2 * qx * qz - 2 * qy * qw, 2 * qy * qz + 2 * qx * qw, 1 - 2 * qx * qx - 2 * qy * qy, 0,
        0, 0, 0, 1
    );

    return rotMatrix;
}

// =============================================================================
// SPLAT BOUNDS COMPUTATION
// =============================================================================

/**
 * Compute bounds from splat positions (sampling approach)
 */
function computeSplatBoundsFromPositions(splatMeshObj: Object3D): SplatBounds {
    const bounds: SplatBounds = {
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
        center: new THREE.Vector3(),
        found: false
    };

    splatMeshObj.updateMatrixWorld(true);
    const worldMatrix = splatMeshObj.matrixWorld;

    const splatMesh = splatMeshObj as SplatMesh;
    if (splatMesh.packedSplats && typeof splatMesh.packedSplats.forEachSplat === 'function') {
        let count = 0;
        const splatCount = splatMesh.packedSplats.splatCount || 0;

        if (splatCount > 0) {
            const maxSamples = 10000;
            const stride = Math.max(1, Math.floor(splatCount / maxSamples));

            splatMesh.packedSplats.forEachSplat((index: number, center: Point3D) => {
                if (index % stride === 0) {
                    const worldPos = new THREE.Vector3(center.x, center.y, center.z);
                    worldPos.applyMatrix4(worldMatrix);
                    bounds.min.min(worldPos);
                    bounds.max.max(worldPos);
                    count++;
                }
            });

            if (count > 0) {
                bounds.center.addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
                bounds.found = true;
                log.debug(`[SplatBounds] Computed from ${count} sampled positions`);
            }
        }
    }

    return bounds;
}

// =============================================================================
// AUTO CENTER ALIGN (simple bounding-box center match on load)
// =============================================================================

/**
 * Simple bounding-box center alignment — translates the mover's center to
 * the anchor's center. No rotation or scale. Used as the auto-trigger when
 * both objects are loaded.
 */
export function autoCenterAlign(deps: AutoCenterAlignDeps): void {
    const { splatMesh, modelGroup, updateTransformInputs, storeLastPositions } = deps;

    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        return;
    }

    // Compute bounding-box centers
    const splatBounds = computeSplatBoundsFromPositions(splatMesh);
    let splatCenter: Vector3;
    if (splatBounds.found) {
        splatCenter = splatBounds.center.clone();
    } else {
        const box = new THREE.Box3().setFromObject(splatMesh);
        if (box.isEmpty()) {
            log.warn('[autoCenterAlign] Splat bounds empty, skipping');
            return;
        }
        splatCenter = box.getCenter(new THREE.Vector3());
    }

    const modelBox = new THREE.Box3().setFromObject(modelGroup);
    if (modelBox.isEmpty()) {
        log.warn('[autoCenterAlign] Model bounds empty, skipping');
        return;
    }
    const modelCenter = modelBox.getCenter(new THREE.Vector3());

    // Determine anchor/mover: object closer to world origin stays fixed
    const splatDist = splatCenter.length();
    const modelDist = modelCenter.length();

    let mover: Object3D | Group;
    let moverCenter: Vector3;
    let anchorCenter: Vector3;
    if (splatDist <= modelDist) {
        mover = modelGroup;
        moverCenter = modelCenter;
        anchorCenter = splatCenter;
        log.debug('[autoCenterAlign] Anchor: splat, Mover: model');
    } else {
        mover = splatMesh;
        moverCenter = splatCenter;
        anchorCenter = modelCenter;
        log.debug('[autoCenterAlign] Anchor: model, Mover: splat');
    }

    // Translate mover center to anchor center
    const offset = new THREE.Vector3().subVectors(anchorCenter, moverCenter);
    mover.position.add(offset);
    mover.updateMatrix();
    mover.updateMatrixWorld(true);

    log.info(`[autoCenterAlign] Moved by offset: [${offset.x.toFixed(3)}, ${offset.y.toFixed(3)}, ${offset.z.toFixed(3)}]`);

    updateTransformInputs();
    storeLastPositions();
}

// =============================================================================
// RIGID TRANSFORM FROM POINT CORRESPONDENCES
// =============================================================================

/**
 * Compute a rigid transform (rotation + uniform scale + translation) from
 * 3 source-destination point correspondences.
 */
function computeRigidTransformFromPoints(srcPts: Vector3[], dstPts: Vector3[]): Matrix4 {
    // Convert to plain objects for computeCentroid / computeOptimalRotation
    const srcObjs = srcPts.map(v => ({ x: v.x, y: v.y, z: v.z }));
    const dstObjs = dstPts.map(v => ({ x: v.x, y: v.y, z: v.z }));

    const srcCentroid = computeCentroid(srcObjs);
    const dstCentroid = computeCentroid(dstObjs);

    // Compute optimal rotation via Horn's quaternion method
    const rotMatrix = computeOptimalRotation(srcObjs, dstObjs, srcCentroid, dstCentroid);

    // Compute uniform scale: ratio of dst spread to src spread
    let srcSpreadSq = 0, dstSpreadSq = 0;
    for (let i = 0; i < srcObjs.length; i++) {
        const sdx = srcObjs[i].x - srcCentroid.x;
        const sdy = srcObjs[i].y - srcCentroid.y;
        const sdz = srcObjs[i].z - srcCentroid.z;
        srcSpreadSq += sdx * sdx + sdy * sdy + sdz * sdz;

        const ddx = dstObjs[i].x - dstCentroid.x;
        const ddy = dstObjs[i].y - dstCentroid.y;
        const ddz = dstObjs[i].z - dstCentroid.z;
        dstSpreadSq += ddx * ddx + ddy * ddy + ddz * ddz;
    }

    let scale = 1;
    if (srcSpreadSq > 1e-10) {
        scale = Math.sqrt(dstSpreadSq / srcSpreadSq);
    }

    // Compute translation: t = dstCentroid - scale * R * srcCentroid
    const rotatedSrcCentroid = new THREE.Vector3(srcCentroid.x, srcCentroid.y, srcCentroid.z)
        .applyMatrix4(rotMatrix)
        .multiplyScalar(scale);

    const translation = new THREE.Vector3(
        dstCentroid.x - rotatedSrcCentroid.x,
        dstCentroid.y - rotatedSrcCentroid.y,
        dstCentroid.z - rotatedSrcCentroid.z
    );

    // Build final matrix: M = T * S * R
    const result = new THREE.Matrix4();
    const scaleMat = new THREE.Matrix4().makeScale(scale, scale, scale);
    const transMat = new THREE.Matrix4().makeTranslation(translation.x, translation.y, translation.z);

    result.copy(transMat).multiply(scaleMat).multiply(rotMatrix);
    return result;
}

// =============================================================================
// LANDMARK ALIGNMENT CLASS
// =============================================================================

/**
 * Interactive N-point landmark alignment tool.
 *
 * Workflow:
 * 1. User clicks "Align Objects" -- enters alignment mode
 * 2. Alternating pair-by-pair placement: anchor 1 -> mover 1 -> anchor 2 -> mover 2 -> ...
 * 3. After 3+ complete pairs: live preview appears, RMSE shown, Apply button enabled
 * 4. User can continue adding pairs, undo with Ctrl+Z, then Apply or Cancel
 */
export class LandmarkAlignment {
    private scene: Scene;
    private camera: PerspectiveCamera;
    private renderer: WebGLRenderer;
    private controls: any; // OrbitControls

    // Asset references (updated via updateRefs())
    private splatMesh: Object3D | null;
    private modelGroup: Group | null;

    // Callbacks from main.ts
    private updateTransformInputs: () => void;
    private storeLastPositions: () => void;

    // State
    private _active: boolean;
    private _phase: 'place-anchor' | 'place-mover' | null;
    private _anchorObj: Object3D | Group | null;
    private _anchorType: string;
    private _moverObj: Object3D | Group | null;
    private _moverType: string;
    private _pairs: AlignmentPair[];
    private _currentPairIndex: number;
    private _undoStack: UndoAction[];
    private _previewGroup: Group | null;
    private _rmse: number | null;
    private _lastTransform: Matrix4 | null;
    private _savedMoverTransform: SavedTransform | null;

    // DOM
    private _markerContainer: HTMLDivElement | null;
    private _markers: MarkerData[];
    private _indicatorEl: HTMLElement | null;
    private _instructionEl: HTMLElement | null;
    private _applyBtnEl: HTMLElement | null;
    private _undoBtnEl: HTMLElement | null;
    private _rmseEl: HTMLElement | null;

    // Raycaster
    private _raycaster: Raycaster;
    private _mouse: Vector2;
    private _projVec: Vector3;

    // Bound handlers
    private _onClickBound: (event: MouseEvent) => void;
    private _onKeyDownBound: (event: KeyboardEvent) => void;

    constructor(deps: LandmarkAlignmentDeps) {
        this.scene = deps.scene;
        this.camera = deps.camera;
        this.renderer = deps.renderer;
        this.controls = deps.controls;

        // These are updated via updateRefs() when assets load
        this.splatMesh = deps.splatMesh || null;
        this.modelGroup = deps.modelGroup || null;

        // Callbacks from main.ts
        this.updateTransformInputs = deps.updateTransformInputs;
        this.storeLastPositions = deps.storeLastPositions;

        // State
        this._active = false;
        this._phase = null;
        this._anchorObj = null;
        this._anchorType = '';
        this._moverObj = null;
        this._moverType = '';
        this._pairs = [];
        this._currentPairIndex = 0;
        this._undoStack = [];
        this._previewGroup = null;
        this._rmse = null;
        this._lastTransform = null;
        this._savedMoverTransform = null;

        // DOM
        this._markerContainer = null;
        this._markers = [];
        this._indicatorEl = null;
        this._instructionEl = null;
        this._applyBtnEl = null;
        this._undoBtnEl = null;
        this._rmseEl = null;

        // Raycaster
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();
        this._projVec = new THREE.Vector3();

        // Bound handlers
        this._onClickBound = this._onClick.bind(this);
        this._onKeyDownBound = this._onKeyDown.bind(this);

        this._ensureContainer();
    }

    /**
     * Update asset references (called when splat/model loads)
     */
    updateRefs(splatMesh: Object3D | null, modelGroup: Group | null): void {
        this.splatMesh = splatMesh;
        this.modelGroup = modelGroup;
    }

    /**
     * Ensure the marker container exists in the DOM
     */
    private _ensureContainer(): void {
        this._markerContainer = document.getElementById('alignment-markers') as HTMLDivElement | null;
        if (!this._markerContainer) {
            this._markerContainer = document.createElement('div');
            this._markerContainer.id = 'alignment-markers';
            document.body.appendChild(this._markerContainer);
        }

        this._indicatorEl = document.getElementById('alignment-mode-indicator');
        this._instructionEl = document.getElementById('alignment-instruction');
        this._applyBtnEl = document.getElementById('btn-alignment-apply');
        this._undoBtnEl = document.getElementById('btn-alignment-undo');
        this._rmseEl = document.getElementById('alignment-rmse');
    }

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Enter alignment mode
     */
    start(): void {
        if (this._active) return;

        if (!this.splatMesh || !this.modelGroup || this.modelGroup.children.length === 0) {
            notify.warning('Both splat and model must be loaded for alignment');
            return;
        }

        this._active = true;

        // Determine anchor/mover
        const splatBounds = computeSplatBoundsFromPositions(this.splatMesh);
        let splatCenter: Vector3;
        if (splatBounds.found) {
            splatCenter = splatBounds.center;
        } else {
            splatCenter = new THREE.Box3().setFromObject(this.splatMesh).getCenter(new THREE.Vector3());
        }
        const modelCenter = new THREE.Box3().setFromObject(this.modelGroup).getCenter(new THREE.Vector3());

        if (splatCenter.length() <= modelCenter.length()) {
            this._anchorObj = this.splatMesh;
            this._anchorType = 'splat';
            this._moverObj = this.modelGroup;
            this._moverType = 'model';
        } else {
            this._anchorObj = this.modelGroup;
            this._anchorType = 'model';
            this._moverObj = this.splatMesh;
            this._moverType = 'splat';
        }

        this._phase = 'place-anchor';
        this._pairs = [];
        this._currentPairIndex = 0;
        this._undoStack = [];
        this._clearMarkers();

        // Hide new UI elements initially
        if (this._applyBtnEl) this._applyBtnEl.classList.add('hidden');
        if (this._undoBtnEl) this._undoBtnEl.classList.add('hidden');
        if (this._rmseEl) this._rmseEl.classList.add('hidden');

        // Attach listeners
        this.renderer.domElement.addEventListener('click', this._onClickBound, { capture: true });
        document.addEventListener('keydown', this._onKeyDownBound);
        this.renderer.domElement.style.cursor = 'crosshair';

        // Show indicator
        this._updateInstruction();
        if (this._indicatorEl) this._indicatorEl.classList.remove('hidden');

        log.info(`[LandmarkAlignment] Started — anchor: ${this._anchorType}, mover: ${this._moverType}`);
    }

    /**
     * Update the renderer reference after a renderer switch (WebGPU <-> WebGL).
     * If alignment mode is active, re-attach the click listener to the new canvas.
     */
    updateRenderer(newRenderer: any): void {
        const wasActive = this._active;

        // If alignment mode is active, cancel it first (removes old listener)
        if (wasActive) {
            this.cancel();
        }

        // Update renderer reference
        this.renderer = newRenderer;

        // If it was active, restart it (attaches to new canvas)
        if (wasActive) {
            this.start();
        }

        log.info('[updateRenderer] Renderer updated, alignment mode', wasActive ? 'restarted' : 'updated');
    }

    /**
     * Cancel alignment mode and clean up
     */
    cancel(): void {
        if (!this._active) return;

        this._active = false;
        this._phase = null;
        this._pairs = [];
        this._undoStack = [];
        this._currentPairIndex = 0;
        this._clearMarkers();

        // Clean up preview
        this._removePreview();
        this._lastTransform = null;
        this._rmse = null;

        // Hide new UI elements
        if (this._applyBtnEl) this._applyBtnEl.classList.add('hidden');
        if (this._undoBtnEl) this._undoBtnEl.classList.add('hidden');
        if (this._rmseEl) this._rmseEl.classList.add('hidden');

        // Remove listeners
        this.renderer.domElement.removeEventListener('click', this._onClickBound);
        document.removeEventListener('keydown', this._onKeyDownBound);
        this.renderer.domElement.style.cursor = 'default';

        // Hide indicator
        if (this._indicatorEl) this._indicatorEl.classList.add('hidden');

        log.info('[LandmarkAlignment] Cancelled');
    }

    /**
     * Whether alignment mode is currently active
     */
    isActive(): boolean {
        return this._active;
    }

    /**
     * Update marker screen positions — call each frame from animate()
     */
    updateMarkerPositions(): void {
        if (!this._active || this._markers.length === 0) return;

        const rect = this.renderer.domElement.getBoundingClientRect();

        for (const marker of this._markers) {
            const screenPos = this._projVec.copy(marker.position).project(this.camera);
            const x = (screenPos.x * 0.5 + 0.5) * rect.width + rect.left;
            const y = (-screenPos.y * 0.5 + 0.5) * rect.height + rect.top;

            if (screenPos.z > 1) {
                marker.element.style.display = 'none';
            } else {
                marker.element.style.display = 'flex';
                marker.element.style.left = x + 'px';
                marker.element.style.top = y + 'px';
            }
        }
    }

    /**
     * Dispose — remove event listeners
     */
    dispose(): void {
        this.cancel();
    }

    // ── Private ─────────────────────────────────────────────────────

    /**
     * Handle click during alignment mode
     */
    private _onClick(event: MouseEvent): void {
        log.info('[_onClick] Click detected, active:', this._active, 'target:', event.target);

        if (!this._active) return;

        // Ignore clicks on UI overlays
        if (event.target !== this.renderer.domElement) return;

        // Compute normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this.camera);
        const intersects = this._raycaster.intersectObjects(this.scene.children, true);

        // Filter: only accept hits on the current target object
        const targetObj = this._phase === 'place-anchor' ? this._anchorObj : this._moverObj;

        let hit = intersects.find(h => this._isDescendantOf(h.object, targetObj));

        // If no hit via standard raycasting and target is a splat mesh, try custom splat raycasting
        if (!hit && targetObj && this._isSplatMesh(targetObj)) {
            hit = this._raycastSplatMesh(targetObj);
        }

        if (!hit) return;

        const point = hit.point.clone();

        if (this._phase === 'place-anchor') {
            // Start a new pair with this anchor point
            this._pairs.push({ anchor: point, mover: null });
            const marker = this._addMarker(point, this._currentPairIndex, 'anchor');
            this._undoStack.push({ type: 'anchor', pairIndex: this._currentPairIndex, point, marker });
            log.debug(`[LandmarkAlignment] Anchor ${this._currentPairIndex + 1}A: [${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}]`);

            this._phase = 'place-mover';
            if (this._undoBtnEl) this._undoBtnEl.classList.remove('hidden');
            this._updateInstruction();

        } else if (this._phase === 'place-mover') {
            // Complete the current pair with this mover point
            this._pairs[this._currentPairIndex].mover = point;
            const marker = this._addMarker(point, this._currentPairIndex, 'mover');
            this._undoStack.push({ type: 'mover', pairIndex: this._currentPairIndex, point, marker });
            log.debug(`[LandmarkAlignment] Mover ${this._currentPairIndex + 1}B: [${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}]`);

            this._currentPairIndex++;
            this._phase = 'place-anchor';

            // If 3+ complete pairs, show preview and Apply
            const completePairs = this._getCompletePairs();
            if (completePairs.length >= 3) {
                this._updatePreview();
                if (this._applyBtnEl) this._applyBtnEl.classList.remove('hidden');
                if (this._rmseEl) this._rmseEl.classList.remove('hidden');
            }
            this._updateInstruction();
        }
    }

    /**
     * Handle keydown — Escape cancels
     */
    private _onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            this.cancel();
            notify.info('Alignment cancelled');
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            event.preventDefault();
            this.undo();
        }
    }

    /**
     * Check whether obj is targetObj itself or a descendant of it
     */
    private _isDescendantOf(obj: Object3D, targetObj: Object3D | Group | null): boolean {
        if (!targetObj) return false;

        // For splat mesh, direct equality check
        if (obj === targetObj) return true;

        // For model group, walk up the parent chain
        let current: Object3D | null = obj;
        while (current) {
            if (current === targetObj) return true;
            current = current.parent;
        }
        return false;
    }

    /**
     * Check if an object is a splat mesh (has packedSplats property)
     */
    private _isSplatMesh(obj: Object3D): boolean {
        return !!(obj as any).packedSplats;
    }

    /**
     * Manual raycasting for splat meshes (Spark.js doesn't implement Three.js raycast)
     * Samples splat points and finds the closest one to the ray.
     */
    private _raycastSplatMesh(splatMeshObj: Object3D): { point: Vector3; distance: number } | null {
        const splatMesh = splatMeshObj as SplatMesh;
        if (!splatMesh.packedSplats || typeof splatMesh.packedSplats.forEachSplat !== 'function') {
            log.warn('[_raycastSplatMesh] No packedSplats or forEachSplat method');
            return null;
        }

        splatMesh.updateMatrixWorld(true);
        const worldMatrix = splatMesh.matrixWorld;
        const ray = this._raycaster.ray;

        let closestPoint: Vector3 | null = null;
        let closestDistance = Infinity;

        const splatCount = (splatMesh.packedSplats as any).splatCount || 0;
        if (splatCount === 0) {
            log.warn('[_raycastSplatMesh] splatCount is 0');
            return null;
        }

        // Sample at most 10000 splats for better coverage
        const maxSamples = 10000;
        const stride = Math.max(1, Math.floor(splatCount / maxSamples));

        log.info(`[_raycastSplatMesh] Sampling ${splatCount} splats with stride ${stride}`);

        splatMesh.packedSplats.forEachSplat((index: number, center: Point3D) => {
            if (index % stride !== 0) return;

            // Transform splat center to world space
            const worldPos = new THREE.Vector3(center.x, center.y, center.z);
            worldPos.applyMatrix4(worldMatrix);

            // Find distance from ray to this point
            const distToRay = ray.distanceToPoint(worldPos);
            if (distToRay < closestDistance) {
                closestDistance = distToRay;
                closestPoint = worldPos;
            }
        });

        // Adaptive tolerance based on camera distance to scene
        const camToOrigin = this.camera.position.length();
        const baseTolerance = 0.5;
        const adaptiveTolerance = Math.max(baseTolerance, camToOrigin * 0.02); // 2% of camera distance

        log.info(`[_raycastSplatMesh] Closest distance: ${closestDistance.toFixed(3)}, tolerance: ${adaptiveTolerance.toFixed(3)}`);

        if (closestPoint && closestDistance < adaptiveTolerance) {
            log.info(`[_raycastSplatMesh] Hit! Point: [${closestPoint.x.toFixed(3)}, ${closestPoint.y.toFixed(3)}, ${closestPoint.z.toFixed(3)}]`);
            return {
                point: closestPoint,
                distance: ray.origin.distanceTo(closestPoint)
            };
        }

        log.info('[_raycastSplatMesh] No hit within tolerance');
        return null;
    }

    /**
     * Create a color-coded DOM marker at a 3D position with pair label
     */
    private _addMarker(point: Vector3, pairIndex: number, phase: 'anchor' | 'mover'): MarkerData {
        const el = document.createElement('div');
        const colorClass = `pair-${pairIndex % 10}`;
        el.className = `alignment-marker ${phase} ${colorClass}`;
        el.textContent = `${pairIndex + 1}${phase === 'anchor' ? 'A' : 'B'}`;
        if (this._markerContainer) {
            this._markerContainer.appendChild(el);
        }

        const marker: MarkerData = {
            element: el,
            position: point.clone(),
            phase,
            pairIndex,
            colorClass
        };
        this._markers.push(marker);
        return marker;
    }

    /**
     * Remove all markers from the DOM
     */
    private _clearMarkers(): void {
        for (const marker of this._markers) {
            marker.element.remove();
        }
        this._markers = [];
    }

    /**
     * Update instruction text in the mode indicator
     */
    private _updateInstruction(): void {
        if (!this._instructionEl) return;

        if (this._phase === 'place-anchor') {
            const completePairs = this._getCompletePairs().length;
            this._instructionEl.textContent =
                `Point ${this._currentPairIndex + 1}: click on ${this._anchorType} (${completePairs} pairs, min 3)`;
        } else if (this._phase === 'place-mover') {
            this._instructionEl.textContent =
                `Point ${this._currentPairIndex + 1}: click on ${this._moverType}`;
        }
    }

    // ── N-point helpers ─────────────────────────────────────────────

    /**
     * Get all pairs where both anchor and mover are set
     */
    private _getCompletePairs(): AlignmentPair[] {
        return this._pairs.filter(p => p.mover !== null);
    }

    /**
     * Compute RMSE (root mean square error) of the current alignment
     */
    private _computeRMSE(): number | null {
        const complete = this._getCompletePairs();
        if (complete.length < 3) return null;

        const srcPts = complete.map(p => p.mover!);
        const dstPts = complete.map(p => p.anchor);

        const transformMatrix = computeRigidTransformFromPoints(srcPts, dstPts);

        let sumSqError = 0;
        for (let i = 0; i < srcPts.length; i++) {
            const transformed = srcPts[i].clone().applyMatrix4(transformMatrix);
            sumSqError += transformed.distanceToSquared(dstPts[i]);
        }

        return Math.sqrt(sumSqError / complete.length);
    }

    /**
     * Update (or create) the live preview and RMSE display
     */
    private _updatePreview(): void {
        const complete = this._getCompletePairs();
        if (complete.length < 3) {
            this._removePreview();
            this._rmse = null;
            if (this._rmseEl) {
                this._rmseEl.textContent = '';
                this._rmseEl.classList.add('hidden');
            }
            return;
        }

        const srcPts = complete.map(p => p.mover!);
        const dstPts = complete.map(p => p.anchor);

        // Compute transform
        const transformMatrix = computeRigidTransformFromPoints(srcPts, dstPts);
        this._lastTransform = transformMatrix;

        // Compute and display RMSE
        this._rmse = this._computeRMSE();
        if (this._rmseEl && this._rmse !== null) {
            this._rmseEl.textContent = `${complete.length} pairs \u2014 RMSE: ${this._rmse.toFixed(4)} units`;
            this._rmseEl.classList.remove('hidden');
        }

        if (!this._moverObj) return;

        // Convert world-space transform to local-space parameters for the mover
        const parentWorldInverse = new THREE.Matrix4();
        if (this._moverObj.parent) {
            this._moverObj.parent.updateMatrixWorld(true);
            parentWorldInverse.copy(this._moverObj.parent.matrixWorld).invert();
        }

        // For splat mover: move the actual splat (save original on first call)
        if (this._moverType === 'splat') {
            if (!this._savedMoverTransform) {
                this._savedMoverTransform = {
                    position: this._moverObj.position.clone(),
                    quaternion: this._moverObj.quaternion.clone(),
                    scale: this._moverObj.scale.clone()
                };
            }

            const oldWorldMatrix = new THREE.Matrix4().compose(
                this._savedMoverTransform.position,
                this._savedMoverTransform.quaternion,
                this._savedMoverTransform.scale
            );
            if (this._moverObj.parent) {
                oldWorldMatrix.premultiply(this._moverObj.parent.matrixWorld);
            }

            const newWorldMatrix = transformMatrix.clone().multiply(oldWorldMatrix);
            const newLocalMatrix = parentWorldInverse.clone().multiply(newWorldMatrix);

            const newPos = new THREE.Vector3();
            const newQuat = new THREE.Quaternion();
            const newScale = new THREE.Vector3();
            newLocalMatrix.decompose(newPos, newQuat, newScale);

            if (isFinite(newPos.x) && isFinite(newPos.y) && isFinite(newPos.z) &&
                isFinite(newScale.x) && isFinite(newScale.y) && isFinite(newScale.z)) {
                this._moverObj.position.copy(newPos);
                this._moverObj.quaternion.copy(newQuat);
                this._moverObj.scale.copy(newScale);
                this._moverObj.updateMatrix();
                this._moverObj.updateMatrixWorld(true);
            }
        } else {
            // For mesh mover: create a transparent clone for preview
            // Remove old preview first
            if (this._previewGroup) {
                this.scene.remove(this._previewGroup);
                this._previewGroup.traverse((child: Object3D) => {
                    const mesh = child as THREE.Mesh;
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach(m => m.dispose());
                        } else {
                            mesh.material.dispose();
                        }
                    }
                });
                this._previewGroup = null;
            }

            // Clone the mover group
            const clone = this._moverObj.clone(true) as Group;

            // Apply transparent green material to all meshes in the clone
            clone.traverse((child: Object3D) => {
                const mesh = child as THREE.Mesh;
                if (mesh.isMesh) {
                    mesh.material = new THREE.MeshBasicMaterial({
                        color: 0x00ff88,
                        opacity: 0.3,
                        transparent: true,
                        depthWrite: false,
                        side: THREE.DoubleSide
                    });
                }
            });

            // Compute the preview transform
            const oldWorldMatrix = this._moverObj.matrixWorld.clone();
            const newWorldMatrix = transformMatrix.clone().multiply(oldWorldMatrix);

            // Apply directly as world transform (preview group has no parent transform)
            const newPos = new THREE.Vector3();
            const newQuat = new THREE.Quaternion();
            const newScale = new THREE.Vector3();
            newWorldMatrix.decompose(newPos, newQuat, newScale);

            clone.position.copy(newPos);
            clone.quaternion.copy(newQuat);
            clone.scale.copy(newScale);
            clone.updateMatrix();

            this._previewGroup = clone;
            this.scene.add(this._previewGroup);
        }

        log.debug(`[LandmarkAlignment] Preview updated: ${complete.length} pairs, RMSE: ${this._rmse?.toFixed(4)}`);
    }

    /**
     * Remove the preview (ghost mesh clone or restore splat position)
     */
    private _removePreview(): void {
        // Remove mesh preview clone
        if (this._previewGroup) {
            this.scene.remove(this._previewGroup);
            this._previewGroup.traverse((child: Object3D) => {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(m => m.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            });
            this._previewGroup = null;
        }

        // Restore splat mover to original transform
        if (this._savedMoverTransform && this._moverObj) {
            this._moverObj.position.copy(this._savedMoverTransform.position);
            this._moverObj.quaternion.copy(this._savedMoverTransform.quaternion);
            this._moverObj.scale.copy(this._savedMoverTransform.scale);
            this._moverObj.updateMatrix();
            this._moverObj.updateMatrixWorld(true);
        }
        this._savedMoverTransform = null;
    }

    // ── Public: Undo / Apply ──────────────────────────────────────────

    /**
     * Undo the last placed point
     */
    undo(): void {
        if (this._undoStack.length === 0) return;

        const action = this._undoStack.pop()!;

        // Remove the marker from DOM and from _markers array
        action.marker.element.remove();
        const idx = this._markers.indexOf(action.marker);
        if (idx !== -1) this._markers.splice(idx, 1);

        if (action.type === 'mover') {
            // Undo mover point: clear the mover from this pair, go back to place-mover
            this._pairs[action.pairIndex].mover = null;
            this._phase = 'place-mover';
            this._currentPairIndex = action.pairIndex;
        } else {
            // Undo anchor point: remove the entire pair, go back to place-anchor
            this._pairs.splice(action.pairIndex, 1);
            this._currentPairIndex = action.pairIndex;
            this._phase = 'place-anchor';
        }

        // Recalculate preview
        this._updatePreview();

        // Update UI visibility
        const completePairs = this._getCompletePairs().length;
        if (completePairs < 3) {
            if (this._applyBtnEl) this._applyBtnEl.classList.add('hidden');
            if (this._rmseEl) this._rmseEl.classList.add('hidden');
        }
        if (this._undoStack.length === 0) {
            if (this._undoBtnEl) this._undoBtnEl.classList.add('hidden');
        }

        this._updateInstruction();
        log.debug(`[LandmarkAlignment] Undo: removed ${action.type} at pair ${action.pairIndex + 1}`);
    }

    /**
     * Apply the computed alignment transform
     */
    apply(): void {
        const completePairs = this._getCompletePairs();
        if (completePairs.length < 3) return;

        log.info(`[LandmarkAlignment] Applying alignment from ${completePairs.length} point pairs...`);

        try {
            if (!this._moverObj) {
                throw new Error('Mover object is null');
            }

            if (this._moverType === 'splat' && this._savedMoverTransform) {
                // Splat is already at the preview position -- just keep it there
                this._savedMoverTransform = null;
            } else if (this._moverType !== 'splat') {
                // Mesh mover: apply the transform to the real mover object
                const transform = this._lastTransform;
                if (!transform) {
                    throw new Error('No transform computed');
                }

                const parentWorldInverse = new THREE.Matrix4();
                if (this._moverObj.parent) {
                    this._moverObj.parent.updateMatrixWorld(true);
                    parentWorldInverse.copy(this._moverObj.parent.matrixWorld).invert();
                }

                const oldWorldMatrix = this._moverObj.matrixWorld.clone();
                const newWorldMatrix = transform.clone().multiply(oldWorldMatrix);
                const newLocalMatrix = parentWorldInverse.clone().multiply(newWorldMatrix);

                const newPos = new THREE.Vector3();
                const newQuat = new THREE.Quaternion();
                const newScale = new THREE.Vector3();
                newLocalMatrix.decompose(newPos, newQuat, newScale);

                if (!isFinite(newPos.x) || !isFinite(newPos.y) || !isFinite(newPos.z) ||
                    !isFinite(newScale.x) || !isFinite(newScale.y) || !isFinite(newScale.z)) {
                    notify.error('Alignment produced an invalid transform -- try clicking different points');
                    log.error('[LandmarkAlignment] NaN in computed transform');
                    this.cancel();
                    return;
                }

                this._moverObj.position.copy(newPos);
                this._moverObj.quaternion.copy(newQuat);
                this._moverObj.scale.copy(newScale);
                this._moverObj.updateMatrix();
                this._moverObj.updateMatrixWorld(true);

                log.info(`[LandmarkAlignment] Applied to ${this._moverType}:`,
                    `pos=[${newPos.x.toFixed(3)}, ${newPos.y.toFixed(3)}, ${newPos.z.toFixed(3)}]`,
                    `scale=[${newScale.x.toFixed(3)}, ${newScale.y.toFixed(3)}, ${newScale.z.toFixed(3)}]`);
            }

            this.updateTransformInputs();
            this.storeLastPositions();

            const rmseStr = this._rmse !== null ? ` (RMSE: ${this._rmse.toFixed(4)})` : '';
            notify.success(`Alignment complete${rmseStr} (moved ${this._moverType})`);
        } catch (e) {
            const error = e as Error;
            log.error('[LandmarkAlignment] Apply failed:', error);
            notify.error('Alignment failed: ' + error.message);
        }

        // Clean up -- clear savedMoverTransform first so cancel() doesn't restore
        this._savedMoverTransform = null;
        this.cancel();
    }
}

// =============================================================================
// FIT TO VIEW
// =============================================================================

/**
 * Fit camera to view all objects
 */
export function fitToView(deps: FitToViewDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup, camera, controls } = deps;

    const box = new THREE.Box3();
    let hasContent = false;

    if (splatMesh) {
        const splatBounds = computeSplatBoundsFromPositions(splatMesh);
        if (splatBounds.found) {
            box.expandByPoint(splatBounds.min);
            box.expandByPoint(splatBounds.max);
            hasContent = true;
        } else {
            const tempBox = new THREE.Box3().setFromObject(splatMesh);
            if (!tempBox.isEmpty()) {
                box.union(tempBox);
                hasContent = true;
            }
        }
    }

    if (modelGroup && modelGroup.children.length > 0) {
        const tempBox = new THREE.Box3().setFromObject(modelGroup);
        if (!tempBox.isEmpty()) {
            box.union(tempBox);
            hasContent = true;
        }
    }

    if (pointcloudGroup && pointcloudGroup.children.length > 0) {
        const tempBox = new THREE.Box3().setFromObject(pointcloudGroup);
        if (!tempBox.isEmpty()) {
            box.union(tempBox);
            hasContent = true;
        }
    }

    if (!hasContent || box.isEmpty()) {
        notify.warning('No objects to fit to view');
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const fov = camera.fov * (Math.PI / 180);
    const cameraDistance = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

    camera.position.set(
        center.x + cameraDistance * 0.5,
        center.y + cameraDistance * 0.3,
        center.z + cameraDistance
    );
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

// =============================================================================
// ALIGNMENT SAVE/LOAD/RESET
// =============================================================================

/**
 * Apply alignment data to objects
 */
export function applyAlignmentData(data: AlignmentData, deps: AlignmentDataDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup, updateTransformInputs, storeLastPositions } = deps;

    if (data.splat && splatMesh) {
        splatMesh.position.fromArray(data.splat.position);
        splatMesh.rotation.set(...data.splat.rotation);
        splatMesh.scale.setScalar(data.splat.scale);
    }

    if (data.model && modelGroup) {
        modelGroup.position.fromArray(data.model.position);
        modelGroup.rotation.set(...data.model.rotation);
        modelGroup.scale.setScalar(data.model.scale);
    }

    if (data.pointcloud && pointcloudGroup) {
        pointcloudGroup.position.fromArray(data.pointcloud.position);
        pointcloudGroup.rotation.set(...data.pointcloud.rotation);
        pointcloudGroup.scale.setScalar(data.pointcloud.scale);
    }

    updateTransformInputs();
    if (storeLastPositions) storeLastPositions();
}

/**
 * Reset alignment to defaults
 */
export function resetAlignment(deps: AlignmentDataDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup, updateTransformInputs, storeLastPositions } = deps;

    if (splatMesh) {
        splatMesh.position.set(0, 0, 0);
        splatMesh.rotation.set(0, 0, 0);
        splatMesh.scale.setScalar(1);
    }

    if (modelGroup) {
        modelGroup.position.set(0, 0, 0);
        modelGroup.rotation.set(0, 0, 0);
        modelGroup.scale.setScalar(1);
    }

    if (pointcloudGroup) {
        pointcloudGroup.position.set(0, 0, 0);
        pointcloudGroup.rotation.set(0, 0, 0);
        pointcloudGroup.scale.setScalar(1);
    }

    updateTransformInputs();
    if (storeLastPositions) storeLastPositions();
}

/**
 * Reset camera to initial position
 */
export function resetCamera(deps: ResetCameraDeps): void {
    const { camera, controls, initialPosition } = deps;

    camera.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
}

// =============================================================================
// ALIGNMENT I/O (extracted from main.js)
// =============================================================================

/**
 * Save current alignment transforms to a JSON file.
 */
export async function saveAlignment(deps: SaveAlignmentDeps): Promise<void> {
    const { splatMesh, modelGroup, pointcloudGroup, tauriBridge } = deps;

    const alignment: AlignmentData = {
        version: 1,
        splat: splatMesh ? {
            position: splatMesh.position.toArray() as [number, number, number],
            rotation: [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z],
            scale: splatMesh.scale.x
        } : null,
        model: modelGroup ? {
            position: modelGroup.position.toArray() as [number, number, number],
            rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z],
            scale: modelGroup.scale.x
        } : null,
        pointcloud: pointcloudGroup ? {
            position: pointcloudGroup.position.toArray() as [number, number, number],
            rotation: [pointcloudGroup.rotation.x, pointcloudGroup.rotation.y, pointcloudGroup.rotation.z],
            scale: pointcloudGroup.scale.x
        } : null
    };

    const blob = new Blob([JSON.stringify(alignment, null, 2)], { type: 'application/json' });
    if (tauriBridge) {
        await tauriBridge.download(blob, 'alignment.json', { name: 'JSON Files', extensions: ['json'] });
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'alignment.json';
        a.click();
        URL.revokeObjectURL(url);
    }
}

/**
 * Load alignment from a file input event and apply it.
 */
export function loadAlignment(event: Event, deps: LoadAlignmentDeps): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
            const result = e.target?.result;
            if (typeof result !== 'string') {
                throw new Error('Failed to read file as text');
            }
            const alignment = JSON.parse(result) as AlignmentData;
            applyAlignmentData(alignment, deps);
        } catch (error) {
            const err = error as Error;
            notify.error('Error loading alignment file: ' + err.message);
        }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    target.value = '';
}

/**
 * Load alignment from a URL and apply it.
 */
export async function loadAlignmentFromUrl(url: string, deps: LoadAlignmentDeps): Promise<boolean> {
    try {
        log.info('Loading alignment from URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const alignment = await response.json() as AlignmentData;
        applyAlignmentData(alignment, deps);
        log.info('Alignment loaded successfully from URL');
        return true;
    } catch (error) {
        log.error('Error loading alignment from URL:', error);
        return false;
    }
}

// =============================================================================

/**
 * Center a model on the grid (y=0) when loaded standalone (without a splat).
 *
 * Uses pivot centering: offsets children so their collective center is at the
 * group's local origin, then positions the group so the model sits on y=0.
 * This ensures TransformControls gizmo appears at the model's visual center.
 */
export function centerModelOnGrid(modelGroup: Group): void {
    if (!modelGroup || modelGroup.children.length === 0) {
        log.warn('[centerModelOnGrid] No model to center');
        return;
    }

    const box = new THREE.Box3().setFromObject(modelGroup);

    if (box.isEmpty()) {
        log.warn('[centerModelOnGrid] Model bounding box is empty');
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Position group so model sits on the grid (y=0), centered on x/z.
    // Only adjust the group position — do NOT modify children positions,
    // because child offsets are not saved in the archive manifest and would
    // be lost on re-import.
    modelGroup.position.set(
        -center.x,
        -center.y + size.y / 2,
        -center.z
    );

    log.info('[centerModelOnGrid] Model centered on grid:', {
        newPosition: modelGroup.position.toArray()
    });
}

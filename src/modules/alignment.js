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
import { Logger, notify } from './utilities.js';

const log = Logger.getLogger('alignment');

// =============================================================================
// CENTROID AND ROTATION COMPUTATION
// =============================================================================

/**
 * Compute centroid of points
 * @param {Array<{x: number, y: number, z: number}>} points
 * @returns {{x: number, y: number, z: number}}
 */
function computeCentroid(points) {
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
 * @param {Array} sourcePoints - Source point cloud
 * @param {Array} targetPoints - Target point cloud
 * @param {Object} sourceCentroid - Centroid of source points
 * @param {Object} targetCentroid - Centroid of target points
 * @returns {THREE.Matrix4} Rotation matrix
 */
function computeOptimalRotation(sourcePoints, targetPoints, sourceCentroid, targetCentroid) {
    // Build the covariance matrix H
    let h = [
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
 * @param {Object} splatMeshObj - The SplatMesh object
 * @returns {{min: THREE.Vector3, max: THREE.Vector3, center: THREE.Vector3, found: boolean}}
 */
function computeSplatBoundsFromPositions(splatMeshObj) {
    const bounds = {
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
        center: new THREE.Vector3(),
        found: false
    };

    splatMeshObj.updateMatrixWorld(true);
    const worldMatrix = splatMeshObj.matrixWorld;

    if (splatMeshObj.packedSplats && typeof splatMeshObj.packedSplats.forEachSplat === 'function') {
        let count = 0;
        const splatCount = splatMeshObj.packedSplats.splatCount || 0;

        if (splatCount > 0) {
            const maxSamples = 10000;
            const stride = Math.max(1, Math.floor(splatCount / maxSamples));

            splatMeshObj.packedSplats.forEachSplat((index, center) => {
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
 * @param {Object} deps - Dependencies object
 */
export function autoCenterAlign(deps) {
    const { splatMesh, modelGroup, updateTransformInputs, storeLastPositions } = deps;

    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        return;
    }

    // Compute bounding-box centers
    const splatBounds = computeSplatBoundsFromPositions(splatMesh);
    let splatCenter;
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

    let mover, moverCenter, anchorCenter;
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
 * @param {THREE.Vector3[]} srcPts - 3 source points (on the mover)
 * @param {THREE.Vector3[]} dstPts - 3 corresponding destination points (on the anchor)
 * @returns {THREE.Matrix4} World-space transform matrix
 */
function computeRigidTransformFromPoints(srcPts, dstPts) {
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
 * Interactive 3-point landmark alignment tool.
 *
 * Workflow:
 * 1. User clicks "Align Objects" → enters alignment mode
 * 2. Clicks 3 points on the anchor object (numbered markers appear)
 * 3. Clicks 3 corresponding points on the mover object
 * 4. Rigid transform computed and applied to the mover
 */
export class LandmarkAlignment {
    /**
     * @param {Object} deps - Dependencies
     * @param {THREE.Scene} deps.scene
     * @param {THREE.Camera} deps.camera
     * @param {THREE.WebGLRenderer} deps.renderer
     * @param {Object} deps.controls - OrbitControls
     */
    constructor(deps) {
        this.scene = deps.scene;
        this.camera = deps.camera;
        this.renderer = deps.renderer;
        this.controls = deps.controls;

        // These are updated via updateRefs() when assets load
        this.splatMesh = deps.splatMesh || null;
        this.modelGroup = deps.modelGroup || null;

        // Callbacks from main.js
        this.updateTransformInputs = deps.updateTransformInputs;
        this.storeLastPositions = deps.storeLastPositions;

        // State
        this._active = false;
        this._phase = null;      // 'anchor' or 'mover'
        this._anchorObj = null;
        this._anchorType = '';    // 'splat' or 'model'
        this._moverObj = null;
        this._moverType = '';
        this._anchorPoints = [];  // THREE.Vector3[]
        this._moverPoints = [];   // THREE.Vector3[]

        // DOM
        this._markerContainer = null;
        this._markers = [];       // { element, position: THREE.Vector3, phase }
        this._indicatorEl = null;
        this._instructionEl = null;

        // Raycaster
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();

        // Bound handlers
        this._onClickBound = this._onClick.bind(this);
        this._onKeyDownBound = this._onKeyDown.bind(this);

        this._ensureContainer();
    }

    /**
     * Update asset references (called when splat/model loads)
     */
    updateRefs(splatMesh, modelGroup) {
        this.splatMesh = splatMesh;
        this.modelGroup = modelGroup;
    }

    /**
     * Ensure the marker container exists in the DOM
     */
    _ensureContainer() {
        this._markerContainer = document.getElementById('alignment-markers');
        if (!this._markerContainer) {
            this._markerContainer = document.createElement('div');
            this._markerContainer.id = 'alignment-markers';
            document.body.appendChild(this._markerContainer);
        }

        this._indicatorEl = document.getElementById('alignment-mode-indicator');
        this._instructionEl = document.getElementById('alignment-instruction');
    }

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Enter alignment mode
     */
    start() {
        if (this._active) return;

        if (!this.splatMesh || !this.modelGroup || this.modelGroup.children.length === 0) {
            notify.warning('Both splat and model must be loaded for alignment');
            return;
        }

        this._active = true;

        // Determine anchor/mover
        const splatBounds = computeSplatBoundsFromPositions(this.splatMesh);
        let splatCenter;
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

        this._phase = 'anchor';
        this._anchorPoints = [];
        this._moverPoints = [];
        this._clearMarkers();

        // Attach listeners
        this.renderer.domElement.addEventListener('click', this._onClickBound);
        document.addEventListener('keydown', this._onKeyDownBound);
        this.renderer.domElement.style.cursor = 'crosshair';

        // Show indicator
        this._updateInstruction();
        if (this._indicatorEl) this._indicatorEl.classList.remove('hidden');

        log.info(`[LandmarkAlignment] Started — anchor: ${this._anchorType}, mover: ${this._moverType}`);
    }

    /**
     * Cancel alignment mode and clean up
     */
    cancel() {
        if (!this._active) return;

        this._active = false;
        this._phase = null;
        this._anchorPoints = [];
        this._moverPoints = [];
        this._clearMarkers();

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
     * @returns {boolean}
     */
    isActive() {
        return this._active;
    }

    /**
     * Update marker screen positions — call each frame from animate()
     */
    updateMarkerPositions() {
        if (!this._active || this._markers.length === 0) return;

        const rect = this.renderer.domElement.getBoundingClientRect();

        for (const marker of this._markers) {
            const screenPos = marker.position.clone().project(this.camera);
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
    dispose() {
        this.cancel();
    }

    // ── Private ─────────────────────────────────────────────────────

    /**
     * Handle click during alignment mode
     */
    _onClick(event) {
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
        const targetObj = this._phase === 'anchor' ? this._anchorObj : this._moverObj;
        const hit = intersects.find(h => this._isDescendantOf(h.object, targetObj));

        if (!hit) return;

        const point = hit.point.clone();

        if (this._phase === 'anchor') {
            this._anchorPoints.push(point);
            this._addMarker(point, this._anchorPoints.length, 'anchor');
            log.debug(`[LandmarkAlignment] Anchor point ${this._anchorPoints.length}: [${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}]`);

            if (this._anchorPoints.length === 3) {
                this._phase = 'mover';
            }
            this._updateInstruction();

        } else if (this._phase === 'mover') {
            this._moverPoints.push(point);
            this._addMarker(point, this._moverPoints.length, 'mover');
            log.debug(`[LandmarkAlignment] Mover point ${this._moverPoints.length}: [${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}]`);

            if (this._moverPoints.length === 3) {
                this._computeAndApply();
            } else {
                this._updateInstruction();
            }
        }
    }

    /**
     * Handle keydown — Escape cancels
     */
    _onKeyDown(event) {
        if (event.key === 'Escape') {
            this.cancel();
            notify.info('Alignment cancelled');
        }
    }

    /**
     * Check whether obj is targetObj itself or a descendant of it
     */
    _isDescendantOf(obj, targetObj) {
        // For splat mesh, direct equality check
        if (obj === targetObj) return true;

        // For model group, walk up the parent chain
        let current = obj;
        while (current) {
            if (current === targetObj) return true;
            current = current.parent;
        }
        return false;
    }

    /**
     * Create a numbered DOM marker at a 3D position
     */
    _addMarker(point, number, phase) {
        const el = document.createElement('div');
        el.className = `alignment-marker ${phase}`;
        el.textContent = number;
        this._markerContainer.appendChild(el);

        this._markers.push({
            element: el,
            position: point.clone(),
            phase
        });
    }

    /**
     * Remove all markers from the DOM
     */
    _clearMarkers() {
        for (const marker of this._markers) {
            marker.element.remove();
        }
        this._markers = [];
    }

    /**
     * Update instruction text in the mode indicator
     */
    _updateInstruction() {
        if (!this._instructionEl) return;

        if (this._phase === 'anchor') {
            const count = this._anchorPoints.length;
            this._instructionEl.textContent =
                `Click 3 points on the ${this._anchorType} (${count} of 3)`;
        } else if (this._phase === 'mover') {
            const count = this._moverPoints.length;
            this._instructionEl.textContent =
                `Now click 3 matching points on the ${this._moverType} (${count} of 3)`;
        }
    }

    /**
     * Compute and apply the rigid transform from the 6 clicked points
     */
    _computeAndApply() {
        log.info('[LandmarkAlignment] Computing rigid transform from 3 point pairs...');

        try {
            // Source = mover points (in world space), Destination = anchor points (in world space)
            const transformMatrix = computeRigidTransformFromPoints(this._moverPoints, this._anchorPoints);

            // Convert world-space transform to local space for the mover
            const parentWorldInverse = new THREE.Matrix4();
            if (this._moverObj.parent) {
                this._moverObj.parent.updateMatrixWorld(true);
                parentWorldInverse.copy(this._moverObj.parent.matrixWorld).invert();
            }

            const oldWorldMatrix = this._moverObj.matrixWorld.clone();
            const newWorldMatrix = transformMatrix.clone().multiply(oldWorldMatrix);
            const newLocalMatrix = parentWorldInverse.clone().multiply(newWorldMatrix);

            const newPos = new THREE.Vector3();
            const newQuat = new THREE.Quaternion();
            const newScale = new THREE.Vector3();
            newLocalMatrix.decompose(newPos, newQuat, newScale);

            // Validate
            if (!isFinite(newPos.x) || !isFinite(newPos.y) || !isFinite(newPos.z) ||
                !isFinite(newScale.x) || !isFinite(newScale.y) || !isFinite(newScale.z)) {
                notify.error('Alignment produced an invalid transform — try clicking different points');
                log.error('[LandmarkAlignment] NaN in computed transform');
                this.cancel();
                return;
            }

            // Apply
            this._moverObj.position.copy(newPos);
            this._moverObj.quaternion.copy(newQuat);
            this._moverObj.scale.copy(newScale);
            this._moverObj.updateMatrix();
            this._moverObj.updateMatrixWorld(true);

            log.info(`[LandmarkAlignment] Applied to ${this._moverType}:`,
                `pos=[${newPos.x.toFixed(3)}, ${newPos.y.toFixed(3)}, ${newPos.z.toFixed(3)}]`,
                `scale=[${newScale.x.toFixed(3)}, ${newScale.y.toFixed(3)}, ${newScale.z.toFixed(3)}]`);

            this.updateTransformInputs();
            this.storeLastPositions();

            notify.success(`Alignment complete (moved ${this._moverType})`);
        } catch (e) {
            log.error('[LandmarkAlignment] Transform computation failed:', e);
            notify.error('Alignment failed: ' + e.message);
        }

        // Clean up regardless of success/failure
        this.cancel();
    }
}

// =============================================================================
// FIT TO VIEW
// =============================================================================

/**
 * Fit camera to view all objects
 * @param {Object} deps - Dependencies object
 */
export function fitToView(deps) {
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
 * @param {Object} data - Alignment data with splat/model/pointcloud transforms
 * @param {Object} deps - Dependencies object
 */
export function applyAlignmentData(data, deps) {
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
 * @param {Object} deps - Dependencies object
 */
export function resetAlignment(deps) {
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
    storeLastPositions();
}

/**
 * Reset camera to initial position
 * @param {Object} deps - Dependencies object
 */
export function resetCamera(deps) {
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
 * @param {Object} deps - { splatMesh, modelGroup, pointcloudGroup, tauriBridge }
 */
export async function saveAlignment(deps) {
    const { splatMesh, modelGroup, pointcloudGroup, tauriBridge } = deps;

    const alignment = {
        version: 1,
        splat: splatMesh ? {
            position: splatMesh.position.toArray(),
            rotation: [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z],
            scale: splatMesh.scale.x
        } : null,
        model: modelGroup ? {
            position: modelGroup.position.toArray(),
            rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z],
            scale: modelGroup.scale.x
        } : null,
        pointcloud: pointcloudGroup ? {
            position: pointcloudGroup.position.toArray(),
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
 * @param {Event} event - File input change event
 * @param {Object} deps - Dependencies for applyAlignmentData
 */
export function loadAlignment(event, deps) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const alignment = JSON.parse(e.target.result);
            applyAlignmentData(alignment, deps);
        } catch (error) {
            notify('Error loading alignment file: ' + error.message, 'error');
        }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    event.target.value = '';
}

/**
 * Load alignment from a URL and apply it.
 * @param {string} url - URL to fetch alignment JSON from
 * @param {Object} deps - Dependencies for applyAlignmentData
 * @returns {Promise<boolean>} true if loaded successfully
 */
export async function loadAlignmentFromUrl(url, deps) {
    try {
        log.info('Loading alignment from URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const alignment = await response.json();
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
 * @param {THREE.Group} modelGroup - The model group to center
 */
export function centerModelOnGrid(modelGroup) {
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

    const offsetX = -center.x;
    const offsetY = -box.min.y;
    const offsetZ = -center.z;

    modelGroup.position.x += offsetX;
    modelGroup.position.y += offsetY;
    modelGroup.position.z += offsetZ;

    log.info('[centerModelOnGrid] Model centered on grid:', {
        newPosition: modelGroup.position.toArray(),
        offset: [offsetX, offsetY, offsetZ]
    });
}

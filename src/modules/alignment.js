/**
 * Alignment Module
 *
 * Handles 3D object alignment algorithms:
 * - KD-Tree for efficient nearest neighbor search
 * - ICP (Iterative Closest Point) alignment
 * - Auto-alignment based on bounding boxes
 * - Fit-to-view camera positioning
 * - Alignment save/load/reset
 * - Share link generation
 */

import * as THREE from 'three';
import { Logger, notify } from './utilities.js';

const log = Logger.getLogger('alignment');

// =============================================================================
// KD-TREE IMPLEMENTATION
// =============================================================================

/**
 * KD-Tree for efficient nearest neighbor search in 3D space.
 * Used by ICP alignment algorithm.
 */
export class KDTree {
    constructor(points) {
        // points is an array of {x, y, z, index}
        this.root = this.buildTree(points, 0);
    }

    buildTree(points, depth) {
        if (points.length === 0) return null;

        const axis = depth % 3; // 0=x, 1=y, 2=z
        const axisKey = ['x', 'y', 'z'][axis];

        // Sort points by the current axis
        points.sort((a, b) => a[axisKey] - b[axisKey]);

        const median = Math.floor(points.length / 2);

        return {
            point: points[median],
            axis: axis,
            left: this.buildTree(points.slice(0, median), depth + 1),
            right: this.buildTree(points.slice(median + 1), depth + 1)
        };
    }

    /**
     * Find nearest neighbor to target point
     * @param {Object} target - Point with x, y, z properties
     * @returns {{point: Object, distSq: number}}
     */
    nearestNeighbor(target) {
        let best = { point: null, distSq: Infinity };
        this.searchNearest(this.root, target, best);
        return best;
    }

    searchNearest(node, target, best) {
        if (node === null) return;

        const dx = target.x - node.point.x;
        const dy = target.y - node.point.y;
        const dz = target.z - node.point.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < best.distSq) {
            best.point = node.point;
            best.distSq = distSq;
        }

        const axisKey = ['x', 'y', 'z'][node.axis];
        const diff = target[axisKey] - node.point[axisKey];

        // Search the closer side first
        const first = diff < 0 ? node.left : node.right;
        const second = diff < 0 ? node.right : node.left;

        this.searchNearest(first, target, best);

        // Only search the other side if it could contain a closer point
        if (diff * diff < best.distSq) {
            this.searchNearest(second, target, best);
        }
    }
}

// =============================================================================
// POINT EXTRACTION
// =============================================================================

/**
 * Extract positions from splat mesh in world space
 * @param {Object} splatMeshObj - The SplatMesh object
 * @param {number} maxPoints - Maximum points to extract
 * @returns {Array<{x: number, y: number, z: number, index: number}>}
 */
export function extractSplatPositions(splatMeshObj, maxPoints = 5000) {
    const positions = [];

    // Get splat's world matrix for transforming local positions to world space
    splatMeshObj.updateMatrixWorld(true);
    const worldMatrix = splatMeshObj.matrixWorld;

    log.debug('[extractSplatPositions] Checking available APIs...');
    log.debug('[extractSplatPositions] packedSplats:', !!splatMeshObj.packedSplats);
    log.debug('[extractSplatPositions] geometry:', !!splatMeshObj.geometry);

    // Try to access splat positions via Spark library's packedSplats API
    if (splatMeshObj.packedSplats && typeof splatMeshObj.packedSplats.forEachSplat === 'function') {
        let count = 0;
        const splatCount = splatMeshObj.packedSplats.splatCount || 0;
        log.debug('[extractSplatPositions] splatCount:', splatCount);

        if (splatCount === 0) {
            log.warn('[extractSplatPositions] splatCount is 0, splat may still be loading');
        }

        const stride = Math.max(1, Math.floor(splatCount / maxPoints));

        try {
            splatMeshObj.packedSplats.forEachSplat((index, center) => {
                if (index % stride === 0 && count < maxPoints) {
                    // center is a reused Vector3, so clone and transform to world space
                    const worldPos = new THREE.Vector3(center.x, center.y, center.z);
                    worldPos.applyMatrix4(worldMatrix);
                    positions.push({
                        x: worldPos.x,
                        y: worldPos.y,
                        z: worldPos.z,
                        index: index
                    });
                    count++;
                }
            });
        } catch (e) {
            log.error('[extractSplatPositions] Error in forEachSplat:', e);
        }
        log.debug(`[extractSplatPositions] Extracted ${positions.length} splat positions via forEachSplat (world space)`);
    } else if (splatMeshObj.geometry && splatMeshObj.geometry.attributes.position) {
        // Fallback: try to read from geometry
        const posAttr = splatMeshObj.geometry.attributes.position;
        log.debug('[extractSplatPositions] geometry.position.count:', posAttr.count);
        const stride = Math.max(1, Math.floor(posAttr.count / maxPoints));
        for (let i = 0; i < posAttr.count && positions.length < maxPoints; i += stride) {
            const worldPos = new THREE.Vector3(
                posAttr.getX(i),
                posAttr.getY(i),
                posAttr.getZ(i)
            );
            worldPos.applyMatrix4(worldMatrix);
            positions.push({
                x: worldPos.x,
                y: worldPos.y,
                z: worldPos.z,
                index: i
            });
        }
        log.debug(`[extractSplatPositions] Extracted ${positions.length} splat positions from geometry (world space)`);
    } else {
        log.warn('[extractSplatPositions] Could not find splat position data');
        log.debug('[extractSplatPositions] Available splatMesh properties:', Object.keys(splatMeshObj));
        if (splatMeshObj.packedSplats) {
            log.debug('[extractSplatPositions] Available packedSplats properties:', Object.keys(splatMeshObj.packedSplats));
        }
    }

    return positions;
}

/**
 * Extract vertex positions from model mesh in world space
 * @param {THREE.Group} modelGroupObj - The model group
 * @param {number} maxPoints - Maximum points to extract
 * @returns {Array<{x: number, y: number, z: number, index: number}>}
 */
export function extractMeshVertices(modelGroupObj, maxPoints = 10000) {
    const positions = [];
    const allVertices = [];

    // Collect all vertices from all meshes
    modelGroupObj.traverse((child) => {
        if (child.isMesh && child.geometry) {
            const geo = child.geometry;
            const posAttr = geo.attributes.position;
            if (!posAttr) return;

            // Get world matrix for this mesh
            child.updateMatrixWorld(true);
            const matrix = child.matrixWorld;

            for (let i = 0; i < posAttr.count; i++) {
                const v = new THREE.Vector3(
                    posAttr.getX(i),
                    posAttr.getY(i),
                    posAttr.getZ(i)
                );
                v.applyMatrix4(matrix);
                allVertices.push({ x: v.x, y: v.y, z: v.z, index: allVertices.length });
            }
        }
    });

    // Subsample if too many vertices
    const stride = Math.max(1, Math.floor(allVertices.length / maxPoints));
    for (let i = 0; i < allVertices.length && positions.length < maxPoints; i += stride) {
        positions.push(allVertices[i]);
    }

    log.debug(`[ICP] Extracted ${positions.length} mesh vertices (from ${allVertices.length} total)`);
    return positions;
}

// =============================================================================
// CENTROID AND ROTATION COMPUTATION
// =============================================================================

/**
 * Compute centroid of points
 * @param {Array<{x: number, y: number, z: number}>} points
 * @returns {{x: number, y: number, z: number}}
 */
export function computeCentroid(points) {
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
export function computeOptimalRotation(sourcePoints, targetPoints, sourceCentroid, targetCentroid) {
    // Build the covariance matrix H
    // H = sum((source - sourceCentroid) * (target - targetCentroid)^T)
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
        // Multiply n * q
        const newQ = [
            n[0][0] * q[0] + n[0][1] * q[1] + n[0][2] * q[2] + n[0][3] * q[3],
            n[1][0] * q[0] + n[1][1] * q[1] + n[1][2] * q[2] + n[1][3] * q[3],
            n[2][0] * q[0] + n[2][1] * q[1] + n[2][2] * q[2] + n[2][3] * q[3],
            n[3][0] * q[0] + n[3][1] * q[1] + n[3][2] * q[2] + n[3][3] * q[3]
        ];

        // Normalize
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
export function computeSplatBoundsFromPositions(splatMeshObj) {
    const bounds = {
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
        center: new THREE.Vector3(),
        found: false
    };

    splatMeshObj.updateMatrixWorld(true);
    const worldMatrix = splatMeshObj.matrixWorld;

    // Try to access splat positions via packedSplats
    if (splatMeshObj.packedSplats && typeof splatMeshObj.packedSplats.forEachSplat === 'function') {
        let count = 0;
        const splatCount = splatMeshObj.packedSplats.splatCount || 0;

        if (splatCount > 0) {
            // Sample up to 10000 splats for bounds calculation
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
// ICP ALIGNMENT
// =============================================================================

/**
 * Run ICP alignment between splat and model
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.splatMesh - The splat mesh
 * @param {THREE.Group} deps.modelGroup - The model group
 * @param {Function} deps.showLoading - Show loading overlay
 * @param {Function} deps.hideLoading - Hide loading overlay
 * @param {Function} deps.updateTransformInputs - Update UI inputs
 * @param {Function} deps.storeLastPositions - Store positions for undo
 * @returns {Promise<void>}
 */
export async function icpAlignObjects(deps) {
    const { splatMesh, modelGroup, showLoading, hideLoading, updateTransformInputs, storeLastPositions } = deps;

    log.debug('[ICP] icpAlignObjects called');

    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        notify.warning('Both splat and model must be loaded for ICP alignment');
        return;
    }

    showLoading('Running ICP alignment...');

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        // Extract points in world space
        log.debug('[ICP] Extracting splat positions...');
        const splatPoints = extractSplatPositions(splatMesh, 3000);
        log.debug('[ICP] Extracted splat points:', splatPoints.length);

        log.debug('[ICP] Extracting mesh vertices...');
        const meshPoints = extractMeshVertices(modelGroup, 8000);
        log.debug('[ICP] Extracted mesh points:', meshPoints.length);

        if (splatPoints.length < 10) {
            hideLoading();
            notify.warning('Could not extract enough splat positions for ICP (' + splatPoints.length + ' found). The splat may not support position extraction or may still be loading.');
            return;
        }

        if (meshPoints.length < 10) {
            hideLoading();
            notify.warning('Could not extract enough mesh vertices for ICP (' + meshPoints.length + ' found).');
            return;
        }

        log.debug(`[ICP] Starting ICP with ${splatPoints.length} splat points and ${meshPoints.length} mesh points`);

        // ---- Step 0: Centroid pre-alignment and scale correction ----
        const srcCentroid = computeCentroid(splatPoints);
        const tgtCentroid = computeCentroid(meshPoints);

        // Compute RMS spread from centroids for scale estimation
        let srcSpreadSq = 0, tgtSpreadSq = 0;
        for (const p of splatPoints) {
            srcSpreadSq += (p.x - srcCentroid.x) ** 2 + (p.y - srcCentroid.y) ** 2 + (p.z - srcCentroid.z) ** 2;
        }
        for (const p of meshPoints) {
            tgtSpreadSq += (p.x - tgtCentroid.x) ** 2 + (p.y - tgtCentroid.y) ** 2 + (p.z - tgtCentroid.z) ** 2;
        }
        const srcRMS = Math.sqrt(srcSpreadSq / splatPoints.length);
        const tgtRMS = Math.sqrt(tgtSpreadSq / meshPoints.length);
        const scaleFactor = (srcRMS > 1e-10) ? tgtRMS / srcRMS : 1.0;

        log.debug(`[ICP] Source RMS spread: ${srcRMS.toFixed(4)}, Target RMS spread: ${tgtRMS.toFixed(4)}, Scale factor: ${scaleFactor.toFixed(4)}`);

        // Build pre-alignment matrix: translate to origin, scale, translate to target centroid
        const preAlign = new THREE.Matrix4();
        const toOrigin = new THREE.Matrix4().makeTranslation(-srcCentroid.x, -srcCentroid.y, -srcCentroid.z);
        const scaleM = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
        const toTarget = new THREE.Matrix4().makeTranslation(tgtCentroid.x, tgtCentroid.y, tgtCentroid.z);
        preAlign.copy(toTarget).multiply(scaleM).multiply(toOrigin);

        // Apply pre-alignment to working points
        let currentPoints = splatPoints.map(p => {
            const v = new THREE.Vector3(p.x, p.y, p.z);
            v.applyMatrix4(preAlign);
            return { x: v.x, y: v.y, z: v.z, index: p.index };
        });

        // Cumulative transformation starts with pre-alignment
        let cumulativeMatrix = preAlign.clone();

        // Build KD-tree from mesh points for fast nearest neighbor search
        const kdTree = new KDTree([...meshPoints]);

        // ---- ICP iterations ----
        const maxIterations = 50;
        const convergenceThreshold = 1e-6;
        let prevMeanError = Infinity;

        for (let iter = 0; iter < maxIterations; iter++) {
            // Step 1: Find correspondences with outlier rejection
            const allCorrespondences = [];
            for (const srcPt of currentPoints) {
                const nearest = kdTree.nearestNeighbor(srcPt);
                if (nearest.point) {
                    allCorrespondences.push({
                        source: srcPt,
                        target: nearest.point,
                        distSq: nearest.distSq
                    });
                }
            }

            if (allCorrespondences.length < 10) break;

            // Outlier rejection: discard worst 20% of correspondences by distance
            allCorrespondences.sort((a, b) => a.distSq - b.distSq);
            const keepCount = Math.max(10, Math.floor(allCorrespondences.length * 0.8));
            const correspondences = allCorrespondences.slice(0, keepCount);

            let totalError = 0;
            for (const c of correspondences) totalError += c.distSq;
            const meanError = totalError / correspondences.length;
            log.debug(`[ICP] Iteration ${iter + 1}: Mean squared error = ${meanError.toFixed(6)} (${correspondences.length} correspondences)`);

            // Check convergence
            if (Math.abs(prevMeanError - meanError) < convergenceThreshold) {
                log.debug(`[ICP] Converged after ${iter + 1} iterations`);
                break;
            }
            prevMeanError = meanError;

            // Step 2: Compute optimal transformation
            const sourceForAlign = correspondences.map(c => c.source);
            const targetForAlign = correspondences.map(c => c.target);

            const sourceCentroid = computeCentroid(sourceForAlign);
            const targetCentroid = computeCentroid(targetForAlign);

            // Compute rotation
            const rotMatrix = computeOptimalRotation(sourceForAlign, targetForAlign, sourceCentroid, targetCentroid);

            // Compute translation: t = targetCentroid - R * sourceCentroid
            const rotatedSourceCentroid = new THREE.Vector3(sourceCentroid.x, sourceCentroid.y, sourceCentroid.z);
            rotatedSourceCentroid.applyMatrix4(rotMatrix);

            const translation = new THREE.Vector3(
                targetCentroid.x - rotatedSourceCentroid.x,
                targetCentroid.y - rotatedSourceCentroid.y,
                targetCentroid.z - rotatedSourceCentroid.z
            );

            // Build transformation matrix for this iteration
            const iterMatrix = new THREE.Matrix4();
            iterMatrix.makeTranslation(translation.x, translation.y, translation.z);
            iterMatrix.multiply(rotMatrix);

            // Update cumulative transformation
            cumulativeMatrix.premultiply(iterMatrix);

            // Transform current points for next iteration
            currentPoints = currentPoints.map(p => {
                const v = new THREE.Vector3(p.x, p.y, p.z);
                v.applyMatrix4(iterMatrix);
                return { x: v.x, y: v.y, z: v.z, index: p.index };
            });
        }

        // ---- Apply cumulative transformation to splat mesh ----
        log.debug('[ICP] Applying cumulative transformation to splat mesh');

        // Combine with existing local transform, accounting for parent
        // cumulativeMatrix maps: old world positions -> new world positions
        // We need: new local matrix such that parent * newLocal = cumulativeMatrix * parent * oldLocal
        // If parent is identity: newLocal = cumulativeMatrix * oldLocal
        const parentWorldInverse = new THREE.Matrix4();
        if (splatMesh.parent) {
            splatMesh.parent.updateMatrixWorld(true);
            parentWorldInverse.copy(splatMesh.parent.matrixWorld).invert();
        }

        // newLocal = parentInverse * cumulative * parentWorld * oldLocal
        const oldWorldMatrix = splatMesh.matrixWorld.clone();
        const newWorldMatrix = cumulativeMatrix.clone().multiply(oldWorldMatrix);
        const newLocalMatrix = parentWorldInverse.clone().multiply(newWorldMatrix);

        // Decompose the result
        const newPos = new THREE.Vector3();
        const newQuat = new THREE.Quaternion();
        const newScale = new THREE.Vector3();
        newLocalMatrix.decompose(newPos, newQuat, newScale);

        // Apply to splatMesh
        splatMesh.position.copy(newPos);
        splatMesh.quaternion.copy(newQuat);
        splatMesh.scale.copy(newScale);
        splatMesh.updateMatrix();
        splatMesh.updateMatrixWorld(true);

        log.debug('[ICP] ICP alignment complete');
        log.debug('[ICP] New splat position:', splatMesh.position.toArray());
        log.debug('[ICP] New splat scale:', splatMesh.scale.toArray());
        log.debug('[ICP] Scale correction applied:', scaleFactor.toFixed(4));

        updateTransformInputs();
        storeLastPositions();

        hideLoading();
        notify.success(`ICP alignment complete (scale: ${scaleFactor.toFixed(2)}x)`);

    } catch (e) {
        log.error('[ICP] ICP alignment failed:', e);
        hideLoading();
        notify.error('ICP alignment failed: ' + e.message);
    }
}

// =============================================================================
// AUTO-ALIGNMENT
// =============================================================================

/**
 * Auto-align model to splat based on bounding boxes
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.splatMesh - The splat mesh
 * @param {THREE.Group} deps.modelGroup - The model group
 * @param {Function} deps.updateTransformInputs - Update UI inputs
 * @param {Function} deps.storeLastPositions - Store positions for undo
 * @returns {void}
 */
export function autoAlignObjects(deps) {
    const { splatMesh, modelGroup, updateTransformInputs, storeLastPositions } = deps;

    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        notify.warning('Both splat and model must be loaded for auto-alignment');
        return;
    }

    log.debug('Auto-aligning model to splat...');

    // Get model bounding box
    const modelBox = new THREE.Box3().setFromObject(modelGroup);
    const modelCenter = modelBox.getCenter(new THREE.Vector3());

    // Try to get splat bounding box
    let splatBox = new THREE.Box3();
    let splatCenter = new THREE.Vector3();
    let splatBoundsFound = false;

    // First, try the built-in boundingBox
    if (splatMesh.geometry && splatMesh.geometry.boundingBox) {
        splatMesh.geometry.computeBoundingBox();
        splatBox.copy(splatMesh.geometry.boundingBox);
        splatBox.applyMatrix4(splatMesh.matrixWorld);
        splatCenter = splatBox.getCenter(new THREE.Vector3());
        splatBoundsFound = true;
        log.debug('Auto-align: Using geometry.boundingBox');
    }

    // If built-in box seems invalid, try computing from positions
    if (!splatBoundsFound || splatBox.isEmpty() ||
        (splatBox.max.x - splatBox.min.x) < 0.001) {
        log.debug('Auto-align: Built-in bounds invalid, computing from positions...');
        const computedBounds = computeSplatBoundsFromPositions(splatMesh);
        if (computedBounds.found) {
            splatBox.min.copy(computedBounds.min);
            splatBox.max.copy(computedBounds.max);
            splatCenter.copy(computedBounds.center);
            splatBoundsFound = true;
            log.debug('Auto-align: Using computed bounds from positions');
        }
    }

    // Fallback to setFromObject if still no bounds
    if (!splatBoundsFound || splatBox.isEmpty()) {
        log.debug('Auto-align: Falling back to setFromObject');
        splatBox.setFromObject(splatMesh);
        splatCenter = splatBox.getCenter(new THREE.Vector3());
    }

    log.debug('Splat bounds:', splatBox.min.toArray(), 'to', splatBox.max.toArray());
    log.debug('Model bounds:', modelBox.min.toArray(), 'to', modelBox.max.toArray());

    // Align centers horizontally (X, Z) and align bottoms vertically (Y)
    const splatBottom = splatBox.min.y;
    const modelBottom = modelBox.min.y;

    // Calculate where the model should be positioned
    const targetX = splatCenter.x;
    const targetY = modelGroup.position.y + (splatBottom - modelBottom);
    const targetZ = splatCenter.z;

    // Calculate offset from current model center to target position
    const offsetX = targetX - modelCenter.x;
    const offsetZ = targetZ - modelCenter.z;

    // Apply the offset
    modelGroup.position.x += offsetX;
    modelGroup.position.y = targetY;
    modelGroup.position.z += offsetZ;
    modelGroup.updateMatrixWorld(true);

    updateTransformInputs();
    storeLastPositions();

    log.debug('Auto-align complete:', {
        splatBounds: { min: splatBox.min.toArray(), max: splatBox.max.toArray(), center: splatCenter.toArray() },
        modelBounds: { min: modelBox.min.toArray(), max: modelBox.max.toArray(), center: modelCenter.toArray() },
        modelPosition: modelGroup.position.toArray(),
        splatBoundsFound: splatBoundsFound
    });
}

// =============================================================================
// FIT TO VIEW
// =============================================================================

/**
 * Fit camera to view all objects
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.splatMesh - The splat mesh (can be null)
 * @param {THREE.Group} deps.modelGroup - The model group (can be null)
 * @param {THREE.Camera} deps.camera - The camera
 * @param {Object} deps.controls - OrbitControls
 * @returns {void}
 */
export function fitToView(deps) {
    const { splatMesh, modelGroup, camera, controls } = deps;

    const box = new THREE.Box3();
    let hasContent = false;

    if (splatMesh) {
        // For splat, try computed bounds first
        const splatBounds = computeSplatBoundsFromPositions(splatMesh);
        if (splatBounds.found) {
            box.expandByPoint(splatBounds.min);
            box.expandByPoint(splatBounds.max);
            hasContent = true;
        } else {
            // Fallback to setFromObject
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

    if (!hasContent || box.isEmpty()) {
        notify.warning('No objects to fit to view');
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Position camera to fit the object
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
 * Collect current alignment data
 * @param {Object} deps - Dependencies object
 * @returns {Object} Alignment data
 */
export function collectAlignmentData(deps) {
    const { splatMesh, modelGroup } = deps;

    const data = {};

    if (splatMesh) {
        data.splat = {
            position: [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z],
            rotation: [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z],
            scale: splatMesh.scale.x
        };
    }

    if (modelGroup) {
        data.model = {
            position: [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z],
            rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z],
            scale: modelGroup.scale.x
        };
    }

    return data;
}

/**
 * Apply alignment data to objects
 * @param {Object} data - Alignment data
 * @param {Object} deps - Dependencies object
 * @param {Function} deps.updateTransformInputs - Update UI inputs
 */
export function applyAlignmentData(data, deps) {
    const { splatMesh, modelGroup, updateTransformInputs } = deps;

    if (data.splat && splatMesh) {
        splatMesh.position.set(...data.splat.position);
        splatMesh.rotation.set(...data.splat.rotation);
        splatMesh.scale.setScalar(data.splat.scale);
    }

    if (data.model && modelGroup) {
        modelGroup.position.set(...data.model.position);
        modelGroup.rotation.set(...data.model.rotation);
        modelGroup.scale.setScalar(data.model.scale);
    }

    updateTransformInputs();
}

/**
 * Reset alignment to defaults
 * @param {Object} deps - Dependencies object
 */
export function resetAlignment(deps) {
    const { splatMesh, modelGroup, updateTransformInputs, storeLastPositions } = deps;

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

    updateTransformInputs();
    storeLastPositions();
}

/**
 * Reset camera to initial position
 * @param {Object} deps - Dependencies object
 * @param {THREE.Camera} deps.camera - The camera
 * @param {Object} deps.controls - OrbitControls
 * @param {Object} deps.initialPosition - Initial camera position {x, y, z}
 */
export function resetCamera(deps) {
    const { camera, controls, initialPosition } = deps;

    camera.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
}

// =============================================================================
// SHARE LINK GENERATION
// =============================================================================

/**
 * Generate share link parameters from current alignment
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.state - Application state
 * @param {Object} deps.splatMesh - The splat mesh
 * @param {THREE.Group} deps.modelGroup - The model group
 * @returns {URLSearchParams} URL parameters
 */
export function generateShareParams(deps) {
    const { state, splatMesh, modelGroup } = deps;
    const params = new URLSearchParams();

    // Add file URLs
    if (state.currentArchiveUrl) {
        params.set('archive', state.currentArchiveUrl);
    } else {
        if (state.currentSplatUrl) {
            params.set('splat', state.currentSplatUrl);
        }
        if (state.currentModelUrl) {
            params.set('model', state.currentModelUrl);
        }
    }

    // Add alignment parameters
    if (splatMesh) {
        const sp = splatMesh.position;
        const sr = splatMesh.rotation;
        const ss = splatMesh.scale.x;

        if (sp.x !== 0 || sp.y !== 0 || sp.z !== 0) {
            params.set('sp', `${sp.x.toFixed(3)},${sp.y.toFixed(3)},${sp.z.toFixed(3)}`);
        }
        if (sr.x !== 0 || sr.y !== 0 || sr.z !== 0) {
            params.set('sr', `${sr.x.toFixed(4)},${sr.y.toFixed(4)},${sr.z.toFixed(4)}`);
        }
        if (ss !== 1) {
            params.set('ss', ss.toFixed(3));
        }
    }

    if (modelGroup) {
        const mp = modelGroup.position;
        const mr = modelGroup.rotation;
        const ms = modelGroup.scale.x;

        if (mp.x !== 0 || mp.y !== 0 || mp.z !== 0) {
            params.set('mp', `${mp.x.toFixed(3)},${mp.y.toFixed(3)},${mp.z.toFixed(3)}`);
        }
        if (mr.x !== 0 || mr.y !== 0 || mr.z !== 0) {
            params.set('mr', `${mr.x.toFixed(4)},${mr.y.toFixed(4)},${mr.z.toFixed(4)}`);
        }
        if (ms !== 1) {
            params.set('ms', ms.toFixed(3));
        }
    }

    return params;
}

/**
 * Center a model on the grid (y=0) when loaded standalone (without a splat).
 * Positions the model so its bottom is on the grid and it's centered horizontally.
 * @param {THREE.Group} modelGroup - The model group to center
 */
export function centerModelOnGrid(modelGroup) {
    if (!modelGroup || modelGroup.children.length === 0) {
        log.warn('[centerModelOnGrid] No model to center');
        return;
    }

    // Calculate the bounding box of the model
    const box = new THREE.Box3().setFromObject(modelGroup);

    if (box.isEmpty()) {
        log.warn('[centerModelOnGrid] Model bounding box is empty');
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    log.debug('[centerModelOnGrid] Model bounds:', {
        min: box.min.toArray(),
        max: box.max.toArray(),
        center: center.toArray(),
        size: size.toArray()
    });

    // Calculate offset to center the model horizontally (X, Z) and place bottom on grid (Y)
    // The model's current world position affects where the bounding box is
    // We need to offset the modelGroup position to achieve the desired placement

    // Target: center.x = 0, center.z = 0, box.min.y = 0
    const offsetX = -center.x;
    const offsetY = -box.min.y;  // Move bottom to y=0
    const offsetZ = -center.z;

    modelGroup.position.x += offsetX;
    modelGroup.position.y += offsetY;
    modelGroup.position.z += offsetZ;

    log.info('[centerModelOnGrid] Model centered on grid:', {
        newPosition: modelGroup.position.toArray(),
        offset: [offsetX, offsetY, offsetZ]
    });
}

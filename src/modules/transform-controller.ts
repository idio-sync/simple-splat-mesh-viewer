/**
 * Transform Controller Module
 *
 * Handles transform gizmo orchestration:
 * - Attaching/detaching transform controls to selected objects
 * - Syncing paired objects in "both" mode
 * - Tracking delta movements for multi-object sync
 * - Transform mode switching (translate/rotate/scale)
 *
 * Extracted from main.js. The 9 tracking vectors are private module state.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import type { AppState, SelectedObject, TransformMode } from '@/types.js';

const log = Logger.getLogger('transform-controller');

// Private tracking state for sync calculations
const lastSplatPosition = new THREE.Vector3();
const lastSplatRotation = new THREE.Euler();
const lastSplatScale = new THREE.Vector3(1, 1, 1);
const lastModelPosition = new THREE.Vector3();
const lastModelRotation = new THREE.Euler();
const lastModelScale = new THREE.Vector3(1, 1, 1);
const lastPointcloudPosition = new THREE.Vector3();
const lastPointcloudRotation = new THREE.Euler();
const lastPointcloudScale = new THREE.Vector3(1, 1, 1);

// Quaternion tracking for pivot rotation
const lastSplatQuat = new THREE.Quaternion();
const lastModelQuat = new THREE.Quaternion();

interface SetSelectedObjectDeps {
    transformControls: any; // TODO: type when @types/three is installed (TransformControls)
    splatMesh: any; // TODO: type when @types/three is installed (SplatMesh | null)
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
    state: AppState;
}

/**
 * Set the selected object for transform controls.
 * @param selection - 'splat', 'model', 'both', or 'none'
 * @param deps - { transformControls, splatMesh, modelGroup, state }
 */
export function setSelectedObject(selection: SelectedObject, deps: SetSelectedObjectDeps): void {
    const { transformControls, splatMesh, modelGroup, state } = deps;
    state.selectedObject = selection;

    // Update button states
    (['splat', 'model', 'both', 'none'] as const).forEach(s => {
        const btn = document.getElementById(`btn-select-${s}`);
        if (btn) btn.classList.toggle('active', s === selection);
    });

    // Attach transform controls with error handling
    try {
        transformControls.detach();
    } catch (e) {
        log.warn('Error detaching transform controls:', e);
    }

    try {
        if (selection === 'splat' && splatMesh) {
            transformControls.attach(splatMesh);
        } else if (selection === 'model' && modelGroup && modelGroup.children.length > 0) {
            transformControls.attach(modelGroup);
        } else if (selection === 'both') {
            // For both, attach to splat and sync model
            if (splatMesh) {
                transformControls.attach(splatMesh);
            } else if (modelGroup && modelGroup.children.length > 0) {
                transformControls.attach(modelGroup);
            }
        }
    } catch (attachError) {
        log.error('Error attaching transform controls:', attachError);
        log.error('This may be due to THREE.js instance mismatch.');
        // Don't re-throw - allow the rest of the application to continue
    }
}

interface SyncBothObjectsDeps {
    transformControls: any; // TODO: type when @types/three is installed (TransformControls)
    splatMesh: any; // TODO: type when @types/three is installed (SplatMesh | null)
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup: any; // TODO: type when @types/three is installed (THREE.Group)
}

/**
 * Sync both objects when moving in "both" mode.
 * Applies delta movement from the attached object to the other objects.
 * @param deps - { transformControls, splatMesh, modelGroup, pointcloudGroup }
 */
export function syncBothObjects(deps: SyncBothObjectsDeps): void {
    const { transformControls, splatMesh, modelGroup, pointcloudGroup } = deps;
    if (!splatMesh || !modelGroup) return;

    // Calculate the delta movement based on which object is attached
    if (transformControls.object === splatMesh) {
        const deltaPos = new THREE.Vector3().subVectors(splatMesh.position, lastSplatPosition);
        const deltaRot = new THREE.Euler(
            splatMesh.rotation.x - lastSplatRotation.x,
            splatMesh.rotation.y - lastSplatRotation.y,
            splatMesh.rotation.z - lastSplatRotation.z
        );
        // Calculate scale ratio to apply proportionally
        const scaleRatio = lastSplatScale.x !== 0 ? splatMesh.scale.x / lastSplatScale.x : 1;

        modelGroup.position.add(deltaPos);
        modelGroup.rotation.x += deltaRot.x;
        modelGroup.rotation.y += deltaRot.y;
        modelGroup.rotation.z += deltaRot.z;
        modelGroup.scale.multiplyScalar(scaleRatio);

        if (pointcloudGroup) {
            pointcloudGroup.position.add(deltaPos);
            pointcloudGroup.rotation.x += deltaRot.x;
            pointcloudGroup.rotation.y += deltaRot.y;
            pointcloudGroup.rotation.z += deltaRot.z;
            pointcloudGroup.scale.multiplyScalar(scaleRatio);
        }
    } else if (transformControls.object === modelGroup) {
        const deltaPos = new THREE.Vector3().subVectors(modelGroup.position, lastModelPosition);
        const deltaRot = new THREE.Euler(
            modelGroup.rotation.x - lastModelRotation.x,
            modelGroup.rotation.y - lastModelRotation.y,
            modelGroup.rotation.z - lastModelRotation.z
        );
        // Calculate scale ratio to apply proportionally
        const scaleRatio = lastModelScale.x !== 0 ? modelGroup.scale.x / lastModelScale.x : 1;

        splatMesh.position.add(deltaPos);
        splatMesh.rotation.x += deltaRot.x;
        splatMesh.rotation.y += deltaRot.y;
        splatMesh.rotation.z += deltaRot.z;
        splatMesh.scale.multiplyScalar(scaleRatio);

        if (pointcloudGroup) {
            pointcloudGroup.position.add(deltaPos);
            pointcloudGroup.rotation.x += deltaRot.x;
            pointcloudGroup.rotation.y += deltaRot.y;
            pointcloudGroup.rotation.z += deltaRot.z;
            pointcloudGroup.scale.multiplyScalar(scaleRatio);
        }
    }

    // Update last positions and scales
    if (splatMesh) {
        lastSplatPosition.copy(splatMesh.position);
        lastSplatRotation.copy(splatMesh.rotation);
        lastSplatScale.copy(splatMesh.scale);
    }
    if (modelGroup) {
        lastModelPosition.copy(modelGroup.position);
        lastModelRotation.copy(modelGroup.rotation);
        lastModelScale.copy(modelGroup.scale);
    }
    if (pointcloudGroup) {
        lastPointcloudPosition.copy(pointcloudGroup.position);
        lastPointcloudRotation.copy(pointcloudGroup.rotation);
        lastPointcloudScale.copy(pointcloudGroup.scale);
    }
}

interface StoreLastPositionsDeps {
    splatMesh: any; // TODO: type when @types/three is installed (SplatMesh | null)
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup: any; // TODO: type when @types/three is installed (THREE.Group)
}

/**
 * Store last positions, rotations, and scales for delta calculations.
 * Must be called when selection changes or after applying transforms.
 * @param deps - { splatMesh, modelGroup, pointcloudGroup }
 */
export function storeLastPositions(deps: StoreLastPositionsDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup } = deps;
    if (splatMesh) {
        lastSplatPosition.copy(splatMesh.position);
        lastSplatRotation.copy(splatMesh.rotation);
        lastSplatScale.copy(splatMesh.scale);
        lastSplatQuat.copy(splatMesh.quaternion);
    }
    if (modelGroup) {
        lastModelPosition.copy(modelGroup.position);
        lastModelRotation.copy(modelGroup.rotation);
        lastModelScale.copy(modelGroup.scale);
        lastModelQuat.copy(modelGroup.quaternion);
    }
    if (pointcloudGroup) {
        lastPointcloudPosition.copy(pointcloudGroup.position);
        lastPointcloudRotation.copy(pointcloudGroup.rotation);
        lastPointcloudScale.copy(pointcloudGroup.scale);
    }
}

interface SetTransformModeDeps {
    transformControls: any; // TODO: type when @types/three is installed (TransformControls)
    state: AppState;
    splatMesh: any; // TODO: type when @types/three is installed (SplatMesh | null)
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup: any; // TODO: type when @types/three is installed (THREE.Group)
}

/**
 * Set the transform mode (translate/rotate/scale).
 * @param mode - 'translate', 'rotate', or 'scale'
 * @param deps - { transformControls, state, splatMesh, modelGroup, pointcloudGroup }
 */
export function setTransformMode(mode: TransformMode, deps: SetTransformModeDeps): void {
    const { transformControls, state, splatMesh, modelGroup, pointcloudGroup } = deps;
    state.transformMode = mode;
    transformControls.setMode(mode);

    // Update button states
    (['translate', 'rotate', 'scale'] as const).forEach(m => {
        const btnId = m === 'translate' ? 'btn-translate' : m === 'rotate' ? 'btn-rotate' : 'btn-scale';
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.toggle('active', m === mode);
    });

    // Store positions when changing mode
    storeLastPositions({ splatMesh, modelGroup, pointcloudGroup });
}

interface ResetTransformDeps {
    splatMesh: any;
    modelGroup: any;
    pointcloudGroup: any;
    state: AppState;
}

/**
 * Reset position and rotation to zero for the selected object(s).
 * @param deps - { splatMesh, modelGroup, pointcloudGroup, state }
 */
export function resetTransform(deps: ResetTransformDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup, state } = deps;
    const sel = state.selectedObject;
    if (sel === 'none') return;

    if ((sel === 'splat' || sel === 'both') && splatMesh) {
        splatMesh.position.set(0, 0, 0);
        splatMesh.rotation.set(0, 0, 0);
    }
    if ((sel === 'model' || sel === 'both') && modelGroup) {
        modelGroup.position.set(0, 0, 0);
        modelGroup.rotation.set(0, 0, 0);
    }
    if (sel === 'both' && pointcloudGroup) {
        pointcloudGroup.position.set(0, 0, 0);
        pointcloudGroup.rotation.set(0, 0, 0);
    }

    // Re-store positions for delta tracking
    storeLastPositions({ splatMesh, modelGroup, pointcloudGroup });
    log.info(`Reset transform for: ${sel}`);
}

// =============================================================================
// CENTER AT ORIGIN (move objects so combined center is at 0,0,0)
// =============================================================================

interface CenterAtOriginDeps {
    splatMesh: any;
    modelGroup: any;
    pointcloudGroup: any;
    camera: any;         // THREE.PerspectiveCamera
    controls: any;       // OrbitControls
    state: AppState;
}

/**
 * Compute the combined bounding-box center of all loaded objects,
 * translate every object so that center lands at world origin (0,0,0),
 * move the camera by the same offset so the view doesn't jump,
 * and reset the orbit-controls target to the origin.
 */
export function centerAtOrigin(deps: CenterAtOriginDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup, camera, controls, state } = deps;

    const box = new THREE.Box3();
    let hasContent = false;

    // Splat — use setFromObject (world-space) consistently
    if (splatMesh && state.splatLoaded) {
        const tempBox = new THREE.Box3().setFromObject(splatMesh);
        if (!tempBox.isEmpty()) {
            box.union(tempBox);
            hasContent = true;
        }
    }

    // Mesh
    if (modelGroup && state.modelLoaded && modelGroup.children.length > 0) {
        const tempBox = new THREE.Box3().setFromObject(modelGroup);
        if (!tempBox.isEmpty()) {
            box.union(tempBox);
            hasContent = true;
        }
    }

    // Point cloud
    if (pointcloudGroup && state.pointcloudLoaded && pointcloudGroup.children.length > 0) {
        const tempBox = new THREE.Box3().setFromObject(pointcloudGroup);
        if (!tempBox.isEmpty()) {
            box.union(tempBox);
            hasContent = true;
        }
    }

    if (!hasContent) {
        log.warn('centerAtOrigin: no loaded objects to center');
        return;
    }

    const fullCenter = box.getCenter(new THREE.Vector3());
    // Only shift on X and Z axes (preserve vertical position)
    const offset = new THREE.Vector3(fullCenter.x, 0, fullCenter.z);

    // Shift every object by -offset so the XZ center lands at origin
    if (splatMesh) {
        splatMesh.position.sub(offset);
    }
    if (modelGroup) {
        modelGroup.position.sub(offset);
    }
    if (pointcloudGroup) {
        pointcloudGroup.position.sub(offset);
    }

    // Move camera and orbit target by the same offset so the view doesn't jump
    camera.position.sub(offset);
    controls.target.sub(offset);
    controls.update();

    // Re-store positions for delta tracking
    storeLastPositions({ splatMesh, modelGroup, pointcloudGroup });

    log.info('Centered objects on XZ plane (offset:', offset.x.toFixed(3), offset.z.toFixed(3), ')');
}

// =============================================================================
// PIVOT ROTATION (rotate around world origin instead of object origin)
// =============================================================================

interface ApplyPivotRotationDeps {
    transformControls: any;
    splatMesh: any;
    modelGroup: any;
    pointcloudGroup: any;
    state: AppState;
}

/**
 * When rotationPivot is 'origin', adjust the object's position so it
 * orbits around world origin (0,0,0) instead of its own local origin.
 *
 * TransformControls only changes .rotation — we compute the quaternion
 * delta and rotate the position vector around the origin by that delta.
 *
 * Must be called from the objectChange callback AFTER syncBothObjects
 * (so the "both" mode position deltas are applied first, then we layer
 * the pivot offset on top).
 */
export function applyPivotRotation(deps: ApplyPivotRotationDeps): void {
    const { transformControls, splatMesh, modelGroup, pointcloudGroup, state } = deps;
    if (state.rotationPivot !== 'origin') return;
    if (state.transformMode !== 'rotate') return;

    const obj = transformControls.object;
    if (!obj) return;

    // Determine which last-quaternion to use
    const lastQuat = (obj === splatMesh) ? lastSplatQuat : lastModelQuat;

    // Compute delta: deltaQ = currentQ * inverse(lastQ)
    const currentQuat = obj.quaternion.clone();
    const deltaQuat = currentQuat.clone().multiply(lastQuat.clone().invert());

    // Rotate this object's position around origin
    obj.position.applyQuaternion(deltaQuat);

    // In "both" mode, also orbit the paired objects around origin
    if (state.selectedObject === 'both') {
        if (obj === splatMesh && modelGroup) {
            modelGroup.position.applyQuaternion(deltaQuat);
        } else if (obj === modelGroup && splatMesh) {
            splatMesh.position.applyQuaternion(deltaQuat);
        }
        if (pointcloudGroup) {
            pointcloudGroup.position.applyQuaternion(deltaQuat);
        }
    }

    // Update stored quaternion for next delta
    if (obj === splatMesh) {
        lastSplatQuat.copy(currentQuat);
    } else {
        lastModelQuat.copy(currentQuat);
    }
}

// =============================================================================
// UNIFORM SCALE (lock proportions)
// =============================================================================

interface ApplyUniformScaleDeps {
    transformControls: any;
    splatMesh: any;
    modelGroup: any;
    state: AppState;
}

/**
 * When scaleLockProportions is true and in scale mode, enforce uniform scaling.
 * Detects which axis changed the most and applies that ratio to all three axes.
 *
 * Must be called from the objectChange callback.
 */
export function applyUniformScale(deps: ApplyUniformScaleDeps): void {
    const { transformControls, splatMesh, state } = deps;
    if (!state.scaleLockProportions) return;
    if (state.transformMode !== 'scale') return;

    const obj = transformControls.object;
    if (!obj) return;

    const lastScale = (obj === splatMesh) ? lastSplatScale : lastModelScale;

    // Find which axis changed the most (largest absolute ratio delta from 1.0)
    const rx = lastScale.x !== 0 ? obj.scale.x / lastScale.x : 1;
    const ry = lastScale.y !== 0 ? obj.scale.y / lastScale.y : 1;
    const rz = lastScale.z !== 0 ? obj.scale.z / lastScale.z : 1;

    const dx = Math.abs(rx - 1);
    const dy = Math.abs(ry - 1);
    const dz = Math.abs(rz - 1);

    // Pick the dominant axis ratio
    const ratio = (dx >= dy && dx >= dz) ? rx : (dy >= dx && dy >= dz) ? ry : rz;

    // Apply uniform scale
    const uniform = lastScale.x * ratio;
    obj.scale.set(uniform, uniform, uniform);
}

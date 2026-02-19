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

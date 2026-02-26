/**
 * Transform Controller Module
 *
 * Handles transform gizmo orchestration:
 * - Attaching/detaching transform controls to selected objects
 * - Syncing paired objects in "both" mode
 * - Tracking delta movements for multi-object sync
 * - Transform mode switching (translate/rotate/scale)
 *
 * Extracted from main.js. The tracking vectors are private module state.
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
const lastStlPosition = new THREE.Vector3();
const lastStlRotation = new THREE.Euler();
const lastStlScale = new THREE.Vector3(1, 1, 1);
const lastCadPosition = new THREE.Vector3();
const lastCadRotation = new THREE.Euler();
const lastCadScale = new THREE.Vector3(1, 1, 1);
const lastDrawingPosition = new THREE.Vector3();
const lastDrawingRotation = new THREE.Euler();
const lastDrawingScale = new THREE.Vector3(1, 1, 1);

// Quaternion tracking for pivot rotation
const lastSplatQuat = new THREE.Quaternion();
const lastModelQuat = new THREE.Quaternion();

interface SetSelectedObjectDeps {
    transformControls: any; // TODO: type when @types/three is installed (TransformControls)
    splatMesh: any; // TODO: type when @types/three is installed (SplatMesh | null)
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup: any; // THREE.Group
    stlGroup: any; // THREE.Group
    cadGroup: any; // THREE.Group
    drawingGroup: any; // THREE.Group
    state: AppState;
}

/**
 * Set the selected object for transform controls.
 * @param selection - 'splat', 'model', 'pointcloud', 'stl', 'cad', 'drawing', 'both', or 'none'
 * @param deps - { transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, state }
 */
export function setSelectedObject(selection: SelectedObject, deps: SetSelectedObjectDeps): void {
    const { transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, state } = deps;
    state.selectedObject = selection;

    // Update button states
    (['splat', 'model', 'pointcloud', 'stl', 'cad', 'drawing', 'both', 'none'] as const).forEach(s => {
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
        } else if (selection === 'pointcloud' && pointcloudGroup && pointcloudGroup.children.length > 0) {
            transformControls.attach(pointcloudGroup);
        } else if (selection === 'stl' && stlGroup && stlGroup.children.length > 0) {
            transformControls.attach(stlGroup);
        } else if (selection === 'cad' && cadGroup && cadGroup.children.length > 0) {
            transformControls.attach(cadGroup);
        } else if (selection === 'drawing' && drawingGroup && drawingGroup.children.length > 0) {
            transformControls.attach(drawingGroup);
        } else if (selection === 'both') {
            // For both, attach to splat first, then model, then other groups as fallback
            if (splatMesh) {
                transformControls.attach(splatMesh);
            } else if (modelGroup && modelGroup.children.length > 0) {
                transformControls.attach(modelGroup);
            } else if (pointcloudGroup && pointcloudGroup.children.length > 0) {
                transformControls.attach(pointcloudGroup);
            } else if (stlGroup && stlGroup.children.length > 0) {
                transformControls.attach(stlGroup);
            } else if (cadGroup && cadGroup.children.length > 0) {
                transformControls.attach(cadGroup);
            } else if (drawingGroup && drawingGroup.children.length > 0) {
                transformControls.attach(drawingGroup);
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
    pointcloudGroup: any; // THREE.Group
    stlGroup: any; // THREE.Group
    cadGroup: any; // THREE.Group
    drawingGroup: any; // THREE.Group
}

/**
 * Sync all objects when moving in "both" mode.
 * Applies delta movement from the attached object to all other objects.
 * @param deps - { transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup }
 */
export function syncBothObjects(deps: SyncBothObjectsDeps): void {
    const { transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup } = deps;

    // Helper to apply delta to a group
    const applyDelta = (obj: any, deltaPos: THREE.Vector3, deltaRot: THREE.Euler, scaleRatio: number) => {
        if (!obj) return;
        obj.position.add(deltaPos);
        obj.rotation.x += deltaRot.x;
        obj.rotation.y += deltaRot.y;
        obj.rotation.z += deltaRot.z;
        obj.scale.multiplyScalar(scaleRatio);
    };

    // Calculate the delta movement based on which object is attached
    if (splatMesh && transformControls.object === splatMesh) {
        const deltaPos = new THREE.Vector3().subVectors(splatMesh.position, lastSplatPosition);
        const deltaRot = new THREE.Euler(
            splatMesh.rotation.x - lastSplatRotation.x,
            splatMesh.rotation.y - lastSplatRotation.y,
            splatMesh.rotation.z - lastSplatRotation.z
        );
        const scaleRatio = lastSplatScale.x !== 0 ? splatMesh.scale.x / lastSplatScale.x : 1;

        applyDelta(modelGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(pointcloudGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(stlGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(cadGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(drawingGroup, deltaPos, deltaRot, scaleRatio);
    } else if (modelGroup && transformControls.object === modelGroup) {
        const deltaPos = new THREE.Vector3().subVectors(modelGroup.position, lastModelPosition);
        const deltaRot = new THREE.Euler(
            modelGroup.rotation.x - lastModelRotation.x,
            modelGroup.rotation.y - lastModelRotation.y,
            modelGroup.rotation.z - lastModelRotation.z
        );
        const scaleRatio = lastModelScale.x !== 0 ? modelGroup.scale.x / lastModelScale.x : 1;

        if (splatMesh) {
            splatMesh.position.add(deltaPos);
            splatMesh.rotation.x += deltaRot.x;
            splatMesh.rotation.y += deltaRot.y;
            splatMesh.rotation.z += deltaRot.z;
            splatMesh.scale.multiplyScalar(scaleRatio);
        }
        applyDelta(pointcloudGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(stlGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(cadGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(drawingGroup, deltaPos, deltaRot, scaleRatio);
    } else if (pointcloudGroup && transformControls.object === pointcloudGroup) {
        const deltaPos = new THREE.Vector3().subVectors(pointcloudGroup.position, lastPointcloudPosition);
        const deltaRot = new THREE.Euler(
            pointcloudGroup.rotation.x - lastPointcloudRotation.x,
            pointcloudGroup.rotation.y - lastPointcloudRotation.y,
            pointcloudGroup.rotation.z - lastPointcloudRotation.z
        );
        const scaleRatio = lastPointcloudScale.x !== 0 ? pointcloudGroup.scale.x / lastPointcloudScale.x : 1;

        if (splatMesh) {
            splatMesh.position.add(deltaPos);
            splatMesh.rotation.x += deltaRot.x;
            splatMesh.rotation.y += deltaRot.y;
            splatMesh.rotation.z += deltaRot.z;
            splatMesh.scale.multiplyScalar(scaleRatio);
        }
        applyDelta(modelGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(stlGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(cadGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(drawingGroup, deltaPos, deltaRot, scaleRatio);
    } else if (stlGroup && transformControls.object === stlGroup) {
        const deltaPos = new THREE.Vector3().subVectors(stlGroup.position, lastStlPosition);
        const deltaRot = new THREE.Euler(
            stlGroup.rotation.x - lastStlRotation.x,
            stlGroup.rotation.y - lastStlRotation.y,
            stlGroup.rotation.z - lastStlRotation.z
        );
        const scaleRatio = lastStlScale.x !== 0 ? stlGroup.scale.x / lastStlScale.x : 1;

        if (splatMesh) {
            splatMesh.position.add(deltaPos);
            splatMesh.rotation.x += deltaRot.x;
            splatMesh.rotation.y += deltaRot.y;
            splatMesh.rotation.z += deltaRot.z;
            splatMesh.scale.multiplyScalar(scaleRatio);
        }
        applyDelta(modelGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(pointcloudGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(cadGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(drawingGroup, deltaPos, deltaRot, scaleRatio);
    } else if (cadGroup && transformControls.object === cadGroup) {
        const deltaPos = new THREE.Vector3().subVectors(cadGroup.position, lastCadPosition);
        const deltaRot = new THREE.Euler(
            cadGroup.rotation.x - lastCadRotation.x,
            cadGroup.rotation.y - lastCadRotation.y,
            cadGroup.rotation.z - lastCadRotation.z
        );
        const scaleRatio = lastCadScale.x !== 0 ? cadGroup.scale.x / lastCadScale.x : 1;

        if (splatMesh) {
            splatMesh.position.add(deltaPos);
            splatMesh.rotation.x += deltaRot.x;
            splatMesh.rotation.y += deltaRot.y;
            splatMesh.rotation.z += deltaRot.z;
            splatMesh.scale.multiplyScalar(scaleRatio);
        }
        applyDelta(modelGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(pointcloudGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(stlGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(drawingGroup, deltaPos, deltaRot, scaleRatio);
    } else if (drawingGroup && transformControls.object === drawingGroup) {
        const deltaPos = new THREE.Vector3().subVectors(drawingGroup.position, lastDrawingPosition);
        const deltaRot = new THREE.Euler(
            drawingGroup.rotation.x - lastDrawingRotation.x,
            drawingGroup.rotation.y - lastDrawingRotation.y,
            drawingGroup.rotation.z - lastDrawingRotation.z
        );
        const scaleRatio = lastDrawingScale.x !== 0 ? drawingGroup.scale.x / lastDrawingScale.x : 1;

        if (splatMesh) {
            splatMesh.position.add(deltaPos);
            splatMesh.rotation.x += deltaRot.x;
            splatMesh.rotation.y += deltaRot.y;
            splatMesh.rotation.z += deltaRot.z;
            splatMesh.scale.multiplyScalar(scaleRatio);
        }
        applyDelta(modelGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(pointcloudGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(stlGroup, deltaPos, deltaRot, scaleRatio);
        applyDelta(cadGroup, deltaPos, deltaRot, scaleRatio);
    }

    // Update last positions and scales for all objects
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
    if (stlGroup) {
        lastStlPosition.copy(stlGroup.position);
        lastStlRotation.copy(stlGroup.rotation);
        lastStlScale.copy(stlGroup.scale);
    }
    if (cadGroup) {
        lastCadPosition.copy(cadGroup.position);
        lastCadRotation.copy(cadGroup.rotation);
        lastCadScale.copy(cadGroup.scale);
    }
    if (drawingGroup) {
        lastDrawingPosition.copy(drawingGroup.position);
        lastDrawingRotation.copy(drawingGroup.rotation);
        lastDrawingScale.copy(drawingGroup.scale);
    }
}

interface StoreLastPositionsDeps {
    splatMesh: any; // TODO: type when @types/three is installed (SplatMesh | null)
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup: any; // THREE.Group
    stlGroup: any; // THREE.Group
    cadGroup: any; // THREE.Group
    drawingGroup: any; // THREE.Group
}

/**
 * Store last positions, rotations, and scales for delta calculations.
 * Must be called when selection changes or after applying transforms.
 * @param deps - { splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup }
 */
export function storeLastPositions(deps: StoreLastPositionsDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup } = deps;
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
    if (stlGroup) {
        lastStlPosition.copy(stlGroup.position);
        lastStlRotation.copy(stlGroup.rotation);
        lastStlScale.copy(stlGroup.scale);
    }
    if (cadGroup) {
        lastCadPosition.copy(cadGroup.position);
        lastCadRotation.copy(cadGroup.rotation);
        lastCadScale.copy(cadGroup.scale);
    }
    if (drawingGroup) {
        lastDrawingPosition.copy(drawingGroup.position);
        lastDrawingRotation.copy(drawingGroup.rotation);
        lastDrawingScale.copy(drawingGroup.scale);
    }
}

interface SetTransformModeDeps {
    transformControls: any; // TODO: type when @types/three is installed (TransformControls)
    state: AppState;
    splatMesh: any; // TODO: type when @types/three is installed (SplatMesh | null)
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup: any; // THREE.Group
    stlGroup: any; // THREE.Group
    cadGroup: any; // THREE.Group
    drawingGroup: any; // THREE.Group
}

/**
 * Set the transform mode (translate/rotate/scale).
 * @param mode - 'translate', 'rotate', or 'scale'
 * @param deps - { transformControls, state, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup }
 */
export function setTransformMode(mode: TransformMode, deps: SetTransformModeDeps): void {
    const { transformControls, state, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup } = deps;
    state.transformMode = mode;
    transformControls.setMode(mode);

    // Update button states
    (['translate', 'rotate', 'scale'] as const).forEach(m => {
        const btnId = m === 'translate' ? 'btn-translate' : m === 'rotate' ? 'btn-rotate' : 'btn-scale';
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.toggle('active', m === mode);
    });

    // Store positions when changing mode
    storeLastPositions({ splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup });
}

interface ResetTransformDeps {
    splatMesh: any;
    modelGroup: any;
    pointcloudGroup: any;
    stlGroup: any;
    cadGroup: any;
    drawingGroup: any;
    state: AppState;
}

/**
 * Reset position and rotation to zero for the selected object(s).
 * @param deps - { splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, state }
 */
export function resetTransform(deps: ResetTransformDeps): void {
    const { splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, state } = deps;
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
    if ((sel === 'pointcloud' || sel === 'both') && pointcloudGroup) {
        pointcloudGroup.position.set(0, 0, 0);
        pointcloudGroup.rotation.set(0, 0, 0);
    }
    if ((sel === 'stl' || sel === 'both') && stlGroup) {
        stlGroup.position.set(0, 0, 0);
        stlGroup.rotation.set(0, 0, 0);
    }
    if ((sel === 'cad' || sel === 'both') && cadGroup) {
        cadGroup.position.set(0, 0, 0);
        cadGroup.rotation.set(0, 0, 0);
    }
    if ((sel === 'drawing' || sel === 'both') && drawingGroup) {
        drawingGroup.position.set(0, 0, 0);
        drawingGroup.rotation.set(0, 0, 0);
    }

    // Re-store positions for delta tracking
    storeLastPositions({ splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup });
    log.info(`Reset transform for: ${sel}`);
}

// =============================================================================
// CENTER AT ORIGIN (move objects so combined center is at 0,0,0)
// =============================================================================

interface CenterAtOriginDeps {
    splatMesh: any;
    modelGroup: any;
    pointcloudGroup: any;
    stlGroup: any;
    cadGroup: any;
    drawingGroup: any;
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
    const { splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, camera, controls, state } = deps;

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

    // STL
    if (stlGroup && state.stlLoaded && stlGroup.children.length > 0) {
        const tempBox = new THREE.Box3().setFromObject(stlGroup);
        if (!tempBox.isEmpty()) {
            box.union(tempBox);
            hasContent = true;
        }
    }

    // CAD
    if (cadGroup && state.cadLoaded && cadGroup.children.length > 0) {
        const tempBox = new THREE.Box3().setFromObject(cadGroup);
        if (!tempBox.isEmpty()) {
            box.union(tempBox);
            hasContent = true;
        }
    }

    // Drawing
    if (drawingGroup && state.drawingLoaded && drawingGroup.children.length > 0) {
        const tempBox = new THREE.Box3().setFromObject(drawingGroup);
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
    if (stlGroup) {
        stlGroup.position.sub(offset);
    }
    if (cadGroup) {
        cadGroup.position.sub(offset);
    }
    if (drawingGroup) {
        drawingGroup.position.sub(offset);
    }

    // Move camera and orbit target by the same offset so the view doesn't jump
    camera.position.sub(offset);
    controls.target.sub(offset);
    controls.update();

    // Re-store positions for delta tracking
    storeLastPositions({ splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup });

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
    stlGroup: any;
    cadGroup: any;
    drawingGroup: any;
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
    const { transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, state } = deps;
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

    // In "both" mode, also orbit all paired objects around origin
    if (state.selectedObject === 'both') {
        if (obj !== splatMesh && splatMesh) {
            splatMesh.position.applyQuaternion(deltaQuat);
        }
        if (obj !== modelGroup && modelGroup) {
            modelGroup.position.applyQuaternion(deltaQuat);
        }
        if (pointcloudGroup) {
            pointcloudGroup.position.applyQuaternion(deltaQuat);
        }
        if (stlGroup) {
            stlGroup.position.applyQuaternion(deltaQuat);
        }
        if (cadGroup) {
            cadGroup.position.applyQuaternion(deltaQuat);
        }
        if (drawingGroup) {
            drawingGroup.position.applyQuaternion(deltaQuat);
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
    pointcloudGroup: any;
    stlGroup: any;
    cadGroup: any;
    drawingGroup: any;
    state: AppState;
}

/**
 * When scaleLockProportions is true and in scale mode, enforce uniform scaling.
 * Detects which axis changed the most and applies that ratio to all three axes.
 *
 * Must be called from the objectChange callback.
 */
export function applyUniformScale(deps: ApplyUniformScaleDeps): void {
    const { transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, state } = deps;
    if (!state.scaleLockProportions) return;
    if (state.transformMode !== 'scale') return;

    const obj = transformControls.object;
    if (!obj) return;

    // Pick the right last-scale based on which object is attached
    let lastScale: THREE.Vector3;
    if (obj === splatMesh) lastScale = lastSplatScale;
    else if (obj === modelGroup) lastScale = lastModelScale;
    else if (obj === pointcloudGroup) lastScale = lastPointcloudScale;
    else if (obj === stlGroup) lastScale = lastStlScale;
    else if (obj === cadGroup) lastScale = lastCadScale;
    else if (obj === drawingGroup) lastScale = lastDrawingScale;
    else lastScale = lastModelScale; // fallback

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

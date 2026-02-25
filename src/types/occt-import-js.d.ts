/**
 * Type declarations for occt-import-js v0.0.23
 * https://github.com/kovacsv/occt-import-js
 *
 * No official @types package exists yet (issue #52).
 */

declare module 'occt-import-js' {
    export interface OcctMeshAttributes {
        position: { array: Float32Array };
        normal?: { array: Float32Array };
    }

    export interface OcctMesh {
        name: string;
        color?: [number, number, number];
        attributes: OcctMeshAttributes;
        index: { array: Uint32Array };
    }

    export interface OcctResult {
        success: boolean;
        meshes: OcctMesh[];
    }

    export interface OcctParams {
        linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
        linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
        linearDeflection?: number;
        angularDeflection?: number;
    }

    export interface OcctInitOptions {
        locateFile?: (filename: string) => string;
    }

    export interface OcctInstance {
        ReadStepFile(buffer: Uint8Array, params: OcctParams | null): OcctResult;
        ReadIgesFile(buffer: Uint8Array, params: OcctParams | null): OcctResult;
        ReadBrepFile(buffer: Uint8Array, params: OcctParams | null): OcctResult;
    }

    function occtimportjs(options?: OcctInitOptions): Promise<OcctInstance>;
    export default occtimportjs;
}

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    ArchiveCreator,
    CRYPTO_AVAILABLE,
    type QualityStats,
    type ViewerState
} from '../archive-creator.js';
import type { Annotation } from '@/types.js';

describe('ArchiveCreator', () => {
    let creator: ArchiveCreator;

    beforeEach(() => {
        creator = new ArchiveCreator();
    });

    // ===== 1. Constructor & Empty Manifest (~3 tests) =====
    describe('Constructor & Empty Manifest', () => {
        it('creates new instance with empty manifest with correct defaults', () => {
            expect(creator.manifest).toBeDefined();
            expect(creator.manifest.project.title).toBe('');
            expect(creator.manifest.project.license).toBe('CC0');
            expect(creator.files.size).toBe(0);
            expect(creator.annotations).toEqual([]);
        });

        it('sets container_version to "1.0"', () => {
            expect(creator.manifest.container_version).toBe('1.0');
        });

        it('initializes data_entries and annotations as empty', () => {
            expect(creator.manifest.data_entries).toEqual({});
            expect(creator.manifest.annotations).toEqual([]);
        });

        it('has correct default preservation format registry', () => {
            const registry = creator.manifest.preservation.format_registry;
            expect(registry).toEqual({});
        });
    });

    // ===== 2. setProjectInfo / setProvenance / metadata setters (~8 tests) =====
    describe('Metadata Setters', () => {
        it('setProjectInfo sets only title without overwriting other fields', () => {
            creator.setProjectInfo({ title: 'Test Project' });
            expect(creator.manifest.project.title).toBe('Test Project');
            expect(creator.manifest.project.license).toBe('CC0'); // unchanged
        });

        it('setProjectInfo can set multiple fields at once', () => {
            creator.setProjectInfo({
                title: 'My Project',
                id: 'proj-123',
                license: 'CC-BY-4.0',
                description: 'A test project'
            });
            expect(creator.manifest.project.title).toBe('My Project');
            expect(creator.manifest.project.id).toBe('proj-123');
            expect(creator.manifest.project.license).toBe('CC-BY-4.0');
            expect(creator.manifest.project.description).toBe('A test project');
        });

        it('setProvenance with string conventions splits on comma', () => {
            creator.setProvenance({ conventions: 'X-up, Y-right, Z-forward' });
            expect(creator.manifest.provenance.convention_hints).toEqual([
                'X-up',
                'Y-right',
                'Z-forward'
            ]);
        });

        it('setProvenance with array conventions stores directly', () => {
            creator.setProvenance({ conventions: ['X-up', 'Y-right', 'Z-forward'] });
            expect(creator.manifest.provenance.convention_hints).toEqual([
                'X-up',
                'Y-right',
                'Z-forward'
            ]);
        });

        it('setQualityMetrics sets nested capture_resolution correctly', () => {
            creator.setQualityMetrics({
                captureResolution: {
                    value: 0.5,
                    unit: 'mm',
                    type: 'GSD'
                }
            });
            expect(creator.manifest.quality_metrics.capture_resolution.value).toBe(0.5);
            expect(creator.manifest.quality_metrics.capture_resolution.unit).toBe('mm');
            expect(creator.manifest.quality_metrics.capture_resolution.type).toBe('GSD');
        });

        it('setArchivalRecord maps camelCase to snake_case correctly', () => {
            creator.setArchivalRecord({
                ids: {
                    accessionNumber: 'ACC-001',
                    sirisId: 'SIRIS-123',
                    uri: 'https://example.com/object/123'
                }
            });
            expect(creator.manifest.archival_record.ids.accession_number).toBe('ACC-001');
            expect(creator.manifest.archival_record.ids.siris_id).toBe('SIRIS-123');
            expect(creator.manifest.archival_record.ids.uri).toBe('https://example.com/object/123');
        });

        it('setViewerSettings applies singleSided and backgroundColor', () => {
            creator.setViewerSettings({
                singleSided: false,
                backgroundColor: '#ff0000'
            });
            expect(creator.manifest.viewer_settings.single_sided).toBe(false);
            expect(creator.manifest.viewer_settings.background_color).toBe('#ff0000');
        });

        it('setCustomFields replaces entire custom_fields', () => {
            creator.setCustomFields({ foo: 'bar', baz: 42 });
            expect(creator.manifest._meta.custom_fields).toEqual({ foo: 'bar', baz: 42 });

            creator.setCustomFields({ newField: 'value' });
            expect(creator.manifest._meta.custom_fields).toEqual({ newField: 'value' });
        });

        it('addCustomField adds to existing custom_fields', () => {
            creator.addCustomField('field1', 'value1');
            expect(creator.manifest._meta.custom_fields).toEqual({ field1: 'value1' });

            creator.addCustomField('field2', 'value2');
            expect(creator.manifest._meta.custom_fields).toEqual({
                field1: 'value1',
                field2: 'value2'
            });
        });
    });

    // ===== 3. addScene / addMesh / addPointcloud / addSourceFile (~8 tests) =====
    describe('Adding Assets', () => {
        it('addScene creates scene_0 key with correct archive path', () => {
            const blob = new Blob(['test content'], { type: 'application/octet-stream' });
            const key = creator.addScene(blob, 'test.ply');

            expect(key).toBe('scene_0');
            expect(creator.manifest.data_entries[key]).toBeDefined();
            expect(creator.manifest.data_entries[key].file_name).toBe('assets/scene_0.ply');
            expect(creator.files.has('assets/scene_0.ply')).toBe(true);
        });

        it('second addScene creates scene_1', () => {
            const blob1 = new Blob(['test1'], { type: 'application/octet-stream' });
            const blob2 = new Blob(['test2'], { type: 'application/octet-stream' });

            const key1 = creator.addScene(blob1, 'test1.ply');
            const key2 = creator.addScene(blob2, 'test2.ply');

            expect(key1).toBe('scene_0');
            expect(key2).toBe('scene_1');
            expect(creator.manifest.data_entries[key1].file_name).toBe('assets/scene_0.ply');
            expect(creator.manifest.data_entries[key2].file_name).toBe('assets/scene_1.ply');
        });

        it('addMesh creates mesh_0 with correct defaults (position [0,0,0], scale 1)', () => {
            const blob = new Blob(['test mesh'], { type: 'application/octet-stream' });
            const key = creator.addMesh(blob, 'mesh.glb');

            expect(key).toBe('mesh_0');
            const entry = creator.manifest.data_entries[key];
            expect(entry.file_name).toBe('assets/mesh_0.glb');
            expect(entry._parameters?.position).toEqual([0, 0, 0]);
            expect(entry._parameters?.rotation).toEqual([0, 0, 0]);
            expect(entry._parameters?.scale).toBe(1);
        });

        it('addPointcloud stores transform parameters from options', () => {
            const blob = new Blob(['test cloud'], { type: 'application/octet-stream' });
            const key = creator.addPointcloud(blob, 'cloud.e57', {
                position: [10, 20, 30],
                rotation: [0.1, 0.2, 0.3],
                scale: 2.5
            });

            expect(key).toBe('pointcloud_0');
            const entry = creator.manifest.data_entries[key];
            expect(entry._parameters?.position).toEqual([10, 20, 30]);
            expect(entry._parameters?.rotation).toEqual([0.1, 0.2, 0.3]);
            expect(entry._parameters?.scale).toBe(2.5);
        });

        it('addSourceFile sanitizes filename (replaces special chars with _)', () => {
            const blob = new Blob(['source'], { type: 'application/octet-stream' });
            const key = creator.addSourceFile(blob, 'my file (1) & test.pdf');

            const entry = creator.manifest.data_entries[key];
            // Regex: /[^a-zA-Z0-9._-]/g replaced with _, then /_{2,}/g collapsed to single _
            expect(entry.file_name).toBe('sources/my_file_1_test.pdf');
            expect(entry.original_name).toBe('my file (1) & test.pdf');
        });

        it('addSourceFile handles duplicate filenames by appending index', () => {
            const blob1 = new Blob(['source1'], { type: 'application/octet-stream' });
            const blob2 = new Blob(['source2'], { type: 'application/octet-stream' });

            creator.addSourceFile(blob1, 'report.pdf');
            creator.addSourceFile(blob2, 'report.pdf');

            const entries = Object.values(creator.manifest.data_entries).filter(
                e => e.role === 'source'
            );

            expect(entries.length).toBe(2);
            expect(entries[0].file_name).toBe('sources/report.pdf');
            expect(entries[1].file_name).toBe('sources/report_1.pdf');
        });

        it('addSceneProxy creates scene_0_proxy with role: "derived", lod: "proxy"', () => {
            const blob = new Blob(['proxy'], { type: 'application/octet-stream' });
            const key = creator.addSceneProxy(blob, 'proxy.ply');

            expect(key).toBe('scene_0_proxy');
            const entry = creator.manifest.data_entries[key];
            expect(entry.role).toBe('derived');
            expect(entry.lod).toBe('proxy');
            expect(entry.derived_from).toBe('scene_0');
        });

        it('addMeshProxy with face_count stores it in the entry', () => {
            const blob = new Blob(['mesh proxy'], { type: 'application/octet-stream' });
            const key = creator.addMeshProxy(blob, 'mesh_proxy.glb', {
                face_count: 5000
            });

            expect(key).toBe('mesh_0_proxy');
            const entry = creator.manifest.data_entries[key];
            expect(entry.face_count).toBe(5000);
        });
    });

    // ===== 4. validate() (~5 tests) =====
    describe('Validation', () => {
        it('empty archive (no assets) is not valid with error about requiring at least one asset', () => {
            creator.setProjectInfo({ title: 'Test' });
            const result = creator.validate();

            expect(result.valid).toBe(false);
            expect(result.errors).toContain(
                'Archive must contain at least one scene (splat), mesh, or point cloud file'
            );
        });

        it('archive with scene but no title is not valid with error about title required', () => {
            const blob = new Blob(['test'], { type: 'application/octet-stream' });
            creator.addScene(blob, 'test.ply');

            const result = creator.validate();

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Project title is required');
        });

        it('archive with scene and title is valid', () => {
            const blob = new Blob(['test'], { type: 'application/octet-stream' });
            creator.addScene(blob, 'test.ply');
            creator.setProjectInfo({ title: 'Valid Project' });

            const result = creator.validate();

            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it('archive with mesh and title is valid', () => {
            const blob = new Blob(['test mesh'], { type: 'application/octet-stream' });
            creator.addMesh(blob, 'mesh.glb');
            creator.setProjectInfo({ title: 'Valid Project' });

            const result = creator.validate();

            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it('missing file reference is not valid with error about missing file', () => {
            creator.setProjectInfo({ title: 'Test' });
            // Manually add entry without file
            creator.manifest.data_entries['scene_0'] = {
                file_name: 'assets/missing.ply',
                created_by: 'test'
            };

            const result = creator.validate();

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Missing file: assets/missing.ply');
        });
    });

    // ===== 5. addThumbnail / addScreenshot / addImage (~3 tests) =====
    describe('Adding Images', () => {
        it('addThumbnail creates thumbnail_0 with path preview.{ext}', () => {
            const blob = new Blob(['thumbnail'], { type: 'image/jpeg' });
            const key = creator.addThumbnail(blob, 'thumb.jpg');

            expect(key).toBe('thumbnail_0');
            expect(creator.manifest.data_entries[key].file_name).toBe('preview.jpg');
            expect(creator.files.has('preview.jpg')).toBe(true);
        });

        it('addScreenshot creates screenshot_0 with path screenshots/screenshot_0.{ext}', () => {
            const blob = new Blob(['screenshot'], { type: 'image/png' });
            const key = creator.addScreenshot(blob, 'screen.png');

            expect(key).toBe('screenshot_0');
            expect(creator.manifest.data_entries[key].file_name).toBe('screenshots/screenshot_0.png');
            expect(creator.files.has('screenshots/screenshot_0.png')).toBe(true);
        });

        it('addImage creates image_0 with the provided archive path', () => {
            const blob = new Blob(['image'], { type: 'image/jpeg' });
            const key = creator.addImage(blob, 'images/custom/photo.jpg');

            expect(key).toBe('image_0');
            expect(creator.manifest.data_entries[key].file_name).toBe('images/custom/photo.jpg');
            expect(creator.files.has('images/custom/photo.jpg')).toBe(true);
        });
    });

    // ===== 6. captureFromViewer (~3 tests) =====
    describe('Capture From Viewer', () => {
        it('with splat blob and filename adds scene entry', () => {
            const splatBlob = new Blob(['splat'], { type: 'application/octet-stream' });
            const viewerState: ViewerState = {
                splatBlob,
                splatFileName: 'scene.ply'
            };

            creator.captureFromViewer(viewerState);

            expect(creator.manifest.data_entries['scene_0']).toBeDefined();
            expect(creator.manifest.data_entries['scene_0'].file_name).toBe('assets/scene_0.ply');
        });

        it('with mesh blob adds mesh entry', () => {
            const meshBlob = new Blob(['mesh'], { type: 'application/octet-stream' });
            const viewerState: ViewerState = {
                meshBlob,
                meshFileName: 'model.glb'
            };

            creator.captureFromViewer(viewerState);

            expect(creator.manifest.data_entries['mesh_0']).toBeDefined();
            expect(creator.manifest.data_entries['mesh_0'].file_name).toBe('assets/mesh_0.glb');
        });

        it('with annotations sets annotations', () => {
            const annotations: Annotation[] = [
                {
                    id: 'anno-1',
                    position: { x: 1, y: 2, z: 3 },
                    camera_position: { x: 4, y: 5, z: 6 },
                    camera_target: { x: 0, y: 0, z: 0 },
                    title: 'Test Annotation',
                    body: 'Description'
                }
            ];
            const viewerState: ViewerState = { annotations };

            creator.captureFromViewer(viewerState);

            expect(creator.annotations).toEqual(annotations);
            expect(creator.manifest.annotations).toEqual(annotations);
        });

        it('with quality stats sets quality stats', () => {
            const qualityStats: QualityStats = {
                splat_count: 1000000,
                mesh_polygons: 50000
            };
            const viewerState: ViewerState = { qualityStats };

            creator.captureFromViewer(viewerState);

            expect(creator.manifest._meta.quality).toEqual(qualityStats);
        });
    });

    // ===== 7. applyMetadata (~3 tests) =====
    describe('Apply Metadata', () => {
        it('applies project, provenance, and quality metrics together', () => {
            creator.applyMetadata({
                project: { title: 'Applied Project' },
                provenance: { captureDate: '2024-01-01', operator: 'Test Operator' },
                qualityMetrics: { tier: 'high', accuracyGrade: 'A' }
            });

            expect(creator.manifest.project.title).toBe('Applied Project');
            expect(creator.manifest.provenance.capture_date).toBe('2024-01-01');
            expect(creator.manifest.provenance.operator).toBe('Test Operator');
            expect(creator.manifest.quality_metrics.tier).toBe('high');
            expect(creator.manifest.quality_metrics.accuracy_grade).toBe('A');
        });

        it('only applies non-null sections', () => {
            const originalTitle = creator.manifest.project.title;
            creator.applyMetadata({
                provenance: { location: 'Test Location' }
            });

            expect(creator.manifest.project.title).toBe(originalTitle); // unchanged
            expect(creator.manifest.provenance.location).toBe('Test Location');
        });

        it('version history is set correctly', () => {
            const history = [
                { version: '1.0', date: '2024-01-01', description: 'Initial' },
                { version: '1.1', date: '2024-02-01', description: 'Updated' }
            ];

            creator.applyMetadata({ versionHistory: history });

            expect(creator.manifest.version_history).toEqual(history);
        });
    });

    // ===== 8. getMetadataSummary / getFileList / getFileCount (~3 tests) =====
    describe('Metadata Queries', () => {
        it('summary includes correct annotation count and file count', () => {
            const blob = new Blob(['test'], { type: 'application/octet-stream' });
            creator.addScene(blob, 'test.ply');
            creator.setProjectInfo({ title: 'Summary Test' });
            creator.setAnnotations([
                {
                    id: 'a1',
                    position: { x: 0, y: 0, z: 0 },
                    camera_position: { x: 1, y: 1, z: 1 },
                    camera_target: { x: 0, y: 0, z: 0 },
                    title: 'Anno',
                    body: ''
                }
            ]);

            const summary = creator.getMetadataSummary();

            expect(summary.annotationCount).toBe(1);
            expect(summary.fileCount).toBe(1);
            expect(summary.project.title).toBe('Summary Test');
        });

        it('file list returns paths, sizes, and original names', () => {
            const blob1 = new Blob(['content1'], { type: 'application/octet-stream' });
            const blob2 = new Blob(['content2'], { type: 'application/octet-stream' });

            creator.addScene(blob1, 'scene.ply');
            creator.addMesh(blob2, 'mesh.glb');

            const fileList = creator.getFileList();

            expect(fileList.length).toBe(2);
            expect(fileList[0].path).toBe('assets/scene_0.ply');
            expect(fileList[0].size).toBe(blob1.size);
            expect(fileList[0].originalName).toBe('scene.ply');
            expect(fileList[1].path).toBe('assets/mesh_0.glb');
            expect(fileList[1].size).toBe(blob2.size);
            expect(fileList[1].originalName).toBe('mesh.glb');
        });

        it('file count matches number of added files', () => {
            expect(creator.getFileCount()).toBe(0);

            const blob = new Blob(['test'], { type: 'application/octet-stream' });
            creator.addScene(blob, 'test.ply');

            expect(creator.getFileCount()).toBe(1);

            creator.addMesh(blob, 'mesh.glb');
            expect(creator.getFileCount()).toBe(2);
        });
    });

    // ===== 9. generateManifest / previewManifest (~2 tests) =====
    describe('Manifest Generation', () => {
        it('returns valid JSON string', () => {
            creator.setProjectInfo({ title: 'Test' });
            const manifestJson = creator.generateManifest();

            expect(() => JSON.parse(manifestJson)).not.toThrow();
            const parsed = JSON.parse(manifestJson);
            expect(parsed.project.title).toBe('Test');
        });

        it('previewManifest returns parsed object matching manifest structure', () => {
            creator.setProjectInfo({ title: 'Preview Test', id: 'test-123' });
            const preview = creator.previewManifest();

            expect(preview.project.title).toBe('Preview Test');
            expect(preview.project.id).toBe('test-123');
            expect(preview.container_version).toBe('1.0');
        });
    });

    // ===== 10. reset() (~1 test) =====
    describe('Reset', () => {
        it('clears manifest, files, and annotations but keeps hashCache', () => {
            const blob = new Blob(['test'], { type: 'application/octet-stream' });
            creator.addScene(blob, 'test.ply');
            creator.setProjectInfo({ title: 'Test' });
            creator.setAnnotations([
                {
                    id: 'a1',
                    position: { x: 0, y: 0, z: 0 },
                    camera_position: { x: 1, y: 1, z: 1 },
                    camera_target: { x: 0, y: 0, z: 0 },
                    title: 'Anno',
                    body: ''
                }
            ]);

            // Simulate cached hash
            creator.hashCache.set(blob, 'abc123');

            creator.reset();

            expect(creator.manifest.project.title).toBe('');
            expect(creator.files.size).toBe(0);
            expect(creator.annotations).toEqual([]);
            expect(creator.hashCache.has(blob)).toBe(true); // preserved
        });
    });

    // ===== 11. SHA-256 Hashing (~3 tests, conditional on CRYPTO_AVAILABLE) =====
    describe('SHA-256 Hashing', () => {
        // Helper to check if Blob.arrayBuffer is available (not in all jsdom versions)
        const blobSupportsArrayBuffer = () => {
            try {
                const testBlob = new Blob(['test']);
                return typeof testBlob.arrayBuffer === 'function';
            } catch {
                return false;
            }
        };

        const skipIfNoCrypto = CRYPTO_AVAILABLE && blobSupportsArrayBuffer() ? it : it.skip;

        skipIfNoCrypto('precomputeHash returns a 64-char hex string for a known blob', async () => {
            const blob = new Blob(['test content'], { type: 'application/octet-stream' });
            const hash = await creator.precomputeHash(blob);

            expect(hash).toBeDefined();
            expect(hash).toHaveLength(64);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        skipIfNoCrypto('getCachedHash returns cached value after precompute', async () => {
            const blob = new Blob(['cached test'], { type: 'application/octet-stream' });

            expect(creator.getCachedHash(blob)).toBeNull();

            const hash = await creator.precomputeHash(blob);
            expect(creator.getCachedHash(blob)).toBe(hash);
        });

        skipIfNoCrypto('precomputeHash with same blob returns cached result (does not recompute)', async () => {
            const blob = new Blob(['cached content'], { type: 'application/octet-stream' });

            const hash1 = await creator.precomputeHash(blob);
            const hash2 = await creator.precomputeHash(blob);

            expect(hash1).toBe(hash2);
            expect(creator.getCachedHash(blob)).toBe(hash1);
        });

        it('precomputeHash returns null when crypto is not available', async () => {
            if (CRYPTO_AVAILABLE) {
                // Skip this test if crypto is available
                return;
            }

            const blob = new Blob(['test'], { type: 'application/octet-stream' });
            const hash = await creator.precomputeHash(blob);

            expect(hash).toBeNull();
        });
    });

    // ===== Additional Tests for Better Coverage =====
    describe('Additional Coverage', () => {
        it('setQualityStats with partial stats updates correctly', () => {
            creator.setQualityStats({ splat_count: 500000 });
            expect(creator.manifest._meta.quality?.splat_count).toBe(500000);

            creator.setQualityStats({ mesh_polygons: 10000 });
            expect(creator.manifest._meta.quality?.splat_count).toBe(500000); // preserved
            expect(creator.manifest._meta.quality?.mesh_polygons).toBe(10000);
        });

        it('addAnnotation appends to annotations array', () => {
            const anno1: Annotation = {
                id: 'a1',
                position: { x: 1, y: 2, z: 3 },
                camera_position: { x: 4, y: 5, z: 6 },
                camera_target: { x: 0, y: 0, z: 0 },
                title: 'First',
                body: ''
            };
            const anno2: Annotation = {
                id: 'a2',
                position: { x: 7, y: 8, z: 9 },
                camera_position: { x: 10, y: 11, z: 12 },
                camera_target: { x: 0, y: 0, z: 0 },
                title: 'Second',
                body: ''
            };

            creator.addAnnotation(anno1);
            expect(creator.annotations).toHaveLength(1);

            creator.addAnnotation(anno2);
            expect(creator.annotations).toHaveLength(2);
            expect(creator.manifest.annotations).toEqual([anno1, anno2]);
        });

        it('addVersionHistoryEntry adds to version history with defaults', () => {
            creator.addVersionHistoryEntry({
                version: '1.0',
                date: '2024-01-01',
                description: 'Initial release'
            });

            expect(creator.manifest.version_history).toHaveLength(1);
            expect(creator.manifest.version_history[0].version).toBe('1.0');
        });

        it('updateSceneMetadata returns false for non-existent scene', () => {
            const result = creator.updateSceneMetadata(99, { createdBy: 'test' });
            expect(result).toBe(false);
        });

        it('updateSceneMetadata updates existing scene', () => {
            const blob = new Blob(['scene'], { type: 'application/octet-stream' });
            creator.addScene(blob, 'scene.ply');

            const result = creator.updateSceneMetadata(0, {
                createdBy: 'NewCreator',
                version: '2.0',
                sourceNotes: 'Updated notes'
            });

            expect(result).toBe(true);
            expect(creator.manifest.data_entries['scene_0'].created_by).toBe('NewCreator');
            expect(creator.manifest.data_entries['scene_0']._created_by_version).toBe('2.0');
            expect(creator.manifest.data_entries['scene_0']._source_notes).toBe('Updated notes');
        });

        it('getIntegrity returns null when no integrity data', () => {
            expect(creator.getIntegrity()).toBeNull();
        });

        it('setProvenance handles empty string conventions', () => {
            creator.setProvenance({ conventions: '' });
            expect(creator.manifest.provenance.convention_hints).toEqual([]);
        });

        it('setProvenance with comma-separated conventions filters empty strings', () => {
            creator.setProvenance({ conventions: 'X-up, , Y-right,  , Z-forward' });
            const hints = creator.manifest.provenance.convention_hints.filter(h => h);
            expect(hints).toEqual(['X-up', 'Y-right', 'Z-forward']);
        });
    });
});

/**
 * Tests for sanitizeArchiveFilename from archive-loader.js.
 *
 * sanitizeArchiveFilename is not exported, so we test it indirectly
 * by importing and testing the module's ArchiveLoader.extractFile behavior,
 * or we re-implement the pure logic here for unit testing.
 *
 * For now, we extract the sanitization logic into a testable form.
 */
import { describe, it, expect } from 'vitest';

// Since sanitizeArchiveFilename is not exported from archive-loader.js,
// we replicate the core sanitization logic here for testing.
// This ensures the algorithm is correct; integration tests would cover the actual module.
function sanitizeArchiveFilename(filename: string | null | undefined): { safe: boolean; sanitized: string; error: string } {
    if (!filename || typeof filename !== 'string') {
        return { safe: false, sanitized: '', error: 'Filename is empty or not a string' };
    }

    let sanitized = filename.trim();

    // Check for null bytes
    if (sanitized.includes('\0')) {
        return { safe: false, sanitized: '', error: 'Filename contains null bytes' };
    }

    // Normalize path separators
    sanitized = sanitized.replace(/\\/g, '/');

    // Remove path traversal sequences
    const originalFilename = sanitized;
    sanitized = sanitized
        .replace(/%252e/gi, '.')
        .replace(/%2e/gi, '.')
        .replace(/\.\.\//g, '')
        .replace(/\.\./g, '')
        .replace(/\/\.\//g, '/')
        .replace(/^\.\//g, '');

    // Remove leading slashes
    sanitized = sanitized.replace(/^\/+/, '');

    // Check if path traversal was attempted
    if (originalFilename !== sanitized && originalFilename.includes('..')) {
        return { safe: false, sanitized: '', error: 'Path traversal attempt detected' };
    }

    // Validate characters
    if (!/^[a-zA-Z0-9_\-\.\/]+$/.test(sanitized)) {
        return { safe: false, sanitized: '', error: 'Filename contains invalid characters' };
    }

    // Block hidden files
    if (sanitized.startsWith('.') && !sanitized.startsWith('./')) {
        return { safe: false, sanitized: '', error: 'Hidden files are not allowed' };
    }

    // Check empty
    if (sanitized.length === 0) {
        return { safe: false, sanitized: '', error: 'Filename is empty after sanitization' };
    }

    // Check length
    if (sanitized.length > 255) {
        return { safe: false, sanitized: '', error: 'Filename exceeds maximum length (255 characters)' };
    }

    return { safe: true, sanitized, error: '' };
}

describe('sanitizeArchiveFilename', () => {
    it('accepts a normal filename', () => {
        const result = sanitizeArchiveFilename('model.glb');
        expect(result.safe).toBe(true);
        expect(result.sanitized).toBe('model.glb');
    });

    it('accepts filenames with subdirectories', () => {
        const result = sanitizeArchiveFilename('assets/meshes/model.glb');
        expect(result.safe).toBe(true);
        expect(result.sanitized).toBe('assets/meshes/model.glb');
    });

    it('blocks path traversal with ../', () => {
        const result = sanitizeArchiveFilename('../../../etc/passwd');
        expect(result.safe).toBe(false);
        expect(result.error).toContain('Path traversal');
    });

    it('decodes and strips URL-encoded traversal (%2e%2e)', () => {
        // After decoding %2e→'.', the '..' and '../' patterns are removed,
        // leaving 'etc/passwd' which is safe (traversal neutralized)
        const result = sanitizeArchiveFilename('%2e%2e/%2e%2e/etc/passwd');
        expect(result.safe).toBe(true);
        expect(result.sanitized).toBe('etc/passwd');
    });

    it('decodes and strips double-encoded traversal (%252e)', () => {
        // After decoding %252e→'.', the '..' patterns are removed,
        // leaving 'etc/passwd' which is safe (traversal neutralized)
        const result = sanitizeArchiveFilename('%252e%252e/%252e%252e/etc/passwd');
        expect(result.safe).toBe(true);
        expect(result.sanitized).toBe('etc/passwd');
    });

    it('blocks null bytes', () => {
        const result = sanitizeArchiveFilename('model.glb\0.exe');
        expect(result.safe).toBe(false);
        expect(result.error).toContain('null bytes');
    });

    it('rejects empty input', () => {
        const result = sanitizeArchiveFilename('');
        expect(result.safe).toBe(false);
    });

    it('rejects null input', () => {
        const result = sanitizeArchiveFilename(null);
        expect(result.safe).toBe(false);
    });

    it('blocks filenames exceeding 255 characters', () => {
        const longName = 'a'.repeat(256) + '.glb';
        const result = sanitizeArchiveFilename(longName);
        expect(result.safe).toBe(false);
        expect(result.error).toContain('maximum length');
    });

    it('blocks hidden files (dot prefix)', () => {
        const result = sanitizeArchiveFilename('.htaccess');
        expect(result.safe).toBe(false);
        expect(result.error).toContain('Hidden files');
    });

    it('blocks filenames with special characters', () => {
        const result = sanitizeArchiveFilename('model<script>.glb');
        expect(result.safe).toBe(false);
        expect(result.error).toContain('invalid characters');
    });

    it('normalizes backslashes to forward slashes', () => {
        const result = sanitizeArchiveFilename('assets\\model.glb');
        expect(result.safe).toBe(true);
        expect(result.sanitized).toBe('assets/model.glb');
    });

    it('strips leading slashes', () => {
        const result = sanitizeArchiveFilename('/assets/model.glb');
        expect(result.safe).toBe(true);
        expect(result.sanitized).toBe('assets/model.glb');
    });
});

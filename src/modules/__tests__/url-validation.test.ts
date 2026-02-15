import { describe, it, expect } from 'vitest';
import { validateUserUrl } from '../url-validation.js';

describe('validateUserUrl', () => {
    const defaults = {
        currentOrigin: 'https://viewer.example.com',
        currentProtocol: 'https:'
    };

    it('accepts a valid HTTPS URL from an allowed domain', () => {
        const result = validateUserUrl('https://cdn.example.com/model.glb', 'model', {
            ...defaults,
            allowedDomains: ['cdn.example.com']
        });
        expect(result.valid).toBe(true);
        expect(result.url).toBe('https://cdn.example.com/model.glb');
        expect(result.error).toBe('');
    });

    it('accepts same-origin URLs without domain allowlist', () => {
        const result = validateUserUrl('https://viewer.example.com/assets/scene.ply', 'splat', defaults);
        expect(result.valid).toBe(true);
    });

    it('rejects empty input', () => {
        const result = validateUserUrl('', 'model', defaults);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('URL is empty');
    });

    it('rejects whitespace-only input', () => {
        const result = validateUserUrl('   ', 'model', defaults);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('URL is empty');
    });

    it('blocks javascript: protocol', () => {
        const result = validateUserUrl('javascript:alert(1)', 'model', defaults);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsafe protocol');
    });

    it('blocks data: protocol', () => {
        const result = validateUserUrl('data:text/html,<h1>hi</h1>', 'model', defaults);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsafe protocol');
    });

    it('blocks non-allowlisted external domain', () => {
        const result = validateUserUrl('https://evil.com/payload.glb', 'model', {
            ...defaults,
            allowedDomains: ['cdn.example.com']
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
    });

    it('supports wildcard domain matching', () => {
        const result = validateUserUrl('https://sub.cdn.example.com/file.glb', 'model', {
            ...defaults,
            allowedDomains: ['*.cdn.example.com']
        });
        expect(result.valid).toBe(true);
    });

    it('wildcard matches the base domain itself', () => {
        const result = validateUserUrl('https://cdn.example.com/file.glb', 'model', {
            ...defaults,
            allowedDomains: ['*.cdn.example.com']
        });
        expect(result.valid).toBe(true);
    });

    it('enforces HTTPS for external URLs when page is HTTPS', () => {
        const result = validateUserUrl('http://cdn.example.com/file.glb', 'model', {
            ...defaults,
            allowedDomains: ['cdn.example.com']
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('HTTPS');
    });

    it('allows HTTP external URLs when page is HTTP', () => {
        const result = validateUserUrl('http://cdn.example.com/file.glb', 'model', {
            currentOrigin: 'http://viewer.example.com',
            currentProtocol: 'http:',
            allowedDomains: ['cdn.example.com']
        });
        expect(result.valid).toBe(true);
    });

    it('rejects URLs with invalid protocol', () => {
        const result = validateUserUrl('ftp://files.example.com/model.glb', 'model', defaults);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsafe protocol');
    });
});

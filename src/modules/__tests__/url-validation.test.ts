import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

/**
 * Drift detection: config.js has a duplicate validateUrl() that must stay in sync
 * with url-validation.ts. This test extracts config.js's validation logic and
 * confirms both implementations agree on a comprehensive set of inputs.
 */
describe('config.js validateUrl parity with url-validation.ts', () => {
    // Extract config.js's validateUrl into a callable function.
    // config.js is an IIFE that writes to window.APP_CONFIG, but we only need
    // the validateUrl function body. We extract it by regex and eval it in a
    // controlled scope that stubs window.location.
    function buildConfigValidator(origin: string, protocol: string, allowedDomains: string[]) {
        const configSrc = readFileSync(resolve(__dirname, '../../config.js'), 'utf-8');

        // Extract the validateUrl function body
        const fnMatch = configSrc.match(
            /function validateUrl\(urlString, paramName\)\s*\{([\s\S]*?)^\s{4}\}/m
        );
        if (!fnMatch) throw new Error('Could not extract validateUrl from config.js — has the function signature changed?');

        // Build a standalone function with the same logic
        const fnBody = fnMatch[1];
        // eslint-disable-next-line no-new-func
        const factory = new Function(
            'ALLOWED_EXTERNAL_DOMAINS', 'windowLocation',
            `
            return function validateUrl(urlString, paramName) {
                const window = { location: windowLocation };
                ${fnBody}
            };
            `
        );

        const windowLocation = { origin, protocol };
        return factory(allowedDomains, windowLocation) as (url: string, param: string) => string;
    }

    // Test vectors: [url, allowedDomains[], origin, protocol, expectedValid]
    const vectors: [string, string[], string, string, boolean][] = [
        // Basic valid cases
        ['https://cdn.example.com/model.glb', ['cdn.example.com'], 'https://viewer.example.com', 'https:', true],
        ['https://viewer.example.com/assets/scene.ply', [], 'https://viewer.example.com', 'https:', true],
        // Empty / whitespace
        ['', [], 'https://viewer.example.com', 'https:', false],
        ['   ', [], 'https://viewer.example.com', 'https:', false],
        // Dangerous protocols
        ['javascript:alert(1)', [], 'https://viewer.example.com', 'https:', false],
        ['data:text/html,<h1>hi</h1>', [], 'https://viewer.example.com', 'https:', false],
        ['ftp://files.example.com/model.glb', [], 'https://viewer.example.com', 'https:', false],
        // Domain not in allowlist
        ['https://evil.com/payload.glb', ['cdn.example.com'], 'https://viewer.example.com', 'https:', false],
        // Wildcard domain matching
        ['https://sub.cdn.example.com/file.glb', ['*.cdn.example.com'], 'https://viewer.example.com', 'https:', true],
        ['https://cdn.example.com/file.glb', ['*.cdn.example.com'], 'https://viewer.example.com', 'https:', true],
        // HTTPS enforcement for external URLs
        ['http://cdn.example.com/file.glb', ['cdn.example.com'], 'https://viewer.example.com', 'https:', false],
        ['http://cdn.example.com/file.glb', ['cdn.example.com'], 'http://viewer.example.com', 'http:', true],
    ];

    vectors.forEach(([url, domains, origin, protocol, expectedValid], i) => {
        it(`vector ${i}: both implementations agree on "${url.slice(0, 50)}"`, () => {
            // url-validation.ts result
            const tsResult = validateUserUrl(url, 'test', {
                allowedDomains: domains,
                currentOrigin: origin,
                currentProtocol: protocol,
            });

            // config.js result (returns URL string if valid, '' if invalid)
            const configValidate = buildConfigValidator(origin, protocol, domains);
            const configResult = configValidate(url, 'test');

            const tsValid = tsResult.valid;
            const configValid = configResult !== '' && configResult !== undefined;

            expect(configValid).toBe(tsValid,
                `Drift detected! config.js says ${configValid}, url-validation.ts says ${tsValid} for "${url}"`
            );
            expect(tsValid).toBe(expectedValid);
        });
    });
});

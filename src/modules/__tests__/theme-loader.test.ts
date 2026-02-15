/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { parseThemeMeta } from '../theme-loader.js';

describe('parseThemeMeta', () => {
    it('parses a well-formed theme comment', () => {
        const css = `/* @theme Editorial\n@layout editorial\n@scene-bg #1a1a2e */\nbody { color: red; }`;
        const meta = parseThemeMeta(css);
        expect(meta.name).toBe('Editorial');
        expect(meta.layout).toBe('editorial');
        expect(meta.sceneBg).toBe('#1a1a2e');
    });

    it('returns defaults when no comment block exists', () => {
        const css = 'body { color: red; }';
        const meta = parseThemeMeta(css);
        expect(meta.layout).toBe('sidebar');
        expect(meta.sceneBg).toBe(null);
        expect(meta.name).toBe(null);
    });

    it('handles missing fields gracefully', () => {
        const css = '/* @theme My Theme\n */\nbody {}';
        const meta = parseThemeMeta(css);
        expect(meta.name).toBe('My Theme');
        expect(meta.layout).toBe('sidebar'); // default
        expect(meta.sceneBg).toBe(null);      // default
    });

    it('handles CRLF line endings', () => {
        const css = '/* @theme Editorial\r\n@layout editorial\r\n@scene-bg #ffffff */\r\nbody {}';
        const meta = parseThemeMeta(css);
        expect(meta.name).toBe('Editorial');
        expect(meta.layout).toBe('editorial');
        expect(meta.sceneBg).toBe('#ffffff');
    });

    it('trims extra whitespace from values', () => {
        const css = '/*  @theme   My Theme   \n  @layout   editorial   \n  @scene-bg   #abc   */';
        const meta = parseThemeMeta(css);
        expect(meta.name).toBe('My Theme');
        expect(meta.layout).toBe('editorial');
        expect(meta.sceneBg).toBe('#abc');
    });

    it('handles 8-digit hex colors', () => {
        const css = '/* @scene-bg #1a1a2eff */';
        const meta = parseThemeMeta(css);
        expect(meta.sceneBg).toBe('#1a1a2eff');
    });
});

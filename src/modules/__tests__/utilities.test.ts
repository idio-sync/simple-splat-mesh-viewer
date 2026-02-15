/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { parseMarkdown, resolveAssetRefs } from '../utilities.js';

describe('parseMarkdown', () => {
    describe('escapeHtml (tested indirectly)', () => {
        it('escapes HTML entities in plain text', () => {
            const html = parseMarkdown('<script>alert("XSS")</script>');
            expect(html).toContain('&lt;script&gt;');
            expect(html).toContain('&lt;/script&gt;');
            expect(html).not.toContain('<script>');
        });

        it('escapes ampersands, quotes, and apostrophes', () => {
            const html = parseMarkdown('Tom & Jerry said "Hello" and \'Goodbye\'');
            expect(html).toContain('&amp;');
            expect(html).toContain('&quot;');
            expect(html).toContain('&#039;');
        });
    });

    describe('Headers', () => {
        it('parses h1 headers', () => {
            const html = parseMarkdown('# Heading 1');
            expect(html).toBe('<h1 class="md-h1">Heading 1</h1>');
        });

        it('parses h2 headers', () => {
            const html = parseMarkdown('## Heading 2');
            expect(html).toBe('<h2 class="md-h2">Heading 2</h2>');
        });

        it('parses h3 headers', () => {
            const html = parseMarkdown('### Heading 3');
            expect(html).toBe('<h3 class="md-h3">Heading 3</h3>');
        });

        it('parses h4 headers', () => {
            const html = parseMarkdown('#### Heading 4');
            expect(html).toBe('<h4 class="md-h4">Heading 4</h4>');
        });

        it('parses headers with inline markdown', () => {
            const html = parseMarkdown('# **Bold** heading with *italic*');
            expect(html).toContain('<h1 class="md-h1">');
            expect(html).toContain('<strong>Bold</strong>');
            expect(html).toContain('<em>italic</em>');
        });
    });

    describe('Lists', () => {
        it('parses unordered lists with dash', () => {
            const md = '- Item 1\n- Item 2\n- Item 3';
            const html = parseMarkdown(md);
            expect(html).toContain('<ul class="md-ul">');
            expect(html).toContain('<li>Item 1</li>');
            expect(html).toContain('<li>Item 2</li>');
            expect(html).toContain('<li>Item 3</li>');
            expect(html).toContain('</ul>');
        });

        it('parses unordered lists with asterisk', () => {
            const md = '* Item A\n* Item B';
            const html = parseMarkdown(md);
            expect(html).toContain('<ul class="md-ul">');
            expect(html).toContain('<li>Item A</li>');
            expect(html).toContain('<li>Item B</li>');
            expect(html).toContain('</ul>');
        });

        it('parses ordered lists', () => {
            const md = '1. First\n2. Second\n3. Third';
            const html = parseMarkdown(md);
            expect(html).toContain('<ol class="md-ol">');
            expect(html).toContain('<li>First</li>');
            expect(html).toContain('<li>Second</li>');
            expect(html).toContain('<li>Third</li>');
            expect(html).toContain('</ol>');
        });

        it('closes list when followed by paragraph', () => {
            const md = '- Item 1\n- Item 2\n\nParagraph text';
            const html = parseMarkdown(md);
            expect(html).toContain('</ul>');
            expect(html).toContain('<p class="md-p">Paragraph text</p>');
        });

        it('switches list type from unordered to ordered', () => {
            const md = '- Unordered\n1. Ordered';
            const html = parseMarkdown(md);
            expect(html).toContain('<ul class="md-ul">');
            expect(html).toContain('</ul>');
            expect(html).toContain('<ol class="md-ol">');
            expect(html).toContain('</ol>');
        });
    });

    describe('Inline markdown', () => {
        it('parses bold with double asterisk', () => {
            const html = parseMarkdown('This is **bold** text');
            expect(html).toContain('<strong>bold</strong>');
        });

        it('parses italic with single asterisk', () => {
            const html = parseMarkdown('This is *italic* text');
            expect(html).toContain('<em>italic</em>');
        });

        it('parses inline code', () => {
            const html = parseMarkdown('Use the `console.log()` function');
            expect(html).toContain('<code class="md-code">console.log()</code>');
        });

        it('parses links', () => {
            const html = parseMarkdown('[Click here](https://example.com)');
            expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="md-link">Click here</a>');
        });

        it('parses images', () => {
            const html = parseMarkdown('![Alt text](https://example.com/image.jpg)');
            expect(html).toContain('<img src="https://example.com/image.jpg" alt="Alt text" class="md-image" loading="lazy">');
        });

        it('auto-links bare URLs', () => {
            const html = parseMarkdown('Visit https://example.com for more');
            expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="md-link">https://example.com</a>');
        });

        it('handles multiple inline styles in one line', () => {
            const html = parseMarkdown('**Bold**, *italic*, and `code` with [link](https://example.com)');
            expect(html).toContain('<strong>Bold</strong>');
            expect(html).toContain('<em>italic</em>');
            expect(html).toContain('<code class="md-code">code</code>');
            expect(html).toContain('<a href="https://example.com"');
        });
    });

    describe('Edge cases', () => {
        it('returns empty string for empty input', () => {
            expect(parseMarkdown('')).toBe('');
        });

        it('returns empty string for null input', () => {
            expect(parseMarkdown(null as any)).toBe('');
        });

        it('returns empty string for undefined input', () => {
            expect(parseMarkdown(undefined as any)).toBe('');
        });

        it('parses horizontal rule with dashes', () => {
            const html = parseMarkdown('---');
            expect(html).toContain('<hr class="md-hr">');
        });

        it('parses horizontal rule with asterisks', () => {
            const html = parseMarkdown('***');
            expect(html).toContain('<hr class="md-hr">');
        });

        it('converts empty lines to breaks', () => {
            const md = 'Line 1\n\nLine 2';
            const html = parseMarkdown(md);
            expect(html).toContain('<br>');
        });

        it('wraps plain text in paragraph tags', () => {
            const html = parseMarkdown('Just plain text');
            expect(html).toBe('<p class="md-p">Just plain text</p>');
        });

        it('closes unclosed lists at end of text', () => {
            const md = '- Item 1\n- Item 2';
            const html = parseMarkdown(md);
            expect(html).toContain('</ul>');
        });
    });

    describe('Complex scenarios', () => {
        it('handles mixed content types', () => {
            const md = `# Title
Paragraph text

- List item 1
- List item 2

Another paragraph with **bold** and *italic*.

1. Ordered item
2. Another ordered item`;
            const html = parseMarkdown(md);
            expect(html).toContain('<h1 class="md-h1">Title</h1>');
            expect(html).toContain('<ul class="md-ul">');
            expect(html).toContain('<ol class="md-ol">');
            expect(html).toContain('<strong>bold</strong>');
            expect(html).toContain('<em>italic</em>');
        });

        it('handles links with special characters in URL', () => {
            const html = parseMarkdown('[Search](https://example.com/search?q=test&type=all)');
            expect(html).toContain('href="https://example.com/search?q=test&amp;type=all"');
        });
    });
});

describe('resolveAssetRefs', () => {
    it('replaces asset:images/ refs with blob URLs', () => {
        const mockAssets = new Map([
            ['images/photo.jpg', {
                blob: new Blob(['test']),
                url: 'blob:http://localhost/abc-123',
                name: 'photo.jpg'
            }],
        ]);
        const text = 'Look at this: asset:images/photo.jpg';
        const result = resolveAssetRefs(text, mockAssets);
        expect(result).toBe('Look at this: blob:http://localhost/abc-123');
    });

    it('leaves unmatched asset: refs unchanged', () => {
        const mockAssets = new Map([
            ['images/photo.jpg', {
                blob: new Blob(['test']),
                url: 'blob:http://localhost/abc-123',
                name: 'photo.jpg'
            }],
        ]);
        const text = 'Missing: asset:images/missing.jpg';
        const result = resolveAssetRefs(text, mockAssets);
        expect(result).toBe('Missing: asset:images/missing.jpg');
    });

    it('handles multiple refs in the same string', () => {
        const mockAssets = new Map([
            ['images/photo1.jpg', {
                blob: new Blob(['test1']),
                url: 'blob:http://localhost/abc-123',
                name: 'photo1.jpg'
            }],
            ['images/photo2.png', {
                blob: new Blob(['test2']),
                url: 'blob:http://localhost/def-456',
                name: 'photo2.png'
            }],
        ]);
        const text = 'asset:images/photo1.jpg and asset:images/photo2.png';
        const result = resolveAssetRefs(text, mockAssets);
        expect(result).toContain('blob:http://localhost/abc-123');
        expect(result).toContain('blob:http://localhost/def-456');
        expect(result).not.toContain('asset:');
    });

    it('returns text unchanged if imageAssets is empty', () => {
        const mockAssets = new Map();
        const text = 'asset:images/photo.jpg';
        const result = resolveAssetRefs(text, mockAssets);
        expect(result).toBe('asset:images/photo.jpg');
    });

    it('returns text unchanged if imageAssets is null', () => {
        const text = 'asset:images/photo.jpg';
        const result = resolveAssetRefs(text, null as any);
        expect(result).toBe('asset:images/photo.jpg');
    });

    it('returns text unchanged if imageAssets is undefined', () => {
        const text = 'asset:images/photo.jpg';
        const result = resolveAssetRefs(text, undefined as any);
        expect(result).toBe('asset:images/photo.jpg');
    });

    it('returns text unchanged if text is empty', () => {
        const mockAssets = new Map([
            ['images/photo.jpg', {
                blob: new Blob(['test']),
                url: 'blob:http://localhost/abc-123',
                name: 'photo.jpg'
            }],
        ]);
        expect(resolveAssetRefs('', mockAssets)).toBe('');
    });

    it('returns text unchanged if text is falsy', () => {
        const mockAssets = new Map();
        expect(resolveAssetRefs(null as any, mockAssets)).toBe(null as any);
        expect(resolveAssetRefs(undefined as any, mockAssets)).toBe(undefined as any);
    });

    it('works inside markdown image syntax', () => {
        const mockAssets = new Map([
            ['images/photo.jpg', {
                blob: new Blob(['test']),
                url: 'blob:http://localhost/abc-123',
                name: 'photo.jpg'
            }],
        ]);
        const text = '![caption](asset:images/photo.jpg)';
        const result = resolveAssetRefs(text, mockAssets);
        expect(result).toBe('![caption](blob:http://localhost/abc-123)');
    });

    it('stops at parentheses in filenames (by design for markdown safety)', () => {
        const mockAssets = new Map([
            ['images/photo', {
                blob: new Blob(['test']),
                url: 'blob:http://localhost/abc-123',
                name: 'photo'
            }],
        ]);
        // The regex stops at parentheses to avoid conflicts with markdown image syntax
        const text = 'asset:images/photo (extra text)';
        const result = resolveAssetRefs(text, mockAssets);
        expect(result).toBe('blob:http://localhost/abc-123 (extra text)');
    });

    it('handles filenames with hyphens and underscores', () => {
        const mockAssets = new Map([
            ['images/my-photo_v2.jpg', {
                blob: new Blob(['test']),
                url: 'blob:http://localhost/xyz-789',
                name: 'my-photo_v2.jpg'
            }],
        ]);
        const text = 'See: asset:images/my-photo_v2.jpg here';
        const result = resolveAssetRefs(text, mockAssets);
        expect(result).toBe('See: blob:http://localhost/xyz-789 here');
    });
});

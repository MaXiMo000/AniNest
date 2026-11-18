import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/lib/ui.js';

// escapeHtml is the one gate between user-authored text (reviews, list names,
// shared quotes) and the DOM. It must neutralise every character that can
// break out of an HTML context — including the single quote, so the same
// helper is safe in single-quoted attributes, not only double-quoted ones.
describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('neutralises a single-quoted-attribute breakout', () => {
    // If a value ever lands in attr='...', the apostrophe must not close it.
    expect(escapeHtml("' onerror='alert(1)")).toBe('&#39; onerror=&#39;alert(1)');
    expect(escapeHtml("' onerror='alert(1)")).not.toContain("'");
  });

  it('neutralises a script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('leaves safe text untouched and coerces non-strings', () => {
    expect(escapeHtml('Hello, world 123')).toBe('Hello, world 123');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

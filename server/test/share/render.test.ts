import { describe, expect, it } from 'vitest';
import { safeJsonForScript } from '../../src/share/html';
import { renderPage } from '../../src/share/render';

const TEMPLATE = `<!doctype html>
<html><head>
<meta property="og:title" content="old" />
<meta property="og:title" content="duplicate" />
<script id="initial-data" type="application/json">null</script>
</head><body>
<h1 id="name">placeholder</h1>
<a id="join" aria-disabled="true">join</a>
<p class="note">remove me</p>
</body></html>`;

describe('renderPage (HTMLRewriter replacement)', () => {
  it('keeps the doctype and applies an attribute patch to every match', () => {
    const html = renderPage(TEMPLATE, [
      { selector: 'meta[property="og:title"]', kind: 'attr', name: 'content', value: 'New "title"' },
    ]);
    expect(html.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/content="New &quot;title&quot;"/g)).toHaveLength(2);
    expect(html).not.toContain('content="old"');
  });

  it('escapes text patches, as setInnerContent does without { html: true }', () => {
    const html = renderPage(TEMPLATE, [
      { selector: 'h1#name', kind: 'text', value: '<img src=x onerror=alert(1)> & co' },
    ]);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co');
    expect(html).not.toContain('<img src=x');
  });

  it('removes attributes and elements', () => {
    const html = renderPage(TEMPLATE, [
      { selector: 'a#join', kind: 'removeAttr', name: 'aria-disabled' },
      { selector: 'p.note', kind: 'remove' },
    ]);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('remove me');
  });

  it('round-trips script-safe JSON through an html patch intact', () => {
    const data = { name: '</script><script>alert(1)</script>', emoji: '🎮', sep: ' ' };
    const html = renderPage(TEMPLATE, [
      { selector: 'script#initial-data', kind: 'html', value: safeJsonForScript(data) },
    ]);
    expect(html).not.toContain('</script><script>alert(1)');
    const body = html.match(/<script id="initial-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    expect(body).toBeDefined();
    expect(JSON.parse(body ?? '')).toEqual(data);
  });

  it('is a no-op for selectors that match nothing', () => {
    const html = renderPage(TEMPLATE, [{ selector: '#missing', kind: 'text', value: 'x' }]);
    expect(html).toContain('placeholder');
  });
});

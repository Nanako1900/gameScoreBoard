import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const ROOT = path.resolve(__dirname, '../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
function files(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}
describe('light presentation and strict CSP', () => {
  it('uses a light document, system fonts and flat base surfaces', () => {
    const theme = read('src/theme.css'); const html = read('index.html');
    expect(theme).toMatch(/color-scheme:\s*light/);
    expect(html).toContain('name="color-scheme" content="light"');
    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com|Rajdhani/);
    expect(theme).not.toMatch(/(?:radial|linear)-gradient|--glow|--inner-glow/);
    expect(theme).toMatch(/\.btn\s*\{[^}]*min-height:\s*(?:var\(--tap-min\)|44px)/s);
  });
  it('never emits inline styling or raw HTML from any application component', () => {
    const offenders = files('src').filter(file => /\.[jt]sx?$/.test(file))
      .filter(file => /\bstyle\s*=|dangerouslySetInnerHTML|\.style\s*(?:\.|\[|=)/.test(read(file)));
    expect(offenders).toEqual([]);
  });
  it('keeps layout reading order natural rather than assigning visual areas or order', () => {
    const offenders = files('src').filter(file => file.endsWith('.css'))
      .filter(file => /(?:^|[;{])\s*(?:order|grid-template-areas)\s*:/m.test(read(file).replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(offenders).toEqual([]);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const COMPONENTS = path.resolve(__dirname, '../../src/components');
const SEPARATE = new Set(['header.css', 'modal.css', 'page-bar.css', 'board-page.css', 'settings-page.css',
  'home-overview.css', 'avatar.css', 'score-gauge.css', 'history-chart.css', 'tier-badge.css',
  'rules-panel.css', 'sentencing-scale.css']);
const sheets = readdirSync(COMPONENTS).filter((file) => file.endsWith('.css') && !SEPARATE.has(file))
  .map((file) => ({ file, css: readFileSync(path.join(COMPONENTS, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const rules = sheets.flatMap(({ file, css }) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ file, selectors: match[1].trim().split(',').map((part) => part.trim()), body: match[2] })));
function declarations(selector: string): string {
  return rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(';');
}
const readableFont = /font-size:\s*(?:var\(--(?:fs-md|text-base)\)|max\(16px,\s*var\(--(?:text-sm|fs-sm)\)\)|16px|1rem)\s*;/;
const touchSize = /min-height:\s*(?:var\(--tap-min\)|44px|[3-9](?:\.\d+)?rem)\s*;/;

describe('business page visual contract', () => {
  it('uses semantic light surfaces instead of literal dark overlays, neon colors or gradients', () => {
    const offenders = sheets.filter(({ css }) => /(?:rgba?\(|#[\da-f]{3,8}\b|(?:linear|radial)-gradient\(|--(?:inner-glow|glow-)|(?:drop-shadow|text-shadow)\s*\()/i.test(css));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it('keeps the reading order as the visual order', () => {
    const offenders = sheets.filter(({ css }) => /(?:^|[;{\s])(?:order|grid-template-areas)\s*:|(?:row|column)-reverse/.test(css));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it.each(['.aai__input', '.aai__textarea', '.ob__name-input', '.cd__textarea',
    '.cd-extra__input', '.sd__textarea', '.aps__textarea', '.pd__score-input', '.pd__override-input',
    '.voice-log__controls input', '.voice-log__controls select', '.member-list__search input',
    '.tools-page__card > input', '.cases-page__filter select'])('keeps %s readable and touch-sized', (selector) => {
    const body = declarations(selector);
    expect(body, selector).toMatch(readableFont);
    expect(body, selector).toMatch(touchSize);
  });

  it.each(['.aai__input', '.ob__name-input', '.pd__score-input', '.pd__override-input'])
    ('keeps the single-line control %s compact instead of applying textarea height', (selector) => {
      const sizes = [...declarations(selector).matchAll(/min-height:\s*([^;]+);/g)];
      expect(sizes[sizes.length - 1]?.[1]).toMatch(/^(?:var\(--tap-min\)|44px)$/);
    });

  it.each(['.dlink-notice__close', '.cd-extra__toggle', '.cd-person__voice', '.draft-note__clear',
    '.fgn__appeal', '.feed-row__subject--link', '.feed__more', '.ob__name-opt', '.ob-card',
    '.wr__regen', '.wr__close', '.tools-page__back', '.tools-page__other', '.pd__links a',
    'button.msl__standing', '.msl__open'])('gives the custom action %s a 44px minimum hit area', (selector) => {
    const body = declarations(selector);
    expect(body, selector).toMatch(touchSize);
  });
});

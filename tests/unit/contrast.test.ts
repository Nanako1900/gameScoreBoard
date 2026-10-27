// Locks the colour-token contrast fixed by H10 (spec §6.1): every text token
// passes WCAG AA (4.5:1) and every non-text edge passes 3:1 (WCAG 1.4.11) on all
// four surfaces. Reads src/theme.css itself, so a token edit can't drift past it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const THEME_CSS = readFileSync(path.resolve(__dirname, '../../src/theme.css'), 'utf8');

/** WCAG 2.x AA for body-size text. */
const TEXT_MIN_RATIO = 4.5;
/** WCAG 1.4.11 for UI component boundaries and focus indicators. */
const NON_TEXT_MIN_RATIO = 3;

const SURFACES = ['--bg', '--bg-elevated', '--panel', '--panel-2'] as const;
const TEXT_TOKENS = ['--faint', '--muted', '--danger-text'] as const;
const NON_TEXT_TOKENS = ['--border-input', '--focus'] as const;

/** `--name: value` pairs from every `:root { … }` block, comments removed. */
function rootTokens(css: string): ReadonlyMap<string, string> {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...uncommented.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  return new Map(
    blocks.flatMap((block) =>
      [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const),
    ),
  );
}

/** Follows `var(--x)` aliases down to a 6-digit hex. Throws on anything else. */
function resolveHex(tokens: ReadonlyMap<string, string>, name: string, seen: readonly string[] = []): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not defined in :root`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) {
    if (seen.includes(alias[1])) throw new Error(`${name} has a var() cycle`);
    return resolveHex(tokens, alias[1], [...seen, name]);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a 6-digit hex: ${value}`);
  return value.toLowerCase();
}

// WCAG 2.x relative luminance of an sRGB colour.
function channel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const TOKENS = rootTokens(THEME_CSS);
const hex = (name: string): string => resolveHex(TOKENS, name);

describe('contrast()', () => {
  it('matches the WCAG reference points', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrast('#123456', '#123456')).toBe(1);
  });

  it('would have caught the pre-v5 --faint (#5c6675 on --panel-2 ≈ 2.8)', () => {
    expect(contrast('#5c6675', hex('--panel-2'))).toBeLessThan(TEXT_MIN_RATIO);
  });
});

describe('theme.css text tokens', () => {
  for (const token of TEXT_TOKENS) {
    it.each(SURFACES)(`${token} on %s ≥ 4.5:1`, (surface) => {
      expect(contrast(hex(token), hex(surface))).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    });
  }
});

describe('theme.css non-text tokens', () => {
  for (const token of NON_TEXT_TOKENS) {
    it.each(SURFACES)(`${token} on %s ≥ 3:1`, (surface) => {
      expect(contrast(hex(token), hex(surface))).toBeGreaterThanOrEqual(NON_TEXT_MIN_RATIO);
    });
  }
});

describe('theme.css semantic layer (spec §6.2)', () => {
  it.each([
    ['--action', '--gold'],
    ['--attn', '--amber'],
    ['--ok', '--green'],
    ['--neutral', '--muted'],
    ['--danger', '--red'],
    ['--info', '--blue'],
    ['--score-chip-bg', '--panel-2'],
    ['--score-chip-fg', '--text'],
    ['--down', '--danger-text'],
  ] as const)('%s resolves to %s', (semantic, primitive) => {
    expect(hex(semantic)).toBe(hex(primitive));
  });
});

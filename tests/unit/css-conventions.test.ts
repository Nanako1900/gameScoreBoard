// House rules for every stylesheet under src/ (spec §6.1, §6.4; P0 contract §3.1).
// New CSS in later PRs is held to the same rules automatically.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../src');

/** Phone ≤600, above phone, below desktop, desktop ≥1024 — the only width queries allowed. */
const ALLOWED_WIDTH_FEATURES: ReadonlySet<string> = new Set([
  'max-width: 600px',
  'min-width: 601px',
  'max-width: 1023px',
  'min-width: 1024px',
]);

interface CssRule {
  /** Path relative to src/. */
  file: string;
  /** Selector list or at-rule prelude, whitespace collapsed. */
  prelude: string;
  /** Preludes of the enclosing blocks, outermost first. */
  ancestors: readonly string[];
  /** Declarations directly inside this block (nested blocks excluded). */
  body: string;
}

interface Frame {
  prelude: string;
  body: string;
}

interface ScanState {
  stack: readonly Frame[];
  rules: readonly CssRule[];
  pending: string;
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

/** Comments and string contents may hold braces or code-like text: blank them out. */
function stripNoise(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

function appendToTop(stack: readonly Frame[], text: string): readonly Frame[] {
  if (stack.length === 0) return stack;
  const top = stack[stack.length - 1];
  return [...stack.slice(0, -1), { ...top, body: top.body + text }];
}

function openBlock(state: ScanState): ScanState {
  // Whatever follows the last `;` is this block's prelude; before it, the parent's declarations.
  const cut = state.pending.lastIndexOf(';') + 1;
  const stack = appendToTop(state.stack, state.pending.slice(0, cut));
  const frame: Frame = { prelude: squash(state.pending.slice(cut)), body: '' };
  return { ...state, stack: [...stack, frame], pending: '' };
}

function closeBlock(file: string, state: ScanState): ScanState {
  const stack = appendToTop(state.stack, state.pending);
  if (stack.length === 0) return { ...state, pending: '' };
  const top = stack[stack.length - 1];
  const parents = stack.slice(0, -1);
  const rule: CssRule = {
    file,
    prelude: top.prelude,
    ancestors: parents.map((frame) => frame.prelude),
    body: top.body,
  };
  return { stack: parents, rules: [...state.rules, rule], pending: '' };
}

/** Brace-depth scan: enough for our hand-written CSS (plain rules inside at-rules). */
function scanRules(file: string, css: string): readonly CssRule[] {
  const initial: ScanState = { stack: [], rules: [], pending: '' };
  return stripNoise(css)
    .split(/([{}])/)
    .reduce<ScanState>((state, token) => {
      if (token === '{') return openBlock(state);
      if (token === '}') return closeBlock(file, state);
      return { ...state, pending: state.pending + token };
    }, initial).rules;
}

const SHEETS = cssFiles(SRC).map((full) => ({
  file: path.relative(SRC, full),
  css: readFileSync(full, 'utf8'),
}));
const RULES = SHEETS.flatMap((sheet) => scanRules(sheet.file, sheet.css));
const STYLE_RULES = RULES.filter((rule) => !rule.prelude.startsWith('@'));
const where = (rule: CssRule): string => `${rule.file}: ${rule.prelude}`;

describe('css scanner', () => {
  it('sees every stylesheet and its rules', () => {
    const files = SHEETS.map((sheet) => sheet.file);
    expect(files).toContain('theme.css');
    expect(files).toContain('app.css');
    expect(files).toContain(path.join('components', 'modal.css'));
    expect(STYLE_RULES.find((rule) => rule.prelude === '.btn')?.body).toMatch(/display:\s*inline-flex/);
  });

  it('records the enclosing @media of a nested rule', () => {
    const [rule] = scanRules('x.css', '@media (max-width: 600px) { .a:hover { color: red; } }');
    expect(rule).toEqual({
      file: 'x.css',
      prelude: '.a:hover',
      ancestors: ['@media (max-width: 600px)'],
      body: ' color: red; ',
    });
  });
});

describe('src/**/*.css', () => {
  it('uses only the 600 / 1024 breakpoints', () => {
    const offenders = RULES.filter((rule) => rule.prelude.startsWith('@media')).flatMap((rule) =>
      (rule.prelude.match(/\([^()]*width[^()]*\)/g) ?? [])
        .map((feature) => squash(feature.slice(1, -1)).replace(/\s*:\s*/, ': '))
        .filter((feature) => !ALLOWED_WIDTH_FEATURES.has(feature))
        .map((feature) => `${rule.file}: @media (${feature})`),
    );
    expect(offenders).toEqual([]);
  });
});

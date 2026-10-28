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
const HOVER_MEDIA = /^@media\b.*\(\s*hover\s*:\s*hover\s*\)/;
const COARSE_MEDIA = '@media (pointer: coarse)';
/** Longhands in theme.css's coarse block, and the shorthands that also set them. */
const RIVAL_PROPS: Readonly<Record<string, readonly string[]>> = {
  'padding-block': ['padding'],
  'margin-block': ['margin'],
};

const selectorsOf = (rule: CssRule): readonly string[] =>
  rule.prelude.split(',').map((selector) => selector.trim());
const propsOf = (rule: CssRule): readonly string[] =>
  [...rule.body.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map((match) => match[1]);

/** `outline: none` / `0` / `0px`, and the longhands that hide it just as well. */
const OUTLINE_REMOVED =
  /(?:^|[;\s])outline(?:-style|-width)?\s*:\s*(?:none|0(?:px)?)\s*(?:!important\s*)?(?:;|$)/;
const BOX_SHADOW = /(?:^|[;\s])box-shadow\s*:/;
/** `color` / `-webkit-text-fill-color` set to a fill red (4.2:1 on --panel-2 — too dim for text). */
const RED_TEXT =
  /(?:^|[;\s])(?:-webkit-text-fill-)?color\s*:\s*(?:var\(--red(?:-dim)?\)|var\(--danger\)|#e5484d|#a5343a)/i;
/** Selectors naming a form control (`.sf__input`, `.sd__textarea`, `.cd__select`, …). */
const FORM_CONTROL = /(?:input|textarea|select)\b/;
/** A border drawn with the low-contrast structure greys (≈1.2–1.5:1). */
const DIM_BORDER = /(?:^|[;\s])border(?:-color)?\s*:[^;]*var\(--border(?:-strong)?\)/;

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

  it('never removes the focus outline', () => {
    expect(STYLE_RULES.filter((rule) => OUTLINE_REMOVED.test(rule.body)).map(where)).toEqual([]);
  });

  it('has no --focus-ring box-shadow token left', () => {
    const offenders = SHEETS.filter((sheet) => stripNoise(sheet.css).includes('--focus-ring'));
    expect(offenders.map((sheet) => sheet.file)).toEqual([]);
  });

  it('never draws focus with box-shadow (it hides under glows and vanishes in forced colors)', () => {
    const offenders = STYLE_RULES.filter(
      (rule) => rule.prelude.includes(':focus') && BOX_SHADOW.test(rule.body),
    );
    expect(offenders.map(where)).toEqual([]);
  });

  it('writes red text with --danger-text, never the fill red', () => {
    expect(STYLE_RULES.filter((rule) => RED_TEXT.test(rule.body)).map(where)).toEqual([]);
  });

  it('edges form controls with --border-input (3:1), not the structure greys', () => {
    const offenders = STYLE_RULES.filter(
      (rule) => FORM_CONTROL.test(rule.prelude) && DIM_BORDER.test(rule.body),
    );
    expect(offenders.map(where)).toEqual([]);
  });

  it('keeps every :hover rule inside @media (hover: hover)', () => {
    // Touch screens fire :hover on tap and leave it stuck; hover-only styling must opt in.
    const offenders = STYLE_RULES.filter(
      (rule) =>
        rule.prelude.includes(':hover') &&
        !rule.ancestors.some((ancestor) => HOVER_MEDIA.test(ancestor)),
    );
    expect(offenders.map(where)).toEqual([]);
  });

  it("restates theme.css's touch sizes wherever a component's own rule now beats them", () => {
    // theme.css loads first (H8): a component's plain `.x { min-height }` silently
    // undoes the coarse-pointer size theme.css gives `.x`, unless the component
    // repeats it in its own `@media (pointer: coarse)` after that rule.
    const components = STYLE_RULES.filter((rule) => rule.file !== 'theme.css');
    const sets = (rule: CssRule, selector: string, props: readonly string[]): boolean =>
      selectorsOf(rule).includes(selector) && propsOf(rule).some((prop) => props.includes(prop));
    const offenders = STYLE_RULES.filter(
      (rule) => rule.file === 'theme.css' && rule.ancestors.includes(COARSE_MEDIA),
    ).flatMap((themeRule) =>
      selectorsOf(themeRule).flatMap((selector) =>
        propsOf(themeRule)
          .filter((prop) => {
            const rivals = [prop, ...(RIVAL_PROPS[prop] ?? [])];
            const beaten = components.some((r) => r.ancestors.length === 0 && sets(r, selector, rivals));
            const restated = components.some(
              (r) => r.ancestors.includes(COARSE_MEDIA) && sets(r, selector, [prop]),
            );
            return beaten && !restated;
          })
          .map((prop) => `${selector} { ${prop} }`),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe('theme.css primitives later PRs build on', () => {
  const FORCED = '@media (forced-colors: active)';
  const theme = STYLE_RULES.filter((rule) => rule.file === 'theme.css');
  const forced = theme.filter((rule) => rule.ancestors.includes(FORCED));

  it('keeps the focus ring in forced-colors mode', () => {
    const focus = forced.find((rule) => rule.prelude === ':focus-visible');
    expect(focus?.body).toMatch(/outline-color:\s*Highlight/);
  });

  it('gives controls and status chips an edge in forced-colors mode', () => {
    const edged = (pattern: RegExp): string =>
      forced
        .filter((rule) => pattern.test(rule.body))
        .map((rule) => rule.prelude)
        .join(', ');
    expect(edged(/border-color:\s*ButtonText/)).toMatch(/\.btn\b.*\binput\b/);
    const chips = edged(/border:\s*1px solid CanvasText/);
    for (const chip of ['.feed-row__status', '.tier-badge']) {
      expect(chips).toContain(chip);
    }
  });

  it('defines .btn--danger-outline for inline danger confirms', () => {
    const body = theme.find((rule) => rule.prelude === '.btn--danger-outline')?.body ?? '';
    expect(body).toMatch(/color:\s*var\(--danger-text\)/);
    expect(body).toMatch(/border-color:\s*var\(--danger\)/);
    expect(body).toMatch(/background:\s*transparent/);
  });
});

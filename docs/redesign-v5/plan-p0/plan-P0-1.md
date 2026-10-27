# P0-1 地基：层叠顺序、焦点、对比度、token 与断点 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修好 CSS 层叠顺序（H8）、把焦点环换成 outline 并支持强制颜色模式（H9）、把 `--faint` / 输入框边框 / 红色文字的对比度提到 WCAG 线以上（H10），同时立好语义 token、字号 token、600/1024 断点和 hover 约定，并用单元测试把这些约定锁住，让后面每个 PR 的 CSS 自动受约束。

**Architecture:** 只改样式和一行导入顺序，不碰任何组件的 TSX、文案和签名。`src/theme.css` 的 `:root` 拆成 primitive / semantic 两层并补齐契约 §3.1 的全部 token；`main.tsx` 先导入 `theme.css`，组件样式因此重新压过基础样式。约定由两个纯 Node 单元测试守住：`contrast.test.ts` 读 `theme.css` 算 WCAG 对比度，`css-conventions.test.ts` 用花括号深度扫描 `src/**/*.css` 检查断点、hover、焦点、红字和输入框边框。

**Tech Stack:** 手写 CSS（无 PostCSS 插件）、Vite 6、Vitest 3（`tests/unit` 跑在 node 环境，由 `tsconfig.worker.json` 做类型检查，只能用 `node:fs` / `node:path`，不能碰 DOM）。

**依赖:** 无硬依赖，最先合并（契约 §2.2）。**提供**给后续 PR：契约 §3.1 的全部 token（含 `--z-modal`、`--z-toast`、`--safe-bottom`、`--sheet-max-h`、`--tap-min`、`--fs-*`、语义层）、全局 `:focus-visible` outline、`@media (forced-colors: active)` 兜底、`.btn--danger-outline`、四种断点写法、hover 约定，以及会扫描后续 PR 新 CSS 的 `css-conventions.test.ts`。**消费**：无。

**分支:** `claude/p0-1-foundation`（`git fetch origin && git switch -c claude/p0-1-foundation origin/main`；不要从本地过期的 `main` 开）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/main.tsx` | 改 | 先 `import './theme.css'`，再导入 `App`（H8） |
| `src/theme.css` | 改 | `:root` 两层 token（新增 `--border-input`、`--danger-text`、`--amber`、`--focus`、语义层、层级与布局原语、`--fs-*`、中文字体栈；`--faint` 提亮；`--down` 改指 `--danger-text`）；全局 `:focus-visible` outline；删 `--focus-ring`；按钮 hover 包进 `@media (hover: hover)`；新增 `.btn--danger-outline`；文件末尾新增 `@media (forced-colors: active)` |
| `src/app.css` | 改 | 断点 900→1023、480→600；`.app__fab:hover` 包进 hover 媒体查询；`.app__error-title` 红字 |
| `src/components/admin-ai.css` | 改 | 断点；红字 ×3；输入框边框 |
| `src/components/case-dialog.css` | 改 | 断点；去掉焦点 box-shadow；chip 焦点改 outline；红字 ×2；输入框 / chip 边框；hover ×2 |
| `src/components/discord-link.css` | 改 | 断点；红字；hover ×2 |
| `src/components/header.css` | 改 | 断点；红字；hover ×4 |
| `src/components/invite-banner.css` | 改 | 断点；红字 |
| `src/components/leaderboard.css` | 改 | 断点；hover |
| `src/components/modal.css` | 改 | hover |
| `src/components/onboarding-dialog.css` | 改 | 断点；删 `outline: none` 与焦点 glow；红字；卡片 / 选项 / 输入框边框；hover ×3 |
| `src/components/pending-banner.css` | 改 | 断点；红字 |
| `src/components/player-detail.css` | 改 | 断点；红字 ×3；输入框边框 ×2；hover |
| `src/components/records-feed.css` | 改 | 红字；hover |
| `src/components/red-black-board.css` | 改 | 断点 720→600；红字（含 `-webkit-text-fill-color`）；hover ×4；`.hero-card__link` 的 coarse `padding-block` 在组件里重申（H8 之后被压掉，见 Task 9）（P0-4 会整文件删除，这里只为让约定测试通过、并且在 P0-4 合并前不出触控回归） |
| `src/components/roll-call.css` | 改 | 断点；红字；出勤按钮 / 迟到输入框边框；hover |
| `src/components/rules-panel.css` | 改 | 断点 720→600；折叠按钮焦点环内收；hover |
| `src/components/sentencing-scale.css` | 改 | `.scale__pin--heavy` 填充改用 `--danger`（`--down` 变成文字色了） |
| `src/components/session-detail.css` | 改 | 红字；「未回应」等 RSVP / 出勤小标签 `--faint`→`--muted` |
| `src/components/session-form.css` | 改 | 断点；chip 焦点改 outline ×2；红字；时段 / 人物 chip 与输入框边框；hover ×4 |
| `src/components/sessions-panel.css` | 改 | 断点；红字；hover ×2；`.sessions__tab` 的 coarse `min-height: 40px` 在组件里重申（H8 之后被组件自己的 36px 压掉，见 Task 9） |
| `src/components/statement-dialog.css` | 改 | 断点；红字；输入框边框；隐私告知 `--faint`→`--muted`；hover |
| `src/components/verdict-card.css` | 改 | 红字 |
| `src/components/weekly-report.css` | 改 | 断点；hover |
| `tests/unit/source-hygiene.test.ts` | 改 | 末尾新增一个 `describe`/`it`：`theme.css` 的导入早于 `App` |
| `tests/unit/contrast.test.ts` | 新 | WCAG 对比度：文字 token ≥4.5、非文字 token ≥3（四个表面），语义层别名正确 |
| `tests/unit/css-conventions.test.ts` | 新 | 扫描 `src/**/*.css`：断点四种写法、`:hover` 必在 `@media (hover: hover)` 内、不去 outline、无 `--focus-ring`、焦点不用 box-shadow、表单控件边框用 `--border-input`、红字用 `--danger-text`、theme.css 的 coarse 触控尺寸不被组件规则悄悄压掉；`theme.css` 提供 forced-colors 与 `.btn--danger-outline` |

不改：任何 `.tsx`、`index.html`、`scripts/pages-headers.mjs`（CSP）、`src/components/avatar.css`、`history-chart.css`、`score-gauge.css`、`tier-badge.css`（扫过，没有需要改的规则）。`theme.css:313-316` 的 `.modal__close` coarse 规则归 P0-2 挪走，`theme.css:303` 的 `.hero-card__link` 归 P0-4 删，本 PR 都不动。

基线（契约 §1）：typecheck 通过；unit 14 文件 / 178 用例；dom 8 文件 / 54 用例。本 PR 完成后 unit 应为 **16 文件 / 223 用例**（+1 source-hygiene、+31 contrast、+13 css-conventions），dom 不变。

所有命令前先：

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
```

---

### Task 1: 导入顺序（H8）

**Files:**
- Modify: `src/main.tsx:3-4`
- Test: `tests/unit/source-hygiene.test.ts`（在第 34 行之后追加，不动已有用例）

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/source-hygiene.test.ts` 文件末尾（第 34 行 `});` 之后）追加：

```ts

// H8 (spec §6.1): Vite emits CSS in import order. theme.css must come first so
// component stylesheets override its base rules — imported after App it silently
// beat them (modal shadow, .dlink__bind blue, .pd__revoke-btn red, pill radii).
describe('src/main.tsx', () => {
  it('imports theme.css before App', () => {
    const main = readFileSync(path.join(ROOT, 'src/main.tsx'), 'utf8');
    const themeAt = main.indexOf("import './theme.css';");
    const appAt = main.indexOf("from './App';");
    expect(themeAt).toBeGreaterThanOrEqual(0);
    expect(appAt).toBeGreaterThanOrEqual(0);
    expect(themeAt).toBeLessThan(appAt);
  });
});
```

（`readFileSync`、`path`、`ROOT`、`describe/expect/it` 都已在文件头 `:6-10` 导入/定义。）

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts
```

预期：`src/main.tsx > imports theme.css before App` 失败，`AssertionError: expected 112 to be less than 98`；NUL 字节用例照常通过。

- [ ] **Step 3: 改导入顺序**

`src/main.tsx` 第 1-4 行，改前：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
```

改后：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Base styles first: Vite emits CSS in import order, and every component
// stylesheet App pulls in must come later so it can override these rules.
import './theme.css';
import { App } from './App';
```

其余行不动。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts
```

预期：`Tests  2 passed (2)`。

- [ ] **Step 5: 提交**

```bash
git add src/main.tsx tests/unit/source-hygiene.test.ts
git commit -m "fix: theme.css 先于 App 导入，组件样式重新压过基础样式（H8）"
```

---

### Task 2: token 两层化、对比度 token、字号与字体栈（H10、spec §6.2/§6.3）

**Files:**
- Create: `tests/unit/contrast.test.ts`
- Modify: `src/theme.css:6-70`（整个第一个 `:root` 块）
- Modify: `src/components/sentencing-scale.css:89-92`（`.scale__pin--heavy` 的填充）

- [ ] **Step 1: 写失败的测试**

新建 `tests/unit/contrast.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/contrast.test.ts
```

预期：`Tests  25 failed | 6 passed (31)`。失败的是 `--faint`（旧值 2.8–3.3）、`--danger-text` / `--border-input` / `--focus` 和全部语义层（报 `is not defined in :root`）；`contrast()` 两个用例和 `--muted` 四个用例通过。

- [ ] **Step 3: 重写第一个 `:root` 块**

把 `src/theme.css` 第 6-70 行（从 `:root {` 到 `color-scheme: dark;` 之后的 `}`）整段替换为下面的内容。第 141-143 行那个只放 `--focus-ring` 的第二个 `:root` 块留到 Task 4 删。

```css
:root {
  /* ======================================================================
     Primitive layer — the raw palette. New CSS should reach for the semantic
     layer below; a future light theme only has to swap these values.
     Contrast of the text and edge tokens is locked by tests/unit/contrast.test.ts.
     ====================================================================== */

  /* --- Surfaces & structure --- */
  --bg: #0a0e14;
  --bg-elevated: #0d131c;
  --panel: #141a24;
  --panel-2: #182030;
  --border: #232b3a;
  --border-strong: #2f3a4d;
  /* Edges of inputs, checkboxes and clickable chips: ≥ 3:1 on every surface. */
  --border-input: #66738a;

  /* --- Text --- */
  --text: #e6edf3;
  --muted: #8b96a5;
  --faint: #848fa0;

  /* --- Accents --- */
  --gold: #f5c542;
  --gold-dim: #b8912a;
  /* Fills and borders only — #e5484d is 4.2:1 on --panel-2, too dim for text. */
  --red: #e5484d;
  --red-dim: #a5343a;
  /* Every piece of red text (errors, deductions, danger labels). */
  --danger-text: #ff6b6f;
  --blue: #4aa3ff;
  --green: #3ddc84;
  --amber: #ff8a3d;
  /* Keyboard focus ring — see :focus-visible below. */
  --focus: #8ab4ff;

  /* --- Score deltas --- */
  --up: #3ddc84;
  /* A deduction is text, so it follows --danger-text rather than the fill red. */
  --down: var(--danger-text);

  /* ======================================================================
     Semantic layer — one meaning per colour (spec §6.2). Pair every colour
     with an icon or words: gold and amber are only ~1.45:1 apart.
     ====================================================================== */
  --action: var(--gold); /* primary button, current nav item */
  --attn: var(--amber); /* needs you, deadline < 2h, time moved, dm_ok = 0 */
  --ok: var(--green); /* going, on time, bonus, heal, full */
  --neutral: var(--muted); /* maybe, no reply, not going, cancelled — never red */
  --danger: var(--red); /* danger button fill / edge, deductions — never colours a person */
  --info: var(--blue); /* Discord, links, AI source */
  /* Public score chip and public ScoreGauge: the same for everyone, no tier colour. */
  --score-chip-bg: var(--panel-2);
  --score-chip-fg: var(--text);

  /* --- Layers & layout primitives (consumed by Modal / Toast from P0-2, P0-3) --- */
  --z-modal: 100;
  --z-toast: 200;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --sheet-max-h: 92dvh;
  --tap-min: 44px;

  /* --- Glow / shadow --- */
  --glow-gold: 0 0 0 1px rgba(245, 197, 66, 0.35), 0 0 28px -6px rgba(245, 197, 66, 0.45);
  --glow-red: 0 0 0 1px rgba(229, 72, 77, 0.3), 0 0 26px -8px rgba(229, 72, 77, 0.4);
  --inner-glow: inset 0 1px 0 0 rgba(255, 255, 255, 0.04),
    inset 0 0 40px -30px rgba(120, 160, 255, 0.35);
  --shadow-panel: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 30px -12px rgba(0, 0, 0, 0.55);
  --shadow-pop: 0 20px 60px -18px rgba(0, 0, 0, 0.7);

  /* --- Radius --- */
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 16px;
  --r-pill: 999px;

  /* --- Typography --- */
  /* Rajdhani has no CJK glyphs: Chinese falls through to the system fonts. */
  --font-display: 'Rajdhani', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui,
    sans-serif;
  --font-body: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Noto Sans SC',
    'Microsoft YaHei', Roboto, Helvetica, Arial, sans-serif;
  --font-num: 'Rajdhani', ui-monospace, 'SF Mono', 'Menlo', monospace;

  /* Type scale — six steps plus hero (spec §6.3). Chinese never goes below --fs-xs,
     and only timestamps use it; inputs use --fs-md or more (iOS zooms below 16px). */
  --fs-xs: 0.75rem; /* 12px */
  --fs-sm: 0.875rem; /* 14px */
  --fs-md: 1rem; /* 16px — body, inputs */
  --fs-lg: 1.125rem; /* 18px */
  --fs-xl: 1.375rem; /* 22px */
  --fs-2xl: 1.75rem; /* 28px */
  --fs-hero: 3rem; /* 48px — MyScoreCard and the player page score only */

  /* Deprecated: the v4 fluid sizes. Components move to --fs-* as each is reskinned;
     don't use these in new CSS. */
  --text-hero: clamp(2.6rem, 1.2rem + 5.5vw, 5.5rem);
  --text-h1: clamp(1.6rem, 1.1rem + 2vw, 2.6rem);
  --text-h2: clamp(1.15rem, 0.95rem + 0.9vw, 1.5rem);
  --text-base: clamp(0.95rem, 0.9rem + 0.2vw, 1.05rem);
  --text-sm: 0.85rem;
  --text-xs: 0.74rem;

  /* --- Rhythm --- */
  --space-page: clamp(1rem, 0.5rem + 2.5vw, 3rem);
  --space-section: clamp(2.5rem, 1.5rem + 4vw, 5rem);

  /* --- Motion --- */
  --dur-fast: 130ms;
  --dur: 240ms;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);

  --maxw: 1180px;
  color-scheme: dark;
}
```

与旧块相比，值变了的只有 `--faint`（`#5c6675`→`#848fa0`）、`--down`（`#e5484d`→`var(--danger-text)`）、`--font-display`（去掉 `'Segoe UI'`，补中文回退）和 `--font-body`（补 `'Noto Sans SC'`）；其余旧 token 名和值一个不改。

- [ ] **Step 4: `--down` 变成文字色后，修正唯一一处把它当填充用的规则**

`src/components/sentencing-scale.css` 第 89-92 行，改前：

```css
.scale__pin--heavy {
  background: var(--down);
  box-shadow: 0 0 0 3px var(--bg-elevated), 0 0 16px -2px rgba(229, 72, 77, 0.8);
}
```

改后：

```css
.scale__pin--heavy {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--bg-elevated), 0 0 16px -2px rgba(229, 72, 77, 0.8);
}
```

（已核对：`var(--down)` 的其余 13 处全是 `color:`，跟着变亮正是想要的；`.tsx` 里没有任何 `var(--…)`。）

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/contrast.test.ts
npx tsc -p tsconfig.worker.json --noEmit
```

预期：`Tests  31 passed (31)`；tsc 无输出。

- [ ] **Step 6: 提交**

```bash
git add src/theme.css src/components/sentencing-scale.css tests/unit/contrast.test.ts
git commit -m "feat: token 拆成基础层和语义层，新增对比度 token、字号档位和中文字体栈（H10）"
```

---

### Task 3: 断点统一为 600 / 1024（含约定测试骨架）

**Files:**
- Create: `tests/unit/css-conventions.test.ts`
- Modify（每处都只改一行的 `@media` 条件，行号为快照行号）：
  - `src/app.css:160`（900→1023）、`src/app.css:174`（480→600）
  - `src/components/admin-ai.css:209`、`case-dialog.css:262`、`session-form.css:216`、`statement-dialog.css:126`（520→600）
  - `src/components/header.css:180`、`discord-link.css:185`、`invite-banner.css:78`、`leaderboard.css:151`、`onboarding-dialog.css:169`、`pending-banner.css:61`、`player-detail.css:196`、`roll-call.css:234`、`sessions-panel.css:187`、`weekly-report.css:181`（560→600）
  - `src/components/red-black-board.css:178`、`rules-panel.css:177`（720→600）

归并规则：所有「手机布局」（480/520/560/720）一律归到 `max-width: 600px`；`app.css` 的 900 是「两栏变一栏」，归到 `max-width: 1023px`（桌面以下）。

- [ ] **Step 1: 写失败的测试（骨架 + 断点断言）**

新建 `tests/unit/css-conventions.test.ts`：

```ts
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
```

说明：`(width <= 600px)` 这类 range 语法也会被 `\([^()]*width[^()]*\)` 抓到并判为不合法，`prefers-reduced-motion` / `pointer` / `hover` / `forced-colors` 不含 `width`，不受影响。后面的 Task 会在 `const where = …;` 之后追加常量、在 `describe('src/**/*.css', …)` 末尾追加 `it`。

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  1 failed | 2 passed (3)`；失败信息列出正好 18 条：`app.css: @media (max-width: 900px)`、`app.css: @media (max-width: 480px)`、4 条 520、10 条 560、2 条 720。

- [ ] **Step 3: 归并断点**

```bash
perl -pi -e 's/\@media \(max-width: (?:480|520|560|720)px\)/\@media (max-width: 600px)/' src/app.css src/components/*.css
perl -pi -e 's/\@media \(max-width: 900px\)/\@media (max-width: 1023px)/' src/app.css
git diff --stat
```

预期：`17 files changed, 18 insertions(+), 18 deletions(-)`，每处只是数字变了，例如 `src/app.css`：

```diff
-@media (max-width: 900px) {
+@media (max-width: 1023px) {
   .app__grid {
...
-@media (max-width: 480px) {
+@media (max-width: 600px) {
   .app__fab-label {
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npx tsc -p tsconfig.worker.json --noEmit
```

预期：`Tests  3 passed (3)`；tsc 无输出。

- [ ] **Step 5: 提交**

```bash
git add src/app.css src/components tests/unit/css-conventions.test.ts
git commit -m "refactor: 断点统一为 600 / 1024，并用约定测试锁住"
```

---

### Task 4: 焦点环改用 outline（H9）

**Files:**
- Modify: `src/theme.css:141-149`（快照行号；做完 Task 2 后在 `:191-199`，按内容定位：第二个 `:root` 块和 `:focus-visible`）
- Modify: `src/components/case-dialog.css:47-51`、`:149-152`
- Modify: `src/components/session-form.css:93-96`、`:184-186`
- Modify: `src/components/onboarding-dialog.css:163-167`
- Modify: `src/components/rules-panel.css:23-25`（在其后插入一条规则）
- Test: `tests/unit/css-conventions.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/css-conventions.test.ts` 的 `const where = …;` 一行之后追加：

```ts

const OUTLINE_REMOVED = /(?:^|[;\s])outline\s*:\s*(?:none|0)\s*(?:!important\s*)?(?:;|$)/;
const BOX_SHADOW = /(?:^|[;\s])box-shadow\s*:/;
```

在 `describe('src/**/*.css', () => {` 块最后一个 `it` 之后、块的收尾 `});` 之前追加：

```ts

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
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  3 failed | 3 passed (6)`。三条分别列出：`onboarding-dialog.css: .ob__name-input:focus`、`theme.css: :focus-visible`（去 outline）；`case-dialog.css`、`session-form.css`、`theme.css`（还有 `--focus-ring`）；`case-dialog.css: .cd__select:focus-visible, .cd__textarea:focus-visible`、`.cd-chip:has(:focus-visible)`、`.ob__name-input:focus`、`.sf-slot:has(:focus-visible)`、`.sf-person:has(:focus-visible)`、`theme.css: :focus-visible`（box-shadow 焦点）。

- [ ] **Step 3: 全局焦点环**

`src/theme.css` 快照第 141-149 行（Task 2 之后是第 191-199 行），改前：

```css
:root {
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--blue);
}

:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r-sm);
}
```

改后（同时去掉 `border-radius`：它在聚焦时把胶囊按钮压成小圆角，是「胶囊圆角被覆盖」的一半原因；outline 会自己跟着元素的圆角走）：

```css
/* Keyboard focus is a real outline (H9): box-shadows such as the gold button's
   can't paint over it, it follows each element's own border-radius, and
   forced-colors mode keeps it. Never remove it — restyle the outline instead. */
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

- [ ] **Step 4: 组件里的焦点写法**

`src/components/case-dialog.css` 第 47-51 行，改前：

```css
.cd__select:focus-visible,
.cd__textarea:focus-visible {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--blue) 25%, transparent);
}
```

改后（蓝边框保留作状态提示，环交给全局 outline）：

```css
.cd__select:focus-visible,
.cd__textarea:focus-visible {
  border-color: var(--blue);
}
```

`src/components/case-dialog.css` 第 149-152 行，改前：

```css
/* checkbox 是 visually-hidden 的，焦点环得画在 label 上 */
.cd-chip:has(:focus-visible) {
  box-shadow: var(--focus-ring);
}
```

改后：

```css
/* checkbox 是 visually-hidden 的，焦点环得画在 label 上 */
.cd-chip:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

`src/components/session-form.css` 第 93-96 行，改前：

```css
/* 隐藏的 radio 拿到键盘焦点时，把焦点环画在 label 上 */
.sf-slot:has(:focus-visible) {
  box-shadow: var(--focus-ring);
}
```

改后：

```css
/* 隐藏的 radio 拿到键盘焦点时，把焦点环画在 label 上 */
.sf-slot:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

`src/components/session-form.css` 第 184-186 行，改前：

```css
.sf-person:has(:focus-visible) {
  box-shadow: var(--focus-ring);
}
```

改后：

```css
.sf-person:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

`src/components/onboarding-dialog.css` 第 163-167 行，改前：

```css
.ob__name-input:focus {
  outline: none;
  border-color: var(--gold);
  box-shadow: var(--glow-gold);
}
```

改后：

```css
.ob__name-input:focus {
  border-color: var(--gold);
}
```

`src/components/rules-panel.css` 第 23-25 行的 `.rules__toggle:hover { … }` 之后插入（`.rules` 是 `overflow: hidden` 的圆角面板，折叠按钮贴满面板宽度，外扩 2px 的环会被裁掉）：

```css

/* .rules clips its overflow (rounded panel): draw the ring inside the button. */
.rules__toggle:focus-visible {
  outline-offset: -4px;
}
```

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts tests/unit/contrast.test.ts
grep -rn 'focus-ring\|outline: none' src
```

预期：`Tests  37 passed (37)`；grep 无输出。

- [ ] **Step 6: 提交**

```bash
git add src/theme.css src/components/case-dialog.css src/components/session-form.css src/components/onboarding-dialog.css src/components/rules-panel.css tests/unit/css-conventions.test.ts
git commit -m "fix: 焦点环改用 outline，删掉 box-shadow 焦点写法和 outline:none（H9）"
```

---

### Task 5: 强制颜色模式兜底与 `.btn--danger-outline`

**Files:**
- Modify: `src/theme.css:236-244`（`.btn--danger` 与其 hover 之后插入新按钮类）
- Modify: `src/theme.css:317` 之后（文件末尾追加 forced-colors 块）
- Test: `tests/unit/css-conventions.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/css-conventions.test.ts` 文件末尾追加：

```ts

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
    for (const chip of ['.feed-row__status', '.sdt__chip', '.tier-badge']) {
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
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  3 failed | 6 passed (9)`，失败的正是新 `describe` 里的三个用例。

- [ ] **Step 3: 新增 `.btn--danger-outline`**

`src/theme.css` 中，紧跟在（快照第 242-244 行的）

```css
.btn--danger:hover {
  box-shadow: var(--glow-red);
}
```

之后插入：

```css

/* The quieter danger button: inline confirms such as ConfirmInline's 「确认取消」,
   where a solid red block would shout louder than the choice deserves. */
.btn--danger-outline {
  color: var(--danger-text);
  background: transparent;
  border-color: var(--danger);
}

@media (hover: hover) {
  /* Restate the edge: .btn:hover would otherwise grey it out. */
  .btn--danger-outline:hover {
    border-color: var(--danger);
    background: color-mix(in oklab, var(--danger) 14%, transparent);
  }
}
```

（`.btn--danger-outline:hover` 与 `.btn:hover` 同为 0,2,0 且在其后，所以能盖住 `.btn:hover` 的灰边框。它一出生就写在 `@media (hover: hover)` 里，Task 8 不用再动它。）

- [ ] **Step 4: 文件末尾追加强制颜色模式**

在 `src/theme.css` 最后一行（快照第 317 行，`@media (pointer: coarse)` 块的收尾 `}`）之后追加：

```css

/* --- Forced colors (Windows high contrast) ---------------------------------
 * The browser swaps our palette and drops backgrounds: the focus ring takes the
 * system highlight, controls keep an edge, and status chips that were only a
 * tinted fill get a border so they don't vanish. The chips carry an `html`
 * prefix: theme.css loads first, so it needs one more selector to beat the
 * components' own single-class rules (e.g. .feed-row__status--escalate). */
@media (forced-colors: active) {
  :focus-visible {
    outline-color: Highlight;
  }

  .btn,
  input,
  select,
  textarea {
    border-color: ButtonText;
  }

  html .feed-row__status,
  html .sdt__chip,
  html .sdt-player__rsvp,
  html .sdt-player__att,
  html .srow__game,
  html .srow__count,
  html .srow__status,
  html .rc-row__tag,
  html .tier-badge {
    border: 1px solid CanvasText;
  }
}
```

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  9 passed (9)`。

- [ ] **Step 6: 提交**

```bash
git add src/theme.css tests/unit/css-conventions.test.ts
git commit -m "feat: 强制颜色模式下保住焦点环、控件边框和状态 chip，新增 .btn--danger-outline"
```

---

### Task 6: 红色文字一律用 `--danger-text`

**Files:**
- Modify（每处只换一行的值，快照行号）：`src/app.css:49`；`src/components/admin-ai.css:21,76,205`；`case-dialog.css:61,79`；`discord-link.css:86`；`header.css:166`；`invite-banner.css:69`；`onboarding-dialog.css:82`；`pending-banner.css:49`；`player-detail.css:18,182,192`；`records-feed.css:169`；`red-black-board.css:30,31`；`roll-call.css:17`；`session-detail.css:60`；`session-form.css:207`；`sessions-panel.css:58`；`statement-dialog.css:112`；`verdict-card.css:202`（共 23 处）
- Test: `tests/unit/css-conventions.test.ts`

只换文字色（`color` 和 `-webkit-text-fill-color`）。`border-color`、`background`、`color-mix(in oklab, var(--red) …)` 里的 `--red` 是填充和描边，保持不动；`var(--down)` 已在 Task 2 跟着 `--danger-text` 走了。

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/css-conventions.test.ts` 里紧跟 `const BOX_SHADOW = …;` 之后追加：

```ts
/** `color` / `-webkit-text-fill-color` set to the fill red (4.2:1 on --panel-2 — too dim for text). */
const RED_TEXT = /(?:^|[;\s])(?:-webkit-text-fill-)?color\s*:\s*(?:var\(--red\)|var\(--danger\)|#e5484d)/i;
```

在 `describe('src/**/*.css', …)` 块末尾（收尾 `});` 之前）追加：

```ts

  it('writes red text with --danger-text, never the fill red', () => {
    expect(STYLE_RULES.filter((rule) => RED_TEXT.test(rule.body)).map(where)).toEqual([]);
  });
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  1 failed | 9 passed (10)`；`expected [ 'app.css: .app__error-title', …(21) ] to deeply equal []`（22 条规则，`.rbb__title-slash` 一条规则里有两处）。

- [ ] **Step 3: 替换**

```bash
perl -pi -e 's/(?<![\w-])((?:-webkit-text-fill-)?color): var\(--red\);/$1: var(--danger-text);/' src/app.css src/components/*.css
git diff -- src | grep '^[-+] ' | sort | uniq -c
grep -rn 'var(--red)' src | grep -v 'color-mix'
```

预期（只看 `src`：此时 `tests/unit/css-conventions.test.ts` 也有未提交的改动，不加 `-- src` 会把测试行也数进去）：

```
   1 +  -webkit-text-fill-color: var(--danger-text);
  22 +  color: var(--danger-text);
   1 -  -webkit-text-fill-color: var(--red);
  22 -  color: var(--red);
```

最后一条 grep 只剩 `theme.css` 的 `--danger: var(--red);` 和 `.btn--danger` 的渐变填充两行。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  10 passed (10)`。

- [ ] **Step 5: 提交**

```bash
git add src/app.css src/components tests/unit/css-conventions.test.ts
git commit -m "fix: 红色文字统一改用 --danger-text，#e5484d 只留给填充和描边"
```

---

### Task 7: 输入框与可点 chip 的边框、次要说明提亮（H10）

**Files:**
- Modify（快照行号）：
  - 输入框边框 → `--border-input`：`src/components/admin-ai.css:129`、`case-dialog.css:42,238`、`onboarding-dialog.css:157`、`player-detail.css:97,251`、`roll-call.css:138`、`session-form.css:136`、`statement-dialog.css:85`
  - 可点 chip / 选项卡边框 → `--border-input`：`case-dialog.css:144`（`.cd-chip`）、`onboarding-dialog.css:27,45,123`（`.ob-card`、`.ob-card--locked:hover`、`.ob__name-opt`）、`roll-call.css:87`（`.rc-mark`）、`session-form.css:81,173`（`.sf-slot`、`.sf-person`）
  - hover / 选中边框 `--border-strong` → `--muted`（`--border-strong` 比新的 `--border-input` 还暗，悬停会「变淡」）：`case-dialog.css:155`、`onboarding-dialog.css:34,130`、`roll-call.css:92,98`、`session-form.css:89,121,143,181`、`statement-dialog.css:91`
  - 文字 `--faint` → `--muted`（spec §6.1：「未回应」、隐私告知一律 `--muted` 或更亮）：`session-detail.css:129`（`.sdt-player__rsvp, .sdt-player__att`）、`statement-dialog.css:107`（`.sd__notice`）
- Test: `tests/unit/css-conventions.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/css-conventions.test.ts` 里紧跟 `const RED_TEXT = …;` 之后追加：

```ts
/** Selectors naming a form control (`.sf__input`, `.sd__textarea`, `.cd__select`, …). */
const FORM_CONTROL = /(?:input|textarea|select)\b/;
/** A border drawn with the low-contrast structure greys (≈1.2–1.5:1). */
const DIM_BORDER = /(?:^|[;\s])border(?:-color)?\s*:[^;]*var\(--border(?:-strong)?\)/;
```

在 `describe('src/**/*.css', …)` 块末尾追加：

```ts

  it('edges form controls with --border-input (3:1), not the structure greys', () => {
    const offenders = STYLE_RULES.filter(
      (rule) => FORM_CONTROL.test(rule.prelude) && DIM_BORDER.test(rule.body),
    );
    expect(offenders.map(where)).toEqual([]);
  });
```

（`var\(--border(?:-strong)?\)` 要求紧跟右括号，所以 `var(--border-input)` 不会被误判。chip 的类名各不相同，不进这条自动断言，靠本 Task 的 diff 和视觉验收。）

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  1 failed | 10 passed (11)`，列出 11 条：`.aai__input, .aai__textarea`、`.cd__select, .cd__textarea`、`.cd-extra__input`、`.ob__name-input`、`.pd__score-input`、`.pd__override-input`、`.rc-row__late-input`、`.sf__input, .sf__textarea, .sf__select`、它的 `:hover`、`.sd__textarea`、`.sd__textarea:hover`。

- [ ] **Step 3: 改边框和次要文字颜色**

按下面的 diff 逐处修改（上下文是做完 Task 1-6 之后的文件，`@@` 行号也是那时的行号；可以把整段存成 `/tmp/p0-1-border.diff` 后用 `git apply /tmp/p0-1-border.diff` 一次应用，应用前先 `git apply --check`）：

```diff
diff --git a/src/components/admin-ai.css b/src/components/admin-ai.css
--- a/src/components/admin-ai.css
+++ b/src/components/admin-ai.css
@@ -128,3 +128,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
 }
diff --git a/src/components/case-dialog.css b/src/components/case-dialog.css
--- a/src/components/case-dialog.css
+++ b/src/components/case-dialog.css
@@ -41,3 +41,3 @@
   background: var(--bg-elevated);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   border-radius: var(--r-md);
@@ -142,3 +142,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   cursor: pointer;
@@ -154,3 +154,3 @@
 .cd-chip:hover {
-  border-color: var(--border-strong);
+  border-color: var(--muted);
   color: var(--text);
@@ -237,3 +237,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   resize: vertical;
diff --git a/src/components/onboarding-dialog.css b/src/components/onboarding-dialog.css
--- a/src/components/onboarding-dialog.css
+++ b/src/components/onboarding-dialog.css
@@ -26,3 +26,3 @@
   border-radius: var(--r-md);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   background: var(--bg-elevated);
@@ -33,3 +33,3 @@
 .ob-card:hover {
-  border-color: var(--border-strong);
+  border-color: var(--muted);
   transform: translateY(-2px);
@@ -44,3 +44,3 @@
 .ob-card--locked:hover {
-  border-color: var(--border);
+  border-color: var(--border-input);
   transform: none;
@@ -122,3 +122,3 @@
   border-radius: var(--r-md);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   background: var(--bg-elevated);
@@ -129,3 +129,3 @@
 .ob__name-opt:hover {
-  border-color: var(--border-strong);
+  border-color: var(--muted);
 }
@@ -156,3 +156,3 @@
   border-radius: var(--r-md);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   background: var(--bg-elevated);
diff --git a/src/components/player-detail.css b/src/components/player-detail.css
--- a/src/components/player-detail.css
+++ b/src/components/player-detail.css
@@ -96,3 +96,3 @@
   padding: 0.3rem 0.45rem;
-  border: 1px solid var(--border-strong);
+  border: 1px solid var(--border-input);
   border-radius: var(--r-sm);
@@ -250,3 +250,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
 }
diff --git a/src/components/roll-call.css b/src/components/roll-call.css
--- a/src/components/roll-call.css
+++ b/src/components/roll-call.css
@@ -86,3 +86,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   transition: color var(--dur-fast), border-color var(--dur-fast), background var(--dur-fast);
@@ -91,3 +91,3 @@
 .rc-mark:hover {
-  border-color: var(--border-strong);
+  border-color: var(--muted);
   color: var(--text);
@@ -97,3 +97,3 @@
   color: var(--text);
-  border-color: var(--border-strong);
+  border-color: var(--muted);
   background: var(--panel-2);
@@ -137,3 +137,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
 }
diff --git a/src/components/session-detail.css b/src/components/session-detail.css
--- a/src/components/session-detail.css
+++ b/src/components/session-detail.css
@@ -128,3 +128,3 @@
   font-size: var(--text-xs);
-  color: var(--faint);
+  color: var(--muted);
   background: var(--panel-2);
diff --git a/src/components/session-form.css b/src/components/session-form.css
--- a/src/components/session-form.css
+++ b/src/components/session-form.css
@@ -80,3 +80,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   cursor: pointer;
@@ -88,3 +88,3 @@
   color: var(--text);
-  border-color: var(--border-strong);
+  border-color: var(--muted);
   background: var(--panel-2);
@@ -121,3 +121,3 @@
   border-style: solid;
-  border-color: var(--border-strong);
+  border-color: var(--muted);
   box-shadow: none;
@@ -136,3 +136,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   transition: border-color var(--dur-fast);
@@ -143,3 +143,3 @@
 .sf__select:hover {
-  border-color: var(--border-strong);
+  border-color: var(--muted);
 }
@@ -173,3 +173,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   cursor: pointer;
@@ -181,3 +181,3 @@
   color: var(--text);
-  border-color: var(--border-strong);
+  border-color: var(--muted);
 }
diff --git a/src/components/statement-dialog.css b/src/components/statement-dialog.css
--- a/src/components/statement-dialog.css
+++ b/src/components/statement-dialog.css
@@ -84,3 +84,3 @@
   background: var(--bg);
-  border: 1px solid var(--border);
+  border: 1px solid var(--border-input);
   resize: vertical;
@@ -90,3 +90,3 @@
 .sd__textarea:hover {
-  border-color: var(--border-strong);
+  border-color: var(--muted);
 }
@@ -106,3 +106,3 @@
   line-height: 1.6;
-  color: var(--faint);
+  color: var(--muted);
 }
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
git diff --stat -- src
```

预期：`Tests  11 passed (11)`；`8 files changed, 28 insertions(+), 28 deletions(-)`（只统计 `src`；不加 `-- src` 会多出测试文件，变成 9 files / 39 insertions）。

- [ ] **Step 5: 提交**

```bash
git add src/components tests/unit/css-conventions.test.ts
git commit -m "fix: 输入框和可点 chip 边框改用 --border-input，未回应和隐私告知改用 --muted（H10）"
```

---

### Task 8: hover 样式包进 `@media (hover: hover)`

**Files:**
- Modify（快照行号；每条规则原地包一层，规则体缩进两格，内容不变）：
  - `src/theme.css:208-211,230-234,242-244,251-253`
  - `src/app.css:135-138`；`src/app.css:186-195`（reduced-motion 块里的 `.app__fab:hover` 拆成独立的 `@media (hover: hover) and (prefers-reduced-motion: reduce)` 块）
  - `src/components/case-dialog.css:154-157,211-213`
  - `src/components/discord-link.css:67-70,172-176`
  - `src/components/header.css:26-28,101-104,161-163,169-171`
  - `src/components/leaderboard.css:58-62`
  - `src/components/modal.css:47-51`
  - `src/components/onboarding-dialog.css:33-36,44-47,129-131`
  - `src/components/player-detail.css:186-189`
  - `src/components/records-feed.css:84-88`
  - `src/components/red-black-board.css:91-95,101-105,165-168`；`:199-203`（reduced-motion 块改成 `@media (hover: hover) and (prefers-reduced-motion: reduce)`）
  - `src/components/roll-call.css:91-94`
  - `src/components/rules-panel.css:23-25`
  - `src/components/session-form.css:87-91,105-109,140-144,179-182`
  - `src/components/sessions-panel.css:83-86,173-175`
  - `src/components/statement-dialog.css:90-92`
  - `src/components/weekly-report.css:64-67`
- Test: `tests/unit/css-conventions.test.ts`

规则原地包裹，不挪位置，所以层叠顺序和优先级都不变。已核对：这 35 条 `:hover` 规则里没有任何信息只在 hover 时出现（全是边框、底色、位移、下划线），触屏上不需要另开出路。（另有 5 处 TSX 的 `title=` 提示只在悬停时出现：`AdminAiPanel.tsx:299`、`RecordsFeed.tsx:91`、`TierBadge.tsx:24`、`VerdictCard.tsx:62,65`——它们不是 CSS hover，本 PR 不碰任何组件 TSX，不在范围内；各组件换皮时按契约 §3.1「只靠 hover 才出现的信息必须同时有点按或焦点的出路」处理。）

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/css-conventions.test.ts` 里紧跟 `const where = …;` 之后（`OUTLINE_REMOVED` 之前）追加：

```ts
const HOVER_MEDIA = /^@media\b.*\(\s*hover\s*:\s*hover\s*\)/;
```

在 `describe('src/**/*.css', …)` 块末尾追加：

```ts

  it('keeps every :hover rule inside @media (hover: hover)', () => {
    // Touch screens fire :hover on tap and leave it stuck; hover-only styling must opt in.
    const offenders = STYLE_RULES.filter(
      (rule) =>
        rule.prelude.includes(':hover') &&
        !rule.ancestors.some((ancestor) => HOVER_MEDIA.test(ancestor)),
    );
    expect(offenders.map(where)).toEqual([]);
  });
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  1 failed | 11 passed (12)`；`expected [ 'app.css: .app__fab:hover', …(34) ] to deeply equal []`（35 条；Task 5 新加的 `.btn--danger-outline:hover` 已经在媒体查询里，不在其列）。

- [ ] **Step 3: 包裹 hover 规则**

按下面的 diff 修改（上下文是做完 Task 1-7 之后的文件；同样可以存成 `/tmp/p0-1-hover.diff`，先 `git apply --check` 再 `git apply`）：

```diff
diff --git a/src/app.css b/src/app.css
--- a/src/app.css
+++ b/src/app.css
@@ -134,5 +134,7 @@
 
-.app__fab:hover {
-  transform: translateY(-2px) scale(1.02);
-  box-shadow: var(--glow-gold), 0 18px 40px -12px rgba(245, 197, 66, 0.65);
+@media (hover: hover) {
+  .app__fab:hover {
+    transform: translateY(-2px) scale(1.02);
+    box-shadow: var(--glow-gold), 0 18px 40px -12px rgba(245, 197, 66, 0.65);
+  }
 }
@@ -191,2 +193,5 @@
   }
+}
+
+@media (hover: hover) and (prefers-reduced-motion: reduce) {
   .app__fab:hover {
diff --git a/src/components/case-dialog.css b/src/components/case-dialog.css
--- a/src/components/case-dialog.css
+++ b/src/components/case-dialog.css
@@ -153,5 +153,7 @@
 
-.cd-chip:hover {
-  border-color: var(--muted);
-  color: var(--text);
+@media (hover: hover) {
+  .cd-chip:hover {
+    border-color: var(--muted);
+    color: var(--text);
+  }
 }
@@ -210,4 +212,6 @@
 
-.cd-extra__toggle:hover {
-  color: var(--text);
+@media (hover: hover) {
+  .cd-extra__toggle:hover {
+    color: var(--text);
+  }
 }
diff --git a/src/components/discord-link.css b/src/components/discord-link.css
--- a/src/components/discord-link.css
+++ b/src/components/discord-link.css
@@ -66,5 +66,7 @@
 
-.dlink__bind:hover {
-  border-color: var(--blue);
-  background: color-mix(in oklab, var(--blue) 22%, var(--panel-2));
+@media (hover: hover) {
+  .dlink__bind:hover {
+    border-color: var(--blue);
+    background: color-mix(in oklab, var(--blue) 22%, var(--panel-2));
+  }
 }
@@ -171,6 +173,8 @@
 
-.dlink-notice__close:hover {
-  color: var(--text);
-  background: var(--panel-2);
-  border-color: var(--border);
+@media (hover: hover) {
+  .dlink-notice__close:hover {
+    color: var(--text);
+    background: var(--panel-2);
+    border-color: var(--border);
+  }
 }
diff --git a/src/components/header.css b/src/components/header.css
--- a/src/components/header.css
+++ b/src/components/header.css
@@ -25,4 +25,6 @@
 
-.hdr__brand:hover {
-  transform: translateY(-1px);
+@media (hover: hover) {
+  .hdr__brand:hover {
+    transform: translateY(-1px);
+  }
 }
@@ -100,5 +102,7 @@
 
-.hdr__avatar-btn:hover {
-  border-color: var(--border-strong);
-  background: var(--panel-2);
+@media (hover: hover) {
+  .hdr__avatar-btn:hover {
+    border-color: var(--border-strong);
+    background: var(--panel-2);
+  }
 }
@@ -160,4 +164,6 @@
 
-.hdr__dropdown-item:hover {
-  background: var(--panel-2);
+@media (hover: hover) {
+  .hdr__dropdown-item:hover {
+    background: var(--panel-2);
+  }
 }
@@ -168,4 +174,6 @@
 
-.hdr__dropdown-item--danger:hover {
-  background: color-mix(in oklab, var(--red) 14%, transparent);
+@media (hover: hover) {
+  .hdr__dropdown-item--danger:hover {
+    background: color-mix(in oklab, var(--red) 14%, transparent);
+  }
 }
diff --git a/src/components/leaderboard.css b/src/components/leaderboard.css
--- a/src/components/leaderboard.css
+++ b/src/components/leaderboard.css
@@ -57,6 +57,8 @@
 
-.lb-row:hover {
-  background: var(--panel-2);
-  border-color: var(--border-strong);
-  transform: translateX(2px);
+@media (hover: hover) {
+  .lb-row:hover {
+    background: var(--panel-2);
+    border-color: var(--border-strong);
+    transform: translateX(2px);
+  }
 }
diff --git a/src/components/modal.css b/src/components/modal.css
--- a/src/components/modal.css
+++ b/src/components/modal.css
@@ -46,6 +46,8 @@
 
-.modal__close:hover {
-  color: var(--text);
-  background: var(--panel-2);
-  border-color: var(--border);
+@media (hover: hover) {
+  .modal__close:hover {
+    color: var(--text);
+    background: var(--panel-2);
+    border-color: var(--border);
+  }
 }
diff --git a/src/components/onboarding-dialog.css b/src/components/onboarding-dialog.css
--- a/src/components/onboarding-dialog.css
+++ b/src/components/onboarding-dialog.css
@@ -32,5 +32,7 @@
 
-.ob-card:hover {
-  border-color: var(--muted);
-  transform: translateY(-2px);
+@media (hover: hover) {
+  .ob-card:hover {
+    border-color: var(--muted);
+    transform: translateY(-2px);
+  }
 }
@@ -43,5 +45,7 @@
 
-.ob-card--locked:hover {
-  border-color: var(--border-input);
-  transform: none;
+@media (hover: hover) {
+  .ob-card--locked:hover {
+    border-color: var(--border-input);
+    transform: none;
+  }
 }
@@ -128,4 +132,6 @@
 
-.ob__name-opt:hover {
-  border-color: var(--muted);
+@media (hover: hover) {
+  .ob__name-opt:hover {
+    border-color: var(--muted);
+  }
 }
diff --git a/src/components/player-detail.css b/src/components/player-detail.css
--- a/src/components/player-detail.css
+++ b/src/components/player-detail.css
@@ -185,5 +185,7 @@
 
-.pd__revoke-btn:hover:not(:disabled) {
-  background: color-mix(in oklab, var(--red) 14%, transparent);
-  border-color: color-mix(in oklab, var(--red) 55%, transparent);
+@media (hover: hover) {
+  .pd__revoke-btn:hover:not(:disabled) {
+    background: color-mix(in oklab, var(--red) 14%, transparent);
+    border-color: color-mix(in oklab, var(--red) 55%, transparent);
+  }
 }
diff --git a/src/components/records-feed.css b/src/components/records-feed.css
--- a/src/components/records-feed.css
+++ b/src/components/records-feed.css
@@ -83,6 +83,8 @@
 
-.feed-row__subject--link:hover .feed-row__name {
-  color: var(--blue);
-  text-decoration: underline;
-  text-underline-offset: 3px;
+@media (hover: hover) {
+  .feed-row__subject--link:hover .feed-row__name {
+    color: var(--blue);
+    text-decoration: underline;
+    text-underline-offset: 3px;
+  }
 }
diff --git a/src/components/red-black-board.css b/src/components/red-black-board.css
--- a/src/components/red-black-board.css
+++ b/src/components/red-black-board.css
@@ -90,6 +90,8 @@
 
-.hero-card--gold:hover {
-  transform: translateY(-3px);
-  box-shadow: var(--shadow-pop), var(--glow-gold);
-  border-color: var(--gold);
+@media (hover: hover) {
+  .hero-card--gold:hover {
+    transform: translateY(-3px);
+    box-shadow: var(--shadow-pop), var(--glow-gold);
+    border-color: var(--gold);
+  }
 }
@@ -100,6 +102,8 @@
 
-.hero-card--red:hover {
-  transform: translateY(-3px);
-  box-shadow: var(--shadow-pop), var(--glow-red);
-  border-color: color-mix(in oklab, var(--red) 55%, var(--border));
+@media (hover: hover) {
+  .hero-card--red:hover {
+    transform: translateY(-3px);
+    box-shadow: var(--shadow-pop), var(--glow-red);
+    border-color: color-mix(in oklab, var(--red) 55%, var(--border));
+  }
 }
@@ -164,5 +168,7 @@
 
-.hero-card__link:hover {
-  gap: 0.7rem;
-  border-bottom-color: currentColor;
+@media (hover: hover) {
+  .hero-card__link:hover {
+    gap: 0.7rem;
+    border-bottom-color: currentColor;
+  }
 }
@@ -198,3 +204,3 @@
 
-@media (prefers-reduced-motion: reduce) {
+@media (hover: hover) and (prefers-reduced-motion: reduce) {
   .hero-card:hover {
diff --git a/src/components/roll-call.css b/src/components/roll-call.css
--- a/src/components/roll-call.css
+++ b/src/components/roll-call.css
@@ -90,5 +90,7 @@
 
-.rc-mark:hover {
-  border-color: var(--muted);
-  color: var(--text);
+@media (hover: hover) {
+  .rc-mark:hover {
+    border-color: var(--muted);
+    color: var(--text);
+  }
 }
diff --git a/src/components/rules-panel.css b/src/components/rules-panel.css
--- a/src/components/rules-panel.css
+++ b/src/components/rules-panel.css
@@ -22,4 +22,6 @@
 
-.rules__toggle:hover {
-  background: var(--panel-2);
+@media (hover: hover) {
+  .rules__toggle:hover {
+    background: var(--panel-2);
+  }
 }
diff --git a/src/components/session-form.css b/src/components/session-form.css
--- a/src/components/session-form.css
+++ b/src/components/session-form.css
@@ -86,6 +86,8 @@
 
-.sf-slot:hover {
-  color: var(--text);
-  border-color: var(--muted);
-  background: var(--panel-2);
+@media (hover: hover) {
+  .sf-slot:hover {
+    color: var(--text);
+    border-color: var(--muted);
+    background: var(--panel-2);
+  }
 }
@@ -105,6 +107,8 @@
 
-.sf-slot--on:hover {
-  color: #17130a;
-  background: linear-gradient(180deg, #ffe083, #ffce4c);
-  border-color: var(--gold);
+@media (hover: hover) {
+  .sf-slot--on:hover {
+    color: #17130a;
+    background: linear-gradient(180deg, #ffe083, #ffce4c);
+    border-color: var(--gold);
+  }
 }
@@ -140,6 +144,8 @@
 
-.sf__input:hover,
-.sf__textarea:hover,
-.sf__select:hover {
-  border-color: var(--muted);
+@media (hover: hover) {
+  .sf__input:hover,
+  .sf__textarea:hover,
+  .sf__select:hover {
+    border-color: var(--muted);
+  }
 }
@@ -179,5 +185,7 @@
 
-.sf-person:hover {
-  color: var(--text);
-  border-color: var(--muted);
+@media (hover: hover) {
+  .sf-person:hover {
+    color: var(--text);
+    border-color: var(--muted);
+  }
 }
diff --git a/src/components/sessions-panel.css b/src/components/sessions-panel.css
--- a/src/components/sessions-panel.css
+++ b/src/components/sessions-panel.css
@@ -82,5 +82,7 @@
 
-.srow:hover {
-  border-color: var(--border-strong);
-  background: rgba(0, 0, 0, 0.28);
+@media (hover: hover) {
+  .srow:hover {
+    border-color: var(--border-strong);
+    background: rgba(0, 0, 0, 0.28);
+  }
 }
@@ -172,4 +174,6 @@
 
-.srow__rsvp-btn:hover:not(:disabled) {
-  color: var(--text);
+@media (hover: hover) {
+  .srow__rsvp-btn:hover:not(:disabled) {
+    color: var(--text);
+  }
 }
diff --git a/src/components/statement-dialog.css b/src/components/statement-dialog.css
--- a/src/components/statement-dialog.css
+++ b/src/components/statement-dialog.css
@@ -89,4 +89,6 @@
 
-.sd__textarea:hover {
-  border-color: var(--muted);
+@media (hover: hover) {
+  .sd__textarea:hover {
+    border-color: var(--muted);
+  }
 }
diff --git a/src/components/weekly-report.css b/src/components/weekly-report.css
--- a/src/components/weekly-report.css
+++ b/src/components/weekly-report.css
@@ -63,5 +63,7 @@
 
-.wr__regen:hover,
-.wr__close:hover {
-  color: var(--text);
+@media (hover: hover) {
+  .wr__regen:hover,
+  .wr__close:hover {
+    color: var(--text);
+  }
 }
diff --git a/src/theme.css b/src/theme.css
--- a/src/theme.css
+++ b/src/theme.css
@@ -255,5 +255,7 @@ h3 {
 
-.btn:hover {
-  border-color: var(--border-strong);
-  background: #1c2536;
+@media (hover: hover) {
+  .btn:hover {
+    border-color: var(--border-strong);
+    background: #1c2536;
+  }
 }
@@ -277,6 +279,8 @@ h3 {
 
-.btn--gold:hover {
-  background: linear-gradient(180deg, #ffe083, #ffce4c);
-  border-color: var(--gold);
-  box-shadow: var(--glow-gold);
+@media (hover: hover) {
+  .btn--gold:hover {
+    background: linear-gradient(180deg, #ffe083, #ffce4c);
+    border-color: var(--gold);
+    box-shadow: var(--glow-gold);
+  }
 }
@@ -289,4 +293,6 @@ h3 {
 
-.btn--danger:hover {
-  box-shadow: var(--glow-red);
+@media (hover: hover) {
+  .btn--danger:hover {
+    box-shadow: var(--glow-red);
+  }
 }
@@ -314,4 +320,6 @@ h3 {
 
-.btn--ghost:hover {
-  background: var(--panel-2);
+@media (hover: hover) {
+  .btn--ghost:hover {
+    background: var(--panel-2);
+  }
 }
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts
npx tsc -p tsconfig.worker.json --noEmit
```

预期：`Test Files  16 passed (16)`、`Tests  222 passed (222)`；tsc 无输出。

- [ ] **Step 5: 提交**

```bash
git add src/theme.css src/app.css src/components tests/unit/css-conventions.test.ts
git commit -m "refactor: hover 样式全部包进 @media (hover: hover)"
```

---

### Task 9: H8 之后被组件规则压掉的触控尺寸

**为什么有这一步：** `theme.css` 末尾的 `@media (pointer: coarse)` 块给几类小按钮补了触控尺寸。以前 theme.css 最后加载，这些规则总能赢；Task 1 把它挪到最前以后，组件 css 里**同一个类名、同一个属性**的普通规则（同为 0,1,0、加载更晚）会把它压掉。逐条核对快照（`theme.css:291-317` 对 `src/components/*.css` 的顶层规则），被压掉的正好两处：

| theme.css coarse 规则 | 压掉它的组件规则 | 后果 |
|---|---|---|
| `.sessions__tab { min-height: 40px }`（`:309-311`） | `sessions-panel.css:30-41` `.sessions__tab { min-height: 36px; … }` | 触屏上约局面板的「即将开始 / 已结束」页签从 40px 缩回 36px |
| `.feed-row__subject, …, .hero-card__link, … { padding-block: 0.6rem; margin-block: -0.6rem }`（`:301-307`） | `red-black-board.css:155-167` `.hero-card__link { padding: 0.35rem 0; … }` | 只剩 `-0.6rem` 外边距生效，`.hero-card__link` 热区缩小、还会往上下邻居身上叠 0.25rem（P0-4 删掉 RedBlackBoard 之前一直在线上） |

其余几条（`.btn`、`.btn--sm`、`.feed-row__subject`、`.invite__detail`、`.wr__regen`、`.modal__close`）在组件里没有同属性的规则，不受影响。

修法：在组件自己的 css 里、紧跟被压的那条规则之后重申 coarse 尺寸——和 P0-2 把 `.modal__close` 的 coarse 规则挪进 `modal.css` 是同一个思路。**theme.css 的 coarse 块一行不动**：P0-2（删 `.modal__close`）和 P0-4（删 `.hero-card__link,`）的计划都按这个块的原文定位，动了会让它们的「改前」对不上。`theme.css` 里那条 `.sessions__tab` 从此是被压住的冗余规则，留给以后换皮时清理（P0-2 计划把它当上下文用）。

**Files:**
- Modify: `src/components/sessions-panel.css`（`.sessions__tab` 规则之后，快照 `:41` 后插入）
- Modify: `src/components/red-black-board.css`（`.hero-card__link` 规则之后，快照 `:167` 后插入；P0-4 会整文件删除）
- Test: `tests/unit/css-conventions.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/css-conventions.test.ts` 里紧跟 `const HOVER_MEDIA = …;` 之后追加：

```ts
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
```

在 `describe('src/**/*.css', …)` 块末尾（收尾 `});` 之前）追加：

```ts

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
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：`Tests  1 failed | 12 passed (13)`；`AssertionError: expected [ …(2) ] to deeply equal []`，diff 里正好两条：`".hero-card__link { padding-block }"`、`".sessions__tab { min-height }"`。

- [ ] **Step 3: 在组件里重申触控尺寸**

`src/components/sessions-panel.css`，紧跟 `.sessions__tab { … transition: color var(--dur-fast), background var(--dur-fast); }` 之后（`.sessions__tab--active` 之前）插入：

```css

/* theme.css loads first now (H8), so its coarse-pointer 40px loses to the 36px
   above: restate the touch size here, after the rule it has to beat. */
@media (pointer: coarse) {
  .sessions__tab {
    min-height: 40px;
  }
}
```

`src/components/red-black-board.css`，紧跟 `.hero-card__link { … transition: gap var(--dur-fast) var(--ease), border-color var(--dur-fast); }` 之后（Task 8 包好的 `@media (hover: hover) { .hero-card__link:hover … }` 之前）插入：

```css

/* theme.css loads first now (H8): its coarse padding-block would lose to the
   padding above while its -0.6rem margin still applied, shrinking the row. */
@media (pointer: coarse) {
  .hero-card__link {
    padding-block: 0.6rem;
  }
}
```

（`margin-block: -0.6rem` 仍由 theme.css 提供，组件里没有 `margin`，不用重复。）

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts
npx tsc -p tsconfig.worker.json --noEmit
```

预期：`Test Files  16 passed (16)`、`Tests  223 passed (223)`；tsc 无输出。

- [ ] **Step 5: 提交**

```bash
git add src/components/sessions-panel.css src/components/red-black-board.css tests/unit/css-conventions.test.ts
git commit -m "fix: 导入顺序修好后在组件里重申被压掉的触控尺寸（H8）"
```

---

### Task 10: 构建产物核对与视觉验收（H8 重新生效的旧样式）

**Files:**
- 无代码改动。验收中如果发现必须修的问题，修在对应组件的 css 里，并单独提交 `fix: <中文描述>`；修完重跑 `npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts`。

- [ ] **Step 1: 构建并确认 theme.css 排在最前**

```bash
npm run build
node -e "const fs=require('fs');const f=fs.readdirSync('dist/assets').find((n)=>n.endsWith('.css'));const c=fs.readFileSync('dist/assets/'+f,'utf8');const at=(s)=>c.indexOf(s);console.log({rootFirst:c.startsWith(':root{--bg:'),btn:at('.btn{'),modalPanel:at('.modal__panel{'),dlinkBind:at('.dlink__bind{')});"
```

预期：`rootFirst: true`，且 `btn` 的位置小于 `modalPanel` 和 `dlinkBind`（做完 Task 1-9 试跑结果为 3523 < 22487 < 35277）。

- [ ] **Step 2: 起本地环境**

按 `README.md:155-179` 准备 `.dev.vars` 并 `npm run db:local`。榜单为空时塞几个测试选手（只写本地 D1）：

```bash
npx wrangler d1 execute edg-credit --local --command "INSERT OR IGNORE INTO users (id, username, is_participant, score) VALUES ('seed-a', '阿杰', 1, 100), ('seed-b', '小红', 1, 82), ('seed-c', '老王', 1, 40);"
```

一个终端 `npm run dev`（:8787），另一个 `npm run dev:web`，浏览器开 `http://localhost:5173`。同一页面在 main 分支的构建（或线上）开一个标签页做对照。

- [ ] **Step 3: 逐项对照「重新生效的旧样式」**（每项截 375px 与 1280px 各一张，放进 PR 描述）

1. 弹窗阴影：点榜单任一选手打开 PlayerDetail，`.modal__panel` 应是更深更大的 `--shadow-pop`（以前被 `.panel` 的 `--shadow-panel` 盖掉）。
2. `.dlink__bind` 蓝色：登录后打开「设置你的显示名字与身份」，「绑定 Discord」按钮应是蓝色描边 + 蓝色淡底（以前被 `.btn` 盖成灰色）。本地登不上时，在 DevTools 里给任意 `.btn` 临时加类 `dlink__bind` 看计算样式。
3. `.pd__revoke-btn` 红色：PlayerDetail 里立案人/管理员看到的「撤销」应是 `#ff6b6f` 红字 + 红描边（以前被 `.btn--ghost`/`.btn` 盖掉）。同上，登不上就在 DevTools 里加类核对。
4. 胶囊圆角：Tab 到右上角头像按钮（`.hdr__avatar-btn`）和约局列表的「来/待定/不来」（`.srow__rsvp-btn`），聚焦时保持胶囊形，焦点环也是胶囊形（以前聚焦时被 `:focus-visible { border-radius: 6px }` 压成小圆角）。
5. 字距与字体：`.srow__when`、`.sdt__when`、`.wr__range` 的组件字距（0.03em / 0.08em）现在压过 `.tabular` 的 0.01em，`.srow__when` 的字体也从 `--font-num` 变成组件写的 `--font-display`（两者首选都是 Rajdhani，数字外观基本不变）；时间会略宽一点，确认不折行。
6. 触控尺寸（DevTools 触屏模拟）：约局面板的「即将开始 / 已结束」页签（`.sessions__tab`）高 40px；红黑榜卡片里的「查看战绩」链接（`.hero-card__link`）不和上下文字重叠（Task 9）。

（以上 6 项是快照里所有「theme.css 规则 × 同元素上的组件规则」同属性冲突的完整清单：`.panel`×`.modal__panel` 的 box-shadow、`.btn`×`.dlink__bind` 的 background/border-color、`.btn`/`.btn--ghost`×`.pd__revoke-btn` 的 color/border-color、`.tabular`×三个时间类的字距/字体、`:focus-visible` 的 border-radius、coarse 块×`.sessions__tab`/`.hero-card__link`。）

- [ ] **Step 4: 焦点、对比度、断点、hover、强制颜色**

1. 键盘 Tab 走一遍首页：每个可聚焦元素都有 2px `#8ab4ff` 外环；金色主按钮（裁判登录后右下角的「记一笔」浮钮 `.app__fab`、弹窗里的主操作）上环清晰可见、不被金色光晕盖住；「计分规则」折叠按钮（`.rules__toggle`）的环画在按钮内侧、四边都在。
2. 文字：动态流时间戳、`--faint` 的说明字明显比 main 亮；约局详情里「未回应」小标签、写说明弹窗底部的隐私告知改用 `--muted`；各处红色报错字是 `#ff6b6f`；`SentencingScale` 重罚的圆点仍是 `#e5484d` 填充。
3. 输入框：发起约局（`SessionFormDialog`）、立案（`CaseDialog`）里的输入框、时段 chip、人物 chip，静止时边框清楚可见（`#66738a`），鼠标悬停变亮（`--muted`），不是变暗。
4. 断点：把窗口从 1280 拉到 1024 → 1023：1023 时首页从两栏变一栏（以前是 900）；600 → 601：「记一笔」浮钮的文字在 ≤600 隐藏、各弹窗的按钮竖排铺满（以前在 480/520/560）；375 下没有横向滚动条。
5. hover：DevTools 打开设备模拟（触屏），点一下按钮 / 榜单行后不再留着「悬停」样式；桌面鼠标悬停样式与 main 一致。
6. 强制颜色：DevTools → Rendering → Emulate CSS media feature `forced-colors: active`：Tab 时焦点环是系统高亮色；按钮、输入框有边框；动态流状态 chip、约局详情的 RSVP 小标签、段位徽章都有一圈边框。

- [ ] **Step 5: 如有修复，提交**

```bash
git add src
git commit -m "fix: <按实际问题写中文描述>"
```

没有修复就跳过本步。

---

## 对契约的补充

契约里的名字、文件、分支、顺序全部照用。以下几点是契约没写死、本计划补上的，**P0-2 … P0-6 写新 CSS 时会被 `css-conventions.test.ts` 自动检查**，请编排方转告各计划：

1. **约定测试比契约 §3.1 的 ①–④ 多三条断言**（同一个测试文件，契约已允许「后续 PR 的 CSS 自动受它约束」）：
   - ⑤ 选择器含 `:focus` 的规则里不得写 `box-shadow`（契约 §3.1「不得用 box-shadow 充当焦点环」的机器版）。
   - ⑥ `color` / `-webkit-text-fill-color` 不得是 `var(--red)`、`var(--danger)` 或 `#e5484d`，红字一律 `var(--danger-text)`（spec §6.1「`#e5484d` 只用于填充和边框」）。
   - ⑦ 选择器里含 `input` / `textarea` / `select` 的规则，`border` / `border-color` 不得用 `var(--border)` 或 `var(--border-strong)`，用 `var(--border-input)`；悬停用 `var(--muted)`。**影响**：P0-5 的 AppealSheet / StatementDialog 新 textarea、P0-6 的 RescheduleSheet `datetime-local` 输入框，类名里只要带 `input`/`textarea`/`select` 就要用 `--border-input`。
   - 另有一组「存在性」断言：`theme.css` 的 forced-colors 块里有 `:focus-visible { outline-color: Highlight }`、`.btn, input, select, textarea { border-color: ButtonText }`、含 `.feed-row__status`/`.sdt__chip`/`.tier-badge` 的 `border: 1px solid CanvasText`，以及 `.btn--danger-outline` 的三条声明。P0-2 的 ConfirmInline 依赖它。
2. **hover 判定**：规则的任一祖先 `@media` 条件里含 `(hover: hover)` 即可，所以和别的条件组合也行（`@media (hover: hover) and (prefers-reduced-motion: reduce)`，本 PR 的 `app.css`、`red-black-board.css` 就这么写）。`:hover` 写在 `@media (pointer: coarse)` 或 `@media (max-width: 600px)` 里而外层没有 `(hover: hover)`，同样不合格。
3. **断点归并口径**：480 / 520 / 560 / 720 → `max-width: 600px`；`app.css` 的 900（两栏变一栏）→ `max-width: 1023px`。所以 601–1023px 现在是单栏（以前 901–1023 是两栏），P0-4 的榜单桌面圆环 `min-width: 1024px` 与此对齐。
4. **`--down` 现在是 `var(--danger-text)`**（契约 §3.1 表里已写），意味着它只能当文字色；要红色填充用 `var(--danger)`。本 PR 已把唯一的填充用法 `.scale__pin--heavy` 改掉。
5. **`:focus-visible` 不再设 `border-radius`**（原来的 `border-radius: var(--r-sm)` 会在聚焦时把胶囊按钮压成小圆角，属于 H8「胶囊圆角」问题的一部分）。全局只剩 `outline` + `outline-offset`。贴满 `overflow: hidden` 容器边缘的可聚焦元素（如 `.rules__toggle`）用负的 `outline-offset` 把环画进内侧；P0-2 的 sticky `.modal__bar` 里的 ✕、P0-4 的榜单行如遇同样裁切，照此处理，不要改成 box-shadow。
6. **强制颜色的状态 chip 名单**比契约举例多了 `.sdt-player__rsvp`、`.sdt-player__att`、`.srow__game`、`.srow__count`、`.srow__status`、`.rc-row__tag`，并都加 `html` 前缀（theme.css 先加载，同为单类会输给组件里的 `.feed-row__status--escalate` 之类）。后续 PR 新增只靠底色区分的状态 chip，在自己组件 css 里补 `@media (forced-colors: active) { .x { border: 1px solid CanvasText; } }`，不要改 theme.css（契约 §2.4）。
7. **`contrast.test.ts` 对 `--focus` 检查全部四个表面**（契约要求 `--bg`/`--panel-2` 两个，四个是超集，实测 7.8–9.3）。另锁住语义层九个别名（含 `--down → --danger-text`）。
8. **`source-hygiene.test.ts` 的新用例放在文件末尾一个新的 `describe('src/main.tsx')` 里**。P0-5 也会在末尾追加，rebase 时两段都保留即可。
9. 输入框 / chip 的「选中」态里原来用 `--border-strong` 的两处（`.rc-mark--on`、`.sf-slot--custom.sf-slot--on`）改成 `--muted`，避免选中后边框反而比未选中（`--border-input`）暗。
10. **⑧ theme.css 的 coarse 触控尺寸不得被组件规则悄悄压掉**（Task 9 新增断言）：`theme.css` 的 `@media (pointer: coarse)` 块里给某个类设的属性（含 `padding`/`margin` 简写对 `padding-block`/`margin-block` 的覆盖），如果组件 css 里有同类名、同属性的顶层规则，组件必须在自己的 `@media (pointer: coarse)` 里重申。**影响**：P0-2 把 `.modal__close` 的 coarse 规则挪进 `modal.css` 正好满足它；P0-4 删 `.hero-card__link,` 那一行与本 PR 在 `red-black-board.css` 里加的重申规则一起消失（整文件删除），断言照常通过；任何 PR 都不要往 theme.css 的 coarse 块里加组件类名（契约 §2.4），组件自己的触控尺寸写在组件 css 里。

---

## 收尾

- [ ] **全量验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.dom.config.ts tests/dom/modal-focus.test.tsx
npm run build
```

预期：typecheck 三个 tsconfig 全过；unit `16 passed (16)` / `223 passed (223)`；dom `8 passed (8)` / `54 passed (54)`（`onboarding-roles` 的三条 `act(...)` 警告是既有噪音，不得新增）；`modal-focus` 全过；build 成功。本 PR 不碰 `worker/`、`server/`、`shared/`，不需要跑 worker 测试；`test:server`、`test:pg` 由 CI 跑。

（以上命令已在 `/tmp` 的仓库副本上按本计划逐 Task 试跑：每个 Task 的失败信息、通过数和最终 223 / 54 用例都与本文一致；Task 7、Task 8 的两段 diff 已验证能在对应状态上 `git apply --check` 后干净应用；`npm run typecheck`、`modal-focus`（4 / 4）、`vite build` 均通过。）

- [ ] **手动检查清单**（`npm run dev` + `npm run dev:web`，对照 main）

375px（DevTools 设备模拟，触屏）：
- 首页无横向滚动；「记一笔」浮钮只剩「✎」图标；各弹窗（PlayerDetail、立案、发起约局、写说明）的操作按钮竖排铺满。
- 约局面板页签高 40px；红黑榜卡片链接不与上下文字重叠。
- 点按按钮、榜单行、约局行后没有残留的 hover 底色 / 位移。
- 输入框、时段 chip、人物 chip、出勤按钮边框清楚；红色报错字是 `#ff6b6f`。
- 次要文字（时间戳、`--faint` 说明、「未回应」、隐私告知）都清楚可读。

1280px（鼠标 + 键盘）：
- 两栏布局；1023px 时变一栏。
- Tab 全程焦点环可见，金色按钮上也可见；胶囊按钮聚焦时仍是胶囊形；「计分规则」折叠按钮的环在内侧。
- 弹窗阴影是 `--shadow-pop`；「绑定 Discord」蓝色；「撤销」红色。
- 鼠标悬停样式与 main 一致；输入框悬停边框变亮。
- Rendering 面板模拟 `forced-colors: active`：焦点环为系统高亮色，状态 chip 有边框。

PR 描述：写明对应 spec §6.1–§6.4、§9 P0-1；列出新增的三个测试文件 / 用例；写明「无组件签名、文案、请求变化」；附 375px 与 1280px 截图（Task 10 Step 3 的六项 + forced-colors 一张）。PR 描述不加任何署名行。

---

## 自查

| spec / 契约项（P0-1） | 覆盖的 Task |
|---|---|
| H8 导入顺序：`main.tsx` 先 `theme.css` 后 `App` | Task 1 |
| source-hygiene 加导入顺序断言 | Task 1 |
| H8 视觉验收：弹窗阴影、`.dlink__bind` 蓝色、撤销按钮红色、胶囊圆角 | Task 4（去掉 `:focus-visible` 的 border-radius）、Task 10 Step 1/3 |
| H8 副作用：theme.css coarse 触控尺寸被组件规则压掉（`.sessions__tab`、`.hero-card__link`） | Task 9 |
| H9 全局 `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`，`--focus: #8ab4ff` | Task 2（token）、Task 4 |
| H9 删掉 `--focus-ring` 及 4 处用法、删掉 `outline: none`；金色按钮阴影不再盖住焦点 | Task 4 |
| H9 forced-colors：outline 用 `Highlight`、按钮和输入框 `ButtonText`、状态 chip 加边框 | Task 5 |
| H10 `--faint: #848fa0`、`--border-input: #66738a`、`--danger-text: #ff6b6f` | Task 2（token）、Task 6（红字）、Task 7（边框） |
| H10「未回应」、隐私告知用 `--muted` 或更亮 | Task 7 |
| H10 新增 `contrast.test.ts` | Task 2 |
| 语义 token 第一版（`--action`/`--attn`/`--ok`/`--neutral`/`--danger`/`--info`/`--score-chip-bg/fg`），primitive/semantic 两层，保留 `color-scheme: dark` | Task 2 |
| 契约其他 token：`--amber`、`--down` 改指、`--z-modal`、`--z-toast`、`--safe-bottom`、`--sheet-max-h`、`--tap-min` | Task 2 |
| 系统字体栈（中文回退）与 6 档字号 + hero token（旧 `--text-*` 保留并标 deprecated） | Task 2 |
| `.btn--danger-outline` | Task 5 |
| 断点统一为 600 / 1024（18 处） | Task 3 |
| hover 包进 `@media (hover: hover)`（35 条） | Task 8 |
| `css-conventions.test.ts` ①断点 ②hover ③不去 outline ④无 `--focus-ring` | Task 3、Task 8、Task 4、Task 4 |
| 语义层不越界（只定义 token；段位色 `#d98e04` 重映射属 P4-1、ScoreGauge `tone` 属 P0-4/P1-1，本 PR 不碰） | — |
| CSP 不变（没有内联 style、没有 `<style>`，只改 .css 文件） | 全部 Task（只改 `.css` 与一行 import） |
| DOM 顺序 = 视觉顺序（不引入 `order` / reverse） | 全部 Task（只换媒体查询条件和颜色，不改布局方向） |
| 深链、锁定文案、类名、组件签名、`modal-focus.test.tsx` 不变 | 不改任何 `.tsx`（除 `main.tsx` 两行 import 顺序）；收尾全量 dom 验证 |

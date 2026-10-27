import { boardTzLabel } from '@shared/boardTime';
import type { Config } from '../types';
import './rules-guide.css';

const GLOSSARY: readonly [string, string][] = [
  ['立案经过', '立案人写的内容（原来叫「裁判陈述」）。'],
  ['说明', '当事人写的回应。Discord 里叫「陈述」，是同一件事。'],
  ['撤案', '对方写说明之前，立案人收回这起案件（管理员在裁决中也可以），没有时间限制。立案后 3 分钟内撤案，对方连私信都不会收到。'],
  ['撤销', '已判决的记录被收回、分数退回：立案人在立案后 15 分钟内可以，管理员任何时候都可以。'],
  ['裁判', '人（有裁判资格的成员）。'],
  ['AI 裁决 / 保底判', '判决的来源。'],
];
export function RulesGuide({ config }: { config: Config }): JSX.Element {
  const zone = config.boardTzOffsetHours === undefined ? '' : `（${boardTzLabel(config.boardTzOffsetHours)}）`;
  return <section className="guide panel" aria-labelledby="guide-title">
    <h2 id="guide-title">30 秒看懂</h2>
    <div className="guide__cards">
      <article><h3>守约</h3><p>说了来就来；来不了，提前说一声。迟到、放鸽子由裁判记一笔。</p></article>
      <article><h3>分数与回血</h3><p>每人从 100 分起；放鸽子会被记一笔；每周一 0 点自动回血 +{config.weeklyHeal}{zone}，最多回到 100。</p></article>
      <article><h3>出事了怎么办</h3><p>先写说明 → AI 裁决 → 不服可以申诉</p></article>
    </div>
    <div className="gloss"><h3>用词表</h3><dl>{GLOSSARY.map(([term, meaning]) =>
      <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>)}</dl>
      <p>不再使用「撤回」这个词。</p></div>
  </section>;
}

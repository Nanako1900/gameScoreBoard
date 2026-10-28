import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../../src/components/Avatar';
import { HistoryChart } from '../../src/components/HistoryChart';
import { RulesPanel } from '../../src/components/RulesPanel';
import { ScoreGauge } from '../../src/components/ScoreGauge';
import { SentencingScale } from '../../src/components/SentencingScale';
import { TierBadge } from '../../src/components/TierBadge';
import type { Config, SentencingRange } from '../../src/types';

const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 15, statementWindowHours: 12, aiEnabled: true,
  maxBatchSubjects: 12, nextResetAt: '2026-10-26 16:00:00' };
const HISTORY = [{ at: '2026-10-20 12:00:00', score: 70 }, { at: '2026-10-21 12:00:00', score: 84 }];
const RANGE: SentencingRange = { min: -20, max: -8, base: -15 };
const expectNoInlineCss = (container: HTMLElement): void => expect(container.querySelector('style, [style]')).toBeNull();

describe('presentational components under the page CSP', () => {
  it('renders all six components without style elements or attributes', () => {
    const { container } = render(<>
      <Avatar name="南" src={null} size={53} ring ringColor="#52726f" />
      <ScoreGauge score={84} size={173} strokeWidth={7} />
      <HistoryChart history={HISTORY} color="#52726f" />
      <TierBadge score={84} />
      <RulesPanel config={CONFIG} alwaysOpen />
      <SentencingScale range={RANGE} delta={-11} />
    </>);
    expectNoInlineCss(container);
  });

  it('preserves a custom avatar size, the same-origin proxy and lazy loading', () => {
    const { container } = render(<Avatar name="Nanako" src="https://nanako.org/avatar.png" size={53} ring ringColor="#52726f" />);
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', '/api/avatar?u=https%3A%2F%2Fnanako.org%2Favatar.png');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveAttribute('width', '53');
    expect(image).toHaveAttribute('height', '53');
    expect(image).toHaveAttribute('alt', '');
    expect(container.querySelector('.avatar__ring circle')).toHaveAttribute('stroke', '#52726f');
    expectNoInlineCss(container);
  });

  it('keeps avatar dimensions and the monogram when a proxied image fails', () => {
    const { container } = render(<Avatar name="  南小鸟 " src="https://nanako.org/avatar.png" size={53} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.avatar__fallback')).toHaveAttribute('width', '53');
    expect(container.querySelector('.avatar__fallback')).toHaveAttribute('height', '53');
    expect(container.querySelector('.avatar__fallback text')).toHaveTextContent('南');
    expectNoInlineCss(container);
  });

  it('renders a blank avatar as a decorative question mark without requiring an image', () => {
    const { container } = render(<Avatar name="   " src={null} size={41} />);
    expect(container.querySelector('.avatar__fallback text')).toHaveTextContent('?');
    expect(container.querySelector('.avatar')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.avatar__ring')).toBeNull();
  });

  it('keeps arbitrary gauge dimensions, stroke geometry and numeric font sizing in SVG attributes', () => {
    const { container } = render(<ScoreGauge score={25} size={173} strokeWidth={7} />);
    const svg = container.querySelector('.gauge__svg');
    expect(svg).toHaveAttribute('width', '173');
    expect(svg).toHaveAttribute('height', '173');
    expect(svg).toHaveAttribute('viewBox', '0 0 173 173');
    const arc = container.querySelector('.gauge__arc');
    expect(arc).toHaveAttribute('r', '83');
    expect(arc).toHaveAttribute('stroke-width', '7');
    expect(Number(arc?.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 83 * 0.75);
    expect(Number(container.querySelector('.gauge__value')?.getAttribute('font-size'))).toBeCloseTo(173 * 0.34);
    expectNoInlineCss(container);
  });

  it('carries a chart custom colour on the plot without shrinking the five HTML axis labels', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#52726f" />);
    expect(container.querySelector('.chart__line')).toHaveAttribute('stroke', '#52726f');
    for (const dot of container.querySelectorAll('.chart__dot')) expect(dot).toHaveAttribute('stroke', '#52726f');
    expect(container.querySelector('.chart__dot--active')).toHaveAttribute('fill', '#52726f');
    expect(container.querySelectorAll('svg text')).toHaveLength(0);
    const ticks = [...container.querySelectorAll('.chart__tick')];
    expect(ticks.map(tick => tick.textContent)).toEqual(['100', '75', '50', '25', '0']);
    for (const tick of ticks) expect(tick).toHaveClass(`chart__tick--${tick.textContent}`);
    expect(container.querySelector('linearGradient')).toBeNull();
    expectNoInlineCss(container);
  });

  it('keeps a tier badge name, description and compact emoji-only option without a tier colour', () => {
    const { container, rerender } = render(<TierBadge score={96} />);
    expect(container.querySelector('.tier-badge')).toHaveAttribute('title', '完全信赖，优先组局');
    expect(screen.getByText('誓约之光')).toBeInTheDocument();
    expectNoInlineCss(container);
    rerender(<TierBadge score={96} size="sm" showName={false} />);
    expect(container.querySelector('.tier-badge')).toHaveClass('tier-badge--sm');
    expect(screen.queryByText('誓约之光')).not.toBeInTheDocument();
    expect(container.querySelector('.tier-badge__emoji')).toHaveTextContent('🏆');
  });

  it('keeps rules expandable and their tier ranges readable without inline colours', () => {
    const { container } = render(<RulesPanel config={CONFIG} />);
    const toggle = screen.getByRole('button', { name: '计分规则' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: '信誉段位' })).toBeInTheDocument();
    expect(container.querySelectorAll('.rules__tier')).toHaveLength(6);
    expect(screen.getByText('≥ 95')).toBeInTheDocument();
    expectNoInlineCss(container);
    fireEvent.click(toggle);
    expect(screen.queryByRole('heading', { name: '信誉段位' })).not.toBeInTheDocument();
  });

  it('places sentencing base and outcome at their exact range positions with readable HTML outcome text', () => {
    const { container } = render(<SentencingScale range={RANGE} delta={-11} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '量刑区间 -20 到 -8，基准 -15，本次判 -11');
    const base = container.querySelector('.scale__base');
    expect(Number(base?.getAttribute('x1'))).toBeCloseTo(100 * 5 / 12);
    expect(base).toHaveAttribute('x1', base?.getAttribute('x2'));
    expect(container.querySelector('.scale__pin')).toHaveAttribute('x1', '75');
    expect(container.querySelector('.scale__pin')).toHaveAttribute('x2', '75');
    expect(screen.getByText('从轻')).toBeInTheDocument();
    expect(container.querySelector('.scale__pin-value')).toHaveTextContent('-11');
    expect(container.querySelector('.scale__pin-value')?.closest('svg')).toBeNull();
    expectNoInlineCss(container);
  });

  it.each([[-30, '0', '从重'], [3, '100', '从轻']] as const)('clamps sentencing markers for %s without changing the reported outcome', (delta, position, comparison) => {
    const { container } = render(<SentencingScale range={RANGE} delta={delta} />);
    expect(container.querySelector('.scale__pin')).toHaveAttribute('x1', position);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', `量刑区间 -20 到 -8，基准 -15，本次判 ${delta}`);
    expect(screen.getByText(comparison)).toBeInTheDocument();
  });

  it('centres a fixed sentencing range and omits the outcome until it is known', () => {
    const { container } = render(<SentencingScale range={{ min: 2, max: 2, base: 2 }} compact />);
    expect(container.querySelector('.scale')).toHaveClass('scale--compact');
    expect(container.querySelector('.scale__base')).toHaveAttribute('x1', '50');
    expect(container.querySelector('.scale__pin')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '量刑区间 2 到 2，基准 2');
    expectNoInlineCss(container);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryChart } from '../../src/components/HistoryChart';
import type { HistoryPoint } from '../../src/types';

// M26 (first half): the axis numbers no longer live inside the stretched SVG
// (they shrank to ~6px on phones), and a point can be read by tapping or with
// the keyboard — not only by hovering.

/** The visible readout under the plot (the dots' hover <title>s carry the same words). */
const readout = (container: HTMLElement): string => container.querySelector('.chart__readout')?.textContent ?? '';

const HISTORY: HistoryPoint[] = [
  { at: '2026-10-01 12:00:00', score: 70 },
  { at: '2026-10-10 12:00:00', score: 82 },
  { at: '2026-10-20 12:00:00', score: 88 },
];

describe('HistoryChart', () => {
  it('draws the axis numbers as HTML, not SVG text', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    expect(container.querySelectorAll('svg text')).toHaveLength(0);
    const ticks = [...container.querySelectorAll('.chart__tick')].map((t) => t.textContent);
    expect(ticks).toEqual(['100', '75', '50', '25', '0']);
  });

  it('shows the latest point until another is picked', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    expect(readout(container)).toMatch(/^88 分 · /);
  });

  it('picks a point with the range input (keyboard path)', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    const scrub = screen.getByRole('slider', { name: '查看某次分数' });
    fireEvent.change(scrub, { target: { value: '0' } });
    expect(readout(container)).toMatch(/^70 分 · /);
    expect(scrub.getAttribute('aria-valuetext')).toMatch(/^70 分 · /);
  });

  it('picks the point nearest a tap on the plot', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    const canvas = container.querySelector('.chart__canvas') as HTMLElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 320, height: 100, right: 320, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(canvas, { clientX: 160 }); // the middle of the plot → the middle point
    expect(readout(container)).toMatch(/^82 分 · /);
    fireEvent.click(canvas, { clientX: 5 });
    expect(readout(container)).toMatch(/^70 分 · /);
  });

  it('new data (another player, a refresh) starts at its latest point again', () => {
    const { container, rerender } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    fireEvent.change(screen.getByRole('slider', { name: '查看某次分数' }), { target: { value: '0' } });
    expect(readout(container)).toMatch(/^70 分 · /);
    rerender(<HistoryChart history={[...HISTORY, { at: '2026-10-25 12:00:00', score: 90 }]} color="#4aa3ff" />);
    expect(readout(container)).toMatch(/^90 分 · /);
  });

  it('a single point needs no picker', () => {
    const { container } = render(<HistoryChart history={[HISTORY[0]]} color="#4aa3ff" />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(readout(container)).toMatch(/^70 分 · /);
  });
});

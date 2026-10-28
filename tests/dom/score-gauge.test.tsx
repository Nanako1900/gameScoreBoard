import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreGauge } from '../../src/components/ScoreGauge';

// tone="neutral" (spec §6.2): public views show the number, never the 段位 —
// neither in the ring's colour nor in what a screen reader hears.

describe('ScoreGauge', () => {
  it('keeps the self-only tier label with a neutral visual treatment', () => {
    render(<ScoreGauge score={96} />);
    const gauge = screen.getByRole('img');
    expect(gauge).toHaveAttribute('aria-label', '信誉分 96 分，段位 誓约之光');
    expect(gauge.className).toBe('gauge');
    expect(gauge).not.toHaveAttribute('style');
    expect(gauge.querySelector('[style]')).toBeNull();
  });

  it('neutral: the label is only the score, and no tier colour is set', () => {
    render(<ScoreGauge score={38} tone="neutral" />);
    const gauge = screen.getByRole('img');
    expect(gauge).toHaveAttribute('aria-label', '信誉分 38 分');
    expect(gauge.getAttribute('aria-label')).not.toContain('段位');
    expect(gauge).toHaveClass('gauge', 'gauge--neutral');
    expect(gauge.style.getPropertyValue('--tier')).toBe('');
  });

  it('neutral keeps a custom label', () => {
    render(<ScoreGauge score={120} tone="neutral" label="当前" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '当前 100 分');
  });
});

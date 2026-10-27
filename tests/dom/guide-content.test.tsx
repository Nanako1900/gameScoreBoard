import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GUIDE_COMMANDS, GUIDE_INTRO, GUIDE_TIPS } from '../../shared/guide';
import { GuideContent } from '../../src/components/GuideContent';

describe('shared guide content', () => {
  it('renders the same introduction, commands and tips as the bot', () => {
    const { container } = render(<GuideContent />);
    expect(screen.getByText(GUIDE_INTRO)).toBeInTheDocument();
    for (const command of GUIDE_COMMANDS) {
      expect(screen.getByText(command.name)).toBeInTheDocument();
      expect(screen.getByText(command.text)).toBeInTheDocument();
    }
    for (const tip of GUIDE_TIPS) expect(screen.getByText(tip)).toBeInTheDocument();
    expect(container.querySelector('style, [style]')).toBeNull();
  });
});

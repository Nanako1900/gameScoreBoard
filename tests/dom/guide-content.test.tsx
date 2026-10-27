import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GUIDE_COMMANDS, GUIDE_INTRO, GUIDE_TIPS } from '../../shared/guide';
import { GuideContent } from '../../src/components/GuideContent';
import { voiceNotice } from '../../shared/voice';

describe('shared guide content', () => {
  it('renders the same introduction, commands and tips as the bot', () => {
    const { container } = render(<GuideContent />);
    expect(screen.getByText(GUIDE_INTRO)).toBeInTheDocument();
    for (const command of GUIDE_COMMANDS) {
      expect(screen.getByText(command.name)).toBeInTheDocument();
      expect(screen.getByText(command.text)).toBeInTheDocument();
    }
    for (const tip of GUIDE_TIPS) expect(screen.getByText(tip)).toBeInTheDocument();
    expect(screen.getByText('信息板频道里随时能看榜单和最近判决，按「我的情况」看自己的')).toBeInTheDocument();
    expect(screen.getAllByText(voiceNotice())).toHaveLength(1);
    expect(container.textContent).not.toMatch(/<#|discord_|\d{17,20}/);
    expect(container.querySelector('style, [style]')).toBeNull();
  });
});

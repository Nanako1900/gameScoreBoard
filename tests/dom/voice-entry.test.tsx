import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CaseDialog } from '../../src/components/CaseDialog';
import { GuidePage } from '../../src/components/GuidePage';
import { RulesGuide } from '../../src/components/RulesGuide';
import { WelcomePage } from '../../src/components/WelcomePage';
import { ToastProvider } from '../../src/components/Toast';
import { voiceNotice } from '../../shared/voice';
import type { Config, PublicUser, User } from '../../src/types';

const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
  aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' };
const ME: User = { id: 'judge', username: '裁判', oauth_username: '裁判', avatar_url: null, score: 100,
  is_judge: true, is_admin: false, is_participant: true, created_at: '2026-10-01 00:00:00' };
const PEOPLE: PublicUser[] = [ME, { ...ME, id: 'a&/?#中', username: '甲', is_judge: false },
  { ...ME, id: 'b', username: '乙', is_judge: false }];

describe('voice evidence entry', () => {
  it('links each selected person in a new tab without toggling people or disturbing the case draft', async () => {
    const close = vi.fn(), created = vi.fn();
    render(<CaseDialog open onClose={close} onCreated={created} selfId={ME.id} participants={PEOPLE} config={CONFIG} />);
    expect(screen.queryByRole('link', { name: '看 TA 的语音记录' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /甲/ }));
    await user.click(screen.getByRole('checkbox', { name: /乙/ }));
    const claim = screen.getByRole('textbox', { name: /发生了什么/ });
    await user.type(claim, '说好一起开黑，结果等了四十分钟还没上线。');
    const links = screen.getAllByRole('link', { name: '看 TA 的语音记录' });
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/admin/voice?user=a%26%2F%3F%23%E4%B8%AD', '/admin/voice?user=b']);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener');
      expect(link.closest('label')).toBeNull();
      // Suppress jsdom's real navigation; an actual browser opens a separate tab.
      link.addEventListener('click', event => event.preventDefault(), { once: true });
      fireEvent.click(link);
    }
    expect(screen.getByRole('checkbox', { name: /甲/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /乙/ })).toBeChecked();
    expect(claim).toHaveValue('说好一起开黑，结果等了四十分钟还没上线。');
    expect(close).not.toHaveBeenCalled(); expect(created).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: /甲/ }));
    expect(screen.getAllByRole('link', { name: '看 TA 的语音记录' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '看 TA 的语音记录' })).toHaveAttribute('href', '/admin/voice?user=b');
  });
  it('shows the shared command and exact privacy notice once in the guide', () => {
    render(<GuidePage />);
    expect(screen.getByText('/voice')).toBeInTheDocument();
    expect(screen.getAllByText(voiceNotice())).toHaveLength(1);
  });
  it('shows the same notice once in onboarding step five', () => {
    render(<ToastProvider><WelcomePage me={ME} discord={{ loading: false,
      value: { discord_username: '本人昵称', linked_at: '', notify_dm: true, dm_ok: true } }}
      onDiscordChanged={() => {}} onSaved={() => {}} onComplete={() => {}} /></ToastProvider>);
    const step = screen.getByTestId('welcome-step-5');
    expect(within(step).getAllByText(voiceNotice())).toHaveLength(1);
  });
  it('tells readers on the rules page that voice entry and exit are recorded as evidence', () => {
    render(<RulesGuide config={CONFIG} />);
    expect(screen.getByText(/迟到、放鸽子由裁判记一笔。机器人会记录语音进出时间作为参考。/)).toBeInTheDocument();
  });
});

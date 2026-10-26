import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingDialog } from '../../src/components/OnboardingDialog';
import type { User } from '../../src/types';

const BASE: User = {
  id: 'u1',
  username: 'Nanako',
  oauth_username: 'Nanako',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function radios(me: User) {
  // The Discord card asks the backend; a 404 keeps it out of the way.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '{}' })));
  render(<OnboardingDialog open onClose={() => {}} me={me} onSaved={() => {}} />);
  const group = within(screen.getByRole('radiogroup', { name: '选择身份' }));
  return {
    player: group.getByRole('radio', { name: /上榜选手/ }),
    judge: group.getByRole('radio', { name: /^裁判/ }),
    both: group.getByRole('radio', { name: /两者都要/ }),
  };
}

describe('OnboardingDialog roles', () => {
  it('locks the judge choices for someone an admin has not appointed', () => {
    const { player, judge, both } = radios(BASE);
    expect(player).toBeEnabled();
    expect(judge).toBeDisabled();
    expect(both).toBeDisabled();
    expect(screen.getAllByText(/裁判资格由管理员授予/)).toHaveLength(2);
  });

  it.each([
    ['a judge', { ...BASE, is_judge: true }],
    ['an admin', { ...BASE, is_admin: true }],
  ])('keeps them open for %s', (_who, me) => {
    const { judge, both } = radios(me);
    expect(judge).toBeEnabled();
    expect(both).toBeEnabled();
  });
});

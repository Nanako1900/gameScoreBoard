import { useState } from 'react';
import type { User } from '../types';
import { ApiError, updateRoles } from '../api';
import { Modal } from './Modal';
import './onboarding-dialog.css';

interface OnboardingDialogProps {
  open: boolean;
  onClose: () => void;
  me: User;
  onSaved: (user: User) => void;
}

type Choice = 'participant' | 'judge' | 'both';

interface RoleCard {
  choice: Choice;
  emoji: string;
  title: string;
  desc: string;
}

const ROLE_CARDS: RoleCard[] = [
  {
    choice: 'participant',
    emoji: '🎮',
    title: '上榜选手',
    desc: '拥有信誉分，出现在红黑榜上，接受裁判记录。',
  },
  {
    choice: 'judge',
    emoji: '⚖️',
    title: '裁判',
    desc: '可以给选手记录违约或守约，结算分数。',
  },
  {
    choice: 'both',
    emoji: '🏅',
    title: '两者都要',
    desc: '既上榜比拼信誉，也能给别人记一笔。',
  },
];

function initialChoice(me: User): Choice {
  if (me.is_participant && me.is_judge) {
    return 'both';
  }
  if (me.is_judge) {
    return 'judge';
  }
  return 'participant';
}

export function OnboardingDialog({
  open,
  onClose,
  me,
  onSaved,
}: OnboardingDialogProps): JSX.Element {
  const [choice, setChoice] = useState<Choice>(() => initialChoice(me));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    const roles = {
      is_participant: choice === 'participant' || choice === 'both',
      is_judge: choice === 'judge' || choice === 'both',
    };
    try {
      const { user } = await updateRoles(roles);
      onSaved(user);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后重试');
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="onboarding-title" size="md">
      <span className="ob__eyebrow eyebrow">欢迎，{me.username}</span>
      <h2 id="onboarding-title" className="ob__title">
        你想以什么身份加入？
      </h2>
      <p className="ob__subtitle">随时可以在头像菜单里修改。</p>

      <div className="ob__cards" role="radiogroup" aria-label="选择身份">
        {ROLE_CARDS.map((card, index) => (
          <button
            type="button"
            key={card.choice}
            role="radio"
            aria-checked={choice === card.choice}
            className={`ob-card${choice === card.choice ? ' ob-card--active' : ''}`}
            onClick={() => setChoice(card.choice)}
            data-autofocus={index === 0 ? true : undefined}
          >
            <span className="ob-card__emoji" aria-hidden="true">
              {card.emoji}
            </span>
            <span className="ob-card__title">{card.title}</span>
            <span className="ob-card__desc">{card.desc}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="ob__error" role="alert">
          {error}
        </p>
      )}

      <div className="ob__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          稍后再说
        </button>
        <button type="button" className="btn btn--gold" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '确认身份'}
        </button>
      </div>
    </Modal>
  );
}

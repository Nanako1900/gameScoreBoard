import { useState } from 'react';
import type { User } from '../types';
import { ApiError, updateDisplayName, updateRoles } from '../api';
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
  // The effective name equals the OAuth name until the user picks a custom one.
  const usingOauthName = me.username === me.oauth_username;
  const [useNanako, setUseNanako] = useState(usingOauthName);
  const [customName, setCustomName] = useState(usingOauthName ? '' : me.username);
  const [choice, setChoice] = useState<Choice>(() => initialChoice(me));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    setError(null);
    const displayName = useNanako ? null : customName.trim();
    if (!useNanako && (displayName === null || displayName.length === 0)) {
      setError('请输入自定义名字，或选择使用 Nanako 名字');
      return;
    }
    setSaving(true);
    const roles = {
      is_participant: choice === 'participant' || choice === 'both',
      is_judge: choice === 'judge' || choice === 'both',
    };
    try {
      await updateDisplayName(displayName);
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
      <span className="ob__eyebrow eyebrow">欢迎，{me.oauth_username}</span>
      <h2 id="onboarding-title" className="ob__title">
        设置你的显示名字与身份
      </h2>
      <p className="ob__subtitle">随时可以在头像菜单里修改。</p>

      <div className="ob__section">
        <span className="ob__label">显示名字</span>
        <div className="ob__name-opts" role="radiogroup" aria-label="显示名字来源">
          <button
            type="button"
            role="radio"
            aria-checked={useNanako}
            className={`ob__name-opt${useNanako ? ' ob__name-opt--active' : ''}`}
            onClick={() => setUseNanako(true)}
            data-autofocus
          >
            <span className="ob__name-opt-title">用 Nanako 名字</span>
            <span className="ob__name-opt-hint">{me.oauth_username}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!useNanako}
            className={`ob__name-opt${!useNanako ? ' ob__name-opt--active' : ''}`}
            onClick={() => setUseNanako(false)}
          >
            <span className="ob__name-opt-title">自定义</span>
            <span className="ob__name-opt-hint">自己起个名字</span>
          </button>
        </div>
        {!useNanako && (
          <input
            className="ob__name-input"
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            maxLength={24}
            placeholder="输入你想显示的名字（最多 24 字）"
            aria-label="自定义显示名字"
          />
        )}
      </div>

      <div className="ob__section">
        <span className="ob__label">身份</span>
        <div className="ob__cards" role="radiogroup" aria-label="选择身份">
          {ROLE_CARDS.map((card) => (
            <button
              type="button"
              key={card.choice}
              role="radio"
              aria-checked={choice === card.choice}
              className={`ob-card${choice === card.choice ? ' ob-card--active' : ''}`}
              onClick={() => setChoice(card.choice)}
            >
              <span className="ob-card__emoji" aria-hidden="true">
                {card.emoji}
              </span>
              <span className="ob-card__title">{card.title}</span>
              <span className="ob-card__desc">{card.desc}</span>
            </button>
          ))}
        </div>
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
          {saving ? '保存中…' : '确认'}
        </button>
      </div>
    </Modal>
  );
}

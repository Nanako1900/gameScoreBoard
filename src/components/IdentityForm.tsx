import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { User } from '../types';
import { ApiError, updateDisplayName, updateRoles } from '../api';
import { clearDraft, readDraft, writeDraft } from '../lib/drafts';
import {
  DISPLAY_NAME_MAX,
  validateOnboardingDraft,
  type OnboardingChoice,
  type OnboardingDraftValue,
} from '../lib/draftShapes';
import './identity-form.css';

export interface IdentityFormHandle {
  /** Persist unsaved fields synchronously before the sibling Discord link leaves. */
  saveBeforeBind(): void;
  /** Reset ordinary edits and the retained first-run draft after an explicit discard. */
  discardChanges?(): void;
}

interface IdentityFormProps {
  me: User;
  onSaved: (user: User) => void;
  mode?: 'onboarding' | 'settings';
  onDirtyChange?: (dirty: boolean) => void;
}

type Mode = NonNullable<IdentityFormProps['mode']>;
type Choice = OnboardingChoice;
type EditingChoice = Choice | 'none';
interface Fields extends Omit<OnboardingDraftValue, 'choice'> { choice: EditingChoice }

interface RoleCard {
  choice: Choice;
  emoji: string;
  title: string;
  desc: string;
}

const ROLE_CARDS: RoleCard[] = [
  { choice: 'participant', emoji: '🎮', title: '上榜选手', desc: '拥有信誉分，出现在信誉榜上，接受裁判记录。' },
  { choice: 'judge', emoji: '⚖️', title: '裁判', desc: '为迟到、放鸽子记录事实，并按权限处理案件。' },
  { choice: 'both', emoji: '🏅', title: '两者都要', desc: '参与信誉榜，也能按裁判权限记录案件。' },
];

function choiceFor(participant: boolean, judge: boolean, mode: Mode): EditingChoice {
  return participant && judge ? 'both' : judge ? 'judge' : participant || mode === 'onboarding' ? 'participant' : 'none';
}

function fieldsFor(me: User, mode: Mode): Fields {
  const useNanako = me.username === me.oauth_username;
  return { choice: choiceFor(me.is_participant, me.is_judge, mode), useNanako,
    customName: useNanako ? '' : me.username };
}

function sameFields(a: Fields, b: Fields): boolean {
  return a.choice === b.choice && a.useNanako === b.useNanako && a.customName === b.customName;
}

function roleValues(choice: EditingChoice): { is_participant: boolean; is_judge: boolean } {
  return { is_participant: choice === 'participant' || choice === 'both', is_judge: choice === 'judge' || choice === 'both' };
}

function clearIdentityDraft(): void {
  clearDraft('onboarding');
  clearDraft('onboarding', 'owner');
}

/** Old unscoped values remain readable; newly written bind drafts carry a separate owner marker. */
function restoredFields(me: User): OnboardingDraftValue | null {
  const owner = readDraft('onboarding', 'owner', (raw) => typeof raw === 'string' ? raw : null);
  if (owner !== null && owner.value !== me.id) {
    clearIdentityDraft();
    return null;
  }
  const restored = readDraft('onboarding', undefined, (raw) => validateOnboardingDraft(raw, me.is_judge || me.is_admin));
  // Compatibility is a one-account handoff: claim an old draft as soon as it
  // is restored, before another account can mount in this tab. If ownership
  // cannot be recorded, do not expose an unowned draft.
  if (restored !== null && owner === null && !writeDraft('onboarding', 'owner', me.id)) {
    clearDraft('onboarding');
    return null;
  }
  return restored?.value ?? null;
}

/** The owner key prevents both stale fields and late saves from crossing account boundaries. */
export const IdentityForm = forwardRef<IdentityFormHandle, IdentityFormProps>(function IdentityForm(props, ref) {
  return <IdentityEditor key={`${props.me.id}:${props.mode ?? 'onboarding'}`} {...props} ref={ref} />;
});

const IdentityEditor = forwardRef<IdentityFormHandle, IdentityFormProps>(function IdentityEditor(
  { me, onSaved, mode = 'onboarding', onDirtyChange }, ref,
) {
  const [baseline, setBaseline] = useState(() => fieldsFor(me, mode));
  const [fields, setFields] = useState<Fields>(() => restoredFields(me) ?? fieldsFor(me, mode));
  const { choice, useNanako, customName } = fields;
  const roles = roleValues(choice);
  const dirty = !sameFields(fields, baseline);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const owner = useRef(me.id); owner.current = me.id;
  const callbacks = useRef({ onSaved, onDirtyChange }); callbacks.current = { onSaved, onDirtyChange };
  const baselineRef = useRef(baseline); baselineRef.current = baseline;
  const canJudge = me.is_judge || me.is_admin;
  const serverStamp = JSON.stringify([me.id, me.username, me.oauth_username, me.is_participant, me.is_judge, me.is_admin]);
  const previousServer = useRef(serverStamp);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; callbacks.current.onDirtyChange?.(false); };
  }, []);

  useEffect(() => { callbacks.current.onDirtyChange?.(dirty); }, [dirty]);

  useEffect(() => {
    if (previousServer.current === serverStamp) return;
    previousServer.current = serverStamp;
    const next = fieldsFor(me, mode);
    const previous = baselineRef.current;
    baselineRef.current = next;
    setBaseline(next);
    setFields((old) => {
      if (sameFields(old, previous)) return next;
      // A role revoked elsewhere cannot remain selected as a future self-grant.
      return canJudge || !roleValues(old.choice).is_judge ? old
        : { ...old, choice: choiceFor(roleValues(old.choice).is_participant, false, mode) };
    });
  }, [serverStamp, me, mode, canJudge]);

  const saveBeforeBind = (): void => {
    clearIdentityDraft();
    // The old first-run shape has no "none" choice. An unlisted settings draft
    // remains in this mounted editor; it is never written as an invalid legacy value.
    if (choice === 'none') return;
    if (writeDraft('onboarding', 'owner', me.id)) {
      const value: OnboardingDraftValue = { choice, useNanako, customName };
      if (!writeDraft('onboarding', undefined, value)) clearDraft('onboarding', 'owner');
    }
  };
  const discardChanges = (): void => {
    if (inFlight.current) return;
    clearIdentityDraft();
    setFields(baselineRef.current);
    setError(null);
  };
  useImperativeHandle(ref, () => ({ saveBeforeBind, discardChanges }), [choice, useNanako, customName, me.id]);

  const handleSave = async (): Promise<void> => {
    if (inFlight.current) return;
    setError(null);
    const displayName = useNanako ? null : customName.trim();
    if (!useNanako && (displayName === null || displayName.length === 0)) {
      setError('请输入自定义名字，或选择使用 Nanako 名字');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    const id = me.id;
    const stillCurrent = (): boolean => active.current && owner.current === id;
    try {
      await updateDisplayName(displayName);
      if (!stillCurrent()) return;
      const { user } = await updateRoles(roles);
      if (!stillCurrent()) return;
      clearIdentityDraft();
      const saved = fieldsFor(user, mode);
      baselineRef.current = saved;
      setBaseline(saved);
      setFields(saved);
      callbacks.current.onSaved(user);
    } catch (err) {
      if (stillCurrent()) setError(err instanceof ApiError ? err.message : '保存失败，请稍后重试');
    } finally {
      if (stillCurrent()) { inFlight.current = false; setSaving(false); }
    }
  };

  return (
    <div className={`identity-form${mode === 'settings' ? ' identity-form--settings' : ''}`}>
      {mode === 'onboarding' && <span className="ob__eyebrow eyebrow">欢迎，{me.oauth_username}</span>}
      <h3 className="ob__title">{mode === 'settings' ? '个人资料' : '设置你的显示名字与身份'}</h3>
      <p className="ob__subtitle">{mode === 'settings' ? '修改展示名、上榜身份与现有裁判资格。' : '以后也可以在设置中修改。'}</p>

      <div className="ob__section">
        <span className="ob__label">显示名字</span>
        <div className="ob__name-opts" role="radiogroup" aria-label="显示名字来源">
          <button type="button" role="radio" aria-checked={useNanako} disabled={saving}
            className={`ob__name-opt${useNanako ? ' ob__name-opt--active' : ''}`}
            onClick={() => setFields((old) => ({ ...old, useNanako: true }))}>
            <span className="ob__name-opt-title">用 Nanako 名字</span><span className="ob__name-opt-hint">{me.oauth_username}</span>
          </button>
          <button type="button" role="radio" aria-checked={!useNanako} disabled={saving}
            className={`ob__name-opt${!useNanako ? ' ob__name-opt--active' : ''}`}
            onClick={() => setFields((old) => ({ ...old, useNanako: false }))}>
            <span className="ob__name-opt-title">自定义</span><span className="ob__name-opt-hint">自己起个名字</span>
          </button>
        </div>
        {!useNanako && <input className="ob__name-input" type="text" value={customName} disabled={saving}
          onChange={(e) => setFields((old) => ({ ...old, customName: e.target.value }))} maxLength={DISPLAY_NAME_MAX}
          placeholder="输入你想显示的名字（最多 24 字）" aria-label="自定义显示名字" />}
      </div>

      <div className="ob__section">
        <span className="ob__label">身份</span>
        {mode === 'settings' ? <div className="ob__settings-roles">
          <label className="ob__settings-role"><input type="checkbox" checked={roles.is_participant} disabled={saving}
            onChange={(e) => setFields((old) => ({ ...old, choice: choiceFor(e.target.checked, roleValues(old.choice).is_judge, mode) }))} />
            <span>作为成员上榜</span></label>
          <p className="ob__settings-description">开启后显示在公开信誉榜中；关闭后仍可查阅自己的记录。</p>
          {canJudge ? <><label className="ob__settings-role"><input type="checkbox" checked={roles.is_judge} disabled={saving}
            onChange={(e) => setFields((old) => ({ ...old, choice: choiceFor(roleValues(old.choice).is_participant, e.target.checked, mode) }))} />
            <span>{me.is_judge ? '保留裁判身份' : '作为裁判'}</span></label>
            <p className="ob__settings-description">为迟到、放鸽子记录事实，并按权限处理案件。</p></>
            : <p className="ob__settings-description">裁判资格由管理员授予，需要的话找管理员。</p>}
        </div> : <div className="ob__cards" role="radiogroup" aria-label="选择身份">
          {ROLE_CARDS.map((card) => {
            const locked = !canJudge && card.choice !== 'participant';
            return <button type="button" key={card.choice} role="radio" aria-checked={choice === card.choice}
              disabled={locked || saving} className={`ob-card${choice === card.choice ? ' ob-card--active' : ''}${locked ? ' ob-card--locked' : ''}`}
              onClick={() => setFields((old) => ({ ...old, choice: card.choice }))}>
              <span className="ob-card__emoji" aria-hidden="true">{card.emoji}</span><span className="ob-card__title">{card.title}</span>
              <span className="ob-card__desc">{locked ? '裁判资格由管理员授予，需要的话找管理员。' : card.desc}</span>
            </button>;
          })}
        </div>}
      </div>

      {me.is_judge && !me.is_admin && !roles.is_judge && <p className="ob__hint" role="note">
        放弃裁判资格后，要再当裁判需要管理员重新授予。
      </p>}
      {error && <p className="ob__error" role="alert">{error}</p>}
      <div className="ob__actions">
        {mode === 'settings' && dirty && <span className="ob__dirty" role="status">有未保存的修改</span>}
        <button type="button" className="btn btn--gold" onClick={() => void handleSave()} disabled={saving}>
          {saving ? '保存中…' : mode === 'settings' ? '保存资料' : '确认'}
        </button>
      </div>
    </div>
  );
});

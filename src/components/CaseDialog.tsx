import { useMemo, useState } from 'react';
import { MIN_CLAIM_LEN, MAX_NARRATIVE_LEN, VIOLATIONS } from '@shared/scoring';
import type { ViolationDef } from '@shared/scoring';
import type { Config, PublicUser, RecordItem, ViolationType } from '../types';
import { ApiError, createCase } from '../api';
import { Modal } from './Modal';
import { SentencingScale } from './SentencingScale';
import './case-dialog.css';

interface CaseDialogProps {
  open: boolean;
  onClose: () => void;
  participants: PublicUser[];
  selfId: string;
  config: Config;
  onCreated: (record: RecordItem) => void;
}

const PENALTIES: ViolationDef[] = VIOLATIONS.filter((v) => v.kind === 'penalty');
const BONUSES: ViolationDef[] = VIOLATIONS.filter((v) => v.kind === 'bonus');

/**
 * 立案 — the judge decides WHAT happened; the AI decides what it costs.
 * That split is why there is no points picker here, only a mandatory account
 * of the facts.
 */
export function CaseDialog({
  open,
  onClose,
  participants,
  selfId,
  config,
  onCreated,
}: CaseDialogProps): JSX.Element {
  const candidates = useMemo(
    () => participants.filter((p) => p.id !== selfId),
    [participants, selfId],
  );

  const [subjectId, setSubjectId] = useState('');
  const [type, setType] = useState<ViolationType | ''>('');
  const [claim, setClaim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = type ? VIOLATIONS.find((v) => v.type === type) ?? null : null;
  const isPenalty = selected?.kind === 'penalty';

  const reset = (): void => {
    setSubjectId('');
    setType('');
    setClaim('');
    setError(null);
    setSubmitting(false);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!subjectId) {
      setError('请选择要记录的选手');
      return;
    }
    if (!type) {
      setError('请选择案由');
      return;
    }
    if (isPenalty && claim.trim().length < MIN_CLAIM_LEN) {
      setError(`请把发生了什么写清楚，至少 ${MIN_CLAIM_LEN} 个字`);
      return;
    }
    setSubmitting(true);
    try {
      const { record } = await createCase({
        subject_id: subjectId,
        type,
        claim: claim.trim() ? claim.trim() : undefined,
      });
      onCreated(record);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="case-dialog-title" size="md">
      <h2 id="case-dialog-title" className="cd__title">
        立案
      </h2>
      <p className="cd__subtitle">
        你负责认定发生了什么，扣多少分交给 AI 裁判。被记录的人有一次说明机会。
      </p>

      <form className="cd__form" onSubmit={handleSubmit}>
        <label className="cd__field">
          <span className="cd__label">选手</span>
          <select
            className="cd__select"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            data-autofocus
            required
          >
            <option value="" disabled>
              选择一位上榜选手…
            </option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.username}（{p.score} 分）
              </option>
            ))}
          </select>
          {candidates.length === 0 && <span className="cd__hint">目前没有可记录的其他选手。</span>}
        </label>

        <fieldset className="cd__field cd__field--types">
          <legend className="cd__label">案由</legend>

          <span className="cd__group-label cd__group-label--penalty">违约（AI 量刑）</span>
          <div className="cd__types">
            {PENALTIES.map((v) => (
              <TypeOption
                key={v.type}
                def={v}
                checked={type === v.type}
                onSelect={() => setType(v.type)}
              />
            ))}
          </div>

          <span className="cd__group-label cd__group-label--bonus">守约加分（立即生效）</span>
          <div className="cd__types">
            {BONUSES.map((v) => (
              <TypeOption
                key={v.type}
                def={v}
                checked={type === v.type}
                onSelect={() => setType(v.type)}
              />
            ))}
          </div>
        </fieldset>

        {selected && isPenalty && (
          <div className="cd__preview">
            <SentencingScale range={{ min: selected.min, max: selected.max, base: selected.base }} />
            <p className="cd__preview-note">
              {config.aiEnabled
                ? `AI 会在这个区间内量刑，${config.statementWindowHours} 小时后仍未说明则按缺席裁决。`
                : `AI 裁判当前未启用，本案将按基准 ${selected.base} 分判罚。`}
            </p>
          </div>
        )}

        <label className="cd__field">
          <span className="cd__label">
            事实描述{isPenalty ? '' : '（可选）'}
            {isPenalty && <span className="cd__required">必填</span>}
          </span>
          <textarea
            className="cd__textarea"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={4}
            maxLength={MAX_NARRATIVE_LEN}
            placeholder="说清楚时间、约定、实际发生了什么。写得越具体，AI 判得越准。例如：说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。"
          />
          <span className="cd__counter tabular">
            {claim.trim().length} / {MAX_NARRATIVE_LEN}
          </span>
        </label>

        {error && (
          <p className="cd__error" role="alert">
            {error}
          </p>
        )}

        <div className="cd__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn--gold"
            disabled={submitting || candidates.length === 0}
          >
            {submitting ? '提交中…' : isPenalty ? '立案，交给 AI' : '确认记录'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface TypeOptionProps {
  def: ViolationDef;
  checked: boolean;
  onSelect: () => void;
}

function TypeOption({ def, checked, onSelect }: TypeOptionProps): JSX.Element {
  const bonus = def.kind === 'bonus';
  const rangeText = bonus
    ? `+${def.base}`
    : def.min === def.max
      ? String(def.base)
      : `${def.min} ~ ${def.max}`;
  return (
    <label className={`cd-type${checked ? ' cd-type--checked' : ''}`}>
      <input
        type="radio"
        name="violation-type"
        className="visually-hidden"
        checked={checked}
        onChange={onSelect}
      />
      <span className="cd-type__emoji" aria-hidden="true">
        {def.emoji}
      </span>
      <span className="cd-type__text">
        <span className="cd-type__label">{def.label}</span>
        <span className="cd-type__desc">{def.desc}</span>
      </span>
      <span
        className={`cd-type__range tabular ${
          bonus ? 'cd-type__range--up' : 'cd-type__range--down'
        }`}
      >
        {rangeText}
      </span>
    </label>
  );
}

import { useMemo, useState } from 'react';
import { VIOLATIONS } from '@shared/scoring';
import type { ViolationDef } from '@shared/scoring';
import type { PublicUser, RecordItem, ViolationType } from '../types';
import { ApiError, createRecord } from '../api';
import { Modal } from './Modal';
import './record-dialog.css';

interface RecordDialogProps {
  open: boolean;
  onClose: () => void;
  participants: PublicUser[];
  selfId: string;
  onCreated: (record: RecordItem) => void;
}

const PENALTIES: ViolationDef[] = VIOLATIONS.filter((v) => v.kind === 'penalty');
const BONUSES: ViolationDef[] = VIOLATIONS.filter((v) => v.kind === 'bonus');

export function RecordDialog({
  open,
  onClose,
  participants,
  selfId,
  onCreated,
}: RecordDialogProps): JSX.Element {
  const candidates = useMemo(
    () => participants.filter((p) => p.id !== selfId),
    [participants, selfId],
  );

  const [subjectId, setSubjectId] = useState('');
  const [type, setType] = useState<ViolationType | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = (): void => {
    setSubjectId('');
    setType('');
    setNote('');
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
      setError('请选择违约 / 守约类型');
      return;
    }
    setSubmitting(true);
    try {
      const { record } = await createRecord({
        subject_id: subjectId,
        type,
        note: note.trim() ? note.trim() : undefined,
      });
      onCreated(record);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="record-dialog-title" size="md">
      <h2 id="record-dialog-title" className="rd__title">
        记一笔
      </h2>
      <p className="rd__subtitle">选择选手与类型，分数将立即结算。</p>

      <form className="rd__form" onSubmit={handleSubmit}>
        <label className="rd__field">
          <span className="rd__label">选手</span>
          <select
            className="rd__select"
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
          {candidates.length === 0 && (
            <span className="rd__hint">目前没有可记录的其他选手。</span>
          )}
        </label>

        <fieldset className="rd__field rd__field--types">
          <legend className="rd__label">类型</legend>

          <span className="rd__group-label rd__group-label--penalty">违约扣分</span>
          <div className="rd__types">
            {PENALTIES.map((v) => (
              <TypeOption
                key={v.type}
                def={v}
                checked={type === v.type}
                onSelect={() => setType(v.type)}
              />
            ))}
          </div>

          <span className="rd__group-label rd__group-label--bonus">守约加分</span>
          <div className="rd__types">
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

        <label className="rd__field">
          <span className="rd__label">备注（可选）</span>
          <textarea
            className="rd__textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder="补充说明，例如：说好八点结果九点才来"
          />
        </label>

        {error && (
          <p className="rd__error" role="alert">
            {error}
          </p>
        )}

        <div className="rd__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn--gold"
            disabled={submitting || candidates.length === 0}
          >
            {submitting ? '提交中…' : '确认记录'}
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
  const positive = def.delta > 0;
  return (
    <label className={`rd-type${checked ? ' rd-type--checked' : ''}`}>
      <input
        type="radio"
        name="violation-type"
        className="visually-hidden"
        checked={checked}
        onChange={onSelect}
      />
      <span className="rd-type__emoji" aria-hidden="true">
        {def.emoji}
      </span>
      <span className="rd-type__text">
        <span className="rd-type__label">{def.label}</span>
        <span className="rd-type__desc">{def.desc}</span>
      </span>
      <span
        className={`rd-type__delta tabular ${
          positive ? 'rd-type__delta--up' : 'rd-type__delta--down'
        }`}
      >
        {positive ? `+${def.delta}` : def.delta}
      </span>
    </label>
  );
}

import { useMemo, useState } from 'react';
import { MAX_NARRATIVE_LEN, MIN_CLAIM_LEN } from '@shared/scoring';
import type { BatchFailure, Config, PublicUser, RecordItem } from '../types';
import { ApiError, createCases } from '../api';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import './case-dialog.css';

interface CaseDialogProps {
  open: boolean;
  onClose: () => void;
  participants: PublicUser[];
  selfId: string;
  config: Config;
  onCreated: (records: RecordItem[]) => void;
}

/**
 * 记一笔 — v3: pick people, describe what happened, done.
 *
 * There is no violation-type picker: the judge establishes WHAT happened, the AI
 * reads it and picks the category, then sentences within that category's range.
 * The shared textarea covers the common case ("说好八点，你们俩都没来"); the
 * collapsible per-person note exists for when someone deserves a specific word.
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

  const [picked, setPicked] = useState<string[]>([]);
  const [claim, setClaim] = useState('');
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<BatchFailure[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const atLimit = picked.length >= config.maxBatchSubjects;

  const reset = (): void => {
    setPicked([]);
    setClaim('');
    setExtras({});
    setExpanded(null);
    setError(null);
    setFailed([]);
    setSubmitting(false);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const toggle = (id: string): void => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= config.maxBatchSubjects) return prev;
      return [...prev, id];
    });
  };

  const nameOf = (id: string): string =>
    candidates.find((c) => c.id === id)?.username ?? id;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setFailed([]);
    if (picked.length === 0) {
      setError('先选一下是谁');
      return;
    }
    if (claim.trim().length < MIN_CLAIM_LEN) {
      setError(`把发生了什么写清楚，至少 ${MIN_CLAIM_LEN} 个字`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await createCases({
        subject_ids: picked,
        claim: claim.trim(),
        extras: Object.fromEntries(
          Object.entries(extras).filter(([id, v]) => picked.includes(id) && v.trim().length > 0),
        ),
      });
      if (res.failed.length > 0) {
        // Partial success is the designed behaviour, not an error state: keep the
        // dialog open so the judge can see exactly who was skipped.
        setFailed(res.failed);
        setPicked(res.failed.map((f) => f.subject_id));
        setSubmitting(false);
        if (res.records.length > 0) onCreated(res.records);
        return;
      }
      onCreated(res.records);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="case-dialog-title" size="md">
      <h2 id="case-dialog-title" className="cd__title">
        记一笔
      </h2>
      <p className="cd__subtitle">
        写清楚发生了什么就行 —— 算哪种违约、扣多少分，都交给 AI 裁判。
      </p>

      <form className="cd__form" onSubmit={handleSubmit}>
        <fieldset className="cd__field">
          <legend className="cd__label">
            谁？
            {picked.length > 0 && <span className="cd__count tabular">已选 {picked.length}</span>}
          </legend>
          {candidates.length === 0 ? (
            <span className="cd__hint">目前没有可记录的其他选手。</span>
          ) : (
            <div className="cd__people">
              {candidates.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`cd-chip${on ? ' cd-chip--on' : ''}`}
                    aria-disabled={!on && atLimit}
                  >
                    <input
                      type="checkbox"
                      className="visually-hidden"
                      checked={on}
                      disabled={!on && atLimit}
                      onChange={() => toggle(p.id)}
                    />
                    <Avatar name={p.username} src={p.avatar_url} size={24} />
                    <span className="cd-chip__name">{p.username}</span>
                    <span className="cd-chip__score tabular">{p.score}</span>
                  </label>
                );
              })}
            </div>
          )}
          {atLimit && (
            <span className="cd__hint">一次最多 {config.maxBatchSubjects} 人。</span>
          )}
        </fieldset>

        <label className="cd__field">
          <span className="cd__label">发生了什么？</span>
          <textarea
            className="cd__textarea"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={4}
            maxLength={MAX_NARRATIVE_LEN}
            data-autofocus
            placeholder="说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。"
          />
          <span className="cd__counter tabular">
            {claim.trim().length} / {MAX_NARRATIVE_LEN}
          </span>
        </label>

        {picked.length > 1 && (
          <div className="cd__extras">
            {picked.map((id) => {
              const open2 = expanded === id;
              const has = (extras[id] ?? '').trim().length > 0;
              return (
                <div key={id} className="cd-extra">
                  <button
                    type="button"
                    className="cd-extra__toggle"
                    aria-expanded={open2}
                    onClick={() => setExpanded(open2 ? null : id)}
                  >
                    <span className="cd-extra__chev" aria-hidden="true">
                      {open2 ? '▾' : '▸'}
                    </span>
                    {nameOf(id)} 单独补一句{has && <span className="cd-extra__dot">已填</span>}
                  </button>
                  {open2 && (
                    <textarea
                      className="cd-extra__input"
                      rows={2}
                      maxLength={300}
                      value={extras[id] ?? ''}
                      onChange={(e) =>
                        setExtras((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      placeholder="而且你还把我拉黑了"
                      aria-label={`针对 ${nameOf(id)} 的补充说明`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!config.aiEnabled && (
          <p className="cd__preview-note">
            AI 裁判当前未启用：本次会按「其他」案由的基准分判罚，判词标注为不可用。
          </p>
        )}

        {failed.length > 0 && (
          <div className="cd__failed" role="alert">
            <p>其中 {failed.length} 人没记上：</p>
            <ul>
              {failed.map((f) => (
                <li key={f.subject_id}>
                  {nameOf(f.subject_id)} —— {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}

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
            {submitting
              ? 'AI 归类中…'
              : picked.length > 1
                ? `记下（${picked.length} 人）`
                : '记下'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

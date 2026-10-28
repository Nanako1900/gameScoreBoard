import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MAX_NARRATIVE_LEN, MIN_CLAIM_LEN } from '@shared/scoring';
import type { BatchFailure, Config, PublicUser, RecordItem } from '../types';
import { ApiError, createCases } from '../api';
import { CASE_EXTRA_MAX, isCaseDraftEmpty, validateCaseDraft, type CaseDraftValue } from '../lib/draftShapes';
import { useDraft } from '../lib/useDraft';
import { useLeaveGuard } from '../lib/useLeaveGuard';
import { usePageLeaveGuard } from '../lib/usePageLeaveGuard';
import { clearDraft, readDraft, writeDraft } from '../lib/drafts';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { Avatar } from './Avatar';
import { Link } from './Link';
import { adminVoicePath, toolsPath } from '../lib/routes';
import './case-dialog.css';

interface CaseDialogProps {
  open: boolean;
  onClose: () => void;
  participants: PublicUser[];
  selfId: string;
  config: Config;
  onCreated: (records: RecordItem[]) => void;
  /** The app keeps the page controller mounted while routes change. */
  variant?: 'center' | 'page';
}

const EMPTY_CASE: CaseDraftValue = { picked: [], claim: '', extras: {} };
let currentPageActor: string | null = null;

/** One private request/draft lifetime per actor, before any new actor renders. */
export function CaseDialog(props: CaseDialogProps): JSX.Element {
  if (props.variant === 'page') currentPageActor = props.selfId;
  return <CaseEditor key={`${props.selfId}:${props.variant ?? 'center'}`} {...props} />;
}

/**
 * 记一笔 — v3: pick people, describe what happened, done.
 *
 * There is no violation-type picker: the judge establishes WHAT happened, the AI
 * reads it and picks the category, then sentences within that category's range.
 * The shared textarea covers the common case ("说好八点，你们俩都没来"); the
 * collapsible per-person note exists for when someone deserves a specific word.
 */
function CaseEditor({
  open,
  onClose,
  participants,
  selfId,
  config,
  onCreated,
  variant = 'center',
}: CaseDialogProps): JSX.Element {
  const active = useRef(false);const unavailableRef = useRef(false);
  const openRef = useRef(open);openRef.current = open;
  const callbacks = useRef({ onClose, onCreated });callbacks.current = { onClose, onCreated };
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const isCurrentActor = (): boolean => active.current && !unavailableRef.current
    && (variant !== 'page' || currentPageActor === selfId);
  const [ownershipReady] = useState(() => {
    if (variant === 'page') {
      const owner = readDraft('case', 'owner', value => typeof value === 'string' ? value : null);
      if (owner !== null && owner.value !== selfId) clearDraft('case');
      // Existing unmarked drafts are the current session's legacy draft. New
      // drafts must carry an actor marker before another account can restore
      // one. A failed first marker write must not expose an unowned draft.
      return owner?.value === selfId || writeDraft('case', 'owner', selfId);
    }
    return true;
  });
  const candidates = useMemo(
    () => participants.filter((p) => p.id !== selfId),
    [participants, selfId],
  );

  const candidateIds = useMemo(() => candidates.map((c) => c.id), [candidates]);
  // Who and what is a local draft (spec §5 #4) until every case is filed.
  const draft = useDraft<CaseDraftValue>('case', undefined, EMPTY_CASE, {
    validate: (raw) => ownershipReady ? validateCaseDraft(raw, candidateIds, config.maxBatchSubjects) : null,
    isEmpty: isCaseDraftEmpty,
    canPersist: variant === 'page' ? () => ownershipReady && isCurrentActor() : undefined,
  });
  const { picked, claim, extras } = draft.value;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<BatchFailure[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [unavailable, setUnavailable] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [departing, setDeparting] = useState(false);
  const departingRef = useRef(false);

  const atLimit = picked.length >= config.maxBatchSubjects;

  // Only the transient bits: what was typed is the draft and stays until a submit succeeds.
  const close = (): void => {
    setExpanded(null);
    setError(null);
    setFailed([]);
    setSubmitting(false);
    if (isCurrentActor() && openRef.current && !departingRef.current) callbacks.current.onClose();
  };
  const guard = useLeaveGuard(draft.dirty, close);
  const pageGuard = usePageLeaveGuard(variant === 'page' && open && draft.dirty && !completed && !departing && !unavailable, {
    onLeave: () => {
      // A route change does not unmount this controller. Flush the last edit
      // now, and let an already-issued request finish pruning its own draft.
      if (ownershipReady && isCurrentActor() && draft.dirty) writeDraft('case', undefined, draft.value);
      departingRef.current = true;setDeparting(true);
    },
  });
  useEffect(() => {
    if (open) return;
    departingRef.current = false;setDeparting(false);setCompleted(false);
  }, [open]);
  useEffect(() => {
    // Let the page guard observe clean state before asking the router to go
    // back; otherwise a successful submission would ask to leave again.
    if (variant === 'page' && completed && open && !departingRef.current) close();
  }, [completed, open, variant]);

  const claimRef = useRef<HTMLTextAreaElement>(null);
  // 清空 takes itself away with the note: hand the keyboard to the empty field.
  const clearAll = (): void => {
    draft.clear();
    claimRef.current?.focus();
  };
  const setClaim = (next: string): void => draft.setValue((prev) => ({ ...prev, claim: next }));
  const setExtra = (id: string, text: string): void =>
    draft.setValue((prev) => ({ ...prev, extras: { ...prev.extras, [id]: text } }));

  const toggle = (id: string): void => {
    draft.setValue((prev) => {
      if (prev.picked.includes(id)) return { ...prev, picked: prev.picked.filter((p) => p !== id) };
      if (prev.picked.length >= config.maxBatchSubjects) return prev;
      return { ...prev, picked: [...prev.picked, id] };
    });
  };

  const nameOf = (id: string): string =>
    candidates.find((c) => c.id === id)?.username ?? id;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isCurrentActor() || !openRef.current || submittingRef.current) return;
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
    submittingRef.current = true;
    try {
      const res = await createCases({
        subject_ids: picked,
        claim: claim.trim(),
        extras: Object.fromEntries(
          Object.entries(extras).filter(([id, v]) => picked.includes(id) && v.trim().length > 0),
        ),
      });
      if (!isCurrentActor()) return;
      if (res.failed.length > 0) {
        // Partial success is the designed behaviour, not an error state: keep the
        // dialog open so the judge can see exactly who was skipped — and keep
        // only them in the draft.
        const failedIds = res.failed.map((f) => f.subject_id);
        setFailed(res.failed);
        draft.setValue((prev) => ({
          ...prev,
          picked: failedIds,
          extras: Object.fromEntries(Object.entries(prev.extras).filter(([id]) => failedIds.includes(id))),
        }));
        setSubmitting(false);
        submittingRef.current = false;
        if (res.records.length > 0) callbacks.current.onCreated(res.records);
        return;
      }
      draft.clear();
      setSubmitting(false);submittingRef.current = false;
      callbacks.current.onCreated(res.records);
      if (variant === 'page' && openRef.current && !departingRef.current) setCompleted(true);
      else close();
    } catch (err) {
      if (!isCurrentActor()) return;
      if (variant === 'page' && err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        unavailableRef.current = true;setUnavailable(true);
      }
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  if (!open) return <></>;
  if (unavailable) return <NotFound title={NOT_FOUND_TITLE} />;
  const page = variant === 'page';
  const confirming = page ? pageGuard.confirming : guard.confirmingLeave;
  return (
    <Modal open={open} variant={variant} onClose={page ? callbacks.current.onClose : guard.requestClose} labelledBy="case-dialog-title" size="md"
      dismissible={!draft.dirty} historyKey={page ? undefined : 'case'}>
      {page && <PageBar backLabel="返回" onBack={callbacks.current.onClose} title="记一笔" />}
      {departing ? <p className="cd__status" role="status">正在离开…</p> : <div className={page ? 'cd__page' : undefined}>
      <h2 id="case-dialog-title" className="cd__title" tabIndex={page ? -1 : undefined}>
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
                  <div className="cd-person" key={p.id}>
                    <label
                      className={`cd-chip${on ? ' cd-chip--on' : ''}`}
                      aria-disabled={!on && atLimit}
                    >
                      <input
                        type="checkbox"
                        className="visually-hidden"
                        checked={on}
                      disabled={submitting || (!on && atLimit)}
                        onChange={() => toggle(p.id)}
                      />
                      <Avatar name={p.username} src={p.avatar_url} size={24} />
                      <span className="cd-chip__name">{p.username}</span>
                      <span className="cd-chip__score tabular">{p.score}</span>
                    </label>
                    {on && <Link className="cd-person__voice" to={page ? toolsPath('voice', p.id) : adminVoicePath(p.id)} target="_blank" rel="noopener">
                      看 TA 的语音记录
                    </Link>}
                  </div>
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
            ref={claimRef}
            className="cd__textarea"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={4}
            disabled={submitting}
            maxLength={MAX_NARRATIVE_LEN}
            data-autofocus
            placeholder="说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。"
          />
          <span className="cd__counter tabular">
            {claim.trim().length} / {MAX_NARRATIVE_LEN}
          </span>
        </label>

        <DraftNote savedAt={draft.savedAt} onClear={submitting ? undefined : clearAll} />

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
                    disabled={submitting}
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
                      disabled={submitting}
                      maxLength={CASE_EXTRA_MAX}
                      value={extras[id] ?? ''}
                      onChange={(e) => setExtra(id, e.target.value)}
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

        {confirming ? (
          <ConfirmInline
            question={page && submitting ? '立案请求已经发出，离开后仍可能完成。' : '这笔还没提交，写的内容会留在这台设备上。'}
            cancelLabel={page && submitting ? '继续等待' : '继续写'}
            confirmLabel="先离开"
            onCancel={page ? pageGuard.stay : guard.stay}
            onConfirm={page ? pageGuard.leave : guard.confirmLeave}
            tone="primary"
            focus="cancel"
          />
        ) : (
          <div className="cd__actions">
            <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={page ? callbacks.current.onClose : guard.requestClose}>
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
        )}
      </form>
      </div>}
    </Modal>
  );
}

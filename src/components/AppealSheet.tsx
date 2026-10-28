import { useLayoutEffect, useRef, useState } from 'react';
import { APPEAL_MAX } from '@shared/scoring';
import type { RecordItem } from '../types';
import { ApiError, appealCase } from '../api';
import { isBlankText, validateAppealDraft } from '../lib/draftShapes';
import { violationLabel } from '../lib/recordView';
import { useDraft, type DraftState } from '../lib/useDraft';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useLeaveGuard, type LeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { verdictSourceLabel } from './VerdictCard';
import './appeal-sheet.css';

interface AppealSheetProps {
  /** A decided case of the viewer's own. */
  record: RecordItem;
  onClose: () => void;
  onAppealed: (record: RecordItem) => void;
  /** The host revokes this lease before a different account or role renders. */
  isCurrentActor?: () => boolean;
}

const TITLE_ID = 'appeal-sheet-title';
const DRAFT_OPTIONS = { validate: validateAppealDraft, isEmpty: isBlankText };

type InlineConfirm = ReturnType<typeof useInlineConfirm<HTMLButtonElement>>;

interface AppealSubmit {
  confirm: InlineConfirm;
  submitting: boolean;
  error: string | null;
  /** 确认申诉: post it (an empty reason is sent as none). */
  submit: () => void;
}

function useAppealSubmit(recordId: number, text: string, onAppealed: (record: RecordItem) => void,
  isCurrent: () => boolean): AppealSubmit {
  const confirm = useInlineConfirm<HTMLButtonElement>();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = (): void => {
    if (!isCurrent() || inFlight.current) return;
    inFlight.current = true;
    const reason = text.trim();
    setSubmitting(true);
    setError(null);
    appealCase(recordId, reason.length > 0 ? reason : undefined)
      .then(({ record }) => {
        if (!isCurrent()) return;
        inFlight.current = false;
        confirm.close();
        setSubmitting(false);
        toast.show({ message: '申诉已提交，等管理员复核。', tone: 'ok' });
        onAppealed(record);
      })
      .catch((err: unknown) => {
        if (!isCurrent()) return;
        inFlight.current = false;
        setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
        setSubmitting(false);
        confirm.dismiss();
      });
  };

  return { confirm, submitting, error, submit };
}

/** 「大迟到 · -6 · AI 裁决」 — the same ASCII minus as VerdictCard. */
function caseLine(record: RecordItem): string {
  const label = violationLabel(record.type);
  const source = record.verdict ? ` · ${verdictSourceLabel(record.verdict.source)}` : '';
  return `${label} · ${record.delta}${source}`;
}

/**
 * 申诉这一起 (spec §3.10, H14): a bottom sheet over the player page (or over the
 * verdict, from StatementDialog). The reason is optional like the bot's
 * 「申诉理由（可不填）」, capped at the same APPEAL_MAX, and kept as a draft.
 */
export function AppealSheet({ record, onClose, onAppealed, isCurrentActor }: AppealSheetProps): JSX.Element {
  const mounted = useRef(false);
  const actor = useRef(isCurrentActor); actor.current = isCurrentActor;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canPersist = (): boolean => actor.current?.() !== false;
  const isCurrent = (): boolean => mounted.current && canPersist();
  const draft = useDraft<string>('appeal', record.id, '', { ...DRAFT_OPTIONS, canPersist });
  const guard = useLeaveGuard(draft.dirty, onClose);
  const submission = useAppealSubmit(record.id, draft.value, (appealed) => {
    draft.clear();
    onAppealed(appealed);
  }, isCurrent);

  // Esc / ✕: back out of the confirm first; never mid-submit.
  const requestClose = (): void => {
    if (submission.submitting) return;
    if (submission.confirm.confirming) submission.confirm.dismiss();
    else guard.requestClose();
  };

  return (
    <Modal open onClose={requestClose} labelledBy={TITLE_ID} title="申诉这一起" variant="sheet" size="md" dismissible={!draft.dirty} historyKey="appeal">
      <div className="aps">
        <p className="aps__case">{caseLine(record)}</p>
        <AppealReason draft={draft} disabled={submission.submitting} />
        <p className="aps__hint">申诉后分数先不动，管理员复核后可能维持，也可能改判。</p>
        {submission.error && (
          <p className="aps__error" role="alert">
            {submission.error}
          </p>
        )}
        <AppealActions guard={guard} submission={submission} onRequestClose={requestClose} />
      </div>
    </Modal>
  );
}

interface AppealReasonProps {
  draft: DraftState<string>;
  disabled: boolean;
}

/** The optional reason, its counter and the draft note. */
function AppealReason({ draft, disabled }: AppealReasonProps): JSX.Element {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const length = draft.value.trim().length;
  // 清空 takes itself away with the note: hand the keyboard to the empty field.
  const clearReason = (): void => {
    draft.clear();
    fieldRef.current?.focus();
  };
  return (
    <>
      <label className="aps__field">
        <span className="aps__label">为什么觉得判得不对？（可以不写，但写一句管理员更好判断）</span>
        <textarea
          ref={fieldRef}
          className="aps__textarea"
          rows={4}
          maxLength={APPEAL_MAX}
          value={draft.value}
          onChange={(e) => draft.setValue(e.target.value)}
          disabled={disabled}
          data-autofocus
        />
        <span className="aps__counter tabular">
          {length} / {APPEAL_MAX}
        </span>
      </label>
      <DraftNote savedAt={draft.savedAt} length={length} onClear={disabled ? undefined : clearReason} />
    </>
  );
}

interface AppealActionsProps {
  guard: LeaveGuard;
  submission: AppealSubmit;
  onRequestClose: () => void;
}

function AppealActions({ guard, submission, onRequestClose }: AppealActionsProps): JSX.Element {
  if (guard.confirmingLeave) {
    return (
      <ConfirmInline
        question="申诉理由会留在这台设备上，下次回来接着写。"
        cancelLabel="继续写"
        confirmLabel="先离开"
        onCancel={guard.stay}
        onConfirm={guard.confirmLeave}
        tone="primary"
        focus="cancel"
      />
    );
  }
  if (submission.confirm.confirming) {
    return (
      <ConfirmInline
        question="提交后要等管理员复核，确定吗？"
        cancelLabel="再想想"
        confirmLabel="确认申诉"
        onCancel={submission.confirm.dismiss}
        onConfirm={submission.submit}
        tone="primary"
        focus="cancel"
        busy={submission.submitting}
        busyLabel="提交中…"
      />
    );
  }
  return (
    <div className="aps__actions">
      <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={onRequestClose}>
        先不申诉
      </button>
      <button ref={submission.confirm.triggerRef} type="button" className="btn btn--gold" onClick={submission.confirm.ask}>
        提交申诉
      </button>
    </div>
  );
}

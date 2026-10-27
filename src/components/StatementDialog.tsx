import { useRef, useState } from 'react';
import { MAX_NARRATIVE_LEN, VIOLATION_MAP, affectsScore, clampScore } from '@shared/scoring';
import type { Config, RecordItem } from '../types';
import { ApiError, submitStatement } from '../api';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { isBlankText, validateStatementDraft } from '../lib/draftShapes';
import { formatRemaining, formatWhen, isUrgent } from '../lib/time';
import { useDraft, type DraftState } from '../lib/useDraft';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useLeaveGuard, type LeaveGuard } from '../lib/useLeaveGuard';
import { useNow } from '../lib/useNow';
import { AppealSheet } from './AppealSheet';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { ForgivenessNote } from './ForgivenessNote';
import { Modal } from './Modal';
import { SentencingScale } from './SentencingScale';
import { VerdictCard } from './VerdictCard';
import './statement-dialog.css';

interface StatementDialogProps {
  open: boolean;
  record: RecordItem;
  config: Config;
  onClose: () => void;
  onDecided: (record: RecordItem) => void;
  /** The subject's score before this verdict (App passes me.score). Without it, no ForgivenessNote. */
  score?: number;
}

interface Outcome {
  record: RecordItem;
  /** `score` as it was when the statement went in: App refreshes `me` right after, delta included. */
  scoreBefore: number | undefined;
}

const TITLE_ID = 'statement-dialog-title';
const DRAFT_OPTIONS = { validate: validateStatementDraft, isEmpty: isBlankText };

type InlineConfirm = ReturnType<typeof useInlineConfirm<HTMLButtonElement>>;

interface StatementSubmit {
  confirm: InlineConfirm;
  submitting: boolean;
  error: string | null;
  /** 提交说明: refuse an empty statement, else show 「确认提交？」. */
  ask: () => void;
  /** 确认提交: post it; the verdict comes back with the response. */
  submit: () => void;
}

function useStatementSubmit(recordId: number, text: string, onSubmitted: (record: RecordItem) => void): StatementSubmit {
  const confirm = useInlineConfirm<HTMLButtonElement>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = (): void => {
    if (isBlankText(text)) {
      setError('说点什么吧，哪怕一句');
      return;
    }
    setError(null);
    confirm.ask();
  };

  const submit = (): void => {
    setSubmitting(true);
    submitStatement(recordId, text.trim())
      .then(({ record }) => {
        confirm.close();
        setSubmitting(false);
        onSubmitted(record);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
        setSubmitting(false);
        confirm.dismiss();
      });
  };

  return { confirm, submitting, error, ask, submit };
}

/**
 * 情况说明 — the accused's single, un-editable statement.
 *
 * Submitting runs the verdict inline: the few seconds of waiting end in the
 * judgment, which is the moment the whole feature exists for. What is typed is
 * a local draft until then (spec §5 #4), and the one-way step asks first.
 */
export function StatementDialog({ open, record, config, onClose, onDecided, score }: StatementDialogProps): JSX.Element {
  const draft = useDraft<string>('statement', record.id, '', DRAFT_OPTIONS);
  const guard = useLeaveGuard(draft.dirty, onClose);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [appealing, setAppealing] = useState(false);
  const submission = useStatementSubmit(record.id, draft.value, (decided) => {
    draft.clear();
    setOutcome({ record: decided, scoreBefore: score });
    onDecided(decided);
  });

  // Esc / ✕: back out of an open confirm first; never mid-submit.
  const requestClose = (): void => {
    if (submission.submitting) return;
    if (submission.confirm.confirming) submission.confirm.dismiss();
    else guard.requestClose();
  };

  const appealed = (next: RecordItem): void => {
    setAppealing(false);
    setOutcome((prev) => (prev ? { ...prev, record: next } : prev));
    onDecided(next);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={outcome ? onClose : requestClose}
        labelledBy={TITLE_ID}
        size="md"
        dismissible={outcome !== null || !draft.dirty}
      >
        {outcome ? (
          <StatementOutcome outcome={outcome} weeklyHeal={config.weeklyHeal} onClose={onClose} onAppeal={() => setAppealing(true)} />
        ) : (
          <StatementForm record={record} config={config} draft={draft} guard={guard} submission={submission} onRequestClose={requestClose} />
        )}
      </Modal>
      {outcome && appealing && (
        <AppealSheet record={outcome.record} onClose={() => setAppealing(false)} onAppealed={appealed} />
      )}
    </>
  );
}

interface StatementFormProps {
  record: RecordItem;
  config: Config;
  draft: DraftState<string>;
  guard: LeaveGuard;
  submission: StatementSubmit;
  onRequestClose: () => void;
}

function StatementForm({ record, config, draft, guard, submission, onRequestClose }: StatementFormProps): JSX.Element {
  const def = VIOLATION_MAP[record.type];
  const now = useNow(COUNTDOWN_TICK_MS);
  return (
    <div className="sd">
      <h2 id={TITLE_ID} className="sd__title">
        说明情况
      </h2>
      <p className="sd__subtitle">
        {record.reporter.username} 给你记了一笔「{def?.label ?? record.type}」。
        扣多少分由 AI 裁判在下面这个区间里决定 —— 你说的话会直接影响结果。
      </p>
      {record.deadline_at && <StatementDeadline deadline={record.deadline_at} now={now} />}
      <blockquote className="sd__claim">
        <span className="sd__claim-who">立案经过</span>
        <p>{record.claim ?? '（未填写）'}</p>
      </blockquote>
      <SentencingScale range={record.range} />
      <div className="sd__form">
        <StatementField draft={draft} disabled={submission.submitting} />
        <StatementPrivacy aiEnabled={config.aiEnabled} />
        {submission.error && (
          <p className="sd__error" role="alert">
            {submission.error}
          </p>
        )}
        <StatementActions guard={guard} submission={submission} onRequestClose={onRequestClose} />
      </div>
    </div>
  );
}

interface StatementFieldProps {
  draft: DraftState<string>;
  disabled: boolean;
}

/** The statement itself, its counter and the draft note. */
function StatementField({ draft, disabled }: StatementFieldProps): JSX.Element {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const length = draft.value.trim().length;
  // 清空 takes itself away with the note: hand the keyboard to the empty field.
  const clearText = (): void => {
    draft.clear();
    fieldRef.current?.focus();
  };
  return (
    <>
      <label className="sd__field">
        <span className="sd__label">你的说明</span>
        <textarea
          ref={fieldRef}
          className="sd__textarea"
          value={draft.value}
          onChange={(e) => draft.setValue(e.target.value)}
          rows={5}
          maxLength={MAX_NARRATIVE_LEN}
          data-autofocus
          placeholder="发生了什么？有没有提前说？有没有补偿？照实说，AI 会考虑减轻情节。"
          disabled={disabled}
        />
        <span className="sd__counter tabular">
          {length} / {MAX_NARRATIVE_LEN}
        </span>
      </label>
      <DraftNote savedAt={draft.savedAt} length={length} onClear={disabled ? undefined : clearText} />
    </>
  );
}

/** 「截止：今天 23:40（还剩 5 小时 0 分）· 过期会按缺席裁决」 — absolute and relative (M19). */
function StatementDeadline({ deadline, now }: { deadline: string; now: number }): JSX.Element {
  const urgent = isUrgent(deadline, now);
  return (
    <p className={`sd__deadline${urgent ? ' sd__deadline--urgent' : ''}`}>
      <span aria-hidden="true">⏳</span> 截止：{formatWhen(deadline, now)}（{formatRemaining(deadline, now)}）· 过期会按缺席裁决
    </p>
  );
}

/** Who sees what, before and after the verdict (spec §3.10, M18). */
function StatementPrivacy({ aiEnabled }: { aiEnabled: boolean }): JSX.Element {
  return (
    <div className="sd__privacy">
      <p>谁能看到：你的说明只给你、立案人、裁判和管理员看。</p>
      <p>判决前，立案经过和案由不会公开给其他人；判决后，案由、立案经过和分数变化会公开，你的说明始终只给上面这几类人看。</p>
      <p>
        说明只能交一次，交了马上进入 AI 裁决。
        {aiEnabled && '你的说明会发送给已配置的 AI 服务用于本次判罚。'}
      </p>
    </div>
  );
}

interface StatementActionsProps {
  guard: LeaveGuard;
  submission: StatementSubmit;
  onRequestClose: () => void;
}

function StatementActions({ guard, submission, onRequestClose }: StatementActionsProps): JSX.Element {
  if (guard.confirmingLeave) {
    return (
      <ConfirmInline
        question="还没提交的说明会留在这台设备上，下次回来接着写。"
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
        question="确认提交？交了就不能改。"
        cancelLabel="再看看"
        confirmLabel="确认提交"
        onCancel={submission.confirm.dismiss}
        onConfirm={submission.submit}
        tone="primary"
        focus="cancel"
        busy={submission.submitting}
        busyLabel="AI 裁决中…"
      />
    );
  }
  return (
    <div className="sd__actions">
      <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={onRequestClose}>
        稍后再说
      </button>
      <button ref={submission.confirm.triggerRef} type="button" className="btn btn--gold" onClick={submission.ask}>
        提交说明
      </button>
    </div>
  );
}

interface StatementOutcomeProps {
  outcome: Outcome;
  weeklyHeal: number;
  onClose: () => void;
  onAppeal: () => void;
}

/** 裁决结果, and right under it the way back (spec §3.10 判决). */
function StatementOutcome({ outcome, weeklyHeal, onClose, onAppeal }: StatementOutcomeProps): JSX.Element {
  const { record, scoreBefore } = outcome;
  return (
    <div className="sd">
      <h2 id={TITLE_ID} className="sd__title">
        裁决结果
      </h2>
      <VerdictCard record={record} />
      {scoreBefore !== undefined && affectsScore(record.status) && (
        <ForgivenessNote
          delta={record.delta}
          scoreAfter={clampScore(scoreBefore + record.delta)}
          weeklyHeal={weeklyHeal}
          onAppeal={record.status === 'decided' ? onAppeal : undefined}
        />
      )}
      <div className="sd__actions">
        <button type="button" className="btn btn--gold" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}

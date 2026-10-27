import { useEffect, useState } from 'react';
import { MAX_NARRATIVE_LEN, VIOLATION_MAP } from '@shared/scoring';
import type { Config, RecordItem } from '../types';
import { ApiError, submitStatement } from '../api';
import { formatRemaining, isUrgent } from '../lib/time';
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
}

/**
 * 情况说明 — the accused's single, un-editable statement.
 *
 * Submitting closes the window and runs the verdict inline: the few seconds of
 * waiting end in the judgment, which is the moment the whole feature exists for.
 */
export function StatementDialog({
  open,
  record,
  config,
  onClose,
  onDecided,
}: StatementDialogProps): JSX.Element {
  const def = VIOLATION_MAP[record.type];
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<RecordItem | null>(null);
  const [, forceTick] = useState(0);

  // Keep the countdown honest while the dialog sits open.
  useEffect(() => {
    if (!open || verdict) return;
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [open, verdict]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const statement = text.trim();
    if (statement.length === 0) {
      setError('说点什么吧，哪怕一句');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitStatement(record.id, statement);
      setVerdict(res.record);
      onDecided(res.record);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const urgent = record.deadline_at !== null && isUrgent(record.deadline_at);

  return (
    <Modal open={open} onClose={onClose} labelledBy="statement-dialog-title" size="md">
      {verdict ? (
        <div className="sd">
          <h2 id="statement-dialog-title" className="sd__title">
            裁决结果
          </h2>
          <VerdictCard record={verdict} />
          <div className="sd__actions">
            <button type="button" className="btn btn--gold" onClick={onClose}>
              知道了
            </button>
          </div>
        </div>
      ) : (
        <div className="sd">
          <h2 id="statement-dialog-title" className="sd__title">
            说明情况
          </h2>
          <p className="sd__subtitle">
            {record.reporter.username} 给你记了一笔「{def?.label ?? record.type}」。
            扣多少分由 AI 裁判在下面这个区间里决定 —— 你说的话会直接影响结果。
          </p>

          {record.deadline_at && (
            <p className={`sd__deadline${urgent ? ' sd__deadline--urgent' : ''}`}>
              <span aria-hidden="true">⏳</span> {formatRemaining(record.deadline_at)}
              ，超时将按缺席裁决
            </p>
          )}

          <blockquote className="sd__claim">
            <span className="sd__claim-who">立案经过</span>
            <p>{record.claim ?? '（未填写）'}</p>
          </blockquote>

          <SentencingScale range={record.range} />

          <form className="sd__form" onSubmit={handleSubmit}>
            <label className="sd__field">
              <span className="sd__label">你的说明</span>
              <textarea
                className="sd__textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={MAX_NARRATIVE_LEN}
                data-autofocus
                placeholder="发生了什么？有没有提前说？有没有补偿？照实说，AI 会考虑减轻情节。"
                disabled={submitting}
              />
              <span className="sd__counter tabular">
                {text.trim().length} / {MAX_NARRATIVE_LEN}
              </span>
            </label>

            <p className="sd__notice">
              提交后不可修改，并会立即触发裁决。只有你、立案人、裁判和管理员能看到这段说明和判词。
              {config.aiEnabled && '你的说明会发送给已配置的 AI 服务用于本次判罚。'}
            </p>

            {error && (
              <p className="sd__error" role="alert">
                {error}
              </p>
            )}

            <div className="sd__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onClose}
                disabled={submitting}
              >
                稍后再说
              </button>
              <button type="submit" className="btn btn--gold" disabled={submitting}>
                {submitting ? 'AI 裁决中…' : '提交并接受裁决'}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

import type { RecordItem, VerdictSource } from '../types';
import { violationDef } from '../lib/recordView';
import { formatRemaining, isUrgent, relativeTime } from '../lib/time';
import { SentencingScale } from './SentencingScale';
import './verdict-card.css';

interface VerdictCardProps {
  record: RecordItem;
  /** Rendered under the verdict — statement / appeal / revoke buttons. */
  actions?: React.ReactNode;
  /** Shown only to the filing judge / an admin while the hint is live. */
  escalation?: React.ReactNode;
  /** The case a link pointed at: marked, and focusable. */
  focused?: boolean;
}

const SOURCE_BADGE: Record<VerdictSource, { label: string; tone: string }> = {
  ai: { label: 'AI 裁决', tone: 'ai' },
  fallback: { label: '基准分（AI 未参与）', tone: 'fallback' },
  manual: { label: '直接记录', tone: 'manual' },
  admin_override: { label: '管理员改判', tone: 'override' },
};

/** 'AI 裁决' / '管理员改判' …, for places that name a verdict's source outside the card. */
export function verdictSourceLabel(source: VerdictSource): string {
  return SOURCE_BADGE[source].label;
}

const PRIVATE_TO = '只有当事人、立案人、裁判和管理员能看';

/**
 * A case, told as a story: 案由 → 双方陈述 → 判词 → 量刑尺.
 *
 * The verdict text is the product, not a status line — this is the difference
 * between v1's bare "-15" and v2's "-11，因为你提前告知了，虽然晚了点".
 */
export function VerdictCard({
  record,
  actions,
  escalation,
  focused = false,
}: VerdictCardProps): JSX.Element {
  const def = violationDef(record.type);
  const { verdict, status } = record;
  const pending = status === 'awaiting_statement';
  const judging = status === 'judging';
  const voided = status === 'revoked' || status === 'withdrawn';
  const badge = verdict ? SOURCE_BADGE[verdict.source] : null;
  const hidden = record.redacted === true;
  // Only a trial's verdict has words to hide; a bonus's is just its label.
  const wordsHidden = hidden && verdict !== null && verdict.source !== 'manual';
  const trial = def?.kind === 'penalty';

  return (
    <article id={`case-${record.id}`} tabIndex={-1} className={`vc vc--${status}${focused ? ' vc--focus' : ''}`}>
      <header className="vc__head">
        <span className="vc__emoji" aria-hidden="true">
          {def?.emoji ?? '📝'}
        </span>
        <div className="vc__head-text">
          <h4 className="vc__type">
            {record.claim_summary ?? def?.label ?? record.type}
          </h4>
          <p className="vc__meta">
            <span className="vc__charge">{def?.label ?? record.type}</span>
            {record.classified_by === 'ai' && (
              <span className="vc__by" title="案由由 AI 从事实描述归类">AI 归类</span>
            )}
            {record.classified_by === 'derived' && (
              <span className="vc__by" title="案由由点名结果确定性推导">点名推导</span>
            )}
            <span aria-hidden="true"> · </span>
            裁判 {record.reporter.username}
            <span aria-hidden="true"> · </span>
            <time dateTime={record.created_at}>{relativeTime(record.created_at)}</time>
          </p>
        </div>
        {!pending && !judging && (
          <span
            className={`vc__delta tabular ${
              record.delta > 0 ? 'vc__delta--up' : 'vc__delta--down'
            }${voided ? ' vc__delta--void' : ''}`}
          >
            {record.delta > 0 ? `+${record.delta}` : record.delta}
          </span>
        )}
      </header>

      {record.claim && (
        <blockquote className="vc__quote vc__quote--claim">
          <span className="vc__quote-who">立案经过</span>
          <p>{record.claim}</p>
        </blockquote>
      )}

      {record.statement ? (
        <blockquote className="vc__quote vc__quote--statement">
          <span className="vc__quote-who">{record.subject.username} 的说明</span>
          <p>{record.statement}</p>
        </blockquote>
      ) : hidden && trial && record.statement_at ? (
        <p className="vc__hidden">
          <span aria-hidden="true">🔒</span> {record.subject.username} 写了说明 · {PRIVATE_TO}
        </p>
      ) : (
        // A withdrawn case was never judged at all (M17): no "absent" either.
        !pending && status !== 'withdrawn' && trial && (
          <p className="vc__absent">该选手没有在期限内说明情况，按缺席裁决。</p>
        )
      )}

      {pending && record.deadline_at && (
        <p className={`vc__pending${isUrgent(record.deadline_at) ? ' vc__pending--urgent' : ''}`}>
          <span aria-hidden="true">⏳</span> 等待 {record.subject.username} 说明情况 ·{' '}
          {formatRemaining(record.deadline_at)}
        </p>
      )}

      {judging && <p className="vc__pending">⚖️ AI 正在裁决…</p>}

      {verdict && (
        <div className="vc__verdict">
          <div className="vc__verdict-head">
            {wordsHidden ? (
              <p className="vc__hidden">
                <span aria-hidden="true">🔒</span> 判词{PRIVATE_TO}
              </p>
            ) : (
              <h5 className="vc__headline">{verdict.headline}</h5>
            )}
            {badge && <span className={`vc__source vc__source--${badge.tone}`}>{badge.label}</span>}
          </div>
          {!wordsHidden && verdict.reasoning && <p className="vc__reason">{verdict.reasoning}</p>}
          {!wordsHidden && verdict.factors.length > 0 && (
            <ul className="vc__factors">
              {verdict.factors.map((f, i) => (
                <li
                  key={`${f.kind}-${i}`}
                  className={`vc__factor vc__factor--${f.kind}`}
                >
                  {f.kind === 'mitigating' ? '从轻' : '从重'}：{f.text}
                </li>
              ))}
            </ul>
          )}
          {!voided && record.range && <SentencingScale range={record.range} delta={record.delta} />}
        </div>
      )}

      {status === 'appealed' && (
        <>
          {!hidden && record.appeal_reason && (
            <blockquote className="vc__quote vc__quote--appeal">
              <span className="vc__quote-who">申诉理由</span>
              <p>{record.appeal_reason}</p>
            </blockquote>
          )}
          <p className="vc__flag vc__flag--appealed">
            该选手已申诉，等待管理员复核（分数暂不变动）。
          </p>
        </>
      )}
      {status === 'revoked' && <p className="vc__flag">这笔记录已被撤销，分数已还原。</p>}
      {status === 'withdrawn' && <p className="vc__flag">裁判已撤案，未产生任何扣分。</p>}

      {record.escalation_suggested && pending && (
        <div className="vc__escalate">
          <p className="vc__escalate-text">
            AI 认为这够得上「团灭级放鸽」。系统先按较轻的案由立案了 —— 要升级得由人确认。
          </p>
          {escalation && <div className="vc__escalate-actions">{escalation}</div>}
        </div>
      )}

      {actions && <div className="vc__actions">{actions}</div>}
    </article>
  );
}

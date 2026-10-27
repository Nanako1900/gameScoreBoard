import { RSVP_LABEL, SELF_RSVPS } from '@shared/attendance';
import { LoginLink } from './LoginLink';
import './visitor-rsvp.css';

interface VisitorRsvpPromptProps {
  sessionId: number;
}

/**
 * A signed-out visitor's RSVP area (spec §3.5 未登录访客). Each answer is a
 * login link that remembers what was clicked, so the page can ask about it
 * after login (ResumeHint) — it is never submitted on the visitor's behalf.
 */
export function VisitorRsvpPrompt({ sessionId }: VisitorRsvpPromptProps): JSX.Element {
  return (
    <div className="vrp" role="group" aria-label="登录后报名">
      <p className="vrp__line">登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。</p>
      <div className="vrp__choices">
        <span className="vrp__label" aria-hidden="true">
          登录后报名：
        </span>
        {SELF_RSVPS.map((rsvp) => (
          <LoginLink
            key={rsvp}
            className="btn btn--ghost btn--sm vrp__choice"
            intent={{ kind: 'rsvp', sessionId, rsvp }}
          >
            {RSVP_LABEL[rsvp]}
          </LoginLink>
        ))}
      </div>
      <LoginLink className="btn btn--gold btn--sm vrp__login">用 Nanako 账号登录</LoginLink>
    </div>
  );
}

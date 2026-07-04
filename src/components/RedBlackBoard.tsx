import { tierFor } from '@shared/scoring';
import type { PublicUser } from '../types';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import './red-black-board.css';

interface RedBlackBoardProps {
  top: PublicUser | null;
  bottom: PublicUser | null;
  onSelect: (id: string) => void;
}

interface HeroCardProps {
  kind: 'gold' | 'red';
  eyebrow: string;
  crown: string;
  user: PublicUser;
  onSelect: (id: string) => void;
}

function HeroCard({ kind, eyebrow, crown, user, onSelect }: HeroCardProps): JSX.Element {
  const tier = tierFor(user.score);
  return (
    <article
      className={`hero-card hero-card--${kind}`}
      style={{ ['--accent' as string]: tier.color }}
    >
      <div className="hero-card__glow" aria-hidden="true" />
      <header className="hero-card__head">
        <span className="hero-card__crown" aria-hidden="true">
          {crown}
        </span>
        <span className="hero-card__eyebrow eyebrow">{eyebrow}</span>
      </header>

      <div className="hero-card__body">
        <ScoreGauge score={user.score} size={148} strokeWidth={12} />
        <div className="hero-card__meta">
          <div className="hero-card__id">
            <Avatar
              name={user.username}
              src={user.avatar_url}
              size={44}
              ring
              ringColor={tier.color}
            />
            <h3 className="hero-card__name">{user.username}</h3>
          </div>
          <TierBadge tier={tier} />
          <p className="hero-card__blurb">{tier.blurb}</p>
        </div>
      </div>

      <button
        type="button"
        className="hero-card__link"
        onClick={() => onSelect(user.id)}
      >
        查看战绩
        <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

/** Editorial 红黑榜: 本周最靠谱 (gold) vs 头号鸽王 (red), side by side. */
export function RedBlackBoard({
  top,
  bottom,
  onSelect,
}: RedBlackBoardProps): JSX.Element {
  return (
    <section className="rbb" aria-label="红黑榜">
      <div className="rbb__masthead">
        <h2 className="rbb__title">
          红<span className="rbb__title-slash">/</span>黑榜
        </h2>
        <p className="rbb__tagline">本周谁最靠谱，谁是头号鸽王</p>
      </div>

      <div className="rbb__cards">
        {top ? (
          <HeroCard
            kind="gold"
            eyebrow="本周最靠谱"
            crown="👑"
            user={top}
            onSelect={onSelect}
          />
        ) : (
          <EmptyHero kind="gold" label="本周最靠谱" hint="暂无上榜选手" />
        )}

        <div className="rbb__versus" aria-hidden="true">
          VS
        </div>

        {bottom ? (
          <HeroCard
            kind="red"
            eyebrow="头号鸽王"
            crown="🕊️"
            user={bottom}
            onSelect={onSelect}
          />
        ) : (
          <EmptyHero kind="red" label="头号鸽王" hint="暂无上榜选手" />
        )}
      </div>
    </section>
  );
}

interface EmptyHeroProps {
  kind: 'gold' | 'red';
  label: string;
  hint: string;
}

function EmptyHero({ kind, label, hint }: EmptyHeroProps): JSX.Element {
  return (
    <article className={`hero-card hero-card--${kind} hero-card--empty`}>
      <span className="hero-card__eyebrow eyebrow">{label}</span>
      <p className="hero-card__blurb">{hint}</p>
    </article>
  );
}

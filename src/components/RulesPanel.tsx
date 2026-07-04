import { useState } from 'react';
import { VIOLATIONS, TIERS } from '@shared/scoring';
import type { Config } from '../types';
import './rules-panel.css';

interface RulesPanelProps {
  config: Config;
}

/** Collapsible rules reference: violations table, tier ladder, weekly heal note. */
export function RulesPanel({ config }: RulesPanelProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <section className="rules panel">
      <h2 className="rules__heading">
        <button
          type="button"
          className="rules__toggle"
          aria-expanded={open}
          aria-controls="rules-body"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="rules__toggle-label">
            <span aria-hidden="true">📖</span> 计分规则
          </span>
          <span className={`rules__chevron${open ? ' rules__chevron--open' : ''}`} aria-hidden="true">
            ▾
          </span>
        </button>
      </h2>

      {open && (
        <div className="rules__body" id="rules-body">
          <p className="rules__heal">
            每位选手每周一（{config ? '本地时区' : ''}）自动恢复
            <strong className="rules__heal-num tabular"> +{config.weeklyHeal} </strong>
            分（上限 100）。守约加分每周最多
            <strong className="rules__heal-num tabular"> +{config.weeklyBonusCap} </strong>
            分。
          </p>

          <div className="rules__grid">
            <div className="rules__block">
              <h3 className="rules__block-title">违约 / 守约</h3>
              <table className="rules__table">
                <thead>
                  <tr>
                    <th scope="col">类型</th>
                    <th scope="col">说明</th>
                    <th scope="col" className="rules__num-col">
                      分数
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {VIOLATIONS.map((v) => {
                    const positive = v.delta > 0;
                    return (
                      <tr key={v.type}>
                        <th scope="row" className="rules__type">
                          <span aria-hidden="true">{v.emoji}</span> {v.label}
                        </th>
                        <td className="rules__desc">{v.desc}</td>
                        <td
                          className={`rules__delta tabular ${
                            positive ? 'rules__delta--up' : 'rules__delta--down'
                          }`}
                        >
                          {positive ? `+${v.delta}` : v.delta}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="rules__block">
              <h3 className="rules__block-title">信誉段位</h3>
              <ul className="rules__tiers">
                {TIERS.map((t) => (
                  <li key={t.name} className="rules__tier" style={{ ['--tier' as string]: t.color }}>
                    <span className="rules__tier-emoji" aria-hidden="true">
                      {t.emoji}
                    </span>
                    <span className="rules__tier-name">{t.name}</span>
                    <span className="rules__tier-range tabular">≥ {t.min}</span>
                    <span className="rules__tier-blurb">{t.blurb}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

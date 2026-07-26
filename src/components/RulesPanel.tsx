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

          <div className="rules__ai">
            <h3 className="rules__block-title">AI 怎么量刑</h3>
            <ol className="rules__steps">
              <li>裁判只写「发生了什么」，不用选类型 —— 一次可以记多个人。</li>
              <li>
                被记录的人有 <strong className="tabular">{config.statementWindowHours}</strong>{' '}
                小时说明情况，说与不说都会进入裁决。
              </li>
              <li>
                AI 先读裁判的描述、归到下面某个案由（此时被告还没开口，所以他无法影响
                自己被归成哪一类），拿不准就归到「其他」。
              </li>
              <li>
                AI 再在该案由的量刑区间内定分并写判词，提前告知、不可抗力、事后补偿从轻；
                失联、甩锅、短期重犯从重。
              </li>
              <li>
                无论 AI 输出什么，服务端都会校验案由、把分值夹回区间 —— 判罚不可能越界，
                也不可能变成加分；「团灭级放鸽」这种重罪还必须由人再确认一次。
                {!config.aiEnabled && ' 当前 AI 未启用，一律按基准分判罚。'}
              </li>
            </ol>
          </div>

          <div className="rules__grid">
            <div className="rules__block">
              <h3 className="rules__block-title">案由与量刑区间（AI 归类到其中之一）</h3>
              <table className="rules__table">
                <thead>
                  <tr>
                    <th scope="col">类型</th>
                    <th scope="col">说明</th>
                    <th scope="col" className="rules__num-col">
                      区间（基准）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {VIOLATIONS.map((v) => {
                    const positive = v.kind === 'bonus';
                    const fixed = v.min === v.max;
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
                          {fixed ? (
                            positive ? `+${v.base}` : v.base
                          ) : (
                            <>
                              {v.min} ~ {v.max}
                              <span className="rules__base">（{v.base}）</span>
                            </>
                          )}
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

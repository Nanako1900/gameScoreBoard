import { GUIDE_COMMANDS, GUIDE_INTRO, GUIDE_TIPS } from '@shared/guide';
import './guide-content.css';

/** Shared by the guide page and the final welcome step. */
export function GuideContent(): JSX.Element {
  return <div className="guide-content">
    <p>{GUIDE_INTRO}</p>
    <h3>常用命令</h3>
    <dl className="guide-content__commands">{GUIDE_COMMANDS.map((command) =>
      <div key={command.name}><dt><code>{command.name}</code></dt><dd>{command.text}</dd></div>)}</dl>
    <h3>使用提醒</h3>
    <ul>{GUIDE_TIPS.map((tip) => <li key={tip}>{tip}</li>)}</ul>
  </div>;
}

import type { InviteRow, PickerGroups } from '../lib/invitePicker';
import { Avatar } from './Avatar';
import './people-picker.css';

interface PeoplePickerProps {
  groups: PickerGroups; selected: readonly string[]; max: number; busy: boolean; onToggle: (id: string) => void;
  search?: { value: string; onChange: (value: string) => void };
  lineup?: { ids: readonly string[]; onPick: () => void };
}
const ROW_TAG = { in: '已在局里', out: '说了不来' } as const;
function PersonRow({ row, selected, locked, onToggle }: {
  row: InviteRow; selected: boolean; locked: boolean; onToggle: (id: string) => void;
}): JSX.Element {
  const off = row.state !== 'free';
  return <label className={`ppk__row${off ? ' ppk__row--off' : ''}`}>
    <input type="checkbox" checked={!off && selected} disabled={off || locked} onChange={() => onToggle(row.user.id)} />
    <Avatar name={row.user.username} src={row.user.avatar_url} size={24} /><span>{row.user.username}</span>
    {off && ' '}{row.state !== 'free' && <span className="ppk__tag">· {ROW_TAG[row.state]}</span>}
  </label>;
}
function PickerGroup({ label, rows, props }: { label: string; rows: InviteRow[]; props: PeoplePickerProps }): JSX.Element | null {
  if (!rows.length) return null;
  return <fieldset className="ppk__group"><legend>{label}</legend>{rows.map((row) => {
    const selected = props.selected.includes(row.user.id);
    return <PersonRow key={row.user.id} row={row} selected={selected} onToggle={props.onToggle}
      locked={props.busy || (props.selected.length >= props.max && !selected)} />;
  })}</fieldset>;
}
export function PeoplePicker(props: PeoplePickerProps): JSX.Element {
  return <div className="ppk">
    {props.search && <input className="ppk__search" type="search" aria-label="搜名字" value={props.search.value}
      onChange={(e) => props.search?.onChange(e.target.value)} disabled={props.busy} />}
    {!!props.lineup?.ids.length && <button type="button" className="btn btn--ghost" disabled={props.busy}
      onClick={props.lineup.onPick}>和上次一样</button>}
    <PickerGroup label="上次一起玩的" rows={props.groups.recent} props={props} />
    <PickerGroup label="在榜的" rows={props.groups.onBoard} props={props} />
    <PickerGroup label="其他朋友（未上榜，不参与计分）" rows={props.groups.others} props={props} />
    {props.selected.length >= props.max && <p className="ppk__cap">一次最多叫 {props.max} 人</p>}
  </div>;
}

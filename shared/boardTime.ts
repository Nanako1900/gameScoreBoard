// Labels for the board's fixed UTC offset. Pure and shared with the web.
const BEIJING_OFFSET_HOURS = 8;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 8 → '北京时间'; 0 → 'UTC'; 9 → 'UTC+9'; -5 → 'UTC-5'; 5.5 → 'UTC+5:30'; -3.5 → 'UTC-3:30'. */
export function boardTzLabel(offsetHours: number): string {
  if (offsetHours === BEIJING_OFFSET_HOURS) return '北京时间';
  if (offsetHours === 0) return 'UTC';
  const sign = offsetHours < 0 ? '-' : '+';
  const minutes = Math.round(Math.abs(offsetHours) * 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `UTC${sign}${hours}${rest === 0 ? '' : `:${pad2(rest)}`}`;
}

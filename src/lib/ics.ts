// Local calendar text only. User-written titles and notes are escaped as TEXT.
import { ICS_LINE_MAX_BYTES, MINUTE_MS } from './constants';
import { parseTimestamp } from './time';

export interface IcsEvent {
  uid: string;
  title: string;
  startsAt: string;
  durationMin: number;
  url: string;
  description?: string;
  alarmMin: number;
  now: number;
}

function textValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** A continuation's leading space counts towards the 75-octet physical line. */
function foldLine(value: string): string[] {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let line = '';
  let bytes = 0;
  for (const character of value) {
    const length = encoder.encode(character).length;
    if (bytes + length > ICS_LINE_MAX_BYTES) {
      lines.push(line);
      line = ' ';
      bytes = 1;
    }
    line += character;
    bytes += length;
  }
  return [...lines, line];
}

export function buildIcs(event: IcsEvent): string {
  const startsAt = parseTimestamp(event.startsAt);
  const description = [event.description, event.url].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EDG 信誉分//约局//ZH',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + textValue(event.uid), 'DTSTAMP:' + utcStamp(event.now),
    'DTSTART:' + utcStamp(startsAt), 'DTEND:' + utcStamp(startsAt + event.durationMin * MINUTE_MS),
    'SUMMARY:' + textValue(event.title), 'DESCRIPTION:' + textValue(description), 'URL:' + event.url,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + textValue(event.title + ' 快开局了'),
    'TRIGGER:-PT' + event.alarmMin + 'M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.flatMap(foldLine).join('\r\n') + '\r\n';
}

export function icsFileName(id: number): string {
  return 'edg-session-' + id + '.ics';
}

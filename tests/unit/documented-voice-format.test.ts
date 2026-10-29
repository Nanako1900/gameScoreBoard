import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOICE_GAP_NOTICE, voiceDuration, voiceInterval } from '../../shared/voicePresentation';
describe('voice format documentation matches the renderer', () => {
  it.each(['README.md', 'docs/CONTRACT.md'])('%s describes the current precision and evidence warning', file => {
    const content = readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    expect(content).toContain(voiceDuration(65));
    expect(content).toContain(voiceInterval('2026-10-27 12:14:05','2026-10-27 12:14:25',8,'2026-10-27'));
    expect(content).toContain(VOICE_GAP_NOTICE);
  });
});

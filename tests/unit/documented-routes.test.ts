import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS, TOOLS_TABS, settingsPath, toolsPath } from '../../src/lib/routes';
const NEW_DESTINATIONS = ['/cases', ...SETTINGS_TABS.map(settingsPath), ...TOOLS_TABS.map(tab => toolsPath(tab))];
describe('documented application destinations', () => {
  it.each(['README.md', 'docs/CONTRACT.md'])('%s lists every current settings and tools destination', file => {
    const content = readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    for (const destination of NEW_DESTINATIONS) expect(content, `${file}: ${destination}`).toContain('`' + destination + '`');
  });
});

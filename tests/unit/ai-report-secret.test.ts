import { afterEach, expect, it, vi } from 'vitest';
import { resolveAiConfig } from '../../worker/ai/config';
import { writeNarrative, type ReportStats } from '../../worker/ai/report';
const KEY = 'sk-fake-report-secret';
const stats: ReportStats = { weekStart: '2026-10-19', weekEnd: '2026-10-25', casesFiled: 0, totalPenalty: 0, absentVerdicts: 0, star: null, pigeon: null, bestTalker: null, harshest: null };
afterEach(() => vi.unstubAllGlobals());
it.each(['success', 'http', 'network'])('redacts report %s output', async (kind) => {
  const cfg = await resolveAiConfig(new Map(), { AI_BASE_URL: 'https://fake.example/v1', AI_MODEL: 'fake', AI_API_KEY: KEY });
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  if (kind === 'network') fetchMock.mockRejectedValue(new Error(KEY));
  else if (kind === 'http') fetchMock.mockResolvedValue(new Response(KEY, { status: 500 }));
  else fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: `周报 ${KEY}` } }] })));
  const result = await writeNarrative(cfg, stats);
  expect(result.source).toBe(kind === 'success' ? 'ai' : 'fallback');
  expect(JSON.stringify(result)).not.toContain(KEY);
  expect(JSON.stringify(result)).toContain('[已隐藏]');
});

it('redacts a full credential before truncating report HTTP errors', async () => {
  const cfg = await resolveAiConfig(new Map(), { AI_BASE_URL: 'https://fake.example/v1', AI_MODEL: 'fake', AI_API_KEY: KEY });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(185) + KEY, { status: 500 })));
  const result = await writeNarrative(cfg, stats);
  expect(result.error).toBe('HTTP 500: ' + 'x'.repeat(185) + '[已隐藏]');
});

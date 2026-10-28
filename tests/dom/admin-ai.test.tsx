import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { App } from '../../src/App';
import { AdminPage } from '../../src/components/AdminPage';
import type { AiConfigResponse, AiTestResponse, Config, User } from '../../src/types';

const ADMIN: User = { id: 'admin-a', username: '管理员', oauth_username: '管理员', avatar_url: null,
  is_admin: true, is_judge: false, is_participant: false, score: 100, created_at: '2026-10-01 00:00:00' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 15, statementWindowHours: 12, aiEnabled: true,
  maxBatchSubjects: 8, nextResetAt: '2099-11-01T16:00:00Z' };
const AI: AiConfigResponse = { enabled: true, base_url: 'https://example.test/v1', model: 'saved-model', temperature: 0.2,
  prompt: '量刑提示', classify_prompt: '归类提示 {{CATALOGUE}}', report_prompt: '战报提示', prompt_version: 'old-version',
  has_api_key: false, disabled_reason: '服务端尚未配置密钥', recent: { total: 42, fallbackRate: 0.25, clampRate: 0.05, avgLatencyMs: 321 } };
const TEST: AiTestResponse = { ok: false, source: 'fallback', verdict: { delta: -3, headline: '<img src=x> 原判', reasoning: '按基准分处理', factors: [] },
  error: '服务暂不可用', clamped: true, parsed_delta: -100, latency_ms: 87, raw: null };
function json(data: unknown, status = 200): Response { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) } as Response; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function page(me: User | null = ADMIN) { return <AdminPage me={me} config={CONFIG} tab="ai" onChanged={vi.fn()} />; }
function stubCore(me: User | null = ADMIN) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/config') return json(CONFIG);
    if (path === '/api/me') return json({ user: me, pending: { statements: 0, appeals: 0 } });
    if (path === '/api/leaderboard') return json({ participants: [] });
    if (path.startsWith('/api/records')) return json({ records: [] });
    if (path === '/api/report/latest') return json({ report: null });
    return json({ error: 'Not found' }, 404);
  }));
}
beforeEach(() => {
  stubCore();
  vi.spyOn(api, 'getAiConfig').mockResolvedValue(AI);
  vi.spyOn(api, 'updateAiConfig').mockResolvedValue({ ok: true, enabled: true, prompt_version: 'new-version' });
  vi.spyOn(api, 'testAiConfig').mockResolvedValue(TEST);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AI settings in the administration page', () => {
  it('opens the real address as a full page with three prompts and seven-day health', async () => {
    window.history.replaceState(null, '', '/admin/ai'); const { container } = render(<App />);
    expect(await screen.findByLabelText(/^Base URL/)).toHaveValue(AI.base_url);
    expect(screen.getByRole('heading', { level: 3, name: 'AI 裁判配置' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.app__main')).toHaveAttribute('hidden');
    const nav = screen.getByRole('navigation', { name: '管理' });
    expect(within(nav).getByRole('link', { name: 'AI 设置' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '语音记录' })).toHaveAttribute('href', '/admin/voice');
    for (const text of ['42', '25%', '5%', '321ms']) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/服务端尚未配置密钥/)).toBeInTheDocument();
    expect(screen.getByText(/后端环境变量.*AI_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByText(/wrangler secret/)).not.toBeInTheDocument();
    expect(container.querySelector('.admin-page')?.querySelector('style,[style]')).toBeNull();
  });
  it.each([null, { ...ADMIN, is_admin: false }, { ...ADMIN, is_admin: false, is_judge: true }])('refuses a non-admin before fetching AI: %o', async (me) => {
    render(page(me)); expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(api.getAiConfig).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });
  it('saves trimmed endpoint/model and every prompt, then reloads server stats and version', async () => {
    const user = userEvent.setup(); render(page()); await screen.findByLabelText(/^Base URL/);
    fireEvent.change(screen.getByLabelText(/^Base URL/), { target: { value: ' https://new.test/v1 ' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: ' new-model ' } });
    fireEvent.change(screen.getByLabelText(/^Temperature/), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('量刑'), { target: { value: '新量刑' } });
    await user.click(screen.getByRole('tab', { name: '归类' })); fireEvent.change(screen.getByLabelText('归类'), { target: { value: '新归类' } });
    await user.click(screen.getByRole('tab', { name: '周报' })); fireEvent.change(screen.getByLabelText('周报'), { target: { value: '新周报' } });
    await user.click(screen.getByRole('checkbox'));
    vi.mocked(api.getAiConfig).mockResolvedValue({ ...AI, model: 'new-model', prompt_version: 'new-version', recent: { ...AI.recent, total: 43 } });
    await user.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('已保存');
    expect(api.updateAiConfig).toHaveBeenCalledExactlyOnceWith({ enabled: false, base_url: 'https://new.test/v1', model: 'new-model',
      temperature: 0.4, prompt: '新量刑', classify_prompt: '新归类', report_prompt: '新周报' });
    expect(api.getAiConfig).toHaveBeenCalledTimes(2); expect(screen.getByText('vnew-version')).toBeInTheDocument(); expect(screen.getByText('43')).toBeInTheDocument();
  });
  it('omits blank endpoint and model fields instead of sending invalid empty values', async () => {
    render(page()); await screen.findByLabelText(/^Base URL/);
    fireEvent.change(screen.getByLabelText(/^Base URL/), { target: { value: '  ' } }); fireEvent.change(screen.getByLabelText('模型'), { target: { value: '' } });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' })); await screen.findByText('已保存');
    const patch = vi.mocked(api.updateAiConfig).mock.calls[0][0]; expect(patch).not.toHaveProperty('base_url'); expect(patch).not.toHaveProperty('model');
  });
  it('tests the saved configuration without submitting unsaved form values and renders escaped results', async () => {
    const { container } = render(page()); await screen.findByLabelText('模型');
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'unsaved-model' } });
    await userEvent.setup().click(screen.getByRole('button', { name: '用样例案试跑' }));
    expect(await screen.findByText(/回退到基准分/)).toBeInTheDocument(); expect(api.testAiConfig).toHaveBeenCalledExactlyOnceWith({});
    expect(api.updateAiConfig).not.toHaveBeenCalled(); expect(api.getAiConfig).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('模型')).toHaveValue('unsaved-model');
    expect(screen.getByText('<img src=x> 原判', { exact: false })).toBeInTheDocument(); expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('服务暂不可用')).toBeInTheDocument(); expect(screen.getByText(/超出区间已被夹回/)).toBeInTheDocument();
  });
  it('retries an ordinary load failure', async () => {
    vi.mocked(api.getAiConfig).mockRejectedValueOnce(new Error('network'));
    render(page()); expect(await screen.findByRole('alert')).toHaveTextContent('加载配置失败');
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByLabelText('模型')).toHaveValue(AI.model); expect(api.getAiConfig).toHaveBeenCalledTimes(2);
  });
  it('preserves edits when saving fails and does not claim success', async () => {
    vi.mocked(api.updateAiConfig).mockRejectedValueOnce(new api.ApiError('暂时不能保存', 500));
    render(page()); await screen.findByLabelText('模型'); fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'keep-me' } });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时不能保存'); expect(screen.getByLabelText('模型')).toHaveValue('keep-me'); expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });
  it.each([403, 404])('hides the whole AI entry when reading returns %s', async (status) => {
    vi.mocked(api.getAiConfig).mockRejectedValueOnce(new api.ApiError('private backend detail', status));
    render(page()); await screen.findByRole('heading', { name: '这页不存在' });
    expect(screen.queryByText('private backend detail')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'AI 设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });
  it.each(['保存', '用样例案试跑'])('conceals the old form when %s discovers lost permission', async (label) => {
    vi.mocked(api.updateAiConfig).mockRejectedValue(new api.ApiError('denied', 403));
    vi.mocked(api.testAiConfig).mockRejectedValue(new api.ApiError('gone', 404));
    render(page()); await screen.findByLabelText('模型'); await userEvent.setup().click(screen.getByRole('button', { name: label }));
    await screen.findByRole('heading', { name: '这页不存在' }); expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
  });
  it('ignores a previous account’s late config response', async () => {
    const old = deferred<AiConfigResponse>(); vi.mocked(api.getAiConfig).mockReturnValueOnce(old.promise).mockResolvedValue({ ...AI, model: 'new-account' });
    const view = render(page()); view.rerender(page({ ...ADMIN, id: 'admin-b' }));
    expect(await screen.findByLabelText('模型')).toHaveValue('new-account');
    await act(async () => old.resolve(AI)); expect(screen.getByLabelText('模型')).toHaveValue('new-account');
  });
  it('clears the old account immediately and ignores its pending save, including the reload', async () => {
    const saved = deferred<{ ok: true; enabled: boolean; prompt_version: string }>(); const next = deferred<AiConfigResponse>();
    vi.mocked(api.updateAiConfig).mockReturnValue(saved.promise);
    const view = render(page()); await screen.findByLabelText('模型'); await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    vi.mocked(api.getAiConfig).mockReturnValue(next.promise); view.rerender(page({ ...ADMIN, id: 'admin-b' }));
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
    await act(async () => saved.resolve({ ok: true, enabled: true, prompt_version: 'late-old-version' }));
    expect(api.getAiConfig).toHaveBeenCalledTimes(2); expect(screen.queryByText('已保存')).not.toBeInTheDocument();
    await act(async () => next.resolve({ ...AI, model: 'admin-b-model' })); expect(screen.getByLabelText('模型')).toHaveValue('admin-b-model');
  });
  it('removes private settings immediately on role loss and ignores a late test result', async () => {
    const tested = deferred<AiTestResponse>(); vi.mocked(api.testAiConfig).mockReturnValue(tested.promise);
    const view = render(page()); await screen.findByLabelText('模型'); await userEvent.setup().click(screen.getByRole('button', { name: '用样例案试跑' }));
    view.rerender(page({ ...ADMIN, is_admin: false, is_judge: true }));
    expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument(); expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
    await act(async () => tested.resolve(TEST)); expect(screen.queryByText(/回退到基准分/)).not.toBeInTheDocument();
  });
});

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
  error: '服务暂不可用', clamped: true, parsed_delta: -100, latency_ms: 87 };
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
    await userEvent.setup().click(screen.getByRole('button', { name: '用样例案试跑' }));
    expect(await screen.findByText(/回退到基准分/)).toBeInTheDocument(); expect(api.testAiConfig).toHaveBeenCalledExactlyOnceWith({});
    expect(api.updateAiConfig).not.toHaveBeenCalled(); expect(api.getAiConfig).toHaveBeenCalledOnce();
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


const MANAGED_AI: AiConfigResponse = { ...AI, has_api_key: true, disabled_reason: null,
  configured_enabled: true, api_key_source: 'database', can_update_api_key: true };

describe('administrator-managed AI credentials', () => {
  beforeEach(() => { vi.mocked(api.getAiConfig).mockResolvedValue(MANAGED_AI); });
  async function replacement() {
    const user = userEvent.setup();
    render(page()); await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '更换 API Key' }));
    return user;
  }
  it.each([
    { source: 'database', label: '数据库', has: true },
    { source: 'environment', label: '环境变量', has: true },
    { source: 'none', label: '无', has: false },
  ] as const)('shows credential status and source for $source', async ({ source, label, has }) => {
    vi.mocked(api.getAiConfig).mockResolvedValue({ ...MANAGED_AI, api_key_source: source, has_api_key: has });
    render(page()); await screen.findByLabelText('模型');
    expect(screen.getByText(`API Key：${has ? '已设置' : '未设置'}`)).toBeInTheDocument();
    expect(screen.getByText(`来源：${label}`)).toBeInTheDocument();
    expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
  });
  it('keeps configured enablement when the effective service is disabled and ordinary save omits the key', async () => {
    vi.mocked(api.getAiConfig).mockResolvedValue({ ...MANAGED_AI, enabled: false, has_api_key: false });
    render(page()); await screen.findByLabelText('模型');
    expect(screen.getByRole('checkbox')).toBeChecked();
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' })); await screen.findByText('已保存');
    expect(vi.mocked(api.updateAiConfig).mock.calls[0][0]).toMatchObject({ enabled: true });
    expect(vi.mocked(api.updateAiConfig).mock.calls[0][0]).not.toHaveProperty('api_key');
  });
  it('submits a trimmed replacement only after explicit replacement and clears the password after success', async () => {
    const user = await replacement(); const input = screen.getByLabelText('新 API Key');
    expect(input).toHaveAttribute('type', 'password'); expect(input).toHaveAttribute('autocomplete', 'new-password'); expect(input).toHaveValue('');
    await user.type(input, ' synthetic-ui-key ');
    await user.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('已保存');
    expect(vi.mocked(api.updateAiConfig).mock.calls[0][0]).toMatchObject({ api_key: 'synthetic-ui-key' });
    expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '更换 API Key' })); expect(screen.getByLabelText('新 API Key')).toHaveValue('');
  });
  it('requires two steps to clear and cancellation restores the trigger focus without writing', async () => {
    const user = userEvent.setup(); render(page()); await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '清除 API Key' }));
    expect(api.updateAiConfig).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: '清除 API Key？' })).toHaveTextContent('停止 AI');
    await user.click(screen.getByRole('button', { name: '保留 Key' }));
    expect(screen.getByRole('button', { name: '清除 API Key' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '清除 API Key' }));
    await user.click(screen.getByRole('button', { name: '确认清除' })); await screen.findByText('已保存');
    expect(vi.mocked(api.updateAiConfig).mock.calls[0][0]).toMatchObject({ api_key: null });
  });
  it('disables replacement without deployment master key but still clears unreadable database credentials', async () => {
    vi.mocked(api.getAiConfig).mockResolvedValue({ ...MANAGED_AI, has_api_key: false, can_update_api_key: false });
    const user = userEvent.setup(); render(page()); await screen.findByLabelText('模型');
    expect(screen.getByRole('button', { name: '更换 API Key' })).toBeDisabled();
    expect(screen.getByText(/一次性.*AI_CONFIG_MASTER_KEY.*app.*bot/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '清除 API Key' })); await user.click(screen.getByRole('button', { name: '确认清除' }));
    await screen.findByText('已保存'); expect(vi.mocked(api.updateAiConfig).mock.calls[0][0]).toMatchObject({ api_key: null });
  });
  it('does not offer credential writes against old backends', async () => {
    vi.mocked(api.getAiConfig).mockResolvedValue(AI); render(page()); await screen.findByLabelText('模型');
    expect(screen.queryByRole('button', { name: /更换 API Key|设置 API Key|清除 API Key/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
  it.each(['', '   ', 'synthetic\0key', 'k'.repeat(4097)])('blocks invalid replacement %j before sending', async (value) => {
    const user = await replacement();
    fireEvent.change(screen.getByLabelText('新 API Key'), { target: { value } });
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('API Key'); expect(api.updateAiConfig).not.toHaveBeenCalled();
  });
  it.each(['\nsynthetic-key', 'synthetic-key\r', 'synthetic\nkey'])('rejects raw clipboard line breaks before password input sanitization', async (value) => {
    const user = await replacement(); await user.click(screen.getByLabelText('新 API Key')); await user.paste(value);
    expect(await screen.findByRole('alert')).toHaveTextContent('API Key');
    expect(screen.getByLabelText('新 API Key')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: '保存' })); expect(api.updateAiConfig).not.toHaveBeenCalled();
  });
  it('clears failed replacement while keeping ordinary edits for retry', async () => {
    vi.mocked(api.updateAiConfig).mockRejectedValueOnce(new api.ApiError('保存暂不可用', 500));
    const user = await replacement(); await user.type(screen.getByLabelText('新 API Key'), 'synthetic-key');
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'keep-edits' } });
    await user.click(screen.getByRole('button', { name: '保存' })); await screen.findByRole('alert');
    expect(screen.getByLabelText('模型')).toHaveValue('keep-edits');
    expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '更换 API Key' })); expect(screen.getByLabelText('新 API Key')).toHaveValue('');
  });
  it('reports a committed write separately from refresh failure and never repeats the write', async () => {
    const user = await replacement(); await user.type(screen.getByLabelText('新 API Key'), 'synthetic-key');
    vi.mocked(api.getAiConfig).mockRejectedValueOnce(new Error('refresh offline'));
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('修改已保存，状态刷新失败')).toBeInTheDocument();
    expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(api.updateAiConfig).toHaveBeenCalledOnce(); expect(await screen.findByLabelText('模型')).toHaveValue(AI.model);
  });
  it.each(['model', 'key'])('blocks saved-only testing with dirty %s form', async (field) => {
    const user = await replacement();
    if (field === 'key') await user.type(screen.getByLabelText('新 API Key'), 'synthetic-key');
    else fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'unsaved-model' } });
    await user.click(screen.getByRole('button', { name: '用样例案试跑' }));
    expect(await screen.findByText('请先保存配置，再试跑')).toBeInTheDocument();
    expect(api.testAiConfig).not.toHaveBeenCalled(); expect(api.updateAiConfig).not.toHaveBeenCalled();
  });
  it('clears password immediately on account change and ignores a pending save', async () => {
    const saved = deferred<{ ok: true; enabled: boolean; prompt_version: string }>();
    vi.mocked(api.updateAiConfig).mockReturnValueOnce(saved.promise);
    const user = userEvent.setup(); const view = render(page()); await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '更换 API Key' })); await user.type(screen.getByLabelText('新 API Key'), 'synthetic-key');
    await user.click(screen.getByRole('button', { name: '保存' })); view.rerender(page({ ...ADMIN, id: 'admin-b' }));
    await screen.findByLabelText('模型'); expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    await act(async () => saved.resolve({ ok: true, enabled: true, prompt_version: 'late' }));
    expect(api.getAiConfig).toHaveBeenCalledTimes(2); expect(screen.queryByText('已保存')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '更换 API Key' })); expect(screen.getByLabelText('新 API Key')).toHaveValue('');
  });
  it('erases the detached password element on unmount and ignores the pending write', async () => {
    const saved = deferred<{ ok: true; enabled: boolean; prompt_version: string }>();
    vi.mocked(api.updateAiConfig).mockReturnValueOnce(saved.promise);
    const user = userEvent.setup(); const view = render(page()); await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '更换 API Key' }));
    const input = screen.getByLabelText('新 API Key'); await user.type(input, 'synthetic-key');
    await user.click(screen.getByRole('button', { name: '保存' })); view.unmount();
    expect(input).toHaveValue('');
    await act(async () => saved.resolve({ ok: true, enabled: true, prompt_version: 'late' }));
    expect(api.getAiConfig).toHaveBeenCalledOnce();
  });
  it('erases a committed password before a slow status refresh completes', async () => {
    const refreshed = deferred<AiConfigResponse>(); const user = await replacement();
    const input = screen.getByLabelText('新 API Key'); await user.type(input, 'synthetic-key');
    vi.mocked(api.getAiConfig).mockReturnValueOnce(refreshed.promise);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(input).toHaveValue(''); expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    await act(async () => refreshed.resolve(MANAGED_AI));
    expect(screen.getByText('已保存')).toBeInTheDocument();
  });
  it('clears password on permission loss and ignores a pending credential write', async () => {
    const saved = deferred<{ ok: true; enabled: boolean; prompt_version: string }>(); vi.mocked(api.updateAiConfig).mockReturnValueOnce(saved.promise);
    const user = userEvent.setup(); const view = render(page()); await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '更换 API Key' })); await user.type(screen.getByLabelText('新 API Key'), 'synthetic-key');
    await user.click(screen.getByRole('button', { name: '保存' })); view.rerender(page({ ...ADMIN, is_admin: false }));
    expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    await act(async () => saved.resolve({ ok: true, enabled: true, prompt_version: 'late' }));
    expect(api.getAiConfig).toHaveBeenCalledOnce(); expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
  });
});

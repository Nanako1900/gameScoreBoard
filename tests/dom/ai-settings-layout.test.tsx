import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { AiSettings } from '../../src/components/AiSettings';
import type { AiConfigResponse } from '../../src/types';

const AI: AiConfigResponse = {
  enabled: true, configured_enabled: true, base_url: 'https://saved.test/v1', model: 'saved-model',
  temperature: 0.2, prompt: '量刑提示', classify_prompt: '归类提示', report_prompt: '战报提示',
  prompt_version: 'saved-version', has_api_key: true, api_key_source: 'database', can_update_api_key: true,
  disabled_reason: null, recent: { total: 42, fallbackRate: 0.25, clampRate: 0.05, avgLatencyMs: 321 },
};

beforeEach(() => {
  vi.spyOn(api, 'getAiConfig').mockResolvedValue(AI);
  vi.spyOn(api, 'updateAiConfig').mockResolvedValue({ ok: true, enabled: true, prompt_version: 'next-version' });
  vi.spyOn(api, 'testAiConfig').mockResolvedValue({ ok: true, source: 'ai',
    verdict: { delta: -3, headline: '样例结果', reasoning: '按基准分', factors: [] },
    error: null, latency_ms: 80, clamped: false, parsed_delta: -3 });
});
afterEach(() => vi.restoreAllMocks());

function advanced(): HTMLDetailsElement {
  return screen.getByText('高级参数与提示词', { selector: 'summary' }).closest('details')!;
}
function statistics(): HTMLDetailsElement {
  return screen.getByText('运行统计', { selector: 'summary' }).closest('details')!;
}

describe('AI settings layout in the consolidated settings page', () => {
  it('puts connection and credentials first, with advanced fields and the existing four statistics folded', async () => {
    const { container } = render(<AiSettings collapsedAdvanced />);
    const endpoint = await screen.findByLabelText(/^Base URL/);
    const model = screen.getByLabelText('模型');
    const credentials = screen.getByText('API Key：已设置');
    const advancedDetails = advanced();
    const stats = statistics();
    expect(advancedDetails).not.toHaveAttribute('open');
    expect(stats).not.toHaveAttribute('open');
    expect(screen.getByLabelText(/^Temperature/)).not.toBeVisible();
    expect(screen.getByLabelText('量刑')).not.toBeVisible();
    expect(screen.getByText('42')).not.toBeVisible();
    expect(endpoint.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(model.compareDocumentPosition(credentials) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(credentials.compareDocumentPosition(advancedDetails) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(advancedDetails.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(container.querySelector('style, [style]')).toBeNull();
    const user = userEvent.setup();
    await user.click(within(advancedDetails).getByText('高级参数与提示词', { selector: 'summary' }));
    expect(screen.getByLabelText(/^Temperature/)).toBeVisible();
    for (const name of ['量刑', '归类', '周报']) expect(screen.getByRole('tab', { name })).toBeVisible();
    await user.click(within(stats).getByText('运行统计', { selector: 'summary' }));
    for (const value of ['42', '25%', '5%', '321ms']) expect(screen.getByText(value)).toBeVisible();
  });

  it('keeps legacy direct callers expanded by default', async () => {
    render(<AiSettings />);
    await screen.findByLabelText('模型');
    expect(advanced()).toHaveAttribute('open');
    expect(statistics()).toHaveAttribute('open');
    expect(screen.getByLabelText(/^Temperature/)).toBeVisible();
    expect(screen.getByRole('tab', { name: '量刑' })).toBeVisible();
    expect(screen.getByText('42')).toBeVisible();
  });

  it('reports ordinary edits and becomes clean when they are restored', async () => {
    const changed = vi.fn();
    render(<AiSettings onDirtyChange={changed} collapsedAdvanced />);
    const model = await screen.findByLabelText('模型');
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
    fireEvent.change(model, { target: { value: 'draft-model' } });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(true));
    fireEvent.change(model, { target: { value: AI.model } });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
  });

  it('treats key replacement as unsaved without serializing the password, and cancels cleanly', async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<AiSettings onDirtyChange={changed} collapsedAdvanced />);
    await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '更换 API Key' }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(true));
    const password = screen.getByLabelText('新 API Key');
    await user.type(password, 'synthetic-layout-secret');
    expect(container.innerHTML).not.toContain('synthetic-layout-secret');
    expect(JSON.stringify(localStorage)).not.toContain('synthetic-layout-secret');
    expect(JSON.stringify(sessionStorage)).not.toContain('synthetic-layout-secret');
    await user.click(screen.getByRole('button', { name: '取消更换' }));
    expect(password).toHaveValue('');
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
  });

  it('keeps failed ordinary edits dirty while clearing the submitted password', async () => {
    const changed = vi.fn();
    vi.mocked(api.updateAiConfig).mockRejectedValueOnce(new api.ApiError('保存暂不可用', 500));
    render(<AiSettings onDirtyChange={changed} collapsedAdvanced />);
    const model = await screen.findByLabelText('模型');
    fireEvent.change(model, { target: { value: 'keep-this-edit' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '更换 API Key' }));
    const password = screen.getByLabelText('新 API Key');
    await user.type(password, 'synthetic-layout-secret');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存暂不可用');
    expect(model).toHaveValue('keep-this-edit');
    expect(password).toHaveValue('');
    expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(true));
  });

  it('uses the committed form snapshot as the clean baseline when refreshing after save fails', async () => {
    const changed = vi.fn();
    render(<AiSettings onDirtyChange={changed} collapsedAdvanced />);
    const model = await screen.findByLabelText('模型');
    fireEvent.change(model, { target: { value: '  committed-model  ' } });
    fireEvent.change(screen.getByLabelText(/^Base URL/), { target: { value: ' https://new.test/v1 ' } });
    vi.mocked(api.getAiConfig).mockRejectedValueOnce(new Error('refresh offline'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('修改已保存，状态刷新失败')).toBeInTheDocument();
    expect(model).toHaveValue('  committed-model  ');
    expect(api.updateAiConfig).toHaveBeenCalledOnce();
    expect(vi.mocked(api.updateAiConfig).mock.calls[0][0]).toMatchObject({ model: 'committed-model', base_url: 'https://new.test/v1' });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
    await user.click(screen.getByRole('button', { name: '用样例案试跑' }));
    await waitFor(() => expect(api.testAiConfig).toHaveBeenCalledExactlyOnceWith({}));
    expect(api.updateAiConfig).toHaveBeenCalledOnce();
  });

  it('still detects new edits after a committed write whose refresh failed', async () => {
    const changed = vi.fn();
    render(<AiSettings onDirtyChange={changed} />);
    const model = await screen.findByLabelText('模型');
    fireEvent.change(model, { target: { value: 'committed-model' } });
    vi.mocked(api.getAiConfig).mockRejectedValueOnce(new Error('refresh offline'));
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('修改已保存，状态刷新失败');
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
    fireEvent.change(model, { target: { value: 'next-draft' } });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(true));
  });

  it('uses the latest callback without resetting dirty state on parent rerender, and releases it on unmount', async () => {
    const first = vi.fn();
    const next = vi.fn();
    const view = render(<AiSettings onDirtyChange={first} />);
    const model = await screen.findByLabelText('模型');
    fireEvent.change(model, { target: { value: 'unsaved-model' } });
    await waitFor(() => expect(first).toHaveBeenLastCalledWith(true));
    const count = first.mock.calls.length;
    view.rerender(<AiSettings onDirtyChange={next} />);
    expect(first).toHaveBeenCalledTimes(count);
    expect(next).not.toHaveBeenCalled();
    fireEvent.change(model, { target: { value: AI.model } });
    await waitFor(() => expect(next).toHaveBeenLastCalledWith(false));
    fireEvent.change(model, { target: { value: 'new-unsaved-model' } });
    await waitFor(() => expect(next).toHaveBeenLastCalledWith(true));
    view.unmount();
    expect(next).toHaveBeenLastCalledWith(false);
  });
});

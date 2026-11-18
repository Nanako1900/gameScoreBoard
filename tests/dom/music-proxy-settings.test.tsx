import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MusicBotSettingsGroup, MusicProxySettings } from '../../src/components/MusicProxySettings';
import type { MusicProxyView } from '../../shared/music';
import { json } from './music-fixtures';

const PROXY = '/api/admin/community/music/proxy';
const SECRET_URL = 'socks5://user:hunter2@proxy.example.com:1080';
let current: MusicProxyView = { configured: true, host: 'proxy.example.com:1080', audio: false, available: true };

function bodies(): Array<Record<string, unknown>> {
  return vi.mocked(fetch).mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url, init]) => ({ path: String(url), ...(JSON.parse(String(init?.body)) as object) }));
}

beforeEach(() => {
  current = { configured: true, host: 'proxy.example.com:1080', audio: false, available: true };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === `${PROXY}/test`) return json({ ok: true, message: '代理连接正常，延迟 120 毫秒' });
    if (path === PROXY && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { url: string | null; audio: boolean };
      current = body.url === null
        ? { configured: false, host: null, audio: false, available: true }
        : { configured: true, host: 'new.example.com:1080', audio: body.audio, available: true };
      return json(current);
    }
    return json(current);
  }));
});

describe('MusicProxySettings', () => {
  it('shows the configured host only, never a full address, and never prefills the input', async () => {
    render(<MusicProxySettings />);
    expect(await screen.findByText('proxy.example.com:1080')).toBeInTheDocument();
    expect(screen.getByLabelText('新的代理地址')).toHaveValue('');
    expect(document.body.textContent).not.toMatch(/socks5:\/\/\S+@/);
  });

  it('saves a new address with the audio flag and clears the field afterwards', async () => {
    render(<MusicProxySettings />);
    fireEvent.change(await screen.findByLabelText('新的代理地址'), { target: { value: SECRET_URL } });
    fireEvent.click(screen.getByRole('checkbox', { name: '音频也走代理' }));
    fireEvent.click(screen.getByRole('button', { name: '保存代理' }));
    expect(await screen.findByText('new.example.com:1080')).toBeInTheDocument();
    expect(bodies()[0]).toMatchObject({ path: PROXY, url: SECRET_URL, audio: true });
    expect(screen.getByLabelText('新的代理地址')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: '音频也走代理' })).toBeChecked();
    expect(document.body.textContent).not.toContain('hunter2');
  });

  it('saves only the audio switch when the address is left empty', async () => {
    render(<MusicProxySettings />);
    const save = await screen.findByRole('button', { name: '保存代理' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '音频也走代理' }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await screen.findByText('代理设置已保存，可点「测试连接」确认可用。');
    expect(bodies()[0]).toMatchObject({ path: PROXY, audio: true });
    expect(bodies()[0]).not.toHaveProperty('url');
  });

  it('rejects an address that is not a socks address without calling the server', async () => {
    render(<MusicProxySettings />);
    fireEvent.change(await screen.findByLabelText('新的代理地址'), { target: { value: 'http://proxy:8080' } });
    fireEvent.click(screen.getByRole('button', { name: '保存代理' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('socks5://');
    expect(bodies()).toHaveLength(0);
  });

  it('clears the proxy', async () => {
    render(<MusicProxySettings />);
    fireEvent.click(await screen.findByRole('button', { name: '清除代理' }));
    expect(await screen.findByText('尚未配置代理，网易云请求将直接连接。')).toBeInTheDocument();
    expect(bodies()[0]).toMatchObject({ url: null, audio: false });
  });

  it('shows the connection test result', async () => {
    render(<MusicProxySettings />);
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }));
    expect(await screen.findByText('代理连接正常，延迟 120 毫秒')).toBeInTheDocument();
    expect(bodies()[0].path).toBe(`${PROXY}/test`);
  });

  it('reports a failed test as an alert', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).endsWith('/test') ? json({ ok: false, message: '出口代理不可用' }) : json(current));
    render(<MusicProxySettings />);
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('出口代理不可用');
  });

  it('disables everything and explains when the master key is missing', async () => {
    current = { configured: false, host: null, audio: false, available: false };
    render(<MusicProxySettings />);
    expect(await screen.findByText(/服务器未配置主密钥/)).toBeInTheDocument();
    expect(screen.getByLabelText('新的代理地址')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '音频也走代理' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存代理' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
  });

  it('shows a save error without echoing the typed address', async () => {
    render(<MusicProxySettings />);
    fireEvent.change(await screen.findByLabelText('新的代理地址'), { target: { value: SECRET_URL } });
    vi.mocked(fetch).mockImplementation(async (_input, init) =>
      init?.method === 'POST' ? json({ error: '代理地址格式无效' }, 400) : json(current));
    fireEvent.click(screen.getByRole('button', { name: '保存代理' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('代理地址格式无效');
    await waitFor(() => expect(screen.getByRole('button', { name: '保存代理' })).toBeEnabled());
  });

  it('says so when the backend has no music settings', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ error: 'Not found' }, 404));
    render(<MusicProxySettings />);
    expect(await screen.findByText('当前服务暂未提供音乐机器人设置。')).toBeInTheDocument();
  });
});

describe('MusicBotSettingsGroup', () => {
  it('is a collapsible 音乐机器人 group that reads settings only once opened', async () => {
    render(<MusicBotSettingsGroup />);
    expect(screen.getByRole('heading', { name: '音乐机器人' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    const details = document.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(await screen.findByText('proxy.example.com:1080')).toBeInTheDocument();
  });
});

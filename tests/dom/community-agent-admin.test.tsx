import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../src/api';
import { CommunityAgentAdmin } from '../../src/components/CommunityAgentAdmin';
import { communityAgentApi } from '../../src/community-agent-api';

vi.mock('../../src/community-agent-api', () => ({ communityAgentApi: { read: vi.fn(), save: vi.fn(), saveDocument: vi.fn(), deleteDocument: vi.fn() } }));
const channelRef = '11111111-1111-4111-8111-111111111111';
const documentRef = '22222222-2222-4222-8222-222222222222';
function data() { return {
  settings: { enabled: false, channelRefs: [channelRef], userDailyLimit: 20, guildDailyLimit: 200, cooldownSeconds: 10 },
  version: 3, knowledgeVersion: 1, documents: [{ ref: documentRef, title: '入服须知', content: '请先阅读服务器规则。', published: true, version: 2, updatedAt: '2026-11-03T10:00:00Z' }],
  usage: { day: '2026-11-03', total: 2 }, requests: [], provider: { ready: true, reason: null },
}; }
const resources = [{ ref: channelRef, name: '问答频道', kind: 'text' as const, available: true }];
async function open() { await userEvent.click(screen.getByText('AI 助理与社区资料')); await screen.findByLabelText('启用 AI 助理'); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(communityAgentApi.read).mockResolvedValue(data()); });

describe('community agent administration', () => {
  it('loads the independent settings only when opened and explains public answers and binding', async () => {
    render(<CommunityAgentAdmin resources={resources}/>);
    expect(communityAgentApi.read).not.toHaveBeenCalled();
    await open();
    expect(screen.getByText(/先绑定 Nanako/)).toBeInTheDocument();
    expect(screen.getByText(/频道内可见/)).toBeInTheDocument();
    expect(screen.getByLabelText('启用 AI 助理')).not.toBeChecked();
    expect(screen.getByText('入服须知')).toBeInTheDocument();
  });
  it('saves its own switch and channel refs without saving unrelated community settings', async () => {
    const saved = data(); saved.settings.enabled = true; saved.version++;
    vi.mocked(communityAgentApi.save).mockResolvedValue(saved);
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    await userEvent.click(screen.getByLabelText('启用 AI 助理'));
    await userEvent.click(screen.getByRole('button', { name: '保存 AI 助理设置' }));
    await waitFor(() => expect(communityAgentApi.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, channelRefs: [channelRef] }), 3));
    expect(await screen.findByText('AI 助理设置已保存。')).toBeInTheDocument();
  });
  it('keeps an empty daily limit invalid instead of converting it to zero', async () => {
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    fireEvent.change(screen.getByLabelText('每人每日上限'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: '保存 AI 助理设置' }));
    expect(communityAgentApi.save).not.toHaveBeenCalled(); expect(await screen.findByRole('alert')).toHaveTextContent('每人每日上限');
    expect(screen.getByLabelText('每人每日上限')).toHaveValue(null);
  });
  it('starts a new document as a draft and explicitly publishes the supplied text', async () => {
    const saved = data(); saved.knowledgeVersion++;
    vi.mocked(communityAgentApi.saveDocument).mockResolvedValue(saved);
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    await userEvent.click(screen.getByRole('button', { name: '新增资料' }));
    expect(screen.getByLabelText('发布到 AI 问答')).not.toBeChecked();
    await userEvent.type(screen.getByLabelText('资料标题'), '如何创建房间');
    await userEvent.type(screen.getByLabelText('资料正文'), '进入创建房间的语音入口即可。');
    await userEvent.click(screen.getByLabelText('发布到 AI 问答'));
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(communityAgentApi.saveDocument).toHaveBeenCalledWith({ ref: expect.any(String), title: '如何创建房间', content: '进入创建房间的语音入口即可。', published: true, expectedVersion: 0 }));
    expect(await screen.findByText('资料已保存。')).toBeInTheDocument();
  });
  it('retains document edits on a version conflict and can stop publishing an existing document', async () => {
    vi.mocked(communityAgentApi.saveDocument).mockRejectedValue(new ApiError('资料已更新，请重新加载', 409));
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    await userEvent.click(screen.getByRole('button', { name: '编辑 入服须知' }));
    await userEvent.click(screen.getByLabelText('发布到 AI 问答'));
    await userEvent.type(screen.getByLabelText('资料正文'), ' 请遵守规则。');
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('资料已更新');
    expect(screen.getByLabelText('资料正文')).toHaveValue('请先阅读服务器规则。 请遵守规则。');
    expect(communityAgentApi.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ ref: documentRef, published: false, expectedVersion: 2 }));
  });
  it('discards private draft state and reports permission loss to the containing page', async () => {
    const unavailable = vi.fn();
    vi.mocked(communityAgentApi.saveDocument).mockRejectedValue(new ApiError('需要管理员权限', 403));
    render(<CommunityAgentAdmin resources={resources} onUnavailable={unavailable}/>); await open();
    await userEvent.click(screen.getByRole('button', { name: '编辑 入服须知' }));
    await userEvent.type(screen.getByLabelText('资料正文'), ' 未保存内容');
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })));
    expect(screen.queryByDisplayValue(/未保存内容/)).not.toBeInTheDocument();
  });
  it('isolates an older backend 404 without affecting room management', async () => {
    vi.mocked(communityAgentApi.read).mockRejectedValue(new ApiError('内容不存在', 404));
    const unavailable = vi.fn(); render(<CommunityAgentAdmin resources={resources} onUnavailable={unavailable}/>);
    await userEvent.click(screen.getByText('AI 助理与社区资料'));
    expect(await screen.findByText(/当前后端暂不支持 AI 助理/)).toBeInTheDocument();
    expect(unavailable).not.toHaveBeenCalled();
  });
  it('reports unsaved changes to the shared departure guard', async () => {
    const dirty = vi.fn(); render(<CommunityAgentAdmin resources={resources} onDirtyChange={dirty}/>); await open();
    await userEvent.click(screen.getByRole('button', { name: '新增资料' }));
    await userEvent.type(screen.getByLabelText('资料标题'), '还未保存');
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  });
  it('preserves unsaved document edits when its section is collapsed and reopened', async () => {
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    await userEvent.click(screen.getByRole('button', { name: '编辑 入服须知' }));
    await userEvent.type(screen.getByLabelText('资料标题'), ' 尚未保存');
    await userEvent.click(screen.getByText('AI 助理与社区资料'));
    await userEvent.click(screen.getByText('AI 助理与社区资料'));
    expect(await screen.findByLabelText('资料标题')).toHaveValue('入服须知 尚未保存');
    expect(communityAgentApi.read).toHaveBeenCalledTimes(1);
  });
  it('does not silently advance the version of an unsaved configuration after saving a document', async () => {
    const newer = data(); newer.version = 4; newer.settings.userDailyLimit = 50;
    vi.mocked(communityAgentApi.saveDocument).mockResolvedValue(newer);
    vi.mocked(communityAgentApi.save).mockRejectedValue(new ApiError('设置已更新，请重新加载', 409));
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    await userEvent.click(screen.getByLabelText('启用 AI 助理'));
    await userEvent.click(screen.getByRole('button', { name: '编辑 入服须知' }));
    await userEvent.type(screen.getByLabelText('资料正文'), ' 更多信息');
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }));
    await screen.findByText('资料已保存。');
    await userEvent.click(screen.getByRole('button', { name: '保存 AI 助理设置' }));
    await waitFor(() => expect(communityAgentApi.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, userDailyLimit: 20 }), 3));
    expect(await screen.findByRole('alert')).toHaveTextContent('设置已更新');
  });
  it('requires a concrete confirmation before removing a published document', async () => {
    vi.mocked(communityAgentApi.deleteDocument).mockResolvedValue({ ...data(), documents: [] });
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    await userEvent.click(screen.getByRole('button', { name: '删除 入服须知' }));
    expect(communityAgentApi.deleteDocument).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(communityAgentApi.deleteDocument).toHaveBeenCalledWith(documentRef, 2));
    expect(await screen.findByText('资料已删除。')).toBeInTheDocument();
  });
  it('does not let an old reload confirmation strand a pending save in the disabled state', async () => {
    let finish!: (value: ReturnType<typeof data>) => void;
    vi.mocked(communityAgentApi.save).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<CommunityAgentAdmin resources={resources}/>); await open();
    await userEvent.click(screen.getByLabelText('启用 AI 助理'));
    await userEvent.click(screen.getByRole('button', { name: '刷新 AI 助理与资料' }));
    await screen.findByRole('button', { name: '放弃并刷新' });
    await userEvent.click(screen.getByRole('button', { name: '保存 AI 助理设置' }));
    const discard = screen.queryByRole('button', { name: '放弃并刷新' });
    if (discard) await userEvent.click(discard);
    const saved = data(); saved.settings.enabled = true; saved.version++;
    finish(saved);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存 AI 助理设置' })).not.toBeDisabled());
    expect(communityAgentApi.read).toHaveBeenCalledTimes(1);
  });
});

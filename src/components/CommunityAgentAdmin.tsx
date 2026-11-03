import { useEffect, useRef, useState } from 'react';
import type { AgentAdminData, AgentDocument, AgentSettings } from '@shared/community-agent';
import type { CommunityResourceView } from '@shared/community';
import { ApiError } from '../api';
import { communityAgentApi, type AgentDocumentSave } from '../community-agent-api';
import { ConfirmInline } from './ConfirmInline';
import { Link } from './Link';

interface Props {
  resources: CommunityResourceView[];
  onUnavailable?: (error: ApiError) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
type Numbers = Record<'userDailyLimit' | 'guildDailyLimit' | 'cooldownSeconds', string>;
const numbersFor = (settings: AgentSettings): Numbers => ({ userDailyLimit: String(settings.userDailyLimit), guildDailyLimit: String(settings.guildDailyLimit), cooldownSeconds: String(settings.cooldownSeconds) });
const labels = { queued: '排队中', running: '回答中', sending: '发送中', succeeded: '已完成', failed: '未完成', canceled: '已取消', isolated: '发送结果待核对' };
const cleanError = (error: unknown) => error instanceof Error ? error.message : 'AI 助理暂不可用，请重试。';

/** Independent saves keep older community configuration clients compatible. */
export function CommunityAgentAdmin({ resources, onUnavailable, onDirtyChange }: Props) {
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<AgentAdminData | null>(null);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [numbers, setNumbers] = useState<Numbers | null>(null);
  const [editor, setEditor] = useState<AgentDocumentSave | null>(null);
  const [editorBaseline, setEditorBaseline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState<'reload' | 'editor' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState<AgentDocument | null>(null);
  const epoch = useRef(0);
  const titleInput = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onUnavailable, onDirtyChange }); callbacks.current = { onUnavailable, onDirtyChange };
  const settingsDirty = !!data && !!settings && !!numbers && (JSON.stringify(settings) !== JSON.stringify(data.settings) || JSON.stringify(numbers) !== JSON.stringify(numbersFor(data.settings)));
  const documentDirty = editor !== null && JSON.stringify(editor) !== editorBaseline;
  const dirty = settingsDirty || documentDirty;
  useEffect(() => { if (editor) titleInput.current?.focus(); }, [editor?.ref]);
  useEffect(() => { callbacks.current.onDirtyChange?.(dirty); }, [dirty]);
  useEffect(() => () => { epoch.current++; callbacks.current.onDirtyChange?.(false); }, []);
  const clearPrivate = (cause: ApiError) => {
    epoch.current++; setData(null); setSettings(null); setNumbers(null); setEditor(null); setEditorBaseline(''); setDeleting(null); setConfirm(null); setNotice(null); setStatus(cause.status);
    callbacks.current.onDirtyChange?.(false); callbacks.current.onUnavailable?.(cause);
  };
  useEffect(() => {
    if (!opened || data) return;
    const controller = new AbortController(), current = ++epoch.current;
    setError(null); setStatus(0);
    void communityAgentApi.read(controller.signal).then(value => {
      if (controller.signal.aborted || current !== epoch.current) return;
      setData(value); setSettings(structuredClone(value.settings)); setNumbers(numbersFor(value.settings));
    }).catch(cause => {
      if (controller.signal.aborted || current !== epoch.current) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) clearPrivate(cause);
      else { setStatus(cause instanceof ApiError ? cause.status : 500); setError(cleanError(cause)); }
    });
    return () => controller.abort();
  }, [opened, refresh]);
  const perform = async (work: () => Promise<AgentAdminData>, success: string, part: 'settings' | 'document') => {
    if (busy) return;
    const current = epoch.current; setBusy(true); setError(null); setNotice(null); setConfirm(null);
    try {
      const value = await work(); if (current !== epoch.current) return;
      // A document response may contain another admin's newer configuration.
      // Keep the original expectedVersion while a local settings draft exists.
      setData(previous => part === 'document' && settingsDirty && previous ? { ...value, settings: previous.settings, version: previous.version } : value);
      if (part === 'settings' || !settingsDirty) { setSettings(structuredClone(value.settings)); setNumbers(numbersFor(value.settings)); }
      if (part === 'document') { setEditor(null); setEditorBaseline(''); setDeleting(null); setConfirm(null); }
      setNotice(success);
    } catch (cause) {
      if (current !== epoch.current) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) clearPrivate(cause);
      else setError(cleanError(cause));
    } finally { if (current === epoch.current) setBusy(false); }
  };
  const edit = (document?: AgentDocument) => {
    const next: AgentDocumentSave = document ? { ref: document.ref, title: document.title, content: document.content, published: document.published, expectedVersion: document.version }
      : { ref: crypto.randomUUID(), title: '', content: '', published: false, expectedVersion: 0 };
    setEditor(next); setEditorBaseline(JSON.stringify(next)); setError(null); setNotice(null); setConfirm(null);
  };
  const closeEditor = () => { setEditor(null); setEditorBaseline(''); setConfirm(null); setError(null); };
  const reload = () => { if (busy) return; closeEditor(); setSettings(null); setNumbers(null); setData(null); setDeleting(null); setNotice(null); setConfirm(null); setRefresh(value => value + 1); };
  const saveSettings = () => {
    if (!settings || !numbers || !data) return;
    const values = { ...settings };
    for (const [field, min, max, label] of [['userDailyLimit', 1, 100, '每人每日上限'], ['guildDailyLimit', 1, 1000, '全服每日上限'], ['cooldownSeconds', 0, 3600, '提问冷却（秒）']] as const) {
      const value = Number(numbers[field]);
      if (numbers[field].trim() === '' || !Number.isInteger(value) || value < min || value > max) { setError(`${label}须为 ${min}–${max} 的整数。`); return; }
      values[field] = value;
    }
    if (values.enabled && !values.channelRefs.length) { setError('启用前请选择至少一个问答文字频道。'); return; }
    if (values.channelRefs.length > 10) { setError('最多选择 10 个问答文字频道。'); return; }
    void perform(() => communityAgentApi.save(values, data.version), 'AI 助理设置已保存。', 'settings');
  };
  const saveDocument = () => {
    if (!editor) return;
    if (!editor.title.trim() || editor.title.length > 100 || !editor.content.trim() || editor.content.length > 8000) { setError('请填写资料标题（1–100 字）和正文（1–8000 字）。'); return; }
    void perform(() => communityAgentApi.saveDocument({ ...editor, title: editor.title.trim(), content: editor.content.trim() }), '资料已保存。', 'document');
  };
  return <details className="community-card community-admin-section community-config-group" id="community-agent" data-setting-path="agent" tabIndex={-1} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary><h2>AI 助理与社区资料</h2></summary>
    {opened && <>
      <p>成员先绑定 Nanako，再在指定文字频道直接 @Bot 提问。答复在频道内可见，只引用已发布的社区资料。</p>
      <p className="community-muted">每次单独回答，不读取聊天历史、附件或私人记录。资料与 AI 助理设置在这里单独保存。</p>
      {status === 404 ? <p role="status">当前后端暂不支持 AI 助理，请更新后端后使用。</p> : status === 401 || status === 403 ? <p role="alert">管理员权限已失效，请重新登录。</p> : <>
        {error && <p role="alert" className="community-error">{error}</p>}{notice && <p role="status">{notice}</p>}
        {!data || !settings || !numbers ? <>{!error && <p role="status">正在读取 AI 助理…</p>}{error && <button type="button" onClick={reload}>重试 AI 助理</button>}</> : <>
          <p>{data.provider.ready ? '模型 API 已配置。' : data.provider.reason ?? '模型 API 尚未配置。'} <Link to="/settings/ai">管理模型与密钥</Link></p>
          <p className="community-muted">使用现有模型、端点和密钥；AI 量刑开关不会关闭此处的助理。</p>
          <form noValidate onSubmit={event => { event.preventDefault(); saveSettings(); }}>
            <fieldset className="community-admin-fields" disabled={busy}>
              <label className="community-choice"><input type="checkbox" checked={settings.enabled} onChange={event => { setSettings({ ...settings, enabled: event.target.checked }); setNotice(null); }}/><span>启用 AI 助理</span></label>
              <fieldset className="community-agent-channels"><legend>问答文字频道</legend><p className="community-muted">仅所选的普通文字频道响应，最多 10 个。</p>
                {resources.filter(resource => resource.kind === 'text').map(resource => <label className="community-choice" key={resource.ref}><input type="checkbox" checked={settings.channelRefs.includes(resource.ref)} disabled={!resource.available && !settings.channelRefs.includes(resource.ref)} onChange={event => setSettings({ ...settings, channelRefs: event.target.checked ? [...settings.channelRefs, resource.ref] : settings.channelRefs.filter(ref => ref !== resource.ref) })}/><span>{resource.name}{!resource.available && '（不可用）'}</span></label>)}
                {settings.channelRefs.filter(ref => !resources.some(resource => resource.kind === 'text' && resource.ref === ref)).map((ref, index) => <label className="community-choice" key={ref}><input type="checkbox" checked onChange={() => setSettings({ ...settings, channelRefs: settings.channelRefs.filter(value => value !== ref) })}/><span>已失效频道 {index + 1}（取消勾选以移除）</span></label>)}
                {!resources.some(resource => resource.kind === 'text') && <p>暂无文字频道，请先刷新社区服务器目录。</p>}
              </fieldset>
              <details><summary>提问额度与冷却</summary><div className="community-setting-grid">
                {([['userDailyLimit', '每人每日上限', 1, 100], ['guildDailyLimit', '全服每日上限', 1, 1000], ['cooldownSeconds', '提问冷却（秒）', 0, 3600]] as const).map(([field, label, min, max]) => <label className="community-setting-field" key={field}>{label}<input type="number" min={min} max={max} step="1" value={numbers[field]} onChange={event => setNumbers({ ...numbers, [field]: event.target.value })}/></label>)}
              </div><p className="community-muted">每日额度按 UTC 重置，以 Nanako 账户计数；已受理的失败调用也计入额度。</p></details>
              <button className="community-button" type="submit">保存 AI 助理设置</button>
            </fieldset>
          </form>
          <div className="community-agent-knowledge"><div className="community-heading"><h3>社区公开资料</h3><button type="button" disabled={busy || documentDirty || data.documents.length >= 50} onClick={() => edit()}>新增资料</button></div>
            <p>最多 50 篇；草稿仅管理员可见。勾选发布后，资料内容可被引用到问答频道。停用或修改资料会取消使用旧内容的待答。</p>
            {!data.documents.length ? <p>还没有资料。先新增并发布，助理才有回答依据。</p> : <ul className="community-admin-log">{data.documents.map(document => <li key={document.ref}><strong>{document.title}</strong><span>{document.published ? '已发布' : '草稿'} · 版本 {document.version}</span><div className="community-actions"><button type="button" disabled={busy || documentDirty} aria-label={`编辑 ${document.title}`} onClick={() => edit(document)}>编辑</button><button type="button" disabled={busy || documentDirty} aria-label={`删除 ${document.title}`} onClick={() => { setDeleting(document); setConfirm('delete'); }}>删除</button></div></li>)}</ul>}
            {editor && <form noValidate className="community-agent-editor" onSubmit={event => { event.preventDefault(); saveDocument(); }}><fieldset className="community-admin-fields" disabled={busy}>
              <h4>{editor.expectedVersion === 0 ? '新增社区资料' : '编辑社区资料'}</h4>
              <label className="community-setting-field">资料标题<input ref={titleInput} maxLength={100} value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })}/></label>
              <label className="community-setting-field">资料正文<textarea maxLength={8000} rows={10} value={editor.content} onChange={event => setEditor({ ...editor, content: event.target.value })}/></label>
              <p className="community-muted">可粘贴纯文本或 Markdown；仅作为资料文字使用，不执行 HTML 或链接。请勿填写密钥、个人信息或私人案件记录。</p>
              <label className="community-choice"><input type="checkbox" checked={editor.published} onChange={event => setEditor({ ...editor, published: event.target.checked })}/><span>发布到 AI 问答</span></label>
              <div className="community-actions"><button className="community-button" type="submit">保存资料</button><button type="button" onClick={() => documentDirty ? setConfirm('editor') : closeEditor()}>取消编辑</button></div>
            </fieldset></form>}
          </div>
          {confirm === 'delete' && deleting && <ConfirmInline question={`删除资料「${deleting.title}」？`} cancelLabel="保留资料" confirmLabel="确认删除" busy={busy} onCancel={() => { setConfirm(null); setDeleting(null); }} onConfirm={() => { void perform(() => communityAgentApi.deleteDocument(deleting.ref, deleting.version), '资料已删除。', 'document'); }}><p>删除后不再参与问答，正在使用旧资料的回答也会取消。</p></ConfirmInline>}
          {confirm === 'editor' && <ConfirmInline question="放弃未保存的资料修改？" cancelLabel="继续编辑" confirmLabel="放弃修改" busy={busy} onCancel={() => setConfirm(null)} onConfirm={closeEditor}/>}
          {confirm === 'reload' && <ConfirmInline question="放弃未保存的 AI 助理修改并重新加载？" cancelLabel="继续编辑" confirmLabel="放弃并刷新" busy={busy} onCancel={() => setConfirm(null)} onConfirm={reload}/>}
          <details><summary>用量与最近调用</summary><p>{data.usage.day}（UTC）已受理 {data.usage.total} 次。</p><p className="community-muted">只保存调用状态，不保存问题或答案正文。发送结果待核对时不自动重发，请到 Discord 查看。</p>{!data.requests.length ? <p>暂无调用记录。</p> : <ul className="community-admin-log">{data.requests.map((request, index) => <li key={`${request.createdAt}:${index}`}><strong>{labels[request.status] ?? '已记录'}</strong><span>{new Date(request.createdAt).toLocaleString('zh-CN')}</span></li>)}</ul>}</details>
          <button type="button" disabled={busy} onClick={() => dirty ? setConfirm('reload') : reload()}>刷新 AI 助理与资料</button>
        </>}
      </>}
    </>}
  </details>;
}

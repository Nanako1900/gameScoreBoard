import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiConfigPatch, AiConfigResponse, AiTestResponse } from '../types';
import { ApiError, getAiConfig, testAiConfig, updateAiConfig } from '../api';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { NotFound } from './NotFound';
import { ConfirmInline } from './ConfirmInline';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import './admin-ai.css';

interface AiSettingsProps { onUnavailable?: () => void }

type PromptTab = 'sentence' | 'classify' | 'report';

const PROMPT_TABS: { value: PromptTab; label: string }[] = [
  { value: 'sentence', label: '量刑' },
  { value: 'classify', label: '归类' },
  { value: 'report', label: '周报' },
];

const PROMPT_HINTS: Record<PromptTab, string> = {
  sentence: '决定在案由区间内扣多少分。改动记入每条判罚的 prompt_version，便于对比漂移。安全规则段建议保留。',
  classify:
    '只读裁判的描述、决定归到哪个案由（被告此时还没开口）。{{CATALOGUE}} 会被替换成案由清单，删掉它模型就看不到可选项了。',
  report: '每周周报的文风。数字一律由 SQL 算好后喂给它 —— 提示词里的「不许自己算数」那段别删。',
};

function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Runtime provider settings; credentials are write-only and never refilled. */
export function AiSettings({ onUnavailable }: AiSettingsProps): JSX.Element {
  const [cfg, setCfg] = useState<AiConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const active = useRef(false);
  const readVersion = useRef(0);
  const unavailableCallback = useRef(onUnavailable);
  unavailableCallback.current = onUnavailable;
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('0.2');
  const [prompt, setPrompt] = useState('');
  const [classifyPrompt, setClassifyPrompt] = useState('');
  const [reportPrompt, setReportPrompt] = useState('');
  const [tab, setTab] = useState<PromptTab>('sentence');
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<AiTestResponse | null>(null);
  const [replacingKey, setReplacingKey] = useState(false);
  const [invalidKey, setInvalidKey] = useState(false);
  const keyInput = useRef<HTMLInputElement | null>(null);
  const clearConfirm = useInlineConfirm<HTMLButtonElement>();
  // Keep the secret in the password element only, outside React state/drafts.
  // React detaches the ref on account changes, lost access and unmount.
  const bindKeyInput = useCallback((node: HTMLInputElement | null) => {
    if (keyInput.current && keyInput.current !== node) keyInput.current.value = '';
    keyInput.current = node;
  }, []);
  const clearKey = useCallback(() => {
    if (keyInput.current) keyInput.current.value = '';
    setReplacingKey(false);
    setInvalidKey(false);
  }, []);

  const showError = useCallback((err: unknown, fallback: string): void => {
    if (!active.current) return;
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      clearKey();
      setUnavailable(true);
      unavailableCallback.current?.();
      return;
    }
    setError(err instanceof ApiError ? err.message : fallback);
  }, [clearKey]);

  const load = useCallback(async (afterSave = false): Promise<boolean> => {
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const res = await getAiConfig();
      if (!active.current || readVersion.current !== version) return false;
      setCfg(res);
      setBaseUrl(res.base_url);
      setModel(res.model);
      setTemperature(String(res.temperature));
      setPrompt(res.prompt);
      setClassifyPrompt(res.classify_prompt);
      setReportPrompt(res.report_prompt);
      setEnabled(res.configured_enabled ?? res.enabled);
      clearKey();
      setError(null);
      return true;
    } catch (err) {
      if (active.current && readVersion.current === version) {
        const accessLost = err instanceof ApiError && (err.status === 403 || err.status === 404);
        if (afterSave && !accessLost) setError('修改已保存，状态刷新失败');
        else showError(err, '加载配置失败');
      }
      return false;
    } finally {
      if (active.current && readVersion.current === version) setLoading(false);
    }
  }, [showError, clearKey]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      readVersion.current += 1;
      if (keyInput.current) keyInput.current.value = '';
    };
  }, [load]);

  const handleSave = async (clearCredential = false): Promise<void> => {
    if (busy || loading || !cfg) return;
    const rawKey = keyInput.current?.value ?? '';
    if (!clearCredential && replacingKey && (
      invalidKey || /[\0\r\n]/.test(rawKey) || rawKey.trim().length === 0 || rawKey.trim().length > 4096
    )) {
      setError('API Key 不能为空、超过 4096 字符，或包含 NUL、回车、换行。');
      return;
    }
    setBusy(true);
    setStatus(null);
    setError(null);
    setTest(null);
    try {
      // Only send fields that carry a value: the API rejects an empty base_url /
      // model outright, so blanket-sending them would make "save" impossible on a
      // instance that has never been configured.
      const patch: AiConfigPatch = {
        enabled,
        prompt,
        classify_prompt: classifyPrompt,
        report_prompt: reportPrompt,
      };
      if (baseUrl.trim().length > 0) patch.base_url = baseUrl.trim();
      if (model.trim().length > 0) patch.model = model.trim();
      if (Number.isFinite(Number(temperature))) patch.temperature = Number(temperature);
      if (clearCredential) patch.api_key = null;
      else if (replacingKey) patch.api_key = rawKey.trim();
      await updateAiConfig(patch);
      if (!active.current) return;
      clearKey();
      clearConfirm.close();
      if (!await load(true) || !active.current) return;
      setStatus('已保存');
      setError(null);
    } catch (err) {
      if (active.current) { clearKey(); clearConfirm.close(); }
      showError(err, '保存失败');
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const dirty = cfg !== null && (baseUrl !== cfg.base_url || model !== cfg.model ||
    temperature !== String(cfg.temperature) || prompt !== cfg.prompt || classifyPrompt !== cfg.classify_prompt ||
    reportPrompt !== cfg.report_prompt || enabled !== (cfg.configured_enabled ?? cfg.enabled) || replacingKey);
  const handleTest = async (): Promise<void> => {
    if (busy || loading) return;
    if (dirty) { setError('请先保存配置，再试跑'); return; }
    setBusy(true);
    setStatus(null);
    setTest(null);
    try {
      const res = await testAiConfig({});
      if (!active.current) return;
      setTest(res);
      setError(null);
    } catch (err) {
      showError(err, '试跑失败');
    } finally {
      if (active.current) setBusy(false);
    }
  };

  if (unavailable) return <NotFound title={NOT_FOUND_TITLE} />;

  return (
    <section aria-labelledby="admin-ai-title">
      <h3 id="admin-ai-title" className="aai__title">
        AI 裁判配置
      </h3>
      <p className="aai__subtitle">
        任何 OpenAI 兼容端点都可以（OpenAI / DeepSeek / 硅基流动 / OpenRouter / 自建）。
      </p>

      {error && (
        <p className="aai__error" role="alert">
          {error}
        </p>
      )}
      {error && <button type="button" className="btn btn--ghost" disabled={busy || loading} onClick={() => void load()}>重试</button>}
      {loading && !cfg && <p role="status">正在读取 AI 配置…</p>}
      {status && <p className="aai__ok" role="status">{status}</p>}

      {cfg && (
        <>
          <div className="aai__health">
            <Stat label="近 7 天判罚" value={String(cfg.recent.total)} />
            <Stat
              label="回退率"
              value={percent(cfg.recent.fallbackRate)}
              warn={cfg.recent.fallbackRate > 0.1}
              hint="AI 不可用而按基准分判的比例"
            />
            <Stat
              label="越界率"
              value={percent(cfg.recent.clampRate)}
              warn={cfg.recent.clampRate > 0.1}
              hint="AI 给出的分值被强制夹回区间的比例。持续偏高说明提示词或模型有问题"
            />
            <Stat label="平均耗时" value={`${cfg.recent.avgLatencyMs}ms`} />
          </div>

          {cfg.disabled_reason && (
            <p className="aai__warn">⚠️ {cfg.disabled_reason}</p>
          )}
          {cfg.can_update_api_key === undefined && !cfg.has_api_key && (
            <p className="aai__warn">
              API Key 不在网页或数据库保存，请由机主在后端环境变量中配置 AI_API_KEY
            </p>
          )}

          <div className="aai__form">
            <div className="aai__credential">
              <p>API Key：{cfg.has_api_key ? '已设置' : '未设置'}</p>
              {cfg.api_key_source !== undefined && <p className="aai__hint">来源：{{ database: '数据库', environment: '环境变量', none: '无' }[cfg.api_key_source]}</p>}
              {cfg.can_update_api_key === false && <p className="aai__warn">需一次性部署 AI_CONFIG_MASTER_KEY 到 app 和 bot，才能在网页设置或更换 API Key；仍可清除现有凭据。</p>}
              {cfg.can_update_api_key !== undefined && <>
                {!replacingKey ? <button type="button" className="btn btn--ghost" disabled={busy || loading || !cfg.can_update_api_key}
                  onClick={() => { setReplacingKey(true); setInvalidKey(false); setError(null); clearConfirm.close(); }}>
                  {cfg.has_api_key || cfg.api_key_source === 'database' ? '更换 API Key' : '设置 API Key'}
                </button> : <>
                  <label className="aai__field">
                    <span className="aai__label">新 API Key</span>
                    <input ref={bindKeyInput} className="aai__input" type="password" autoComplete="new-password" aria-label="新 API Key"
                      disabled={busy || loading} aria-describedby="aai-key-hint"
                      onChange={() => { setInvalidKey(false); setError(null); }}
                      onPaste={(event) => {
                        // Password inputs strip CR/LF before change: inspect the raw clipboard first.
                        if (/[\0\r\n]/.test(event.clipboardData.getData('text'))) {
                          event.preventDefault();
                          if (keyInput.current) keyInput.current.value = '';
                          setInvalidKey(true);
                          setError('API Key 不能包含 NUL、回车或换行。');
                        }
                      }} />
                    <span className="aai__hint" id="aai-key-hint">仅本次保存使用，不回填已有 Key。取消更换可保留现有凭据。</span>
                  </label>
                  <button type="button" className="btn btn--ghost" disabled={busy || loading} onClick={clearKey}>取消更换</button>
                </>}
                {clearConfirm.confirming ? <ConfirmInline question="清除 API Key？" confirmLabel="确认清除" cancelLabel="保留 Key"
                  busy={busy || loading} busyLabel="正在清除…" onCancel={clearConfirm.dismiss} onConfirm={() => void handleSave(true)}>
                  清除后会停止 AI，转入现有回退逻辑；不会恢复旧环境变量中的 Key。当前其他配置也会一并保存。
                </ConfirmInline> : <button ref={clearConfirm.triggerRef} type="button" className="btn btn--danger-outline"
                  disabled={busy || loading} onClick={clearConfirm.ask}>清除 API Key</button>}
              </>}
            </div>
            <label className="aai__toggle">
              <input
                type="checkbox"
                disabled={busy || loading}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>启用 AI 量刑（关闭后一律按基准分判罚）</span>
            </label>

            <label className="aai__field">
              <span className="aai__label">Base URL</span>
              <input
                className="aai__input"
                disabled={busy || loading}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <span className="aai__hint">
                以 <code>/v1</code> 结尾，代码只会拼接 <code>/chat/completions</code>
              </span>
            </label>

            <div className="aai__row">
              <label className="aai__field">
                <span className="aai__label">模型</span>
                <input
                  className="aai__input"
                  disabled={busy || loading}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </label>

              <label className="aai__field">
                <span className="aai__label">Temperature</span>
                <input
                  className="aai__input tabular"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  disabled={busy || loading}
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
                <span className="aai__hint">判罚要可复现，建议 ≤ 0.3</span>
              </label>
            </div>

            <div className="aai__field">
              <span className="aai__label">
                提示词 <span className="aai__version tabular">v{cfg.prompt_version}</span>
              </span>
              <div className="aai__tabs" role="tablist" aria-label="提示词">
                {PROMPT_TABS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.value}
                    className={`aai__tab${tab === t.value ? ' aai__tab--active' : ''}`}
                    onClick={() => setTab(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                className="aai__textarea"
                value={
                  tab === 'sentence' ? prompt : tab === 'classify' ? classifyPrompt : reportPrompt
                }
                onChange={(e) => {
                  if (tab === 'sentence') setPrompt(e.target.value);
                  else if (tab === 'classify') setClassifyPrompt(e.target.value);
                  else setReportPrompt(e.target.value);
                }}
                disabled={busy || loading}
                rows={14}
                maxLength={8000}
                aria-label={PROMPT_TABS.find((t) => t.value === tab)?.label}
              />
              <span className="aai__hint">{PROMPT_HINTS[tab]}</span>
            </div>

            <p className="aai__hint">试跑仅使用已保存配置，不修改任何人的分数。</p>
            <div className="aai__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void handleTest()}
                disabled={busy || loading}
              >
                {busy ? '请稍候…' : '用样例案试跑'}
              </button>
              <button
                type="button"
                className="btn btn--gold"
                onClick={() => void handleSave()}
                disabled={busy || loading}
              >
                保存
              </button>
            </div>
          </div>

          {test && (
            <div className={`aai__test${test.ok ? '' : ' aai__test--fail'}`}>
              <h3 className="aai__test-title">
                试跑结果 · {test.ok ? 'AI 判决' : '回退到基准分'}
                <span className="aai__test-latency tabular">{test.latency_ms}ms</span>
              </h3>
              {test.error && <p className="aai__test-error">{test.error}</p>}
              <p className="aai__test-verdict">
                <strong className="tabular">{test.verdict.delta}</strong> — {test.verdict.headline}
              </p>
              <p className="aai__test-reason">{test.verdict.reasoning}</p>
              {test.clamped && (
                <p className="aai__test-error">
                  ⚠️ 模型给出的是 {test.parsed_delta}，超出区间已被夹回。
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface StatProps {
  label: string;
  value: string;
  warn?: boolean;
  hint?: string;
}

function Stat({ label, value, warn = false, hint }: StatProps): JSX.Element {
  return (
    <div className={`aai-stat${warn ? ' aai-stat--warn' : ''}`} title={hint}>
      <span className="aai-stat__value tabular">{value}</span>
      <span className="aai-stat__label">{label}</span>
    </div>
  );
}

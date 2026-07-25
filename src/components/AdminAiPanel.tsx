import { useCallback, useEffect, useState } from 'react';
import type { AiConfigPatch, AiConfigResponse, AiTestResponse } from '../types';
import { ApiError, getAiConfig, testAiConfig, updateAiConfig } from '../api';
import { Modal } from './Modal';
import './admin-ai.css';

interface AdminAiPanelProps {
  open: boolean;
  onClose: () => void;
}

function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * AI 裁判配置 — any OpenAI-compatible endpoint, editable at runtime.
 *
 * The prompt lives here rather than in an env var on purpose: sentencing style
 * needs iterating, and iterating should not require a redeploy. The API key is
 * the deliberate exception — it stays a Worker secret and is never round-tripped
 * through this panel.
 */
export function AdminAiPanel({ open, onClose }: AdminAiPanelProps): JSX.Element {
  const [cfg, setCfg] = useState<AiConfigResponse | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('0.2');
  const [prompt, setPrompt] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<AiTestResponse | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await getAiConfig();
      setCfg(res);
      setBaseUrl(res.base_url);
      setModel(res.model);
      setTemperature(String(res.temperature));
      setPrompt(res.prompt);
      setEnabled(res.enabled);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载配置失败');
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleSave = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      // Only send fields that carry a value: the API rejects an empty base_url /
      // model outright, so blanket-sending them would make "save" impossible on a
      // instance that has never been configured.
      const patch: AiConfigPatch = { enabled, prompt };
      if (baseUrl.trim().length > 0) patch.base_url = baseUrl.trim();
      if (model.trim().length > 0) patch.model = model.trim();
      if (Number.isFinite(Number(temperature))) patch.temperature = Number(temperature);
      await updateAiConfig(patch);
      await load();
      setStatus('已保存');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    setTest(null);
    try {
      const res = await testAiConfig({});
      setTest(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '试跑失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="admin-ai-title" size="lg">
      <h2 id="admin-ai-title" className="aai__title">
        AI 裁判配置
      </h2>
      <p className="aai__subtitle">
        任何 OpenAI 兼容端点都可以（OpenAI / DeepSeek / 硅基流动 / OpenRouter / 自建）。
      </p>

      {error && (
        <p className="aai__error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="aai__ok">{status}</p>}

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
          {!cfg.has_api_key && (
            <p className="aai__warn">
              API Key 未设置。它不存数据库，请执行：
              <code className="aai__code">wrangler secret put AI_API_KEY</code>
            </p>
          )}

          <div className="aai__form">
            <label className="aai__toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>启用 AI 量刑（关闭后一律按基准分判罚）</span>
            </label>

            <label className="aai__field">
              <span className="aai__label">Base URL</span>
              <input
                className="aai__input"
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
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
                <span className="aai__hint">判罚要可复现，建议 ≤ 0.3</span>
              </label>
            </div>

            <label className="aai__field">
              <span className="aai__label">
                系统提示词 <span className="aai__version tabular">v{cfg.prompt_version}</span>
              </span>
              <textarea
                className="aai__textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={14}
                maxLength={8000}
              />
              <span className="aai__hint">
                改动会记入每条判罚的 prompt_version，便于对比判罚漂移。安全规则段建议保留。
              </span>
            </label>

            <div className="aai__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void handleTest()}
                disabled={busy}
              >
                {busy ? '请稍候…' : '用样例案试跑'}
              </button>
              <button
                type="button"
                className="btn btn--gold"
                onClick={() => void handleSave()}
                disabled={busy}
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
    </Modal>
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

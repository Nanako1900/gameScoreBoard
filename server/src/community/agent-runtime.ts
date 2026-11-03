import { Events, type Client, type Message } from 'discord.js';
import type pg from 'pg';
import { safeAgentText, type AgentErrorCode } from '../../../shared/community-agent';
import { loadAiConfig, type AiConfig } from '../../../worker/ai/config';
import { redactAiSecret } from '../../../worker/ai/redact';
import type { Env } from '../../../worker/types';
import { AGENT_INSUFFICIENT_TEXT, AgentAnswerError, answerAgentQuestion, selectAgentSources, type AgentAnswer, type AgentSource } from './agent-answer';
import { AgentDiscordError, clipAgentText, createAgentDiscord, extractAgentQuestion, type AgentDiscord, type AgentIncoming } from './agent-discord';
import { AgentDeliveryError, CommunityAgentStore, type AgentClaim, type AgentDeliveryResult, type AgentFinish } from './agent-store';

export type AgentRuntimeStore = Pick<CommunityAgentStore, 'allowsChannel' | 'reserve' | 'claim' | 'check' | 'withDeliveryGuard' | 'withChannelGuard' | 'finish' | 'recoverExpired'>;
interface Dependencies {
  store?: AgentRuntimeStore;
  discord?: AgentDiscord;
  answer?: typeof answerAgentQuestion;
  selectSources?: typeof selectAgentSources;
  loadConfig?: () => Promise<AiConfig>;
}
export interface CommunityAgentRuntimeOptions {
  pool: pg.Pool; db: D1Database; client: Client; guildId: string; frontendUrl: string; env: Env;
  isReadOnly: () => boolean; onError: (error: unknown) => void; dependencies?: Dependencies;
}
const PROGRESS = '正在查找公开资料，请稍候…';
const FAILED = '暂时无法回答，请稍后再试。';
const NO_QUESTION = '请在 @ 后写下文字问题。';
const TOO_LONG = '问题请控制在 2000 字以内。';
const BIND = '请先使用 /link 绑定 Nanako 账号，再来提问。';
const LIMITED = '提问过于频繁或今日额度已用完，请稍后再试。';
const BUSY = '现在提问较多，请稍后再试。';
class AgentCanceled extends Error {}

/** One bounded worker owns only this runtime's in-memory questions. A restart
 * can recover metadata, but cannot recover or replay a user's question. */
export function createCommunityAgentRuntime(options: CommunityAgentRuntimeOptions): { handle(message: Message): Promise<void>; stop(): Promise<void> } {
  const { client, guildId } = options, injected = options.dependencies ?? {};
  const store = injected.store ?? new CommunityAgentStore(options.pool, guildId, { offsetHours: 0 });
  const discord = injected.discord ?? createAgentDiscord(client, guildId);
  const answer = injected.answer ?? answerAgentQuestion, select = injected.selectSources ?? selectAgentSources;
  const config = injected.loadConfig ?? (() => loadAiConfig(options.db, options.env));
  let stopped = false, worker: Promise<void> = Promise.resolve(), recovery: Promise<void> | undefined;
  let maintenance: Promise<void> | undefined, maintenanceTimer: ReturnType<typeof setInterval> | undefined;
  const pending = new Set<Promise<void>>(), controllers = new Set<AbortController>();
  const unavailable = () => stopped || options.isReadOnly();
  const report = (code: string) => options.onError(new Error(`community_agent_${code}`));
  const recover = (): Promise<void> => {
    if (!recovery) {
      const attempt = store.recoverExpired().catch(() => {
        if (recovery === attempt) recovery = undefined;
        report('storage_failed'); throw new AgentCanceled();
      });
      recovery = attempt;
    }
    if (!maintenanceTimer) {
      maintenanceTimer = setInterval(() => {
        if (!stopped) maintenance = store.recoverExpired().catch(() => report('cleanup_failed'));
      }, 3_600_000);
      maintenanceTimer.unref();
    }
    return recovery;
  };
  const ready = (): void => { if (!stopped) void recover().catch(() => undefined); };
  client.once(Events.ClientReady, ready);

  async function current(claim: AgentClaim): Promise<void> {
    if (unavailable() || !await store.check(claim) || unavailable() || !await discord.authorize(claim.discordUserId, claim.channelId) || unavailable()) throw new AgentCanceled();
  }
  async function delivery<T>(claim: AgentClaim, work: () => Promise<T>): Promise<AgentDeliveryResult<T>> {
    return store.withDeliveryGuard(claim, async beforeWrite => {
      if (unavailable() || !await discord.authorize(claim.discordUserId, claim.channelId) || unavailable()) throw new AgentDeliveryError(false, 'authorization_changed');
      await beforeWrite();
      if (unavailable()) throw new AgentDeliveryError(false, 'authorization_changed');
      try { return await work(); }
      catch (error) {
        if (error instanceof AgentDiscordError && !error.uncertain) throw new AgentDeliveryError(false, 'delivery_failed');
        throw new AgentDeliveryError(true, 'delivery_unknown');
      }
    });
  }
  async function notice(input: AgentIncoming, content: string): Promise<void> {
    await store.withChannelGuard(input.channelId, async beforeWrite => {
      if (unavailable() || !await discord.authorize(input.discordUserId, input.channelId) || unavailable()) throw new AgentDeliveryError(false, 'authorization_changed');
      await beforeWrite();
      if (unavailable()) throw new AgentDeliveryError(false, 'authorization_changed');
      await discord.send(input.channelId, content, input.messageId);
    });
  }
  async function clear(claim: AgentClaim, messageId: string | null): Promise<void> {
    // Removal carries no user data and remains safe after the original identity
    // has been revoked. Never create a replacement when removal fails.
    if (messageId) await discord.remove(claim.channelId, messageId).catch(() => report('cleanup_failed'));
  }
  async function finish(claim: AgentClaim, result: AgentFinish): Promise<void> {
    await store.finish(claim.ref, claim.claimToken, result).catch(() => report('finish_failed'));
  }
  async function failedDelivery(claim: AgentClaim, result: Exclude<AgentDeliveryResult<unknown>, { kind: 'delivered' }>, messageId: string | null): Promise<void> {
    if (result.kind === 'canceled' || unavailable()) await clear(claim, messageId);
    await finish(claim, { status: result.kind, errorCode: result.kind === 'isolated' ? 'delivery_unknown' : result.kind === 'canceled' ? 'authorization_changed' : 'delivery_failed' });
  }
  async function modelCall(question: string, sources: AgentSource[], modelConfig: AiConfig, controller: AbortController): Promise<AgentAnswer> {
    const timer = setTimeout(() => controller.abort(), 25_000);
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new AgentAnswerError('aborted'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try { return await Promise.race([answer({ question, sources, config: modelConfig, signal: controller.signal }), aborted]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); }
  }
  async function run(requestRef: string, input: AgentIncoming): Promise<void> {
    let claim: AgentClaim | null = null, responseId: string | null = null, modelConfig: AiConfig | undefined;
    const controller = new AbortController(), started = Date.now();
    controllers.add(controller);
    try {
      claim = await store.claim(requestRef);
      if (!claim) return;
      if (unavailable()) throw new AgentCanceled();
      const progress = await delivery(claim, () => discord.send(claim!.channelId, PROGRESS, claim!.messageId));
      if (progress.kind !== 'delivered') { await failedDelivery(claim, progress, null); return; }
      responseId = progress.value.id;
      await current(claim);
      const sources = select(input.question, claim.documents);
      let result: AgentAnswer = { answer: AGENT_INSUFFICIENT_TEXT, sourceRefs: [], insufficient: true };
      if (sources.length) {
        modelConfig = await config();
        await current(claim);
        result = await modelCall(input.question, sources, modelConfig, controller);
      }
      await current(claim);
      const used = new Set(result.sourceRefs);
      const scrub = (text: string) => redactAiSecret(safeAgentText(text), modelConfig?.apiKey ?? '');
      const citations = sources.filter(source => used.has(source.ref)).map(source => `${clipAgentText(scrub(source.title), 100)}（v${source.version}）`);
      const suffix = citations.length ? `\n\n来源：${citations.join('、')}` : '';
      const content = clipAgentText(scrub(result.answer), 1950 - suffix.length) + suffix;
      const sent = await delivery(claim, () => discord.edit(claim!.channelId, responseId!, content));
      if (sent.kind !== 'delivered') { await failedDelivery(claim, sent, responseId); return; }
      await finish(claim, { status: 'succeeded', ...(sources.length ? {} : { errorCode: 'no_sources' }),
        model: modelConfig?.model, latencyMs: Date.now() - started });
    } catch (error) {
      if (!claim) { report('admission_failed'); return; }
      if (error instanceof AgentCanceled || unavailable()) {
        await clear(claim, responseId);
        await finish(claim, { status: 'canceled', errorCode: unavailable() ? 'interrupted' : 'authorization_changed' });
        return;
      }
      const code: AgentErrorCode = error instanceof AgentAnswerError && error.code === 'provider_unavailable' ? 'provider_unavailable' : 'provider_failed';
      report(code);
      if (responseId) {
        const sent = await delivery(claim, () => discord.edit(claim!.channelId, responseId!, FAILED));
        if (sent.kind !== 'delivered') { await failedDelivery(claim, sent, responseId); return; }
      }
      await finish(claim, { status: 'failed', errorCode: code, model: modelConfig?.model, latencyMs: Date.now() - started });
    } finally { controllers.delete(controller); }
  }
  async function admit(message: Message): Promise<void> {
    const botId = client.user?.id;
    if (unavailable() || !botId) return;
    const input = extractAgentQuestion(message, guildId, botId);
    if (!input) return;
    await recover();
    if (unavailable() || !await store.allowsChannel(input.channelId) || unavailable() || !await discord.authorize(input.discordUserId, input.channelId) || unavailable()) return;
    if (!input.question) { await notice(input, NO_QUESTION); return; }
    if (Array.from(input.question).length > 2000) { await notice(input, TOO_LONG); return; }
    const reserved = await store.reserve({ discordUserId: input.discordUserId, channelId: input.channelId, messageId: input.messageId });
    if (reserved.kind === 'unbound') { await notice(input, BIND); return; }
    if (reserved.kind === 'rate_limited') { await notice(input, LIMITED); return; }
    if (reserved.kind === 'busy') { await notice(input, BUSY); return; }
    if (reserved.kind !== 'accepted') return;
    // The tail contains the question only in memory; no worker reads old queued
    // records or touches the community room execution queue.
    worker = worker.catch(() => report('worker_failed')).then(() => run(reserved.request.ref, input));
    await worker;
  }
  return {
    handle(message) {
      if (stopped) return Promise.resolve();
      const task = admit(message).catch(() => report('request_failed')).finally(() => pending.delete(task));
      pending.add(task); return task;
    },
    async stop() {
      stopped = true; client.off(Events.ClientReady, ready);
      clearInterval(maintenanceTimer);
      for (const controller of controllers) controller.abort();
      discord.stop?.();
      await Promise.allSettled([...pending]);
      await worker.catch(() => undefined);
      await recovery?.catch(() => undefined);
      await maintenance;
    },
  };
}

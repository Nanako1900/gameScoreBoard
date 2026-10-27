// A read-only destination survives the full Discord OAuth navigation and a
// welcome-page reload. It is tab-local, expires like login return, and never
// carries a command or an action to replay.
import { LOGIN_RETURN_TTL_MS, RETURN_PATH_MAX } from './constants';
import { hasRetiredSessionLink, readDeepLink, withoutParams } from './deepLink';
import { HOME_PATH, parseRoute } from './routes';

export const WELCOME_RETURN_KEY = 'edg.welcome.return';

export function normalizeWelcomeReturn(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > RETURN_PATH_MAX || !raw.startsWith('/') || raw.startsWith('//')
    || raw.includes('\\') || raw.includes('#')) return null;
  const pathname = raw.split('?')[0];
  const search = raw.slice(pathname.length);
  const route = parseRoute(pathname);
  if (route.name === 'notFound' || route.name === 'welcome') return null;
  if (route.name === 'home' && readDeepLink(search) === null && !hasRetiredSessionLink(search)) return null;
  return (route.name === 'home' ? HOME_PATH : pathname) + withoutParams(search, ['onboarding', 'linked']);
}

export function parseWelcomeReturn(raw: string | null, now: number): string | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const { v, savedAt, path } = value as Record<string, unknown>;
    if (v !== 1 || typeof savedAt !== 'number' || !Number.isFinite(savedAt)
      || savedAt > now || now - savedAt > LOGIN_RETURN_TTL_MS) return null;
    return normalizeWelcomeReturn(path);
  } catch { return null; }
}

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
function storage(): Store | null {
  try { return (globalThis as unknown as { sessionStorage?: Store }).sessionStorage ?? null; }
  catch { return null; }
}
export function clearWelcomeReturn(): void {
  try { storage()?.removeItem(WELCOME_RETURN_KEY); } catch { /* Storage can be blocked. */ }
}
export function saveWelcomeReturn(path: string | null): void {
  const checked = normalizeWelcomeReturn(path);
  if (checked === null) { clearWelcomeReturn(); return; }
  try { storage()?.setItem(WELCOME_RETURN_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), path: checked })); }
  catch { /* Binding remains usable when storage is blocked. */ }
}
export function readWelcomeReturn(): string | null {
  try {
    const store = storage();
    const raw = store?.getItem(WELCOME_RETURN_KEY) ?? null;
    const path = parseWelcomeReturn(raw, Date.now());
    if (path === null && raw !== null) clearWelcomeReturn();
    return path;
  } catch { return null; }
}

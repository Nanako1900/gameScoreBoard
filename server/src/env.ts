// Reading the container's environment. Coolify hands a variable that was never
// filled in to the container as an empty string, so empty always means "use
// the default" — and a value that cannot be read is reported and ignored, never
// turned into something surprising (JOBS_INTERVAL_MS='' used to mean 0 ms).

export type Warn = (message: string) => void;

const TRUE = ['1', 'true', 'yes', 'on'];
const FALSE = ['0', 'false', 'no', 'off'];

export function envFlag(raw: string | undefined, fallback: boolean, name: string, warn: Warn = console.warn): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return fallback;
  if (TRUE.includes(value)) return true;
  if (FALSE.includes(value)) return false;
  warn(`${name}=${JSON.stringify(raw)} is not a yes/no value; using ${fallback}`);
  return fallback;
}

export function envInt(
  raw: string | undefined,
  fallback: number,
  rule: { name: string; min: number },
  warn: Warn = console.warn,
): number {
  const value = (raw ?? '').trim();
  if (value === '') return fallback;
  const n = Number(value);
  if (Number.isSafeInteger(n) && n >= rule.min) return n;
  warn(`${rule.name}=${JSON.stringify(raw)} is not an integer ≥ ${rule.min}; using ${fallback}`);
  return fallback;
}

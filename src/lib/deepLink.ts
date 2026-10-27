// Links into the app (P8): `?case=<id>` opens a case in its subject's page,
// `?session=<id>` a session. The bot's DMs and replies use them.
//
// Only a positive integer id is read — nothing from the URL is ever rendered —
// and a link only chooses which ordinary view opens: what is shown, and which
// controls, still come from the API and `/api/me`. A link never writes.

export type DeepLink = { kind: 'case' | 'session'; id: number };

export const DEEP_LINK_PARAMS = ['case', 'session'] as const;

/** A positive integer id, at most 15 digits: the only id a link may carry (the router reuses it). */
export const ID_PATTERN = /^[1-9]\d{0,14}$/;

export function readDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search);
  for (const kind of DEEP_LINK_PARAMS) {
    const raw = params.get(kind);
    if (raw !== null && ID_PATTERN.test(raw)) return { kind, id: Number(raw) };
  }
  return null;
}

/** `search` without these parameters, others kept ('' when none are left). */
export function withoutParams(search: string, names: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const name of names) params.delete(name);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

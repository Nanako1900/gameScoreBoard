// The handful of Cloudflare Workers global types that worker/*.ts mentions,
// declared for the Node build. The Worker code is compiled into the Node
// server unchanged (see server/src/api.ts), but @cloudflare/workers-types
// cannot be loaded next to Node's and the DOM's own fetch types. Only the
// members the domain code actually uses are declared; the D1 ones match
// server/src/db/d1.ts, the adapter that implements them.

declare global {
  interface D1Meta {
    changes: number;
    last_row_id: number | null;
    duration: number;
    [key: string]: unknown;
  }

  interface D1Result<T = Record<string, unknown>> {
    results: T[];
    success: true;
    meta: D1Meta;
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  }

  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  }

  interface Fetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
    readonly props: unknown;
  }

  interface ScheduledController {
    readonly scheduledTime: number;
    readonly cron: string;
    noRetry(): void;
  }
}

export {};

// Runs an embedded PostgreSQL in its own process for tests/pg/global-setup.ts.
//
// Why a separate process: embedded-postgres imports async-exit-hook, which
// installs process-wide exit/signal handlers that swallow the exit code. Loaded
// inside vitest's own process, a failing PG run would exit 0 and CI would never
// notice. Here, the hook only ever governs this helper.
//
// Usage: node embedded-server.mjs <dataDir> <port>   → prints "READY" when up.

import EmbeddedPostgres from 'embedded-postgres';

const [dataDir, port] = process.argv.slice(2);
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'edg',
  password: 'edg',
  port: Number(port),
  persistent: false,
  onLog: () => undefined,
  initdbFlags: ['--encoding=UTF8', '--locale=C.UTF-8'],
  postgresFlags: ['-c', 'timezone=UTC', '-c', 'fsync=off', '-c', 'synchronous_commit=off'],
});

await server.initialise();
await server.start();
process.stdout.write('READY\n');
// SIGTERM from the parent: async-exit-hook runs embedded-postgres' graceful
// shutdown (stops the cluster) before this process exits.

// A raw NUL byte in a source file makes git classify the whole file as binary,
// which hides every later change to it from `git diff` and from PR review.
// worker/ai/config.ts carried two from ca73f92 until they became `\u0000`
// escapes — same string at runtime, reviewable in git.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['worker', 'shared', 'src', 'tests', 'migrations', 'functions'];
const ROOT_FILES = ['schema.sql', 'index.html', 'wrangler.toml'];
const SOURCE_EXT = /\.(ts|tsx|js|css|sql)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE_EXT.test(entry.name) ? [full] : [];
  });
}

describe('source files', () => {
  it('contain no raw NUL bytes', () => {
    const files = [
      ...SOURCE_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d))),
      ...ROOT_FILES.map((f) => path.join(ROOT, f)),
    ];
    const offenders = files
      .filter((file) => readFileSync(file).includes(0))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});

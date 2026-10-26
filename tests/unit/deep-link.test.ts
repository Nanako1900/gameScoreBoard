import { describe, expect, it } from 'vitest';
import { readDeepLink, withoutParams } from '../../src/lib/deepLink';

describe('readDeepLink', () => {
  it('reads a case or a session by a positive id', () => {
    expect(readDeepLink('?case=7')).toEqual({ kind: 'case', id: 7 });
    expect(readDeepLink('?session=3&x=1')).toEqual({ kind: 'session', id: 3 });
    expect(readDeepLink('?case=123456789012345')).toEqual({ kind: 'case', id: 123456789012345 });
  });

  it('ignores anything else', () => {
    for (const search of ['', '?case=', '?case=0', '?case=-1', '?case=abc', '?case=1e3', '?case=07x', '?case=1234567890123456', '?player=7']) {
      expect(readDeepLink(search), search).toBeNull();
    }
  });
});

describe('withoutParams', () => {
  it('drops only the given parameters', () => {
    expect(withoutParams('?case=7&utm=dc', ['case', 'session'])).toBe('?utm=dc');
    expect(withoutParams('?case=7', ['case'])).toBe('');
    expect(withoutParams('', ['case'])).toBe('');
  });
});

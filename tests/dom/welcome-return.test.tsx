import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWelcomeReturn, saveWelcomeReturn, readWelcomeReturn, WELCOME_RETURN_KEY } from '../../src/lib/welcomeReturn';
afterEach(() => vi.restoreAllMocks());
describe('welcome address storage', () => {
  it('uses guarded session storage and keeps an address through reloads until the wizard finishes', () => {
    saveWelcomeReturn('/?case=9&onboarding=1');
    expect(localStorage.getItem(WELCOME_RETURN_KEY)).toBeNull();
    expect(readWelcomeReturn()).toBe('/?case=9'); expect(readWelcomeReturn()).toBe('/?case=9');
    clearWelcomeReturn(); expect(readWelcomeReturn()).toBeNull();
  });
  it('clears old addresses for a null or invalid target and at logout', () => {
    for (const next of [null, '/welcome', '/api/me']) {
      saveWelcomeReturn('/cases/9'); saveWelcomeReturn(next); expect(readWelcomeReturn()).toBeNull();
    }
    saveWelcomeReturn('/guide'); clearWelcomeReturn(); expect(readWelcomeReturn()).toBeNull();
  });
  it('drops corrupt data and tolerates blocked storage without blocking binding', () => {
    sessionStorage.setItem(WELCOME_RETURN_KEY, '{'); expect(readWelcomeReturn()).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => { saveWelcomeReturn('/cases/9'); clearWelcomeReturn(); }).not.toThrow();
    expect(readWelcomeReturn()).toBeNull();
  });
});

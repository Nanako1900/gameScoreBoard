import { expect, it } from 'vitest';
import { redactAiSecret } from '../../worker/ai/redact';
it('replaces every literal occurrence including regex metacharacters', () => {
  expect(redactAiSecret('before sk.*$ again sk.*$ after', 'sk.*$')).toBe('before [已隐藏] again [已隐藏] after');
});
it('leaves text alone when there is no active key or no occurrence', () => {
  expect(redactAiSecret('hello', '')).toBe('hello');
  expect(redactAiSecret('hello', 'other')).toBe('hello');
});

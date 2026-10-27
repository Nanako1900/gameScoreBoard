// Re-classification rules for case filing and historical attendance-derived records.
import type { ViolationType } from './scoring';

export function isAllowedTypeOverride(
  derived: ViolationType,
  requested: ViolationType,
): boolean {
  if (derived === requested) return true;
  return derived === 'no_show' && requested === 'no_show_group';
}

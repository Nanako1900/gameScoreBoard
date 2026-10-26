/** "a.example, B.example " → Set { 'a.example', 'b.example' }. */
export function hostSet(csv: string | undefined): Set<string> {
  return new Set(
    (csv ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Browser effects stay outside the calendar/share string builders. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }
}
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text); return true;
  } catch { return false; }
}

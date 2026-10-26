// HTMLRewriter replacement for Node. page.ts already expresses the page edits
// as data (PagePatch) applied through a narrow PatchTarget interface, so the
// only runtime-specific part is this adapter over a linkedom element.

import { parseHTML } from 'linkedom';
import { applyPatch, type PagePatch, type PatchTarget } from './page';

/**
 * Elements whose content linkedom serialises verbatim (RCDATA / raw text).
 * For every other element, textContent is escaped on output.
 */
const RCDATA = new Set(['TITLE', 'TEXTAREA']);
const RAW_TEXT = new Set(['SCRIPT', 'STYLE']);

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function targetOf(el: Element): PatchTarget {
  return {
    setAttribute: (name, value) => el.setAttribute(name, value),
    removeAttribute: (name) => el.removeAttribute(name),
    // HTMLRewriter's setInnerContent: text is escaped unless { html: true }.
    setInnerContent: (content, options) => {
      if (options?.html) {
        el.innerHTML = content;
      } else if (RCDATA.has(el.tagName)) {
        // linkedom writes a <title>'s text out as-is, so a guild named
        // "</title><meta http-equiv=refresh …>" would become real markup.
        // Escaped here, the browser decodes it back to the exact name — which
        // is what lol-html (HTMLRewriter) produces.
        el.textContent = escapeText(content);
      } else if (RAW_TEXT.has(el.tagName)) {
        // No safe text escaping exists inside <script>/<style>; page.ts only
        // ever fills them through { html: true } with pre-escaped JSON.
        throw new Error(`refusing a text patch into <${el.tagName.toLowerCase()}>`);
      } else {
        el.textContent = content;
      }
    },
    remove: () => el.remove(),
  };
}

/** Apply every patch to every element its selector matches, as HTMLRewriter does. */
export function renderPage(template: string, patches: readonly PagePatch[]): string {
  const { document } = parseHTML(template);
  for (const patch of patches) {
    for (const el of Array.from(document.querySelectorAll(patch.selector))) {
      applyPatch(targetOf(el), patch);
    }
  }
  return document.toString();
}

// HTMLRewriter replacement for Node. page.ts already expresses the page edits
// as data (PagePatch) applied through a narrow PatchTarget interface, so the
// only runtime-specific part is this adapter over a linkedom element.

import { parseHTML } from 'linkedom';
import { applyPatch, type PagePatch, type PatchTarget } from './page';

function targetOf(el: Element): PatchTarget {
  return {
    setAttribute: (name, value) => el.setAttribute(name, value),
    removeAttribute: (name) => el.removeAttribute(name),
    // HTMLRewriter's setInnerContent: text is escaped unless { html: true }.
    setInnerContent: (content, options) => {
      if (options?.html) el.innerHTML = content;
      else el.textContent = content;
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

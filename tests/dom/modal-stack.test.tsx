import { StrictMode, useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/Modal';
import {
  acquireRootInert,
  isTopLayer,
  layerCount,
  lockBodyScroll,
  popLayer,
  pushLayer,
  releaseRootInert,
  resetModalStackForTests,
  unlockBodyScroll,
} from '../../src/lib/modalStack';

// Modal portals into document.body; Testing Library's automatic cleanup unmounts
// it, and tests/dom/setup.ts resets the module-level stack after every test.

/** index.html's mount point. Tests that look at inert need a real #root. */
function makeRoot(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return root;
}

// A #root left behind by a failed assertion must not make the next test's body inert.
afterEach(() => {
  document.getElementById('root')?.remove();
});

describe('modalStack', () => {
  it('only the newest layer is on top, and pops are out-of-order safe', () => {
    const lower = pushLayer();
    const upper = pushLayer();
    expect(layerCount()).toBe(2);
    expect(isTopLayer(upper)).toBe(true);
    expect(isTopLayer(lower)).toBe(false);

    popLayer(lower);
    expect(isTopLayer(upper)).toBe(true);
    popLayer(lower); // a StrictMode re-run popping twice is harmless
    expect(layerCount()).toBe(1);

    popLayer(upper);
    expect(layerCount()).toBe(0);
    expect(isTopLayer(upper)).toBe(false);
  });

  it('ref-counts inert on #root: first acquire marks it, last release clears it', () => {
    const root = makeRoot();
    acquireRootInert();
    acquireRootInert();
    expect(root).toHaveAttribute('inert');
    expect(root).toHaveAttribute('aria-hidden', 'true');

    releaseRootInert();
    expect(root).toHaveAttribute('inert');
    releaseRootInert();
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
  });

  it('ref-counts the body scroll lock and restores the value it found', () => {
    document.body.style.overflow = 'clip';
    lockBodyScroll();
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockBodyScroll();
    unlockBodyScroll(); // an extra unlock is ignored
    expect(document.body.style.overflow).toBe('clip');
    document.body.style.overflow = '';
  });

  it('reset empties the stack, zeroes the inert count and strips #root', () => {
    const root = makeRoot();
    pushLayer();
    acquireRootInert();
    acquireRootInert();
    lockBodyScroll();

    resetModalStackForTests();
    resetModalStackForTests(); // idempotent
    expect(layerCount()).toBe(0);
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('');

    // The count really is zero: one acquire + one release round-trips cleanly.
    acquireRootInert();
    expect(root).toHaveAttribute('inert');
    releaseRootInert();
    expect(root).not.toHaveAttribute('inert');
  });
});

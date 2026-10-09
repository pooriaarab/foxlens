// Functions that run in the page. `scripting.executeScript({ func })` sends
// only each function's source (Function.prototype.toString), so each one
// must be self-contained: no imports, no helpers from module scope.

/** The page facts that `capture` reads. */
export interface View {
  sx: number;
  sy: number;
  w: number;
  h: number;
  dpr: number;
  docW: number;
  docH: number;
  url: string;
  /** DOM changes counted since foxlens first ran in this page. */
  mutations: number;
}

declare global {
  interface Window {
    foxlensState?: { mutations: number; ids: WeakMap<Element, number>; nodes: Map<number, WeakRef<Element>>; next: number };
  }
}

/** Reads scroll, viewport and DPR, and starts counting DOM changes. */
export function readView(): View {
  let lens = window.foxlensState;
  if (!lens) {
    const state = { mutations: 0, ids: new WeakMap<Element, number>(), nodes: new Map<number, WeakRef<Element>>(), next: 1 };
    lens = window.foxlensState = state;
    new MutationObserver((records) => {
      state.mutations += records.length;
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  const root = document.documentElement;
  return {
    sx: scrollX, sy: scrollY, w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    docW: Math.max(root.scrollWidth, innerWidth), docH: Math.max(root.scrollHeight, innerHeight),
    url: location.href, mutations: lens.mutations,
  };
}

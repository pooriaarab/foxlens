// Functions that run in the page. `scripting.executeScript({ func })` sends
// only each function's source (Function.prototype.toString), so each one
// must be self-contained: no imports, no helpers from module scope. So the
// helpers live inside each function, and the scoping lint rule is off here.
/* eslint-disable unicorn/consistent-function-scoping */

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

/** What `locate` reports about the element under the point. */
export interface ElementInfo {
  tag: string;
  /** The ARIA role, or the role the tag implies. "" when there is none. */
  role: string;
  /** The accessible name: aria-label, aria-labelledby, alt, label, title, or text. */
  name: string;
  /** Visible text, up to 200 characters. */
  text: string;
  /** The element's box in document CSS pixels of the top page. */
  rect: { x: number; y: number; width: number; height: number };
  /** A control a person can use (button, link, field, canvas...). */
  interactive: boolean;
  /** A CSS selector inside the element's own document or shadow root. */
  selector: string;
  /** "same-origin" or "cross-origin" when the point is inside a frame. A cross-origin frame is not searched. */
  frame: "top" | "same-origin" | "cross-origin";
  /** Set when the element is inside a shadow root. */
  shadow?: "open" | "closed";
  /** The element on top that takes a click at this point, when it is not the found element. */
  coveredBy?: { tag: string; role: string; name: string; selector: string };
}

export type Hit =
  | { kind: "stale" | "offscreen" | "nothing" }
  | { kind: "hit"; point: { x: number; y: number }; element: ElementInfo; scrolled: boolean; mutations: number; lensNode: number; foxpawNode?: number };

/** Finds the element at a document point, through open and closed shadow roots and same-origin frames. */
export function hitTest(at: { x: number; y: number; w: number; h: number; dpr: number; sx: number; sy: number; mutations: number }): Hit {
  if (innerWidth !== at.w || innerHeight !== at.h || devicePixelRatio !== at.dpr) return { kind: "stale" };
  let [vx, vy] = [at.x - scrollX, at.y - scrollY];
  if (vx < 0 || vy < 0 || vx >= innerWidth || vy >= innerHeight) return { kind: "offscreen" };
  type Root = Document | ShadowRoot;
  const shadowOf = (e: Element) => (e as Element & { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot ?? e.shadowRoot;
  let root: Root = document;
  let top = document.elementFromPoint(vx, vy);
  let [ox, oy] = [0, 0];
  let frame: ElementInfo["frame"] = "top";
  let shadow: ElementInfo["shadow"];
  for (let depth = 0; top && depth < 20; depth++) {
    if (top.tagName === "IFRAME" || top.tagName === "FRAME") {
      const inner = (top as HTMLIFrameElement).contentDocument;
      if (!inner) {
        frame = "cross-origin";
        break;
      }
      const r = top.getBoundingClientRect();
      const style = getComputedStyle(top);
      const dx = r.left + top.clientLeft + parseFloat(style.paddingLeft);
      const dy = r.top + top.clientTop + parseFloat(style.paddingTop);
      [vx, vy, ox, oy] = [vx - dx, vy - dy, ox + dx, oy + dy];
      root = inner;
      top = inner.elementFromPoint(vx, vy);
      frame = "same-origin";
      continue;
    }
    const sr = shadowOf(top);
    const inner = sr?.elementFromPoint(vx, vy);
    if (!sr || !inner || inner === top) break;
    [root, top, shadow] = [sr, inner, sr.mode];
  }
  if (!top) return { kind: "nothing" };

  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,label,canvas,[role="button"],[role="link"],[role="checkbox"],' +
    '[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[onclick],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  const up = (e: Element): Element | null => e.parentElement ?? ((e.getRootNode() as ShadowRoot).host || null);
  const control = (e: Element | null): Element | null => {
    for (let n = e; n; n = up(n)) if (n.matches(INTERACTIVE)) return n;
    return null;
  };
  let target = control(top);
  let cover: Element | null = null;
  if (!target) {
    for (const below of root.elementsFromPoint(vx, vy)) {
      const found = control(below);
      if (found) {
        [target, cover] = [found, top];
        break;
      }
    }
  }
  target ??= top;
  if (target.tagName === "HTML" || target.tagName === "BODY") return { kind: "nothing" };

  const clean = (s: string | null | undefined, n = 200) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const IMPLIED: Record<string, string> = { BUTTON: "button", SUMMARY: "button", A: "link", SELECT: "combobox", TEXTAREA: "textbox", IMG: "img", H1: "heading", H2: "heading", H3: "heading", IFRAME: "document" };
  const role = (e: Element): string => {
    const explicit = e.getAttribute("role");
    if (explicit) return explicit.split(" ")[0]!;
    if (e.tagName === "INPUT") {
      const type = (e as HTMLInputElement).type;
      return ["checkbox", "radio"].includes(type) ? type : ["submit", "button", "reset", "image"].includes(type) ? "button" : "textbox";
    }
    return IMPLIED[e.tagName] ?? "";
  };
  const name = (e: Element): string => {
    const owner = e.getRootNode() as Root;
    const by = e.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => owner.getElementById?.(id)?.textContent ?? "").join(" ");
    const img = e.tagName === "IMG" ? e : e.querySelector("img[alt]");
    const labels = (e as HTMLInputElement).labels;
    return clean(e.getAttribute("aria-label") || by || img?.getAttribute("alt") || (labels?.[0]?.textContent ?? "") ||
      e.getAttribute("title") || (e as HTMLElement).innerText || e.getAttribute("placeholder") || (e as HTMLInputElement).value || "");
  };
  const selector = (e: Element): string => {
    const parts: string[] = [];
    for (let n: Element | null = e; n && parts.length < 4; n = n.parentElement) {
      if (n.id) {
        parts.unshift(`#${CSS.escape(n.id)}`);
        break;
      }
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n!.tagName) : [];
      parts.unshift(same.length > 1 ? `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})` : n.tagName.toLowerCase());
    }
    return parts.join(" > ");
  };
  const r = target.getBoundingClientRect();
  const state = (window.foxlensState ??= { mutations: 0, ids: new WeakMap(), nodes: new Map(), next: 1 });
  if (!state.ids.has(target)) state.ids.set(target, state.next++);
  const lensNode = state.ids.get(target)!;
  state.nodes.set(lensNode, new WeakRef(target));
  const paw = (window as unknown as Record<string, { ids?: WeakMap<Element, number> } | undefined>)["__foxpaw"];
  const foxpawNode = frame === "top" ? paw?.ids?.get(target) : undefined;
  return {
    kind: "hit",
    point: { x: at.x - scrollX, y: at.y - scrollY },
    element: {
      tag: target.tagName.toLowerCase(), role: role(target), name: name(target), text: clean((target as HTMLElement).innerText),
      rect: { x: r.left + ox + scrollX, y: r.top + oy + scrollY, width: r.width, height: r.height },
      interactive: target.matches(INTERACTIVE), selector: selector(target), frame,
      ...(shadow ? { shadow } : {}),
      ...(cover ? { coveredBy: { tag: cover.tagName.toLowerCase(), role: role(cover), name: name(cover), selector: selector(cover) } } : {}),
    },
    scrolled: scrollX !== at.sx || scrollY !== at.sy,
    mutations: state.mutations - at.mutations,
    lensNode,
    ...(foxpawNode === undefined ? {} : { foxpawNode }),
  };
}

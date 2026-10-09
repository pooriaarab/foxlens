/** A rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of the WebExtension `browser` object that foxlens uses. Pass a fake in tests. */
export interface LensBrowser {
  tabs: {
    captureTab(tabId: number, details?: { format?: "png"; rect?: Rect; scale?: number }): Promise<string>;
    getZoom?(tabId: number): Promise<number>;
  };
  scripting: {
    executeScript(details: {
      target: { tabId: number; frameIds?: number[]; documentIds?: string[] };
      func: (...args: never[]) => unknown;
      args?: unknown[];
      world?: "ISOLATED" | "MAIN";
    }): Promise<{ frameId: number; result?: unknown; error?: unknown; documentId?: string }[]>;
  };
  trial?: { ml?: unknown };
  permissions?: { contains(permissions: { permissions?: string[] }): Promise<boolean> };
}

/** The global `browser` object of the extension. */
export function api(): LensBrowser {
  const found = (globalThis as { browser?: LensBrowser }).browser;
  if (!found?.tabs || !found.scripting) throw new Error("foxlens needs the WebExtension browser.tabs and browser.scripting APIs. Run it in a Firefox extension, or pass the browser option.");
  return found;
}

/** Runs a bundled page function in the top frame, in the given document when known. */
export async function inPage<T>(browser: LensBrowser, tabId: number, func: (...args: never[]) => unknown, args: unknown[], documentId?: string): Promise<{ result: T; documentId?: string }> {
  const target = documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] };
  const [first] = await browser.scripting.executeScript({ target, func, args, world: "ISOLATED" });
  if (!first) throw new Error("The page returned no result.");
  if (first.error) throw first.error instanceof Error ? first.error : new Error(String((first.error as { message?: string }).message ?? first.error));
  return { result: first.result as T, documentId: first.documentId };
}

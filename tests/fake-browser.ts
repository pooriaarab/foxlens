// A fake WebExtension `browser` object for the isolated tests. It returns
// fixed page facts and a fixed PNG, or throws the errors Firefox throws.
import type { LensBrowser } from "../src/browser.js";

/** A PNG data URL with this width and height in its IHDR chunk. Only the header is real. */
export function pngOf(width: number, height: number): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

export interface View { sx: number; sy: number; w: number; h: number; dpr: number; docW: number; docH: number; url: string; mutations: number }

export function fakeBrowser(options: {
  view?: Partial<View>;
  zoom?: number;
  png?: (rect: { width: number; height: number }, scale: number | undefined) => string;
  captureError?: string;
  scriptError?: string;
  calls?: unknown[];
  /** What the page answers to hitTest. */
  hit?: unknown;
}): LensBrowser {
  const view: View = { sx: 0, sy: 0, w: 1000, h: 700, dpr: 1, docW: 1000, docH: 700, url: "http://127.0.0.1/a.html", mutations: 0, ...options.view };
  return {
    tabs: {
      async captureTab(_tabId, details) {
        options.calls?.push(details);
        if (options.captureError) throw new Error(options.captureError);
        const rect = details?.rect ?? { width: view.w, height: view.h };
        const ratio = (details?.scale ?? view.dpr / (options.zoom ?? 1)) * (options.zoom ?? 1);
        return options.png ? options.png(rect, details?.scale) : pngOf(Math.round(rect.width * ratio), Math.round(rect.height * ratio));
      },
      async getZoom() {
        return options.zoom ?? 1;
      },
    },
    scripting: {
      async executeScript(details) {
        if (options.scriptError) throw new Error(options.scriptError);
        const grid = details.args?.[0] as { region?: { x: number; y: number; width: number; height: number }; rows: number } | undefined;
        const result = details.func.name === "hitTest" ? options.hit
          : details.func.name === "drawGrid" ? { region: grid?.region ?? { x: 0, y: 0, width: view.w, height: view.h }, rows: grid?.rows || 6, sx: view.sx, sy: view.sy }
          : details.func.name === "removeGrid" ? undefined : view;
        return [{ frameId: 0, documentId: "doc-1", result }];
      },
    },
  };
}

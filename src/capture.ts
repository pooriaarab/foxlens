import { api, inPage, type LensBrowser, type Rect } from "./browser.js";
import { FoxlensError, fromFirefox } from "./errors.js";
import { readView, type View } from "./page.js";
import { pngSize } from "./png.js";

/** A screenshot and the page facts needed to map its pixels back to the page. */
export interface Capture {
  /** The PNG as a data URL. */
  dataUrl: string;
  /** Image size in image pixels. */
  width: number;
  height: number;
  /** The captured area, in document CSS pixels. */
  rect: Rect;
  /** Image pixels per CSS pixel, measured from the PNG size. */
  pxPerCss: number;
  /** True when foxlens lowered the scale to fit `maxSide`. */
  downscaled: boolean;
  /** The page's devicePixelRatio (screen DPR times page zoom). */
  dpr: number;
  /** The tab's page zoom, when Firefox reports it. */
  zoom?: number;
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
  url: string;
  /** The document that was captured (Firefox 153+). Later calls target only it. */
  documentId?: string;
  /** DOM changes counted in the page at capture time. */
  mutations: number;
  /** Date.now() at capture time. */
  at: number;
}

export interface CaptureOptions {
  /** The area to capture, in document CSS pixels. Default: the visible viewport. */
  rect?: Rect;
  /** Image pixels per CSS pixel. Default: the page's devicePixelRatio. */
  scale?: number;
  /** The longest image side allowed. foxlens lowers the scale to fit. Default 2048. */
  maxSide?: number;
  browser?: LensBrowser;
}

/** The scale to ask for so that the longer side of `rect` is at most `maxSide` image pixels. */
export function fitScale(rect: Rect, scale: number, maxSide: number): { scale: number; downscaled: boolean } {
  const longest = Math.max(rect.width, rect.height) * scale;
  return longest <= maxSide ? { scale, downscaled: false } : { scale: maxSide / Math.max(rect.width, rect.height), downscaled: true };
}

/** Screenshots a tab with `tabs.captureTab` and records how its pixels map to the page. */
export async function capture(tabId: number, options: CaptureOptions = {}): Promise<Capture> {
  const browser = options.browser ?? api();
  let view: View;
  let documentId: string | undefined;
  try {
    ({ result: view, documentId } = await inPage<View>(browser, tabId, readView, []));
  } catch (error) {
    throw fromFirefox(error, "Cannot read the page");
  }
  const zoom = await browser.tabs.getZoom?.(tabId).catch(() => undefined);
  const rect = options.rect ?? { x: view.sx, y: view.sy, width: view.w, height: view.h };
  if (!(rect.width > 0 && rect.height > 0)) throw new FoxlensError("bad_image", "The capture rect has no area.");
  const wanted = fitScale(rect, options.scale ?? view.dpr, options.maxSide ?? 2048);
  let dataUrl: string;
  try {
    // Firefox multiplies `scale` by the page zoom, so divide the zoom out.
    dataUrl = await browser.tabs.captureTab(tabId, { format: "png", rect, scale: wanted.scale / (zoom ?? 1) });
  } catch (error) {
    throw fromFirefox(error, "Cannot capture the tab");
  }
  const { width, height } = pngSize(dataUrl);
  return {
    dataUrl, width, height, rect, pxPerCss: width / rect.width, downscaled: wanted.downscaled, dpr: view.dpr,
    ...(zoom === undefined ? {} : { zoom }), scroll: { x: view.sx, y: view.sy }, viewport: { width: view.w, height: view.h },
    url: view.url, ...(documentId ? { documentId } : {}), mutations: view.mutations, at: Date.now(),
  };
}

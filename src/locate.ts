import { api, inPage, type LensBrowser } from "./browser.js";
import { capture, type Capture } from "./capture.js";
import { FoxlensError, fromFirefox } from "./errors.js";
import { privacyOf, type Eyes, type Privacy } from "./eyes.js";
import { hitTest, type ElementInfo, type Hit } from "./page.js";
import { readPoint, toDocument, type Box, type Coordinates, type Point } from "./reply.js";
import { eyesOf } from "./vision.js";
import type { Mind } from "foxmind";

export interface LocateOptions {
  /** A foxmind Mind with a vision chat model. */
  mind?: Mind;
  /** Any vision model that can point. Used before `mind`. */
  eyes?: Eyes;
  /** Let a Mind send the screenshot to a cloud provider. Default false. */
  allowCloud?: boolean;
  /** Use this capture instead of taking a new one. */
  capture?: Capture;
  /** The scale the model gives coordinates in. Default "per1000" (Qwen-VL and many open models). */
  coordinates?: Coordinates;
  browser?: LensBrowser;
  signal?: AbortSignal;
}

/** The capture facts in a result, without the PNG. */
export type CaptureFacts = Omit<Capture, "dataUrl">;

interface Base {
  description: string;
  /** The model's raw reply. */
  reply: string;
  privacy: Privacy;
  capture: CaptureFacts;
  /** Time spent in the model call. */
  modelMs: number;
}

export interface Found extends Base {
  found: true;
  /** The point in viewport CSS pixels, at the time of the hit test. */
  point: Point;
  /** The point in document CSS pixels. */
  docPoint: Point;
  /** The box the model gave, in image pixels. */
  imageBox?: Box;
  element: ElementInfo;
  /** foxlens's id for the element in the page, for `clickAt` and `outline`. */
  lensNode: number;
  /** foxpaw's node number for the element, when foxpaw has read the page. */
  foxpawNode?: number;
  /** How well the description's words match the element's role, name and text, from 0 to 1. */
  check: { match: number; words: string[] };
  /** What changed since the capture. A scroll is corrected. DOM changes are only counted. */
  changed: { scrolled: boolean; mutations: number };
}

export type NotFoundReason = "not_found" | "out_of_image" | "bad_reply" | "offscreen" | "stale" | "nothing_there";
export interface NotFound extends Base {
  found: false;
  reason: NotFoundReason;
}

export type LocateResult = Found | NotFound;

const STOP = new Set(["the", "and", "for", "with", "that", "this", "find", "click", "into", "from", "near", "next", "one"]);

/** The share of the description's words that appear in the element's role, name or text. */
export function matchWords(description: string, element: Pick<ElementInfo, "role" | "name" | "text" | "tag">): { match: number; words: string[] } {
  const words = [...new Set(description.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))];
  const said = ` ${[element.role, element.name, element.text, element.tag].join(" ").toLowerCase()} `;
  const hits = words.filter((w) => said.includes(w));
  return { match: words.length ? Math.round((hits.length / words.length) * 100) / 100 : 0, words: hits };
}

export function pointPrompt(description: string, width: number, height: number, coordinates: Coordinates): string {
  const scale = coordinates === "per1000" ? "on a 0 to 1000 scale for both axes" : "in image pixels";
  return `Find this element in the screenshot: "${description}". The image is ${width} x ${height} pixels. ` +
    `Give its bounding box ${scale}, x from the left edge and y from the top edge. ` +
    'Reply with JSON only: {"bbox_2d": [x1, y1, x2, y2]}. If it is not in the image, reply {"found": false}.';
}

/** Asks a vision model where the element is, maps the point back to the page, and hit-tests it. */
export async function locate(tabId: number, description: string, options: LocateOptions): Promise<LocateResult> {
  const browser = options.browser ?? api();
  const eyes = eyesOf(options);
  if (!eyes.canPoint) throw new FoxlensError("unsupported", `${eyes.name} gives captions only and cannot point at an element. Use a vision chat model.`);
  const shot = options.capture ?? (await capture(tabId, { browser }));
  const coordinates = options.coordinates ?? "per1000";
  const seen = await eyes.ask(shot.dataUrl, pointPrompt(description, shot.width, shot.height, coordinates), { json: true, signal: options.signal });
  const { dataUrl: _png, ...facts } = shot;
  const base: Base = { description, reply: seen.text, privacy: privacyOf(seen), capture: facts, modelMs: seen.ms };
  const read = readPoint(seen.text, { width: shot.width, height: shot.height, coordinates });
  if (!read.ok) return { ...base, found: false, reason: read.reason };
  const docPoint = toDocument(shot, read.point);
  let hit: Hit;
  try {
    const at = { ...docPoint, w: shot.viewport.width, h: shot.viewport.height, dpr: shot.dpr, sx: shot.scroll.x, sy: shot.scroll.y, mutations: shot.mutations };
    ({ result: hit } = await inPage<Hit>(browser, tabId, hitTest, [at], shot.documentId));
  } catch (error) {
    const mapped = fromFirefox(error, "Cannot hit-test the page");
    if (mapped.code === "stale") return { ...base, found: false, reason: "stale" };
    throw mapped;
  }
  if (hit.kind !== "hit") return { ...base, found: false, reason: hit.kind === "nothing" ? "nothing_there" : hit.kind };
  return {
    ...base, found: true, point: hit.point, docPoint, ...(read.box ? { imageBox: read.box } : {}), element: hit.element,
    lensNode: hit.lensNode, ...(hit.foxpawNode === undefined ? {} : { foxpawNode: hit.foxpawNode }),
    check: matchWords(description, hit.element), changed: { scrolled: hit.scrolled, mutations: hit.mutations },
  };
}

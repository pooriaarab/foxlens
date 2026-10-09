import { api, inPage, type LensBrowser } from "./browser.js";
import { capture, type Capture } from "./capture.js";
import { FoxlensError, fromFirefox } from "./errors.js";
import { privacyOf, type Eyes, type Privacy, type Seen } from "./eyes.js";
import { drawOutline, hitTest, type ElementInfo, type Hit } from "./page.js";
import { readPoint, toDocument, type Box, type Coordinates, type Point } from "./reply.js";
import { eyesOf } from "./vision.js";
import { gridLocate } from "./grid.js";
import type { Mind } from "foxmind";

/** The part of a foxpaw Control that foxlens matches on. */
export interface PawControl {
  frameId: number;
  node: number;
}

export interface LocateOptions<C extends PawControl = PawControl> {
  /** A foxpaw Snapshot taken before locate. Its matching control comes back as `control`. */
  snapshot?: { controls: C[] };
  /** A foxmind Mind with a vision chat model. */
  mind?: Mind;
  /** Any vision model that can point. Used before `mind`. */
  eyes?: Eyes;
  /** Let a Mind send the screenshot to a cloud provider. Default false. */
  allowCloud?: boolean;
  /** Use this capture instead of taking a new one. */
  capture?: Capture;
  /**
   * Grid mode for weak models: the number of columns of numbered cells drawn over the
   * page. The model names a cell, then a cell in a finer grid around it (two calls).
   */
  grid?: number;
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
  /** In grid mode, the cells the model named. */
  cells?: number[];
}

export interface Found<C extends PawControl = PawControl> extends Base {
  found: true;
  /** The point in viewport CSS pixels, at the time of the hit test. */
  point: Point;
  /** The point in document CSS pixels. */
  docPoint: Point;
  /** The box the model gave, in image pixels. */
  imageBox?: Box;
  /** The same box in document CSS pixels. */
  docBox?: { x: number; y: number; width: number; height: number };
  element: ElementInfo;
  /** foxlens's id for the element in the page, for `clickAt` and `outline`. */
  lensNode: number;
  /** foxpaw's node number for the element, when foxpaw has read the page. */
  foxpawNode?: number;
  /** The foxpaw control for the element, from `snapshot`. Pass it to foxpaw's act with that snapshot. */
  control?: C;
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

export type LocateResult<C extends PawControl = PawControl> = Found<C> | NotFound;

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

function boxOnPage(shot: Capture, [x1, y1, x2, y2]: Box) {
  const a = toDocument(shot, { x: x1, y: y1 });
  const b = toDocument(shot, { x: x2, y: y2 });
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

/** Asks a vision model where the element is, maps the point back to the page, and hit-tests it. */
export async function locate<C extends PawControl = PawControl>(tabId: number, description: string, options: LocateOptions<C>): Promise<LocateResult<C>> {
  const browser = options.browser ?? api();
  const eyes = eyesOf(options);
  if (!eyes.canPoint) throw new FoxlensError("unsupported", `${eyes.name} gives captions only and cannot point at an element. Use a vision chat model.`);
  let shot: Capture;
  let base: Base;
  let docPoint: Point;
  let imageBox: Box | undefined;
  const pack = (seen: Seen, taken: Capture): Base => {
    const { dataUrl: _png, ...facts } = taken;
    return { description, reply: seen.text, privacy: privacyOf(seen), capture: facts, modelMs: seen.ms };
  };
  if (options.grid) {
    const answer = await gridLocate(browser, tabId, eyes, description, options.grid, options.signal);
    shot = answer.shot;
    base = { ...pack(answer.seen, shot), cells: answer.cells };
    if (!answer.read.ok || !answer.docPoint) return { ...base, found: false, reason: answer.read.ok ? "bad_reply" : answer.read.reason };
    docPoint = answer.docPoint;
  } else {
    shot = options.capture ?? (await capture(tabId, { browser }));
    const coordinates = options.coordinates ?? "per1000";
    const seen = await eyes.ask(shot.dataUrl, pointPrompt(description, shot.width, shot.height, coordinates), { json: true, signal: options.signal });
    base = pack(seen, shot);
    const read = readPoint(seen.text, { width: shot.width, height: shot.height, coordinates });
    if (!read.ok) return { ...base, found: false, reason: read.reason };
    docPoint = toDocument(shot, read.point);
    imageBox = read.box;
  }
  let hit: Hit;
  try {
    const at = { ...docPoint, w: shot.viewport.width, h: shot.viewport.height, dpr: shot.dpr, sx: shot.scroll.x, sy: shot.scroll.y, mutations: shot.mutations };
    ({ result: hit } = await inPage<Hit>(browser, tabId, hitTest, [at], shot.documentId));
  } catch (error) {
    const mapped = fromFirefox(error, "Cannot hit-test the page");
    if (mapped.code === "stale") return { ...base, found: false, reason: "stale" };
    throw mapped;
  }
  if (hit.kind !== "hit") return { ...base, found: false, reason: hit.kind === "offscreen" ? "offscreen" : hit.kind === "nothing" ? "nothing_there" : "stale" };
  const control = hit.foxpawNode === undefined ? undefined : options.snapshot?.controls.find((c) => c.frameId === 0 && c.node === hit.foxpawNode);
  return {
    ...base, found: true, point: hit.point, docPoint, ...(imageBox ? { imageBox, docBox: boxOnPage(shot, imageBox) } : {}), element: hit.element,
    lensNode: hit.lensNode, ...(hit.foxpawNode === undefined ? {} : { foxpawNode: hit.foxpawNode }), ...(control ? { control } : {}),
    check: matchWords(description, hit.element), changed: { scrolled: hit.scrolled, mutations: hit.mutations },
  };
}

export type ClickResult = { ok: true } | { ok: false; reason: "stale" | "covered" | "offscreen" };

/**
 * Clicks the point of a found element with in-page pointer and mouse events. Use it
 * for elements foxpaw cannot act on, such as a canvas. It refuses when the page
 * navigated, the layout changed, another element is now at the point, or an
 * element covers it.
 */
export async function clickAt(tabId: number, found: Found<PawControl>, options: { browser?: LensBrowser } = {}): Promise<ClickResult> {
  const browser = options.browser ?? api();
  const shot = found.capture;
  const at = { ...found.docPoint, w: shot.viewport.width, h: shot.viewport.height, dpr: shot.dpr, sx: shot.scroll.x, sy: shot.scroll.y, mutations: 0, click: found.lensNode };
  let hit: Hit;
  try {
    ({ result: hit } = await inPage<Hit>(browser, tabId, hitTest, [at], shot.documentId));
  } catch (error) {
    const mapped = fromFirefox(error, "Cannot click the page");
    if (mapped.code === "stale") return { ok: false, reason: "stale" };
    throw mapped;
  }
  if (hit.kind === "clicked") return { ok: true };
  return { ok: false, reason: hit.kind === "offscreen" || hit.kind === "covered" ? hit.kind : "stale" };
}

/**
 * Draws a box around a found element, or with `box: true` around the box the model
 * gave (useful on a canvas, where the element is the whole canvas). With `ms`, the
 * box goes away after that time. Returns the box in document CSS pixels.
 */
export async function outline(tabId: number, found: Found<PawControl>, options: { box?: boolean; colour?: string; ms?: number; browser?: LensBrowser } = {}) {
  const browser = options.browser ?? api();
  const model = options.box && found.docBox;
  const args = { lensNode: model ? 0 : found.lensNode, rect: model || found.element.rect, colour: options.colour ?? "#e11d48", ms: options.ms ?? 0 };
  try {
    return (await inPage<Found["element"]["rect"]>(browser, tabId, drawOutline, [args], found.capture.documentId)).result;
  } catch (error) {
    throw fromFirefox(error, "Cannot draw the outline");
  }
}

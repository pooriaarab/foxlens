// Grid mode for weak models: number the cells of a grid drawn over the page,
// ask which cell holds the element, then repeat with finer cells over the
// area around that cell. The answer is a cell, so no image scale is involved.
import { inPage, type LensBrowser, type Rect } from "./browser.js";
import { capture, type Capture } from "./capture.js";
import { fromFirefox } from "./errors.js";
import type { Eyes, Seen } from "./eyes.js";
import { firstJson, type Point } from "./reply.js";

export type CellRead = { ok: true; cell: number } | { ok: false; reason: "not_found" | "out_of_image" | "bad_reply" };

/** The cell number in a reply, from 1 to `cells`. */
export function readCell(text: string, cells: number): CellRead {
  const json = firstJson(text) as { cell?: unknown; found?: unknown } | number | null | undefined;
  let value: unknown;
  if (json === null || (typeof json === "object" && (json.found === false || json.cell === null))) return { ok: false, reason: "not_found" };
  if (typeof json === "number") value = json;
  else if (json && typeof json === "object" && "cell" in json) value = typeof json.cell === "string" ? Number(json.cell) : json.cell;
  else {
    const numbers = text.match(/\d+(?:\.\d+)?/g);
    if (numbers?.length !== 1) return { ok: false, reason: "bad_reply" };
    value = Number(numbers[0]);
  }
  if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, reason: "bad_reply" };
  return value >= 1 && value <= cells ? { ok: true, cell: value } : { ok: false, reason: "out_of_image" };
}

export function gridPrompt(description: string, cols: number, rows: number): string {
  return `The screenshot has a grid of ${cols} x ${rows} numbered cells, counted from 1 at the top left, left to right, then top to bottom. ` +
    `Which cell holds the centre of this element: "${description}"? Reply with JSON only: {"cell": n}. If the element is not in the image, reply {"found": false}.`;
}

/**
 * Draws numbered cells over a viewport region (CSS pixels) and waits for a paint.
 * No region means the whole viewport. Rows 0 means rows that keep the cells near square.
 */
export async function drawGrid(at: { region?: Rect; cols: number; rows: number }) {
  document.getElementById("foxlens-grid")?.remove();
  const region = at.region ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const rows = at.rows || Math.max(1, Math.round((at.cols * region.height) / region.width));
  const grid = document.createElement("div");
  grid.id = "foxlens-grid";
  grid.style.cssText = `position:fixed;left:${region.x}px;top:${region.y}px;width:${region.width}px;height:${region.height}px;` +
    `display:grid;grid-template:repeat(${rows},1fr)/repeat(${at.cols},1fr);pointer-events:none;z-index:2147483647;margin:0`;
  for (let n = 1; n <= at.cols * rows; n++) {
    const cell = document.createElement("div");
    cell.style.cssText = "border:1px solid rgba(255,0,64,0.8);box-sizing:border-box;font:bold 12px sans-serif;color:#fff;overflow:hidden";
    const label = document.createElement("span");
    label.style.cssText = "background:rgba(0,0,0,0.7);padding:0 3px";
    label.textContent = String(n);
    cell.append(label);
    grid.append(cell);
  }
  document.documentElement.append(grid);
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  return { region, rows, sx: scrollX, sy: scrollY };
}

export function removeGrid() {
  document.getElementById("foxlens-grid")?.remove();
}

/** One pass: draw, capture, remove, ask. */
async function pass(browser: LensBrowser, tabId: number, eyes: Eyes, description: string, cols: number, rows: number, region: Rect | undefined, signal?: AbortSignal) {
  let shot: Capture;
  let drawn: { region: Rect; rows: number; sx: number; sy: number };
  try {
    ({ result: drawn } = await inPage<typeof drawn>(browser, tabId, drawGrid, [{ region, cols, rows }]));
    shot = await capture(tabId, { browser, ...(region ? { rect: { ...drawn.region, x: drawn.region.x + drawn.sx, y: drawn.region.y + drawn.sy } } : {}) });
  } catch (error) {
    throw fromFirefox(error, "Cannot draw the grid");
  } finally {
    await inPage(browser, tabId, removeGrid, []).catch(() => undefined);
  }
  const seen = await eyes.ask(shot.dataUrl, gridPrompt(description, cols, drawn.rows), { signal });
  return { shot, seen, drawn, read: readCell(seen.text, cols * drawn.rows) };
}

/** Viewport rect of one cell. */
function cellRect(region: Rect, cols: number, rows: number, cell: number): Rect {
  const [w, h] = [region.width / cols, region.height / rows];
  return { x: region.x + ((cell - 1) % cols) * w, y: region.y + Math.floor((cell - 1) / cols) * h, width: w, height: h };
}

export interface GridAnswer {
  /** The first capture, for the hit test. */
  shot: Capture;
  /** Every model call, in order. */
  seen: Seen[];
  cells: number[];
  read: CellRead;
  docPoint?: Point;
}

/** Two grid passes: `cols` columns over the viewport, then 6 x 6 cells over the 3 x 3 cells around the answer. */
export async function gridLocate(browser: LensBrowser, tabId: number, eyes: Eyes, description: string, cols: number, signal?: AbortSignal): Promise<GridAnswer> {
  const first = await pass(browser, tabId, eyes, description, cols, 0, undefined, signal);
  if (!first.read.ok) return { shot: first.shot, seen: [first.seen], cells: [], read: first.read };
  const view = first.drawn.region;
  const hit = cellRect(view, cols, first.drawn.rows, first.read.cell);
  const x = Math.max(view.x, hit.x - hit.width);
  const y = Math.max(view.y, hit.y - hit.height);
  const near = { x, y, width: Math.min(view.x + view.width, hit.x + 2 * hit.width) - x, height: Math.min(view.y + view.height, hit.y + 2 * hit.height) - y };
  const second = await pass(browser, tabId, eyes, description, 6, 6, near, signal);
  const cells = second.read.ok ? [first.read.cell, second.read.cell] : [first.read.cell];
  if (!second.read.ok) return { shot: first.shot, seen: [first.seen, second.seen], cells, read: second.read };
  const fine = cellRect(second.drawn.region, 6, 6, second.read.cell);
  const docPoint = { x: second.drawn.sx + fine.x + fine.width / 2, y: second.drawn.sy + fine.y + fine.height / 2 };
  return { shot: first.shot, seen: [first.seen, second.seen], cells, read: second.read, docPoint };
}

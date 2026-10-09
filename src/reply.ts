// Reads a point or a box out of a vision model's reply. Models wrap JSON in
// code fences, use different keys, and sometimes answer in plain words.

export type Coordinates = "per1000" | "pixels";
export interface Point {
  x: number;
  y: number;
}
export type Box = [number, number, number, number];
export type Read = { ok: true; point: Point; box?: Box } | { ok: false; reason: "not_found" | "out_of_image" | "bad_reply" };

/** The first JSON object or array in the text, or undefined. */
export function firstJson(text: string): unknown {
  const body = text.replace(/```(?:json)?/gi, " ");
  for (let start = 0; start < body.length; start++) {
    if (body[start] !== "{" && body[start] !== "[") continue;
    const close = body[start] === "{" ? "}" : "]";
    for (let end = body.lastIndexOf(close); end > start; end = body.lastIndexOf(close, end - 1)) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        // Try a shorter slice.
      }
    }
  }
  if (/^\s*null\s*$/.test(body)) return null;
  return undefined;
}

const KEYS = ["bbox_2d", "bbox", "box", "point_2d", "point", "coordinates", "position"];

/** The numbers the model gave, or "none" when it said it found nothing. */
function numbersOf(value: unknown): unknown[] | "none" | undefined {
  if (value === null) return "none";
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    if (value.length === 2 || value.length === 4) {
      if (value.every((v) => typeof v === "number" || typeof v === "string")) return value;
    }
    return numbersOf(value[0]);
  }
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.found === false) return "none";
  for (const key of KEYS) if (key in record) return record[key] === null ? "none" : numbersOf(record[key]);
  if ("x1" in record) return [record.x1, record.y1, record.x2, record.y2];
  if ("x" in record && "y" in record) return [record.x, record.y];
  return undefined;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The image-pixel point (and box) in the reply. Out-of-image values are refused, not clamped. */
export function readPoint(text: string, image: { width: number; height: number; coordinates: Coordinates }): Read {
  let found = numbersOf(firstJson(text));
  if (found === undefined) {
    const bare = text.match(/-?\d+(?:\.\d+)?/g);
    if (bare && (bare.length === 2 || bare.length === 4)) found = bare;
    else if (/\b(not|no|cannot|can't|unable|none)\b/i.test(text)) return { ok: false, reason: "not_found" };
  }
  if (found === "none") return { ok: false, reason: "not_found" };
  if (!found) return { ok: false, reason: "bad_reply" };
  const values = found.map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v));
  if (!values.every((v): v is number => typeof v === "number" && Number.isFinite(v))) return { ok: false, reason: "bad_reply" };
  const [x1, y1, x2 = x1, y2 = y1] = values as number[];
  if (x2! < x1! || y2! < y1!) return { ok: false, reason: "bad_reply" };
  const [maxX, maxY] = image.coordinates === "per1000" ? [1000, 1000] : [image.width, image.height];
  if ([x1, x2].some((v) => v! < 0 || v! > maxX) || [y1, y2].some((v) => v! < 0 || v! > maxY)) return { ok: false, reason: "out_of_image" };
  const sx = image.coordinates === "per1000" ? image.width / 1000 : 1;
  const sy = image.coordinates === "per1000" ? image.height / 1000 : 1;
  const point = { x: round(((x1! + x2!) / 2) * sx), y: round(((y1! + y2!) / 2) * sy) };
  return values.length === 4 ? { ok: true, point, box: [round(x1! * sx), round(y1! * sy), round(x2! * sx), round(y2! * sy)] } : { ok: true, point };
}

/** Image pixels to document CSS pixels: divide by the measured ratio, add the captured rect's origin. */
export function toDocument(shot: { rect: { x: number; y: number }; pxPerCss: number }, point: Point): Point {
  return { x: round(shot.rect.x + point.x / shot.pxPerCss), y: round(shot.rect.y + point.y / shot.pxPerCss) };
}

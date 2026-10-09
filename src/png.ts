import { FoxlensError } from "./errors.js";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height of a PNG data URL, read from its IHDR chunk with no decode. */
export function pngSize(dataUrl: string): { width: number; height: number } {
  const match = /^data:image\/png;base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new FoxlensError("bad_image", `Expected a PNG data URL, got ${dataUrl.slice(0, 30)}...`);
  const head = atob(match[1]!.slice(0, 44).replace(/=+$/, "").slice(0, 32));
  if (head.length < 24) throw new FoxlensError("bad_image", "The PNG data is too short to hold a header.");
  if (SIGNATURE.some((byte, i) => head.charCodeAt(i) !== byte) || head.slice(12, 16) !== "IHDR") {
    throw new FoxlensError("bad_image", "The data URL says PNG, but the bytes are not a PNG header.");
  }
  const word = (at: number) => ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0;
  const size = { width: word(16), height: word(20) };
  if (!size.width || !size.height) throw new FoxlensError("bad_image", "The PNG header says the image is empty.");
  return size;
}

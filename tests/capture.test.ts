// C1-C7: capture measures the image, maps Firefox errors, and caps huge rects.
import { describe, expect, it } from "vitest";
import { capture, fitScale, FoxlensError, pngSize } from "../src/index.js";
import { fakeBrowser, pngOf } from "./fake-browser.js";

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof FoxlensError ? error.code : `not a FoxlensError: ${String(error)}`;
  }
  return "no error";
};

describe("pngSize", () => {
  it("reads the width and height from the PNG header", () => {
    expect(pngSize(pngOf(2000, 1400))).toEqual({ width: 2000, height: 1400 });
  });

  it("refuses data that is not a PNG data URL (C7)", () => {
    expect(() => pngSize("data:image/jpeg;base64,/9j/4AAQ")).toThrow(FoxlensError);
    expect(() => pngSize("not a url")).toThrow(/PNG/);
    expect(() => pngSize("data:image/png;base64,iVBORw0KGgo=")).toThrow(/short/);
  });
});

describe("capture", () => {
  it("measures image pixels per CSS pixel from the PNG, not from devicePixelRatio (C1, C2)", async () => {
    const shot = await capture(1, { browser: fakeBrowser({ view: { dpr: 3, w: 667, h: 467 }, zoom: 1.5, png: () => pngOf(2001, 1401) }) });
    expect(shot.pxPerCss).toBeCloseTo(3, 2);
    expect(shot.rect).toEqual({ x: 0, y: 0, width: 667, height: 467 });
    expect(shot.dpr).toBe(3);
    expect(shot.documentId).toBe("doc-1");
  });

  it("captures the viewport at the scroll offsets (C3)", async () => {
    const calls: unknown[] = [];
    const shot = await capture(1, { browser: fakeBrowser({ view: { sx: 10, sy: 1150, docH: 3000 }, calls }) });
    expect(calls[0]).toMatchObject({ rect: { x: 10, y: 1150, width: 1000, height: 700 } });
    expect(shot.scroll).toEqual({ x: 10, y: 1150 });
    expect(shot.viewport).toEqual({ width: 1000, height: 700 });
  });

  it("maps a missing host permission to code permission (C4)", async () => {
    expect(await code(capture(1, { browser: fakeBrowser({ scriptError: "Missing host permission for the tab" }) }))).toBe("permission");
    expect(await code(capture(1, { browser: fakeBrowser({ captureError: "Missing host permission for the tab" }) }))).toBe("permission");
  });

  it("maps a missing tab to no_tab and a privileged page to permission (C5)", async () => {
    expect(await code(capture(9, { browser: fakeBrowser({ scriptError: "Invalid tab ID: 9" }) }))).toBe("no_tab");
    expect(await code(capture(1, { browser: fakeBrowser({ scriptError: "Missing host permission for the tab, or cannot access this page" }) }))).toBe("permission");
  });

  it("refuses a capture that is not a PNG (C7)", async () => {
    expect(await code(capture(1, { browser: fakeBrowser({ png: () => "data:image/jpeg;base64,/9j/4AAQSkZJRg==" }) }))).toBe("bad_image");
  });

  it("lowers the scale so the longer side fits maxSide (C6)", async () => {
    const calls: { scale?: number }[] = [];
    const shot = await capture(1, { rect: { x: 0, y: 0, width: 1000, height: 20000 }, browser: fakeBrowser({ view: { dpr: 2, docH: 20000 }, calls }) });
    expect(shot.height).toBeLessThanOrEqual(2048);
    expect(shot.downscaled).toBe(true);
    expect(shot.pxPerCss).toBeCloseTo(2048 / 20000, 3);
  });
});

describe("fitScale", () => {
  it("keeps the asked scale when the image fits (C6)", () => {
    expect(fitScale({ x: 0, y: 0, width: 1000, height: 700 }, 2, 2048)).toEqual({ scale: 2, downscaled: false });
  });

  it("lowers the scale for a long rect (C6)", () => {
    expect(fitScale({ x: 0, y: 0, width: 800, height: 8000 }, 1, 2048)).toEqual({ scale: 2048 / 8000, downscaled: true });
  });
});

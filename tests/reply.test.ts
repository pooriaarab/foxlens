// M1-M7: reading a point or a box out of a vision model's reply.
import { describe, expect, it } from "vitest";
import { readPoint, toDocument } from "../src/index.js";

const image = { width: 2000, height: 1400 };
const per1000 = { ...image, coordinates: "per1000" as const };
const pixels = { ...image, coordinates: "pixels" as const };

describe("readPoint", () => {
  it("reads JSON inside a code fence and words (M1)", () => {
    const reply = 'Sure! Here it is:\n```json\n[\n\t{"bbox_2d": [617, 590, 832, 672], "label": "blue Subscribe button"}\n]\n```';
    expect(readPoint(reply, per1000)).toEqual({ ok: true, point: { x: 1449, y: 883.4 }, box: [1234, 826, 1664, 940.8] });
  });

  it("accepts bbox, box, point and point_2d keys (M2)", () => {
    expect(readPoint('{"box": [100, 100, 300, 200]}', pixels)).toMatchObject({ ok: true, point: { x: 200, y: 150 } });
    expect(readPoint('{"bbox": [100, 100, 300, 200]}', pixels)).toMatchObject({ ok: true, point: { x: 200, y: 150 } });
    expect(readPoint('{"found": true, "point": [500, 500]}', per1000)).toEqual({ ok: true, point: { x: 1000, y: 700 } });
    expect(readPoint('[{"point_2d": [250, 750], "label": "x"}]', per1000)).toEqual({ ok: true, point: { x: 500, y: 1050 } });
    expect(readPoint('{"x": 40, "y": 60}', pixels)).toEqual({ ok: true, point: { x: 40, y: 60 } });
  });

  it("refuses coordinates outside the image instead of clamping them (M3)", () => {
    expect(readPoint('{"box": [1900, 100, 2100, 200]}', pixels)).toMatchObject({ ok: false, reason: "out_of_image" });
    expect(readPoint('{"bbox_2d": [100, 100, 1200, 300]}', per1000)).toMatchObject({ ok: false, reason: "out_of_image" });
    expect(readPoint('{"point": [10, 1401]}', pixels)).toMatchObject({ ok: false, reason: "out_of_image" });
  });

  it("refuses a reversed box, NaN and negative numbers (M4)", () => {
    expect(readPoint('{"box": [300, 100, 100, 200]}', pixels)).toMatchObject({ ok: false, reason: "bad_reply" });
    expect(readPoint('{"box": [-5, 100, 100, 200]}', pixels)).toMatchObject({ ok: false, reason: "out_of_image" });
    expect(readPoint('{"point": ["a", 3]}', pixels)).toMatchObject({ ok: false, reason: "bad_reply" });
  });

  it("reads a 'not found' answer (M5)", () => {
    expect(readPoint('{"found": false}', pixels)).toMatchObject({ ok: false, reason: "not_found" });
    expect(readPoint("null", pixels)).toMatchObject({ ok: false, reason: "not_found" });
    expect(readPoint("[]", pixels)).toMatchObject({ ok: false, reason: "not_found" });
    expect(readPoint("I cannot find a Subscribe button in this image.", pixels)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("reads bare numbers, and calls other text a bad reply (M6)", () => {
    expect(readPoint("The button is at (120, 340).", pixels)).toEqual({ ok: true, point: { x: 120, y: 340 } });
    expect(readPoint("It is the blue one on the right.", pixels)).toMatchObject({ ok: false, reason: "bad_reply" });
  });

  it("uses the coordinate scale the caller set (M7)", () => {
    expect(readPoint('{"point": [500, 500]}', pixels)).toEqual({ ok: true, point: { x: 500, y: 500 } });
    expect(readPoint('{"point": [500, 500]}', per1000)).toEqual({ ok: true, point: { x: 1000, y: 700 } });
  });
});

describe("toDocument", () => {
  it("maps image pixels to document CSS pixels with the measured ratio and the capture's offsets (L1)", () => {
    const shot = { rect: { x: 0, y: 1150, width: 1000, height: 700 }, pxPerCss: 2 };
    expect(toDocument(shot, { x: 400, y: 300 })).toEqual({ x: 200, y: 1300 });
    const zoomed = { rect: { x: 10, y: 0, width: 667, height: 467 }, pxPerCss: 3 };
    expect(toDocument(zoomed, { x: 300, y: 600 })).toEqual({ x: 110, y: 200 });
  });
});

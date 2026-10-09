// M8: reading a cell number out of a reply in grid mode.
import { describe, expect, it } from "vitest";
import { readCell } from "../src/index.js";

describe("readCell", () => {
  it("reads the cell from JSON, a code fence or plain words", () => {
    expect(readCell('{"cell": 12}', 48)).toEqual({ ok: true, cell: 12 });
    expect(readCell('```json\n{"cell": "7"}\n```', 48)).toEqual({ ok: true, cell: 7 });
    expect(readCell("Cell 31 holds the button.", 48)).toEqual({ ok: true, cell: 31 });
    expect(readCell("5", 48)).toEqual({ ok: true, cell: 5 });
  });

  it("refuses a cell that does not exist (M8)", () => {
    expect(readCell('{"cell": 0}', 48)).toMatchObject({ ok: false, reason: "out_of_image" });
    expect(readCell('{"cell": 49}', 48)).toMatchObject({ ok: false, reason: "out_of_image" });
    expect(readCell('{"cell": 2.5}', 48)).toMatchObject({ ok: false, reason: "bad_reply" });
  });

  it("reads 'not found' and calls other text a bad reply", () => {
    expect(readCell('{"found": false}', 48)).toMatchObject({ ok: false, reason: "not_found" });
    expect(readCell('{"cell": null}', 48)).toMatchObject({ ok: false, reason: "not_found" });
    expect(readCell("Cells 3 and 4 both have buttons.", 48)).toMatchObject({ ok: false, reason: "bad_reply" });
    expect(readCell("The blue one.", 48)).toMatchObject({ ok: false, reason: "bad_reply" });
  });
});

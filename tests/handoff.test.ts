// A1, A2: the hand-off to foxpaw through the snapshot the caller took first.
import { describe, expect, it } from "vitest";
import { locate } from "../src/index.js";
import { fakeBrowser } from "./fake-browser.js";

const eyes = { name: "fixed", canPoint: true, ask: async () => ({ text: '{"point": [500, 500]}', provider: "fixed", tier: "browser" as const, model: "f", ms: 1 }) };
const element = { tag: "button", role: "button", name: "", text: "", rect: { x: 0, y: 0, width: 10, height: 10 }, interactive: true, selector: "#b", frame: "top" };
const hit = (foxpawNode?: number) => ({ kind: "hit", point: { x: 500, y: 350 }, element, scrolled: false, mutations: 0, lensNode: 1, ...(foxpawNode ? { foxpawNode } : {}) });
const snapshot = { controls: [{ frameId: 0, node: 3, label: "Search" }, { frameId: 1, node: 7, label: "In a frame" }, { frameId: 0, node: 7, label: "Join" }] };

describe("locate with a foxpaw snapshot", () => {
  it("returns the foxpaw control for the element, from the top frame (A1)", async () => {
    const found = await locate(1, "the Join button", { eyes, snapshot, browser: fakeBrowser({ hit: hit(7) }) });
    expect(found.found && found.control).toEqual({ frameId: 0, node: 7, label: "Join" });
  });

  it("returns no control when foxpaw did not read the element (A2)", async () => {
    const found = await locate(1, "the canvas button", { eyes, snapshot, browser: fakeBrowser({ hit: hit() }) });
    expect(found.found && found.control).toBeUndefined();
  });
});

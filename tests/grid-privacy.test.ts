// P6: grid mode makes two model calls; privacy must cover both.
import { describe, expect, it } from "vitest";
import { locate, type Eyes, type Tier } from "../src/index.js";
import { fakeBrowser } from "./fake-browser.js";

/** Eyes that answer each call in turn, from the given tier. */
function twoCalls(tiers: Tier[], replies: string[]): Eyes {
  let n = 0;
  return {
    name: "two", canPoint: true,
    async ask() {
      const i = n++;
      return { text: replies[i] ?? '{"found": false}', provider: `${tiers[i]}-vision`, tier: tiers[i]!, model: "v", ms: 1 };
    },
  };
}

const element = { tag: "button", role: "button", name: "Go", text: "Go", rect: { x: 0, y: 0, width: 10, height: 10 }, interactive: true, selector: "#go", frame: "top" };
const hit = { kind: "hit", point: { x: 1, y: 1 }, anchor: "document", element, scrolled: false, mutations: 0, lensNode: 1 };

describe("grid mode privacy", () => {
  it("says the screenshot left the device when the first of two calls was in the cloud (P6)", async () => {
    const found = await locate(1, "Go", { eyes: twoCalls(["cloud", "local"], ['{"cell": 20}', '{"cell": 15}']), grid: 8, browser: fakeBrowser({ hit }) });
    expect(found.found).toBe(true);
    expect(found.privacy).toMatchObject({ tier: "cloud", provider: "cloud-vision", leftDevice: true });
  });

  it("says so too when the second call fails to find the element (P6)", async () => {
    const found = await locate(1, "Go", { eyes: twoCalls(["local", "cloud"], ['{"cell": 20}', '{"found": false}']), grid: 8, browser: fakeBrowser({ hit }) });
    expect(found).toMatchObject({ found: false, privacy: { tier: "cloud", leftDevice: true } });
  });

  it("stays on the device when both calls were local (P6)", async () => {
    const found = await locate(1, "Go", { eyes: twoCalls(["local", "local"], ['{"cell": 20}', '{"cell": 15}']), grid: 8, browser: fakeBrowser({ hit }) });
    expect(found.privacy).toMatchObject({ tier: "local", leftDevice: false });
  });
});

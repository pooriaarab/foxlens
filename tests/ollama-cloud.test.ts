// P7: Ollama "-cloud" models run on ollama.com, but foxmind calls the localhost server "local".
import type { Mind } from "foxmind";
import { describe, expect, it } from "vitest";
import { describe as describeImage, FoxlensError } from "../src/index.js";
import { pngOf } from "./fake-browser.js";

/** A Mind with one provider on the local tier whose model runs elsewhere. */
function cloudModelMind(model: string): Mind & { calls: number } {
  const mind = {
    calls: 0,
    providers: [{ name: "ollama", tier: "local", model, capabilities: ["chat"] }],
    async chat() {
      mind.calls++;
      return { message: { role: "assistant", content: "A form." }, finishReason: "stop", provider: "ollama", tier: "local", model, ms: 3, skipped: [] };
    },
  };
  return mind as unknown as Mind & { calls: number };
}

const code = (promise: Promise<unknown>) => promise.then(() => "no error", (e) => (e instanceof FoxlensError ? e.code : String(e)));

describe("Ollama cloud models", () => {
  it("refuses a model name that ends in -cloud unless allowCloud is set (P7)", async () => {
    const mind = cloudModelMind("qwen3-vl:235b-cloud");
    expect(await code(describeImage(pngOf(10, 10), { mind }))).toBe("cloud_not_allowed");
    expect(mind.calls).toBe(0);
  });

  it("reports a -cloud model as the cloud tier when it is allowed (P7)", async () => {
    const result = await describeImage(pngOf(10, 10), { mind: cloudModelMind("gpt-oss:120b-cloud"), allowCloud: true });
    expect(result.privacy).toMatchObject({ tier: "cloud", leftDevice: true });
  });

  it("does not refuse a local model with cloud elsewhere in its name (P7)", async () => {
    const result = await describeImage(pngOf(10, 10), { mind: cloudModelMind("cloudy-vl:2b") });
    expect(result.privacy).toMatchObject({ tier: "local", leftDevice: false });
  });
});

// P1-P4, M9: vision models through foxmind and Firefox trial.ml, and where the screenshot goes.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createMind, FoxmindError, openaiCompatible, type Mind } from "foxmind";
import { afterEach, describe, expect, it } from "vitest";
import { describe as describeImage, FoxlensError, locate, mindEyes, trialMLEyes } from "../src/index.js";
import { fakeBrowser, pngOf } from "./fake-browser.js";

const image = pngOf(1000, 700);
const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

/** A fake OpenAI-compatible server. It keeps each chat request body. */
async function fakeServer(answer: (body: { messages: { content: unknown }[] }) => { status: number; text: string }) {
  const bodies: { messages: { content: unknown }[] }[] = [];
  const read = async (req: IncomingMessage) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    return text;
  };
  const server = createServer(async (req, res) => {
    if (req.url?.endsWith("/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "vision" }] }));
    const body = JSON.parse(await read(req));
    bodies.push(body);
    const { status, text } = answer(body);
    res.writeHead(status, { "content-type": "application/json" }).end(status === 200
      ? JSON.stringify({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] })
      : JSON.stringify({ error: { message: text } }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies };
}

/** A Mind whose only provider is on the given tier, and that counts its calls. */
function tierMind(tier: "local" | "cloud"): Mind & { calls: number } {
  const mind = {
    calls: 0,
    providers: [{ name: `${tier}-vision`, tier, model: "v", capabilities: ["chat"] }],
    async chat() {
      mind.calls++;
      return { message: { role: "assistant", content: "A sign-up form." }, finishReason: "stop", provider: `${tier}-vision`, tier, model: "v", ms: 5, skipped: [] };
    },
  };
  return mind as unknown as Mind & { calls: number };
}

const code = async (promise: Promise<unknown>) => promise.then(() => "no error", (e) => (e instanceof FoxlensError || e instanceof FoxmindError ? e.code : String(e)));

describe("mindEyes", () => {
  it("sends the screenshot as an OpenAI image_url part through a real foxmind provider", async () => {
    const server = await fakeServer(() => ({ status: 200, text: "A white page with a blue button." }));
    const mind = createMind({ providers: [openaiCompatible({ baseURL: server.url, model: "vision" })] });
    const result = await describeImage(image, { mind });
    expect(result.text).toBe("A white page with a blue button.");
    expect(server.bodies[0]?.messages[0]?.content).toEqual([
      { type: "text", text: expect.stringContaining("Describe") },
      { type: "image_url", image_url: { url: image } },
    ]);
  });

  it("refuses a Mind with a cloud chat provider unless allowCloud is set (P1)", async () => {
    const mind = tierMind("cloud");
    expect(await code(describeImage(image, { mind }))).toBe("cloud_not_allowed");
    expect(await code(locate(1, "the button", { mind, browser: fakeBrowser({}) }))).toBe("cloud_not_allowed");
    expect(mind.calls).toBe(0);
    const allowed = await describeImage(image, { mind, allowCloud: true });
    expect(allowed.privacy).toEqual({ tier: "cloud", provider: "cloud-vision", model: "v", leftDevice: true });
  });

  it("reports a local server as not leaving the device (P2)", async () => {
    const result = await describeImage(image, { eyes: mindEyes(tierMind("local")) });
    expect(result.privacy).toMatchObject({ tier: "local", leftDevice: false });
  });

  it("passes on foxmind's error code when the model call fails (M9)", async () => {
    const down = createMind({ providers: [openaiCompatible({ baseURL: "http://127.0.0.1:9/v1", model: "vision" })] });
    expect(await code(describeImage(image, { mind: down }))).toBe("no_provider");
    const server = await fakeServer(() => ({ status: 500, text: "model has no vision" }));
    const failing = createMind({ providers: [openaiCompatible({ baseURL: server.url, model: "vision" })] });
    expect(await code(describeImage(image, { mind: failing }))).toBe("http");
  });
});

describe("trialMLEyes", () => {
  it("says unsupported when browser.trial.ml is missing, and permission when trialML is not granted (P3)", async () => {
    expect(await code(describeImage(image, { eyes: trialMLEyes({ browser: fakeBrowser({}) }) }))).toBe("unsupported");
    const denied = { ...fakeBrowser({}), permissions: { contains: async () => false } };
    expect(await code(describeImage(image, { eyes: trialMLEyes({ browser: denied }) }))).toBe("permission");
  });

  it("captions with trial.ml image-to-text and reports the browser tier", async () => {
    const asked: unknown[] = [];
    const ml = { createEngine: async (o: unknown) => void asked.push(o), runEngine: async () => [{ generated_text: "A blue button." }] };
    const browser = { ...fakeBrowser({}), trial: { ml }, permissions: { contains: async () => true } };
    const result = await describeImage(image, { eyes: trialMLEyes({ browser }) });
    expect(result).toMatchObject({ text: "A blue button.", privacy: { tier: "browser", provider: "trialml", leftDevice: false } });
    expect(asked[0]).toMatchObject({ taskName: "image-to-text", modelId: "Mozilla/distilvit" });
  });

  it("cannot locate: a captioner does not point (P4)", async () => {
    expect(await code(locate(1, "the button", { eyes: trialMLEyes({ browser: fakeBrowser({}) }), browser: fakeBrowser({}) }))).toBe("unsupported");
  });
});

// The E2E test: build dist-e2e/ (the demo extension plus the harness page in
// e2e/harness/), run foxlens in a real Firefox at DPR 1 and DPR 2 against the
// fixture pages in e2e/site/, and write artifacts/e2e-<date>.json.
// Usage: pnpm e2e [--headed]. Env: FIREFOX (the Firefox binary).
import { createServer, request } from "node:http";
import { launch, poll, serve, writeArtifact } from "create-foxkit/e2e";

const record = { startedAt: new Date().toISOString(), checks: [], notes: {} };
const check = (name, expected, actual) =>
  record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

const site = await serve("e2e/site");

// A real local vision model, when Ollama has one. Ollama refuses moz-extension:
// origins, so a small proxy on 127.0.0.1 forwards /v1 calls without the Origin header.
const OLLAMA = "http://127.0.0.1:11434";
const tags = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json()).catch(() => ({ models: [] }));
// Prefer an instruct model: a thinking model spends minutes before it answers.
const vision = process.env.FOXLENS_VISION_MODEL ?? (tags.models ?? []).map((m) => m.name)
  .filter((n) => /vl|vision|llava|moondream|minicpm-v|gemma3/i.test(n)).toSorted((a, b) => /instruct/.test(b) - /instruct/.test(a))[0];
const proxy = createServer((req, res) => {
  const forward = request(`${OLLAMA}${req.url}`, { method: req.method, headers: { "content-type": "application/json" } }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, { "content-type": "application/json" });
    answer.pipe(res);
  });
  forward.on("error", (error) => res.writeHead(502).end(error.message));
  req.pipe(forward);
});
await new Promise((done) => proxy.listen(0, "127.0.0.1", done));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}/v1`;

// A fake OpenAI-compatible vision server for the demo panel. It answers a locate
// prompt with the box of the drawn Subscribe button at DPR 1 (0-1000 scale), and
// any other prompt with a fixed description.
const fakeVision = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.url.endsWith("/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "fake-vision" }] }));
  const prompt = JSON.parse(body).messages[0].content[0].text;
  const content = prompt.startsWith("Find") ? '{"bbox_2d": [620, 600, 840, 691]}' : "A news page with a Cancel button and a blue Subscribe button.";
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }));
});
await new Promise((done) => fakeVision.listen(0, "127.0.0.1", done));
const fakeUrl = `http://127.0.0.1:${fakeVision.address().port}/v1`;

/** One Firefox at one DPR. `run` gets helpers bound to that Firefox. */
async function session(dpr, run) {
  const fox = await launch({
    extension: "dist-e2e",
    headless: !process.argv.includes("--headed"),
    // The remote agent turns trial ML and Remote Settings off for automation; a normal profile has both on.
    prefs: {
      "layout.css.devPixelsPerPx": String(dpr), "extensions.background.idle.timeout": 600_000,
      "browser.ml.enable": true, "services.settings.server": "https://firefox.settings.services.mozilla.com/v1",
    },
  });
  try {
    record.firefox = await fox.browser.version();
    const harness = await fox.openExtensionPage("harness.html");
    const open = async (path) => {
      const page = await fox.open(`${site.url}/${path}`);
      await page.setViewport({ width: 1000, height: 700 });
      return page;
    };
    const lens = (fn, path, ...args) => harness.evaluate((f, url, a) => window.lens[f](url, ...a), fn, `${site.url}/${path}`, args);
    /** Like lens, for calls that outlast the WebDriver timeout: start in the page, then poll. */
    const slow = async (fn, path, ...args) => {
      const id = await harness.evaluate((f, url, a) => window.lens.start(f, url, a), fn, `${site.url}/${path}`, args);
      for (;;) {
        const done = await harness.evaluate((i) => window.lens.done(i), id);
        if (done) return done.value;
        await new Promise((wake) => setTimeout(wake, 1000));
      }
    };
    /** Runs JavaScript in Firefox's parent process (chrome scope). */
    const chrome = async (expression) => {
      const tree = await fox.browser.connection.send("browsingContext.getTree", { "moz:scope": "chrome" });
      return fox.browser.connection.send("script.evaluate", { expression, target: { context: tree.result.contexts[0].context }, awaitPromise: true });
    };
    const canvasPage = () => fox.browser.pages().then((pages) => pages.find((p) => p.url().endsWith("/canvas.html")));
    await run({ fox, open, lens, slow, chrome, canvasPage, at: `DPR ${dpr}` });
  } finally {
    await fox.close();
  }
}

try {
  for (const dpr of [1, 2]) {
    await session(dpr, async ({ fox, open, lens, slow, chrome, canvasPage, at }) => {
      // Capture (C1-C3, C6)
      const page = await open("capture.html");
      const view = await lens("captureAt", "capture.html", {}, [[200, 250], [600, 250]]);
      check(`${at}: viewport image is ${1000 * dpr} x ${700 * dpr} (C1)`, [1000 * dpr, 700 * dpr, true], [view.width, view.height, near(view.pxPerCss, dpr)]);
      check(`${at}: blue block is where the mapping says (C1)`, ["blue", "white"], view.colours);
      await lens("setZoom", "capture.html", 1.5);
      const zoomed = await lens("captureAt", "capture.html", {}, [[200, 250], [600, 250]]);
      check(`${at}: 150 % zoom measures ${1.5 * dpr} image px per CSS px (C2)`, [true, "blue", "white"], [near(zoomed.pxPerCss, 1.5 * dpr), ...zoomed.colours]);
      await lens("setZoom", "capture.html", 1);
      await page.evaluate(() => window.scrollTo(0, 1150));
      const scrolled = await lens("captureAt", "capture.html", {}, [[200, 1300], [600, 1300]]);
      check(`${at}: scrolled capture starts at scrollY (C3)`, [1150, "blue", "white"], [scrolled.scroll?.y, ...scrolled.colours]);
      await open("long.html");
      const long = await lens("captureAt", "long.html", { rect: { x: 0, y: 0, width: 1000, height: 20000 } }, [[500, 10200], [500, 5000]]);
      check(`${at}: a 20000 px page fits in 2048 px (C6)`, [true, true, "blue", "white"], [long.height <= 2048, long.downscaled, ...long.colours]);

      // Locate (L1-L13, M3, M5, A5) with fake models that read only the PNG.
      const canvas = await open("canvas.html");
      const inside = (result, name) => canvas.evaluate(([p, n]) => {
        const r = window.rects[n];
        return !!p && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
      }, [result.docPoint, name]);
      const blue = { colour: "1d4ed8" };
      const drawn = await lens("locate", "canvas.html", "the blue Subscribe button", blue);
      check(`${at}: canvas button maps inside the drawn button (L1, L5)`, [true, "canvas", true], [await inside(drawn, "Subscribe"), drawn.element?.tag, drawn.element?.interactive]);
      check(`${at}: a found result has the data to check it (A5)`, true, ["tag", "role", "name", "text"].every((k) => typeof drawn.element?.[k] === "string") && typeof drawn.check?.match === "number");
      check(`${at}: the privacy tier is in the result (P2)`, { tier: "browser", provider: "colour-oracle", leftDevice: false }, drawn.privacy && { tier: drawn.privacy.tier, provider: drawn.privacy.provider, leftDevice: drawn.privacy.leftDevice });
      await lens("setZoom", "canvas.html", 1.5);
      const zoomedHit = await lens("locate", "canvas.html", "the blue Subscribe button", blue);
      check(`${at}: canvas button maps at 150 % zoom (L1)`, true, await inside(zoomedHit, "Subscribe"));
      await lens("setZoom", "canvas.html", 1);
      await canvas.evaluate(() => window.scrollTo(0, 200));
      const scrolledHit = await lens("locate", "canvas.html", "the blue Subscribe button", blue);
      check(`${at}: canvas button maps on a scrolled page (L1)`, true, await inside(scrolledHit, "Subscribe"));
      await lens("capture", "canvas.html");
      await canvas.evaluate(() => window.scrollTo(0, 260));
      const moved = await lens("locate", "canvas.html", "the blue Subscribe button", blue, { useLast: true });
      check(`${at}: a scroll after the capture is corrected (L2)`, [true, true], [await inside(moved, "Subscribe"), moved.changed?.scrolled]);
      await lens("capture", "canvas.html");
      await canvas.evaluate(() => window.scrollTo(0, 1300));
      check(`${at}: a point scrolled out of view is offscreen (L3)`, "offscreen", (await lens("locate", "canvas.html", "the blue Subscribe button", blue, { useLast: true })).reason);
      await canvas.evaluate(() => window.scrollTo(0, 0));
      await lens("capture", "canvas.html");
      await lens("setZoom", "canvas.html", 1.25);
      check(`${at}: a zoom after the capture is stale (L4)`, "stale", (await lens("locate", "canvas.html", "the blue Subscribe button", blue, { useLast: true })).reason);
      await lens("setZoom", "canvas.html", 1);
      check(`${at}: a point on the empty page is nothing_there (L11)`, "nothing_there",
        (await lens("locate", "canvas.html", "the blue Subscribe button", { reply: '{"bbox_2d": [900, 960, 950, 990]}' })).reason);
      const heading = await lens("locate", "canvas.html", "the blue Subscribe button", { reply: '{"point": [40, 60]}' });
      check(`${at}: a hallucinated match scores low (L11)`, ["h1", true], [heading.element?.tag, heading.check?.match < 0.34]);
      check(`${at}: coordinates outside the image are refused (M3)`, "out_of_image", (await lens("locate", "canvas.html", "x", { reply: '{"bbox_2d": [100, 100, 1200, 300]}' })).reason);
      check(`${at}: a model that finds nothing gives not_found (M5)`, "not_found", (await lens("locate", "canvas.html", "x", { reply: '{"found": false}' })).reason);
      await lens("capture", "canvas.html");
      await canvas.evaluate(() => { document.querySelector("h1").textContent = "Daily news, updated"; });
      const mutated = await lens("locate", "canvas.html", "the blue Subscribe button", blue, { useLast: true });
      check(`${at}: DOM changes after the capture are counted (L13)`, [true, true], [mutated.found, mutated.changed?.mutations > 0]);
      await lens("capture", "canvas.html");
      await canvas.reload({ waitUntil: "load" });
      check(`${at}: a reload after the capture is stale (L12)`, "stale", (await lens("locate", "canvas.html", "the blue Subscribe button", blue, { useLast: true })).reason);

      // Grid mode (M8): numbered cells over the page, then finer cells over the chosen area.
      const gridded = await lens("locate", "canvas.html", "the blue Subscribe button", blue, { grid: 8 });
      check(`${at}: grid mode maps inside the drawn button and removes the grid`, [true, [true, true], false],
        [await inside(gridded, "Subscribe"), gridded.cells?.map((n) => Number.isInteger(n)), await canvas.evaluate(() => !!document.getElementById("foxlens-grid"))]);
      check(`${at}: a cell that does not exist is refused (M8)`, "out_of_image", (await lens("locate", "canvas.html", "x", { reply: '{"cell": 99}' }, { grid: 8 })).reason);

      const buttonsPage = await open("buttons.html");
      const join = await lens("locate", "buttons.html", "the green Join button", { colour: "16a34a" });
      check(`${at}: image-only button resolves to the button (L6)`, ["button", "button", "#subscribe"], [join.element?.tag, join.element?.role, join.element?.selector]);
      const upgrade = await lens("locate", "buttons.html", "the orange Upgrade button", { colour: "ea580c" });
      check(`${at}: a pane over the button is named in coveredBy (L7)`, ["#covered", "Upgrade", "div"], [upgrade.element?.selector, upgrade.element?.name, upgrade.element?.coveredBy?.tag]);

      await open("frames.html");
      await new Promise((done) => setTimeout(done, 500));
      const pay = await lens("locate", "frames.html", "the purple Pay button", { colour: "7c3aed" });
      check(`${at}: same-origin frame is searched (L8)`, ["button", "Pay", "same-origin"], [pay.element?.tag, pay.element?.name, pay.element?.frame]);
      const donate = await lens("locate", "frames.html", "the red Donate button", { colour: "dc2626" });
      check(`${at}: cross-origin frame is reported, not guessed (L9)`, ["iframe", "cross-origin"], [donate.element?.tag, donate.element?.frame]);
      const follow = await lens("locate", "frames.html", "the teal Follow button", { colour: "0d9488" });
      check(`${at}: closed shadow root is searched (L10)`, ["button", "Follow", "closed"], [follow.element?.tag, follow.element?.name, follow.element?.shadow]);

      // Act (A1-A4): foxpaw's act, clickAt on a canvas, a stale click, and the outline.
      const paw = await lens("pawClick", "buttons.html", "the green Join button", { colour: "16a34a" });
      check(`${at}: foxpaw acts on the located control (A1)`, [true, true, "subscribed"], [paw.control, paw.acted?.ok, await buttonsPage.title()]);
      await canvas.evaluate(() => window.scrollTo(0, 50));
      const clicked = await lens("locateAndClick", "canvas.html", "the blue Subscribe button", blue);
      check(`${at}: clickAt clicks the drawn canvas button (A2)`, [false, true, "Subscribe"],
        [clicked.control, clicked.clicked?.ok, await canvas.evaluate(() => document.getElementById("log").textContent)]);
      await canvas.evaluate(() => { document.getElementById("log").textContent = "none"; });
      await lens("locateOnly", "canvas.html", "the blue Subscribe button", blue);
      await canvas.evaluate(() => { const board = document.getElementById("board"); board.replaceWith(board.cloneNode(true)); });
      const staleClick = await lens("clickLast", "canvas.html");
      check(`${at}: clickAt refuses an element that changed (A3)`, ["stale", "none"], [staleClick.reason, await canvas.evaluate(() => document.getElementById("log").textContent)]);
      await canvas.reload({ waitUntil: "load" });
      await lens("setZoom", "buttons.html", 1.5);
      await buttonsPage.evaluate(() => window.scrollTo(0, 100));
      await lens("outlineFound", "buttons.html", "the green Join button", { colour: "16a34a" });
      const drawnAt = await buttonsPage.evaluate(() => {
        const a = document.getElementById("foxlens-outline")?.getBoundingClientRect();
        const b = document.getElementById("subscribe").getBoundingClientRect();
        return !!a && ["x", "y", "width", "height"].every((k) => Math.abs(a[k] - b[k]) < 1.5);
      });
      check(`${at}: the outline sits on the element at 150 % zoom, scrolled (A4)`, true, drawnAt);
      await lens("setZoom", "buttons.html", 1);

      if (dpr === 1) {
        // The demo panel (D1-D3): Describe and Find on the canvas page, with the fake server.
        const demoTab = await open("canvas.html");
        const panel = await fox.openExtensionPage("panel.html");
        await demoTab.bringToFront();
        await panel.evaluate((url) => {
          document.getElementById("server").value = url;
          document.getElementById("model").value = "fake-vision";
          document.getElementById("server").dispatchEvent(new Event("change"));
        }, fakeUrl);
        const panelText = (id) => panel.evaluate((i) => document.getElementById(i).textContent, id);
        await panel.evaluate(() => document.getElementById("describe").click());
        await poll(panel, () => !/working/i.test(document.getElementById("status").textContent) && document.getElementById("status").textContent);
        check(`${at}: the demo describes the tab and names the tier (D1)`, [true, true],
          [/Subscribe button/.test(await panelText("output")), /on this device/.test(await panelText("status"))]);
        await panel.evaluate(() => {
          document.getElementById("query").value = "the blue Subscribe button";
          document.getElementById("find").click();
        });
        await poll(panel, () => !/working/i.test(document.getElementById("status").textContent) && document.getElementById("status").textContent);
        const outlined = await demoTab.evaluate(() => {
          const box = document.getElementById("foxlens-outline")?.getBoundingClientRect();
          const want = window.rects.Subscribe;
          return !!box && ["x", "y", "width", "height"].every((k) => Math.abs(box[k] + (k === "x" ? scrollX : k === "y" ? scrollY : 0) - want[k]) < 2);
        });
        check(`${at}: the demo outlines the model's box on the canvas (D2)`, [true, true], [outlined, /canvas/.test(await panelText("output"))]);
        (await import("node:fs")).mkdirSync("artifacts", { recursive: true });
        await demoTab.screenshot({ path: "artifacts/demo-outline.png" });
        record.notes.demoLast = await panel.evaluate(() => browser.storage.local.get("last").then((v) => v.last));
        check(`${at}: the demo keeps the last result for the next time it opens (D3)`, "find", record.notes.demoLast?.kind);
        await demoTab.close();
      }

      if (dpr === 1) {
        // Describe with Firefox's own image-to-text model (P3), then with a real local model when one runs.
        await open("canvas.html");
        check(`${at}: trial.ml before the grant gives code permission (P3)`, "permission", (await lens("describeTrial", "canvas.html")).error?.code);
        await chrome(`ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs").ExtensionPermissions.add("${fox.extensionId}", { permissions: ["trialML"], origins: [] }, WebExtensionPolicy.getByID("${fox.extensionId}").extension)`);
        const caption = await lens("describeTrial", "canvas.html");
        record.notes.trialML = caption;
        check(`${at}: trial.ml image-to-text describes the tab in the browser tier`, [true, "browser", false],
          [typeof caption.text === "string" && caption.text.length > 0, caption.privacy?.tier, caption.privacy?.leftDevice]);
        record.notes.realModel = vision ? { model: vision } : { skipped: "No vision model in Ollama. Set FOXLENS_VISION_MODEL or pull one (for example qwen3-vl:2b)." };
        if (vision) {
          const started = Date.now();
          record.notes.realModel.describe = await slow("real", "canvas.html", "describe", proxyUrl, vision);
          const real = await slow("real", "canvas.html", "locate", proxyUrl, vision, "the blue Subscribe button");
          record.notes.realModel.locate = { ...real, insideDrawnButton: real.found ? await (await canvasPage()).evaluate((p) => {
            const r = window.rects.Subscribe;
            return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
          }, real.docPoint) : false };
          const realGrid = await slow("real", "canvas.html", "grid", proxyUrl, vision, "the blue Subscribe button");
          record.notes.realModel.gridLocate = { found: realGrid.found, reason: realGrid.reason, reply: realGrid.reply, cells: realGrid.cells, docPoint: realGrid.docPoint, error: realGrid.error,
            insideDrawnButton: realGrid.found ? await (await canvasPage()).evaluate((p) => {
              const r = window.rects.Subscribe;
              return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
            }, realGrid.docPoint) : false };
          await open("buttons.html");
          const realJoin = await slow("real", "buttons.html", "locate", proxyUrl, vision, "the green Join button");
          record.notes.realModel.locateImageButton = { found: realJoin.found, reason: realJoin.reason, selector: realJoin.element?.selector, reply: realJoin.reply, modelMs: realJoin.modelMs, error: realJoin.error };
          record.notes.realModel.totalMs = Date.now() - started;
        }
      }

      if (dpr === 2) {
        // Last: take the host grant away (C4). permissions.remove needs no click, but
        // a test cannot grant it back, so nothing runs after this.
        await chrome(`ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs").ExtensionPermissions.remove("${fox.extensionId}", { permissions: [], origins: ["<all_urls>"] }, WebExtensionPolicy.getByID("${fox.extensionId}").extension)`);
        const denied = await lens("captureAt", "capture.html", {}, []);
        record.notes.permissionMessage = denied.error?.message;
        check(`${at}: no host permission gives code permission (C4)`, "permission", denied.error?.code);
      }
    });
  }
} catch (error) {
  record.error = error instanceof Error ? error.stack : String(error);
} finally {
  await site.close();
  proxy.close();
  fakeVision.close();
}
record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}${c.ok ? "" : `: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;

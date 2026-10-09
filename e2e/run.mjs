// The E2E test: build dist-e2e/ (the demo extension plus the harness page in
// e2e/harness/), run foxlens in a real Firefox at DPR 1 and DPR 2 against the
// fixture pages in e2e/site/, and write artifacts/e2e-<date>.json.
// Usage: pnpm e2e [--headed]. Env: FIREFOX (the Firefox binary).
import { launch, serve, writeArtifact } from "create-foxkit/e2e";

const record = { startedAt: new Date().toISOString(), checks: [], notes: {} };
const check = (name, expected, actual) =>
  record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

const site = await serve("e2e/site");

/** One Firefox at one DPR. `run` gets helpers bound to that Firefox. */
async function session(dpr, run) {
  const fox = await launch({
    extension: "dist-e2e",
    headless: !process.argv.includes("--headed"),
    prefs: { "layout.css.devPixelsPerPx": String(dpr), "extensions.background.idle.timeout": 600_000 },
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
    /** Runs JavaScript in Firefox's parent process (chrome scope). */
    const chrome = async (expression) => {
      const tree = await fox.browser.connection.send("browsingContext.getTree", { "moz:scope": "chrome" });
      return fox.browser.connection.send("script.evaluate", { expression, target: { context: tree.result.contexts[0].context }, awaitPromise: true });
    };
    await run({ fox, open, lens, chrome, at: `DPR ${dpr}` });
  } finally {
    await fox.close();
  }
}

try {
  for (const dpr of [1, 2]) {
    await session(dpr, async ({ fox, open, lens, chrome, at }) => {
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
}
record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}${c.ok ? "" : `: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;

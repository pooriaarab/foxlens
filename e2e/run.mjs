// The E2E test: build dist-e2e/ (the demo extension plus the harness page in
// e2e/harness/), run foxlens in a real Firefox at DPR 1 and DPR 2 against the
// fixture pages in e2e/site/, and write artifacts/e2e-<date>.json.
// Usage: pnpm e2e [--headed]. Env: FIREFOX (the Firefox binary).
import { launch, serve, writeArtifact } from "create-foxkit/e2e";

const record = { startedAt: new Date().toISOString(), checks: [], notes: {} };
const check = (name, expected, actual) =>
  record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });

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
    await session(dpr, async ({ open, lens, at }) => {
      await open("index.html");
      check(`${at}: the harness finds the fixture tab`, "number", typeof (await lens("tabFor", "index.html")));
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

// The demo panel (toolbar popup and sidebar). It runs foxlens in this page,
// so keep it open while the model works. The last result is saved, because
// the popup closes when you click the page.
import { createMind, openaiCompatible } from "foxmind";
import { capture, describe, locate, outline, trialMLEyes } from "../src/index.ts";

const $ = (id) => document.getElementById(id);
const DEFAULTS = { server: "http://127.0.0.1:11434/v1", model: "qwen3-vl:2b-instruct", remote: false, describer: "server", grid: false };
const FIELDS = ["server", "model", "remote", "describer", "grid"];
const value = (id) => ($(id).type === "checkbox" ? $(id).checked : $(id).value);

/** The tab to look at: the active web page, not this panel when it is open in a tab. */
async function pageTab() {
  const tabs = (await browser.tabs.query({ currentWindow: true })).filter((t) => !t.url?.startsWith("moz-extension:"));
  const tab = tabs.find((t) => t.active) ?? tabs.toSorted((a, b) => b.lastAccessed - a.lastAccessed)[0];
  if (!tab) throw new Error("Open a web page in this window first.");
  return tab;
}

const local = (url) => /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(url);

function mind() {
  const server = value("server");
  if (!local(server) && !value("remote")) {
    throw new Error(`${server} is not on this device. Check "Send screenshots to this server" to use it.`);
  }
  return createMind({ only: value("remote") ? ["local", "cloud"] : ["local"], providers: [openaiCompatible({ baseURL: server, model: value("model") })] });
}

const where = (privacy) => (privacy.leftDevice ? `sent to ${privacy.provider} (${privacy.model}), not on this device` : `on this device (${privacy.provider}, ${privacy.model})`);

function show(last) {
  $("status").textContent = last.status;
  $("output").textContent = last.output;
}

async function run(kind, work) {
  $("status").textContent = "Working. Keep this panel open.";
  $("output").textContent = "";
  let last;
  try {
    last = { kind, ...(await work()) };
  } catch (error) {
    last = { kind, status: `Failed: ${error.code ?? "error"}`, output: error.message ?? String(error) };
  }
  show(last);
  await browser.storage.local.set({ last });
}

$("describe").addEventListener("click", () => {
  // permissions.request must run in the click, before any await.
  const granted = value("describer") === "trialml" ? browser.permissions.request({ permissions: ["trialML"] }) : Promise.resolve(true);
  run("describe", async () => {
    if (!(await granted)) throw new Error("Firefox's on-device model needs the trial ML permission.");
    const shot = await capture((await pageTab()).id);
    const options = value("describer") === "trialml" ? { eyes: trialMLEyes() } : { mind: mind(), allowCloud: value("remote") };
    const result = await describe(shot, options);
    return { status: `Described ${where(result.privacy)} in ${(result.ms / 1000).toFixed(1)} s`, output: result.text };
  });
});

$("find").addEventListener("click", () => run("find", async () => {
  const tabId = (await pageTab()).id;
  const result = await locate(tabId, value("query"), { mind: mind(), allowCloud: value("remote"), ...(value("grid") ? { grid: 8 } : {}) });
  if (!result.found) return { status: `Not found: ${result.reason}`, output: `The model said: ${result.reply}` };
  // On a canvas the element is the whole canvas, so outline the model's box there.
  await outline(tabId, result, { box: result.element.tag === "canvas" });
  const e = result.element;
  return {
    status: `Found ${where(result.privacy)}. It is outlined on the page.`,
    output: [`${e.tag}${e.role ? ` (${e.role})` : ""}${e.name ? `: "${e.name}"` : ""}`, e.text && `Text: ${e.text}`,
      `Word match: ${Math.round(result.check.match * 100)} %`, e.coveredBy && `Covered by ${e.coveredBy.tag}`, e.frame !== "top" && `In a ${e.frame} frame`]
      .filter(Boolean).join("\n"),
  };
}));

async function start() {
  const saved = await browser.storage.local.get([...FIELDS, "last"]);
  for (const id of FIELDS) {
    const v = saved[id] ?? DEFAULTS[id];
    if ($(id).type === "checkbox") $(id).checked = v;
    else $(id).value = v;
    $(id).addEventListener("change", () => browser.storage.local.set(Object.fromEntries(FIELDS.map((f) => [f, value(f)]))));
  }
  if (saved.last) show(saved.last);
}

start();

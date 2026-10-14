# foxlens

[![npm version](https://img.shields.io/npm/v/foxlens)](https://www.npmjs.com/package/foxlens)
[![Downloads per month](https://img.shields.io/npm/dm/foxlens)](https://www.npmjs.com/package/foxlens)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/license/mit)

[Package](https://www.npmjs.com/package/foxlens) · [Setup](#locate-your-first-control) · [API](#api) · [Issues](https://github.com/pooriaarab/foxlens/issues)

foxlens is an open-source Firefox screenshot and vision-model library for browser agent developers.
It locates visual controls when the Document Object Model (DOM) does not describe them well.
Results map model coordinates to page elements and report the model's privacy tier.

## Install

```bash
npm install foxlens foxmind
```

foxlens has one direct runtime dependency, foxmind. Package tooling requires Node.js 24 or later.
Runtime needs Firefox extension APIs; the bundled extension requires Firefox 153 or later.
The library needs `scripting` permission and host access to the target page.
It does not load `.env` files. Configure providers in code and export server variables in your shell.

## Locate your first control

Use the bundled extension for a complete setup. Install Git, pnpm 11.10.0, Firefox, and Ollama first.

```bash
git clone https://github.com/pooriaarab/foxlens.git
cd foxlens
pnpm install --frozen-lockfile
pnpm build:ext
ollama pull qwen3-vl:2b-instruct
OLLAMA_ORIGINS="moz-extension://*" ollama serve
```

Start Ollama with that origin setting after stopping any existing server.
No API key is needed for this local model. See [Ollama origin configuration](https://docs.ollama.com/faq).
Load `dist-ext/manifest.json` through Firefox's `about:debugging#/runtime/this-firefox` page.
Open a normal web page with a visible button. Open the foxlens sidebar and describe that button in the Find field.
Use server `http://127.0.0.1:11434/v1` and model `qwen3-vl:2b-instruct`, then click Find.
A successful result outlines the target and shows `Found` with its tag and word-match score.
Model answers can fail; a `Not found` result includes the failure reason. Keep the panel open while it works.

For your own bundled extension, the minimal library call is:

```js
import { createMind, ollama } from "foxmind";
import { locate, outline } from "foxlens";

const mind = createMind({
  only: ["browser", "local"],
  providers: [ollama({ model: "qwen3-vl:2b-instruct" })],
});
const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
const hit = await locate(tab.id, "the blue Subscribe button", { mind });
if (hit.found) {
  await outline(tab.id, hit, { box: hit.element.tag === "canvas" });
  console.log(hit.element.tag, hit.docPoint, hit.privacy);
} else {
  console.log("not found", hit.reason);
}
```

Bundle this code in an extension page with `scripting` and the target origin in `host_permissions`.

## How it works

```text
Firefox capture + page geometry -> screenshot -> vision model -> point or box
point -> measured image/CSS ratio -> document point -> hit test -> element + privacy
optional foxpaw snapshot -> matching control -> foxpaw act
```

Capture measures image pixels per Cascading Style Sheets (CSS) pixel from the PNG header.
Hit tests use the captured document identifier when Firefox supplies it.
They traverse closed shadow roots and same-origin frames, with checks for changed viewport geometry.
Grid mode makes up to two model calls: a coarse grid, then a finer 6-by-6 grid.

## Why it exists

DOM locators work well for named controls. Canvas controls and image-only targets can require a screenshot model.
foxlens adds image capture, coordinate mapping, hit testing, and privacy reporting inside Firefox extensions.
[Playwright locators](https://playwright.dev/docs/locators) provide attribute-based browser test targeting.

## Compare

Checked 2026-10-14 against source and [Playwright's locator documentation](https://playwright.dev/docs/locators).

| Property | foxlens | Playwright locators |
|---|---|---|
| Target selection | Vision-model point or box | Role, text, label, test identifier, and selectors |
| Execution | Firefox extension | Browser automation process |
| Configuration | Vision model and capture options | Locator expressions |
| Model requirement | Required for visual locate | None for DOM locators |

## Coverage

| Integration or path | Status | Boundary |
|---|---|---|
| foxmind `mindEyes` | Implemented adapter | Sends OpenAI-format `image_url` content parts |
| Ollama / Qwen-VL | Via foxmind | Requires an image-capable model and extension origins |
| llama.cpp llama-server | Via foxmind | Requires an image-capable OpenAI-compatible endpoint |
| LM Studio | Via foxmind | Requires an image-capable OpenAI-compatible endpoint |
| OpenAI-compatible cloud endpoints | Fake-server tested | Explicit `allowCloud: true`; real credentials unverified here |
| Firefox trial.ml / Mozilla distilvit | Implemented; captions only | Cannot locate elements |
| foxpaw | Implemented bridge | Matches snapshot controls in the same extension's top frame |
| Anthropic through foxmind `anthropic()` | Unsupported image conversion | Does not translate these image parts |

foxlens defines two built-in vision adapters: `mindEyes` and `trialMLEyes`.
Provider rows share the foxmind adapter; they are not separate foxlens adapters.
Custom `Eyes` implementations can supply another model. Their reported privacy tier is trusted.
Local checks cover fake providers and browser stand-ins. No new real-model or live-cloud verification is claimed here.

## Common use cases

1. Firefox agent developers: locate canvas controls with Ollama and Qwen-VL.
2. Extension authors: add screenshot descriptions with Firefox trial.ml or a foxmind vision model.
3. Firefox test authors: inspect coordinates across page scroll, zoom, and device pixel ratios.
4. foxpaw users: use visual location as a fallback, then pass matching controls to `act`.
5. Model researchers: compare point answers with the repository's Firefox fixtures.

## Features

- **Capture:** records PNG geometry, scroll position, document identity, and mutation counts.
- **Locate:** parses points and boxes, then hit-tests the corresponding page position.
- **Describe:** captions captures through foxmind or Firefox trial.ml.
- **Actions:** outlines targets and dispatches synthetic pointer and mouse events.
- **Privacy:** reports the most remote tier used across model calls.

## Runtime surfaces

foxlens is an ECMAScript module library for Firefox extension pages and background scripts.
It has no CLI or Model Context Protocol (MCP) server and exports no MCP tools.

### API

foxlens is a library. It has no CLI and no MCP server.

| Export | What it does |
|---|---|
| `capture(tabId, { rect?, scale?, maxSide? })` | Screenshots the viewport, or a rect in document CSS pixels. Returns `dataUrl`, `width`, `height`, `rect`, `pxPerCss` (measured), `downscaled`, `dpr`, `zoom`, `scroll`, `viewport`, `url`, `documentId`, `mutations` and `at`. |
| `describe(image, { mind? \| eyes?, allowCloud?, prompt?, signal? })` | Describes a `Capture` or a PNG data URL. Returns `{ text, privacy, ms }`. |
| `locate(tabId, description, { mind? \| eyes?, allowCloud?, grid?, coordinates?, capture?, snapshot?, signal? })` | Finds an element. A found result has `point` (viewport), `anchor` (`viewport` for a fixed element, else `document`), `docPoint`, `imageBox`, `docBox`, `element`, `check`, `changed`, `privacy`, `reply`, and `control` when you pass a foxpaw `snapshot`. A result with `found: false` has `reason`: `not_found`, `out_of_image`, `bad_reply`, `offscreen`, `stale` or `nothing_there`. |
| `clickAt(tabId, found)` | Clicks the found point with in-page pointer and mouse events. Returns `{ ok }` or `{ ok: false, reason }` with `stale`, `covered` or `offscreen`. Use it for a canvas; use foxpaw's `act` for real controls. |
| `outline(tabId, found, { box?, colour?, ms? })` | Draws a box around the element, or around the model's box with `box: true`. |
| `mindEyes(mind, { allowCloud?, maxTokens? })` | A vision chat model through a foxmind `Mind`. The screenshot goes out as an OpenAI `image_url` part. |
| `trialMLEyes({ model?, device? })` | Firefox's image-to-text model (`Mozilla/distilvit` by default). It captions only, so `locate` refuses it. Needs the optional `trialML` permission. |
| `readPoint(text, { width, height, coordinates })`, `readCell(text, cells)`, `toDocument(capture, point)` | The reply parsers and the pixel mapping, for callers that run their own model call. |
| `matchWords(description, element)` | The word-match score in `check`. |
| `FoxlensError` | Every failure. `code` is `permission`, `no_tab`, `bad_image`, `cloud_not_allowed`, `unsupported` or `stale`. Model call errors stay foxmind's `FoxmindError`. |

An `Eyes` object is any vision model:

```ts
interface Eyes {
  readonly name: string;
  readonly canPoint: boolean;
  ask(image: string, prompt: string, options: { json?: boolean; signal?: AbortSignal }): Promise<{ text: string; provider: string; tier: "browser" | "local" | "cloud"; model: string; ms: number }>;
}
```

### With foxpaw

Take a foxpaw snapshot first, then pass it to `locate`. When foxpaw read the
found element, `control` is foxpaw's own control for it:

```js
import { act, snapshot } from "foxpaw";
import { locate } from "foxlens";

const page = await snapshot(tabId);
const hit = await locate(tabId, "the icon button that starts the export", { mind, snapshot: page });
if (hit.found && hit.control) await act(tabId, hit.control, { op: "click" }, page);
```

### Privacy

The screenshot goes only to the model you pass. Every result has
`privacy: { tier, provider, model, leftDevice }`. `leftDevice` is true only
for the `cloud` tier. When a foxmind `Mind` has a chat provider on the cloud
tier, `describe` and `locate` throw `cloud_not_allowed` before any call. Pass
`allowCloud: true` to allow it. For a local-only Mind, use foxmind's
`only: ["browser", "local"]`.

Ollama models whose name ends in `-cloud` or `:cloud` (for example
`qwen3-vl:235b-cloud`) run on ollama.com, even though the server is on
localhost and foxmind calls it `local`. foxlens treats them as the cloud
tier: it refuses them without `allowCloud`, and reports `leftDevice: true`.

`allowCloud` guards a foxmind Mind only. When you pass your own `eyes`,
foxlens cannot check where they send the image before the call. It reports
the tier your eyes give.

### Firefox APIs used

| API | MDN | Why |
|---|---|---|
| `tabs.captureTab(tabId, { rect, scale })` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureTab) | Screenshots any tab, or a region of it (Firefox only). Needs host permission. |
| `tabs.getZoom` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/getZoom) | Divides the page zoom out of the capture scale. |
| `tabs.query` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query) | The extension finds the page tab. |
| `scripting.executeScript` (`func`, `args`, `world: "ISOLATED"`) | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript) | Runs the bundled page functions: read the view, hit test, click, outline, grid. |
| `scripting.InjectionTarget.documentIds` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/InjectionTarget) | Pins the hit test to the captured document (Firefox 153). |
| `Element.openOrClosedShadowRoot` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/openOrClosedShadowRoot) | Goes into closed shadow roots from an extension (Firefox only). |
| `Document.elementFromPoint`, `elementsFromPoint`, `ShadowRoot.elementFromPoint` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/elementFromPoint) | Finds the element under the point, and what is below a covering element. |
| `HTMLIFrameElement.contentDocument` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/contentDocument) | Goes into same-origin frames. It is null for cross-origin frames. |
| `MutationObserver` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) | Counts DOM changes between capture and locate. |
| `WeakRef` | [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef) | Remembers the found element for `clickAt` and `outline` without keeping it alive. |
| `PointerEvent`, `MouseEvent` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/dispatchEvent) | `clickAt` clicks with in-page events at the point. |
| `requestAnimationFrame` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) | Waits for the grid to paint before the capture. |
| `browser.trial.ml` (`createEngine`, `runEngine`) | No MDN page: [Firefox source docs](https://firefox-source-docs.mozilla.org/toolkit/components/ml/extensions.html) | `trialMLEyes` runs the `image-to-text` task on the device. |
| `permissions.request` / `permissions.contains` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request) | Asks for and checks the optional `trialML` permission. |
| `host_permissions` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions) | `captureTab` and `executeScript` need host access to the page. |
| `storage.local` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local) | The extension keeps its settings and the last result. |
| `action` popup and `sidebar_action` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action) | The panel opens in both places. |
| `browser_specific_settings.gecko.data_collection_permissions` | [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings) | The extension declares `websiteContent` as optional: a screenshot leaves the device only when you choose a remote server. |
| `createImageBitmap`, `OffscreenCanvas` | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) | The E2E fake model reads pixels of the real screenshot. Not used by the library. |

## Delivery and behavior limits

- Cloud tests use fake servers. This rewrite does not verify real cloud credentials.
- foxmind's `anthropic()` provider does not turn OpenAI image parts into
  Anthropic image blocks, so it cannot take the screenshot. For a cloud model, use `openaiCompatible()` with a server that
  takes OpenAI image parts (for example OpenAI or OpenRouter).
- Firefox's `Mozilla/distilvit` captions were wrong for our test pages. Use it
  only for a rough caption.
- Grid mode worked with the fake model only. `qwen3-vl:2b-instruct` said it
  found nothing in grid mode.
- foxlens cannot tell that a model has no vision. A text-only model gives
  wrong answers; `check.match` and `nothing_there` can catch some of them.
- A canvas that redraws after the capture (a game, a chart) is not detected.
  The DOM does not change, so `changed.mutations` stays 0.
- `changed.mutations` counts any DOM change. foxlens does not compare pixels.
- Cross-origin frames are not searched. `locate` returns the `<iframe>`.
- The foxpaw `control` comes back only for elements in the top frame. foxlens
  reads foxpaw's page cache, so both must run in the same extension.
- `clickAt` events have `isTrusted: false`. A page that checks for trusted
  input can ignore them.
- Captures default to a 2048-pixel maximum side. `maxSide` can change it. Downscaling can make small text unreadable.
- The extension runs the model in its panel. Keep the popup open, or use the
  sidebar, while the model works.
- E2E tests cover local fixture pages only, not live sites.

## Integration guides

- [Ollama and Firefox setup](#locate-your-first-control): extension origin access and local vision calls.
- [foxpaw control handoff](#with-foxpaw): snapshot matching and action calls.
- [Screenshot privacy](#privacy): cloud opt-in and custom adapter boundaries.
- [Firefox permission reference](#firefox-apis-used): capture, scripting, and optional trial ML.

## Status

Version 0.1.3 is an early release. APIs can change before 1.0.
Use [GitHub issues](https://github.com/pooriaarab/foxlens/issues) for support.
Public case studies are not yet published in this repository.
Use the local build for the demo extension; this README does not promise AMO availability.

## FAQ

### What is foxlens?

foxlens locates visual controls in Firefox screenshots and maps model answers back to page elements.
It also describes screenshots and reports model privacy metadata.

### Which integrations are verified?

foxlens has two built-in adapters, plus a foxpaw control bridge.
This rewrite verifies code paths and local checks; real cloud credentials remain unverified.

### Does foxlens provide a managed vision service?

foxlens calls the model you configure.
You run the local server or supply a provider account.

### How is foxlens different from Playwright locators?

foxlens asks a vision model for a point or box inside a screenshot.
Playwright locators select page elements through attributes, text, and selectors.

### Can Firefox trial.ml locate buttons?

foxlens uses trial.ml for captions only.
`locate` rejects this adapter because it cannot return target points.

### Do screenshots leave my device?

foxlens reports `privacy.leftDevice` for cloud-tier calls.
Use local-only foxmind providers; custom `eyes` must report their tier accurately.

### Is allowCloud a consent system for custom models?

foxlens checks `allowCloud` for foxmind providers before a call.
Custom `eyes` run their own code, so you must enforce consent and destination policy there.

### Does clickAt send trusted browser input?

foxlens dispatches synthetic pointer and mouse events.
Pages can ignore them because `isTrusted` is false.

### Does foxlens detect every visual change?

foxlens checks selected geometry and document conditions and counts DOM mutations.
Canvas redraws can change pixels without changing that count.

## Development

```bash
pnpm install --frozen-lockfile
pnpm ci:local
pnpm e2e
```

The local gate runs library checks, extension build, web-ext lint, and AMO listing validation.
Browser tests require Firefox and use fixture pages. Ollama checks also require a running vision model.

## License

[MIT](https://opensource.org/license/mit)

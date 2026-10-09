# Failure modes

This file lists every way foxlens can fail that we know of. Each row says what
foxlens does then, and which test checks it. We wrote this list first, then
the tests, then the code.

`E2E` means a check in `e2e/run.mjs` that runs in a real Firefox.
`unit` means a test in `tests/` that runs in Node with a fake `browser` object
or a fake model. We use a unit test only when an E2E check cannot reach the
failure, or when the case needs exact numbers that a real model cannot give.

Words used here:

- **Image pixels**: pixels in the PNG that `tabs.captureTab` returns.
- **CSS pixels**: the pixels that page layout and `elementFromPoint` use.
- **Page zoom**: the zoom level of the tab (`tabs.setZoom`, Ctrl and +).

## Capture (C)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| C1 | The screen has 2 device pixels per CSS pixel (DPR 2), so the image is twice the size of the viewport. | `capture` measures image pixels per CSS pixel from the real PNG size and returns it as `pxPerCss`. Nothing assumes 1. | E2E: capture at DPR 1 and DPR 2 |
| C2 | Page zoom changes `devicePixelRatio`, `innerWidth` and the image size. `scale: 1` still gives 1.5 image pixels per CSS pixel at 150 % zoom. | Same as C1: the ratio comes from the PNG size divided by the captured CSS width, not from `scale` or `devicePixelRatio`. | E2E: capture at 150 % zoom |
| C3 | The page is scrolled. A viewport capture starts at `scrollY`, not at 0. | `capture` reads `scrollX` and `scrollY` in the page and captures the rect at those offsets, so the image maps to document coordinates. | E2E: capture after a scroll |
| C4 | The extension has no host permission for the tab, so `captureTab` throws. | Throw `FoxlensError` with code `permission` and a message that names the missing host permission. | E2E: remove the host grant, then capture; unit: map Firefox's error text |
| C5 | The tab does not exist, or it shows a page that extensions cannot script (`about:`, the add-ons site). | Throw `FoxlensError` with code `no_tab` or `permission`. Do not return an image without the page facts. | unit: fake `browser` that throws |
| C6 | The caller asks for a huge rect (a whole long page). The PNG would be tens of thousands of pixels high, and a model cannot read it. | Lower the scale so that the longer side is at most `maxSide` (default 2048 image pixels). Return the scale used and `downscaled: true`. | E2E: capture of a 20000 px high page; unit: scale math |
| C7 | The returned data is not a PNG data URL, or it is cut short. | Throw `FoxlensError` with code `bad_image`. | unit |
| C8 | The page navigates while `capture` runs. | The capture keeps the `documentId` of the page it read. Later calls target only that document, so Firefox refuses them (see L12). | E2E: navigate, then locate |

## Model reply (M)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| M1 | The model wraps the JSON in a code fence or adds words around it. | Read the first JSON object or array in the reply. | unit |
| M2 | The model uses another key or shape: `bbox_2d`, `bbox`, `box`, `point`, `point_2d`, or a list of objects. | Accept each of these. A box gives its centre as the point. | unit |
| M3 | The model returns coordinates outside the image (for example x = 1400 in a 1000 px image, or 1200 on the 0 to 1000 scale). | Return `found: false` with reason `out_of_image` and the raw reply. Do not clamp the point to the edge. | unit; E2E with a fake model |
| M4 | The model returns a box with x2 < x1, or a NaN or negative number. | Same as M3: `found: false`, reason `bad_reply` or `out_of_image`. | unit |
| M5 | The model says it cannot find the element (`{"found": false}`, or `null`). | Return `found: false` with reason `not_found`. | unit; E2E with a fake model |
| M6 | The reply is not JSON and has no numbers foxlens can read. | Return `found: false` with reason `bad_reply` and the raw reply. | unit |
| M7 | The model uses the 0 to 1000 scale (Qwen-VL does) but the caller expects image pixels, or the other way round. | The `coordinates` option sets the scale (`"per1000"` by default, or `"pixels"`). The prompt names that scale and the image size, so the model and the parser agree. | unit; E2E with a real model when one runs |
| M8 | In grid mode, the model names a cell that does not exist (0, or 65 in an 8 x 8 grid). | Return `found: false` with reason `out_of_image`. | unit; E2E with a fake model |
| M9 | The model call fails: server down, timeout, or a model with no vision. | Pass on the `FoxmindError` from foxmind, with its code. foxlens does not try another provider by itself. | unit with a fake model |

## Locate: map and hit test (L)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| L1 | DPR, page zoom or scroll is wrong in the mapping, so the point lands beside the element. | Map image pixels to document CSS pixels with the measured ratio and the capture's scroll offsets. The E2E fake model finds the button by its colour in the real PNG, so a wrong mapping misses the button. | E2E: canvas and image-only buttons at DPR 1, DPR 2, 150 % zoom, and scrolled |
| L2 | The page scrolls between the capture and the hit test. | Keep the point in document coordinates and subtract the current scroll in the page. Report the scroll change in `changed`. | E2E: scroll after capture, then locate |
| L3 | The point is outside the viewport after a scroll. | Return `found: false` with reason `offscreen`. | E2E |
| L4 | The viewport size, page zoom or DPR changed after the capture. The image no longer maps to the page. | Return `found: false` with reason `stale`. | E2E: zoom after capture |
| L5 | The element is drawn on a `<canvas>`. `elementFromPoint` gives the canvas, not a button. | Return the canvas as the element, with the point inside it, `interactive: true`, and no foxpaw control. `clickAt` can then click that point. | E2E: canvas fixture |
| L6 | The button has only an image and no text, so its DOM name is empty. | Return the button (the interactive ancestor of the `<img>`), its role, and the `alt` or `aria-label` when there is one. | E2E: image-only button fixture |
| L7 | A transparent overlay (a cookie banner, a glass pane) lies over the element. | Return the element under it and `coveredBy` with the overlay's tag, role and name, so the caller knows a click hits the overlay. | E2E: overlay fixture |
| L8 | The element is in a same-origin `<iframe>`. | Hit test inside the frame's document with the point moved into the frame. Return `frame: "same-origin"`. | E2E: same-origin frame fixture |
| L9 | The element is in a cross-origin `<iframe>`. The top page cannot read inside it. | Return the `<iframe>` as the element with `frame: "cross-origin"` and no control. Do not guess. | E2E: frame from another origin |
| L10 | The element is in a closed shadow root. | In Firefox, the isolated world can use `openOrClosedShadowRoot`, so go inside and return the real element with `shadow: "closed"`. | E2E: closed shadow fixture |
| L11 | The model invents an element: the point lands on the page background (`html` or `body`) or on a large block with no text near it. | Return `found: false` with reason `nothing_there` for `html` and `body`. For other elements, return `check.match` (0 to 1), the word overlap between the description and the element's name and text, so the caller can refuse a weak match. | E2E: fake model points at empty space |
| L12 | The page navigated or reloaded between capture and locate. | The hit test targets the captured `documentId`. Firefox refuses it, and foxlens returns `found: false` with reason `stale`. | E2E: reload after capture |
| L13 | The DOM changed after the capture, but the layout did not move (a counter, a clock). | Count DOM changes since the capture and report them in `changed.mutations`. Do not refuse: many pages change all the time. | E2E: change text after capture |
| L15 | The element is `position: fixed` (or inside a fixed ancestor), and the page scrolls between capture and locate. Its document point now holds another element (for example "Delete account" under a fixed "Accept"). | When the scroll changed and the element at the captured viewport point is fixed, map in viewport space and return the fixed element. Report `anchor: "viewport"`. | E2E: fixed fixture, scroll 300 px after capture |
| L16 | The page scrolls between capture and locate, and the element at the document point is now fixed or sticky (a fixed bar slid over it), or the element at the captured viewport point is sticky. foxlens cannot tell which element the model saw. | Return `found: false` with reason `stale`. | E2E: fixed bar over a scrolled button |
| L14 | The canvas redraws after the capture (a game, a chart), so the drawn button moved. | Not detected. This is a known limit: the DOM does not change. The README says so. | none (documented limit) |

## Hand-off and actions (A)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| A1 | The caller wants foxpaw to act on the element, but foxpaw needs its own `Control` and `Snapshot` for the stale check. | When the caller passes a foxpaw `snapshot` that was taken before `locate`, return the matching `control` from it, so `act(tabId, control, request, snapshot)` keeps foxpaw's stale check. | E2E: image-only button clicked through real foxpaw `act` |
| A2 | The element is not one of foxpaw's controls (a canvas, a closed shadow root). | Return no `control`. `clickAt` clicks the point instead. | E2E: canvas click through `clickAt` |
| A3 | Between `locate` and `clickAt` another element moves under the point. | `clickAt` hit-tests again and compares the element with the one `locate` found. When it differs, it returns `{ ok: false, reason: "stale" }` and does not click. | E2E: swap the element, then click |
| A4 | `outline` draws in the wrong place at DPR 2, at page zoom, or after a scroll. | Draw the outline in document CSS pixels from the hit test's rect. The E2E checks the outline's rect against the element's rect. | E2E |
| A6 | After `locate` found a fixed element, the page scrolls again before `clickAt`. | `clickAt` uses the viewport point for an element found with `anchor: "viewport"`, and the document point otherwise. The identity check still runs. | E2E: scroll, then click the fixed button |
| A5 | The verification data is missing, so the caller cannot sanity-check the element. | Every found result has the element's `tag`, `role`, `name` and `text`. | E2E |

## Providers and privacy (P)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| P1 | The screenshot goes to a cloud model and the caller did not mean it to. | When the foxmind `Mind` has a chat provider on the `cloud` tier, `describe` and `locate` throw `FoxlensError` code `cloud_not_allowed` before any call. `allowCloud: true` lets it through. | unit |
| P2 | The caller cannot tell where the screenshot went. | Every result has `privacy: { tier, provider, leftDevice }`. `leftDevice` is true only for the `cloud` tier. | unit; E2E |
| P3 | `browser.trial.ml` is missing, or the `trialML` permission is not granted. | Throw `FoxlensError` code `unsupported` or `permission`, with the reason. | unit; E2E |
| P4 | `trial.ml` image-to-text gives a caption only. It cannot point at an element. | `locate` with a captioner throws `FoxlensError` code `unsupported`. | unit |
| P5 | The model server answers, but the model has no vision and ignores the image. | foxlens cannot detect this before the call. The README says to pick a vision model. A wrong answer shows up in `check.match` and `nothing_there`. | none (documented limit) |

## Demo extension (D)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| D1 | The person cannot tell where the screenshot went. | The panel shows the answer and says "on this device" or names the remote server. | E2E: describe through the panel with a fake server |
| D2 | Find answers, but the person cannot see which element it means. | The panel outlines the element on the page and shows its tag, role, name and text. | E2E: find through the panel |
| D3 | The popup closes when the person clicks the page, and the answer is lost. | The panel saves the last result and shows it when it opens again. | E2E: read the saved result |
| D4 | The model server is not on this device, and the person did not agree to send screenshots there. | The panel refuses until the person checks "Send screenshots to this server". | none (the code path is `cloud_not_allowed`, P1) |

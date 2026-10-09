// The E2E harness page. e2e/run.mjs calls window.lens.* here, in the
// extension, so foxlens runs with the real browser.* APIs.
import * as foxlens from "../../src/index.ts";

const seen = new Map();
/** The id of the tab that shows this URL. Remembered, because tab URLs hide once the host grant goes. */
async function tabFor(url) {
  const tab = (await browser.tabs.query({})).find((t) => t.url === url);
  if (tab) seen.set(url, tab.id);
  if (!seen.has(url)) throw new Error(`No tab shows ${url}`);
  return seen.get(url);
}

/** RGBA of one image pixel, read with OffscreenCanvas. */
async function pixels(dataUrl, points) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  return points.map(([x, y]) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data]);
}

const colour = ([r, g, b]) => (b > 200 && r < 80 && g < 80 ? "blue" : r > 240 && g > 240 && b > 240 ? "white" : `rgb(${r},${g},${b})`);

/**
 * A fake vision model for deterministic tests. It finds the pixels of one
 * colour in the real screenshot and answers with their box on the 0-1000
 * scale, as Qwen-VL does. It never reads the DOM, so a wrong DPR, zoom or
 * scroll mapping in foxlens makes the point miss.
 */
const per = (v, size) => Math.round((v / size) * 1000);

function colourEyes(hex) {
  const want = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return {
    name: "colour-oracle", canPoint: true,
    async ask(image) {
      const started = Date.now();
      const bitmap = await createImageBitmap(await (await fetch(image)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let [x1, y1, x2, y2] = [Infinity, Infinity, -1, -1];
      for (let i = 0; i < data.length; i += 4) {
        if (want.every((v, c) => Math.abs(data[i + c] - v) <= 12)) {
          const x = (i / 4) % bitmap.width, y = Math.floor(i / 4 / bitmap.width);
          [x1, y1, x2, y2] = [Math.min(x1, x), Math.min(y1, y), Math.max(x2, x), Math.max(y2, y)];
        }
      }
      const text = x2 < 0 ? '{"found": false}'
        : JSON.stringify({ bbox_2d: [per(x1, bitmap.width), per(y1, bitmap.height), per(x2, bitmap.width), per(y2, bitmap.height)] });
      return { text, provider: "colour-oracle", tier: "browser", model: `colour #${hex}`, ms: Date.now() - started };
    },
  };
}

/** A fake vision model that always gives the same reply. */
const fixedEyes = (text) => ({ name: "fixed", canPoint: true, ask: async () => ({ text, provider: "fixed", tier: "browser", model: "fixed", ms: 0 }) });
const eyesFor = (fake) => (fake.colour ? colourEyes(fake.colour) : fixedEyes(fake.reply));

let lastShot;

/** Errors cross the WebDriver boundary as plain objects. */
const plain = (error) => ({ error: { code: error?.code, message: error?.message ?? String(error) } });

window.lens = {
  tabFor,
  async setZoom(url, zoom) {
    await browser.tabs.setZoom(await tabFor(url), zoom);
  },
  /** Capture, then report the colour at each document point through the capture's own mapping. */
  async captureAt(url, options, docPoints) {
    try {
      const shot = await foxlens.capture(await tabFor(url), options);
      const image = docPoints.map(([x, y]) => [(x - shot.rect.x) * shot.pxPerCss, (y - shot.rect.y) * shot.pxPerCss]);
      const colours = (await pixels(shot.dataUrl, image)).map(colour);
      const { dataUrl, ...facts } = shot;
      return { ...facts, bytes: dataUrl.length, colours };
    } catch (error) {
      return plain(error);
    }
  },
  /** Capture and keep the capture for a later locate({ useLast: true }). */
  async capture(url) {
    lastShot = await foxlens.capture(await tabFor(url));
    return { scroll: lastShot.scroll, documentId: lastShot.documentId };
  },
  /** Locate with a fake model. */
  async locate(url, description, fake, options = {}) {
    try {
      const { useLast, ...rest } = options;
      return await foxlens.locate(await tabFor(url), description, { eyes: eyesFor(fake), ...(useLast ? { capture: lastShot } : {}), ...rest });
    } catch (error) {
      return plain(error);
    }
  },
};

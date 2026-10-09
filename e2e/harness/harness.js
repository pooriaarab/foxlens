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
};

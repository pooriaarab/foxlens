// The E2E harness page. e2e/run.mjs calls window.lens.* here, in the
// extension, so foxlens runs with the real browser.* APIs.

const seen = new Map();
/** The id of the tab that shows this URL. Remembered, because tab URLs hide once the host grant goes. */
async function tabFor(url) {
  const tab = (await browser.tabs.query({})).find((t) => t.url === url);
  if (tab) seen.set(url, tab.id);
  if (!seen.has(url)) throw new Error(`No tab shows ${url}`);
  return seen.get(url);
}

window.lens = {
  tabFor,
  async setZoom(url, zoom) {
    await browser.tabs.setZoom(await tabFor(url), zoom);
  },
};

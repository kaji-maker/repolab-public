import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const [root, digest, reportFile, screenshotDirectory] = process.argv.slice(2);
const { verifyRelease } = await import(pathToFileURL(`${root}/integrity.mjs`));
const { startReviewServer } = await import(pathToFileURL(`${root}/server.mjs`));
const { selected } = await import(pathToFileURL(`${root}/contract.mjs`));
assert.equal(Object.keys(process.env).filter(k => /NEBIUS|API_KEY|TOKEN|SECRET|PASSWORD/.test(k)).length, 0);
const sha = b => createHash('sha256').update(b).digest('hex');
await verifyRelease(root, digest);
const exactPatch = await readFile(`${root}/data/patch.patch`, 'utf8');
const requests = [], denied = [], errors = [], cycles = [];
const report = { status: 'RUNNING', manifestSha256: digest,
  inference: 'none', execution: 'Same-host local browser/controller review of recorded data only; no provider calls or candidate execution' };
let server, browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', env: {}, args: ['--no-sandbox'] });
  report.browserVersion = browser.version();
  for (let cycle = 1; cycle <= 2; cycle++) {
    server = await startReviewServer(root, digest, 0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', async route => {
      const request = route.request();
      if (new URL(request.url()).origin !== base || request.method() !== 'GET') {
        denied.push({ url: request.url(), method: request.method() }); await route.abort(); return;
      }
      requests.push(new URL(request.url()).pathname); await route.continue();
    });
    try {
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(base);
      await page.getByTestId('repair-status').filter({ hasText: 'ACCEPTED_INDEPENDENTLY_CORRECT' }).waitFor();
      assert.deepEqual(await page.locator('.fresh-metrics b').allTextContents(), ['1', '14', '$0.004751']);
      await page.getByText('Independently verified', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Start fresh repair', exact: true }).isDisabled(), true);
      assert.match(await page.locator('.fresh-readiness').textContent(), /Portable recorded review only/);
      await page.getByRole('button', { name: 'Inspect tested patch', exact: true }).click();
      const pane = page.getByRole('region', { name: 'Tested patch', exact: true }).locator('pre');
      await pane.waitFor(); assert.equal(await pane.textContent(), exactPatch);
      await pane.focus(); await page.keyboard.press('PageDown');
      await page.waitForFunction(() => {
        const e = document.querySelector('.v8-patch pre');
        return e && e.scrollHeight > e.clientHeight && e.scrollTop > 0;
      }, undefined, { timeout: 3000 });
      const keyboardScroll = await pane.evaluate(e => ({ scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrollTop: e.scrollTop }));
      const downloadPending = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download tested patch', exact: true }).click();
      const download = await downloadPending, stream = await download.createReadStream(), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.equal(sha(Buffer.concat(chunks)), selected.patchSha256);
      await page.getByText('Candidate history & operation IDs', { exact: true }).click();
      assert.equal(await page.locator('details li').count(), 14);
      assert.match(await page.locator('details').textContent(), /Candidate 1: SELECTED/);
      const widths = [];
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.getByRole('button', { name: 'Start fresh repair', exact: true }).isDisabled(), true);
        widths.push({ width, overflow: false, freshDispatchUnavailable: true });
        if (cycle === 1) await page.screenshot({ path: `${screenshotDirectory}/browser-${width}.png`, fullPage: true });
      }
      const before = requests.length;
      await context.setOffline(true);
      await page.getByText('Candidate history & operation IDs', { exact: true }).click();
      assert.equal(await pane.textContent(), exactPatch);
      assert.equal(requests.length, before);
      assert.equal(await page.locator('iframe,object,embed').count(), 0);
      cycles.push({ cycle, status: 'PASS', freshContextAndServer: true, actualRecordedModelCalls: 1, actualRecordedOperations: 14,
        patchSha256: selected.patchSha256, keyboardPatchScroll: true, keyboardScroll, recordedIds: 14, offlineLoadedInspection: true, widths });
    } finally { await context.close(); }
    await new Promise(resolve => server.close(resolve)); server = null;
  }
  assert.deepEqual(errors, []); assert.deepEqual(denied, []);
  await verifyRelease(root, digest);
  Object.assign(report, { status: 'PASS', cycles, pageErrors: errors, deniedRequests: denied,
    allowedRequestPaths: [...new Set(requests)], unchanged: true,
    scope: 'Two fresh same-host Chrome contexts and server starts; not unaided human or separate-machine qualification' });
} catch (error) {
  Object.assign(report, { status: 'FAIL', cycles, error: String(error), pageErrors: errors, deniedRequests: denied });
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
}

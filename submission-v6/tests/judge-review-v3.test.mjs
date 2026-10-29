import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJudgeReviewBundleV3 } from '../scripts/judge-review-bundle-v3.mjs';
import { verifyRelease } from '../apps/judge-review-v3/integrity.mjs';
import { startReviewServer } from '../apps/judge-review-v3/server.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'repolab-review-v3-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, 'review');
  return { directory, created: await createJudgeReviewBundleV3(directory) };
}

test('V3 review serves the compact patch and keeps recorded patch identity separate', async t => {
  const { directory, created } = await fixture(t);
  const server = await startReviewServer(directory, created.manifestSha256, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Read-only source review V5/);
  const catalogResponse = await fetch(`${url}/api/native-preact-repairs-v4`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.readiness.available, false);
  assert.match(catalog.readiness.reason, /no live repair admission/i);
  assert.equal(catalog.history[0].patchSha256, '834fd027fb8433a7fc6eb8ab9d8f81521c52d5fb85fc5ee76f9d7e0754135e52');
  assert.equal(catalog.history[0].recordedPatchSha256, 'cfa54ecee8c1133134b60f50b92ab053b051e13e9a0c928d5181fff5563ba71d');
  const downloaded = await fetch(`${url}/api/native-preact-repairs-v4/${catalog.history[0].id}/patch`);
  assert.equal(downloaded.status, 200);
  assert.equal(sha(Buffer.from(await downloaded.arrayBuffer())), catalog.history[0].patchSha256);
  const mutation = await fetch(`${url}/api/native-preact-repairs-v4`, { method: 'POST' });
  assert.equal(mutation.status, 405);
});

test('V3 release rejects wrong trust digest, changed patch bytes, and unlisted files', async t => {
  const { directory, created } = await fixture(t);
  await assert.rejects(verifyRelease(directory, '0'.repeat(64)), /Trusted manifest digest mismatch/);
  const patchPath = join(directory, 'data/patch.patch');
  const original = await readFile(patchPath);
  await writeFile(patchPath, Buffer.concat([original, Buffer.from('\n') ]));
  await assert.rejects(verifyRelease(directory, created.manifestSha256), /Release asset changed/);
  await writeFile(patchPath, original);
  await writeFile(join(directory, 'extra.txt'), 'unlisted');
  await assert.rejects(verifyRelease(directory, created.manifestSha256), /Unlisted file/);
});

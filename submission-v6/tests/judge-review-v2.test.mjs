import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, cp, readFile, writeFile, mkdir, rename, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createJudgeReviewBundle, verifyRelease } from '../scripts/judge-review-bundle-v2.mjs';
import { selected, manifestName } from '../apps/judge-review-v2/contract.mjs';
import { sha } from '../apps/judge-review-v2/integrity.mjs';
import { startReviewServer } from '../apps/judge-review-v2/server.mjs';
const parent = await mkdtemp(join(tmpdir(), 'repolab-judge-v2-controls-'));
const baseline = join(parent, 'baseline');
const result = await createJudgeReviewBundle(baseline);
async function copy(name) { const p = join(parent, name); await cp(baseline, p, { recursive: true }); return p; }
async function rehash(root, edit = x => x) {
  const path = join(root, manifestName), manifest = JSON.parse(await readFile(path));
  for (const a of manifest.assets) a.sha256 = sha(await readFile(join(root, a.path)));
  edit(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n'); await writeFile(path, bytes); return sha(bytes);
}
async function http(server, path, headers = {}, method = 'GET') {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
}
async function close(server) { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

test('exact qualified frontend and recorded result verify without private runtime or dependencies', async () => {
  assert.equal((await verifyRelease(baseline, result.manifestSha256)).verified, true);
  assert.equal(JSON.parse(await readFile(join(baseline, 'data/review.json'))).inferenceCalls, 1);
  assert.equal(sha(await readFile(join(baseline, 'data/patch.patch'))), selected.patchSha256);
  await assert.rejects(createJudgeReviewBundle(baseline));
  await assert.rejects(createJudgeReviewBundle(join(process.cwd(), 'forbidden-review-output')));
});
test('wrong trust anchor and modified/missing frontend fail', async () => {
  await assert.rejects(verifyRelease(baseline, '0'.repeat(64)), /digest mismatch/);
  const p = await copy('modified'); await writeFile(join(p, 'native-repair-v9.html'), 'changed');
  await assert.rejects(verifyRelease(p, result.manifestSha256), /asset changed/);
  await assert.rejects(verifyRelease(p, await rehash(p)), /binding changed/);
  const q = await copy('missing'); await rename(join(q, 'server.mjs'), join(parent, 'removed-server.mjs'));
  await assert.rejects(verifyRelease(q, result.manifestSha256));
});
test('altered, reformatted and self-rehashed recorded evidence cannot replace the actual result', async () => {
  for (const [index, path] of ['data/review.json', 'data/result.json', 'data/patch.patch'].entries()) {
    const p = await copy(`record-${index}`); await writeFile(join(p, path), Buffer.concat([await readFile(join(p, path)), Buffer.from('\n')]));
    await assert.rejects(verifyRelease(p, result.manifestSha256), /asset changed/);
    await assert.rejects(verifyRelease(p, await rehash(p)), /binding changed/);
  }
});
test('duplicate, missing, traversing and foreign identity manifest entries fail even with their new digest', async () => {
  const edits = [m => { m.assets[1] = m.assets[0]; }, m => { m.assets.pop(); },
    m => { m.assets[0].path = '../secret'; }, m => { m.runId = 'foreign-run'; }];
  for (const [index, edit] of edits.entries()) {
    const p = await copy(`manifest-${index}`); await assert.rejects(verifyRelease(p, await rehash(p, edit)));
  }
});
test('unlisted credential canaries and unexpected directories are refused', async () => {
  const p = await copy('extra'); await writeFile(join(p, '.env'), 'UNTRUSTED_CANARY_ONLY=fixture');
  await assert.rejects(verifyRelease(p, result.manifestSha256), /Unlisted file/);
  const q = await copy('extra-dir'); await mkdir(join(q, 'private'));
  await assert.rejects(verifyRelease(q, result.manifestSha256), /Unlisted directory/);
});
test('symlink root, asset and directory boundaries are refused', async () => {
  const p = join(parent, 'root-link'); await symlink(baseline, p);
  await assert.rejects(verifyRelease(p, result.manifestSha256), /Symlink/);
  const q = await copy('asset-link'); await rename(join(q, 'server.mjs'), join(parent, 'linked-server.mjs'));
  await symlink(join(parent, 'linked-server.mjs'), join(q, 'server.mjs'));
  await assert.rejects(verifyRelease(q, result.manifestSha256), /Symlink/);
  const r = await copy('directory-link'); await rename(join(r, 'data'), join(parent, 'linked-data'));
  await symlink(join(parent, 'linked-data'), join(r, 'data'));
  await assert.rejects(verifyRelease(r, result.manifestSha256), /Symlink/);
});
test('read-only HTTP serves actual projection and exact patch; no mutation, host/origin escape or private file access', async () => {
  const server = await startReviewServer(baseline, result.manifestSha256, 0);
  try {
    const catalog = await http(server, '/api/native-preact-repairs-v4');
    assert.equal(catalog.status, 200); const c = JSON.parse(catalog.bytes);
    assert.equal(c.readiness.available, false); assert.equal(c.history[0].id, selected.id);
    assert.match(c.readiness.reason, /no new model calls/);
    const patch = await http(server, `/api/native-preact-repairs-v4/${selected.id}/patch`);
    assert.equal(sha(patch.bytes), selected.patchSha256);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
      assert.equal((await http(server, '/api/native-preact-repairs-v4', {}, method)).status, 405);
    for (const headers of [{ Host: 'attacker.example' }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }])
      assert.equal((await http(server, '/', headers)).status, 403);
    for (const path of ['/.env', '/server.mjs', '/contract.mjs', '/%2e%2e/.env', '/api/native-preact-repairs-v3', '/data/raw-provider.json'])
      assert.equal((await http(server, path)).status, 404);
    assert.equal((await http(server, '//attacker.example')).status, 400);
    assert.equal((await http(server, '/', {}, 'HEAD')).bytes.length, 0);
  } finally { await close(server); }
});
test('post-start disk substitution cannot change verified response bytes and restart rejects it', async () => {
  const p = await copy('in-memory'), server = await startReviewServer(p, result.manifestSha256, 0);
  try {
    await writeFile(join(p, 'data/patch.patch'), 'malicious patch text');
    const response = await http(server, `/api/native-preact-repairs-v4/${selected.id}/patch`);
    assert.equal(sha(response.bytes), selected.patchSha256);
  } finally { await close(server); }
  await assert.rejects(startReviewServer(p, result.manifestSha256, 0), /asset changed/);
});
test('credential-free restart preserves exact immutable review and writes no state', async () => {
  const before = await readdir(baseline, { recursive: true });
  for (let i = 0; i < 2; i++) {
    const server = await startReviewServer(baseline, result.manifestSha256, 0);
    try { assert.equal(sha((await http(server, '/data/result.json')).bytes), selected.resultSha256); }
    finally { await close(server); }
  }
  assert.deepEqual(await readdir(baseline, { recursive: true }), before);
  assert.equal((await verifyRelease(baseline, result.manifestSha256)).verified, true);
});

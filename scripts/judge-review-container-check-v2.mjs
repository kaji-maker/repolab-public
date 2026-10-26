// Reviewed controller/HTTP checks only. Candidate patch contents remain text.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
const [root, digest] = process.argv.slice(2);
globalThis.fetch = () => { throw Error('Outbound fetch forbidden'); };
assert.equal(Object.keys(process.env).filter(k => /NEBIUS|API_KEY|TOKEN|SECRET|PASSWORD/.test(k)).length, 0);
assert.ok(Number(process.versions.node.split('.')[0]) >= 24);
const external = Object.values(networkInterfaces()).flat().filter(i => i && !i.internal);
assert.equal(external.length, 0);
assert.notEqual(process.getuid(), 0);
const { verifyRelease } = await import(pathToFileURL(`${root}/integrity.mjs`));
const { startReviewServer } = await import(pathToFileURL(`${root}/server.mjs`));
const { selected } = await import(pathToFileURL(`${root}/contract.mjs`));
const sha = b => createHash('sha256').update(b).digest('hex');
const initial = await verifyRelease(root, digest), files = (await readdir(root, { recursive: true })).sort();
assert.equal(initial.files, 17);
assert.equal(files.some(p => /node_modules|\.env|\.repolab/.test(p)), false);
await assert.rejects(startReviewServer(root, '0'.repeat(64), 0), /digest mismatch/);
function get(port, path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []; res.on('data', b => chunks.push(b));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
}
const starts = [];
for (let cycle = 1; cycle <= 2; cycle++) {
  const server = await startReviewServer(root, digest, 0), port = server.address().port;
  try {
    const home = await get(port, '/'); assert.equal(home.status, 200);
    assert.match(home.headers['content-security-policy'], /default-src 'none'/);
    const catalog = JSON.parse((await get(port, '/api/native-preact-repairs-v4')).bytes);
    assert.equal(catalog.readiness.available, false); assert.equal(catalog.history[0].id, selected.id);
    assert.equal(catalog.history[0].inferenceCalls, 1); assert.equal(catalog.history[0].executionCount, 14);
    const patch = await get(port, `/api/native-preact-repairs-v4/${selected.id}/patch`);
    assert.equal(sha(patch.bytes), selected.patchSha256);
    assert.equal(sha((await get(port, '/data/result.json')).bytes), selected.resultSha256);
    for (const path of ['/.env', '/.repolab/state.sqlite', '/server.mjs', '/data%2fresult.json']) assert.equal((await get(port, path)).status, 404);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await get(port, '/api/native-preact-repairs-v4', method)).status, 405);
    assert.equal((await get(port, '/', 'GET', { Host: 'attacker.invalid' })).status, 403);
    assert.equal((await get(port, '/', 'GET', { Origin: 'https://attacker.invalid' })).status, 403);
    assert.equal((await get(port, '/', 'HEAD')).bytes.length, 0);
    starts.push({ cycle, status: 'PASS', freshDispatchAvailable: false, patchSha256: sha(patch.bytes) });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
await verifyRelease(root, digest); assert.deepEqual((await readdir(root, { recursive: true })).sort(), files);
console.log(JSON.stringify({ status: 'PASS', node: process.version, osRelease: (await readFile('/etc/os-release', 'utf8')).split('\n').filter(l => /^(ID|VERSION_ID)=/.test(l)),
  user: process.getuid(), manifestSha256: digest, files: initial.files, nonLoopbackInterfaces: external.length,
  providerVariables: 0, runtimeInstallations: 0, starts, unchanged: true,
  inference: 'none', execution: 'Reviewed controller and loopback HTTP only in a fresh network-disabled container; patch remains text',
  scope: 'Fresh userspace on the original Linux host; not a separate physical machine or live provider qualification' }));

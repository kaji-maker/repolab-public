import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { frontend, selected, manifestName, releasePaths } from './contract.mjs';
export { manifestName, releasePaths };
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function plainFile(root, path) {
  if (!releasePaths.includes(path) && path !== manifestName) throw Error('Unlisted release path');
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw Error('Symlink refused');
  }
  const stat = await lstat(cursor);
  if (!stat.isFile() || stat.size > 4_000_000) throw Error('Bounded regular file required');
  return readFile(cursor);
}

export async function loadRelease(directory, expectedDigest) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? '')) throw Error('Separately trusted manifest SHA-256 required');
  const root = resolve(directory);
  if (await realpath(root) !== root) throw Error('Symlink root refused');
  const manifestBytes = await plainFile(root, manifestName);
  if (sha(manifestBytes) !== expectedDigest) throw Error('Trusted manifest digest mismatch');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.format !== 'repolab-judge-review/v2' || manifest.mode !== 'recorded-qualified-product-only' ||
      manifest.runId !== selected.id || manifest.sourceHash !== selected.sourceHash ||
      !Array.isArray(manifest.assets) || manifest.assets.length !== releasePaths.length)
    throw Error('Unsupported release identity');
  const files = new Map();
  for (const asset of manifest.assets) {
    if (!releasePaths.includes(asset.path) || files.has(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256))
      throw Error('Unsafe, duplicate or missing release asset');
    const bytes = await plainFile(root, asset.path);
    if (sha(bytes) !== asset.sha256) throw Error('Release asset changed');
    files.set(asset.path, bytes);
  }
  if (releasePaths.some(p => !files.has(p))) throw Error('Required release asset missing');
  async function extras(dir = '') {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw Error('Symlink refused');
      if (entry.isDirectory()) {
        if (!['assets', 'data'].includes(path)) throw Error('Unlisted directory');
        await extras(path);
      } else if (!files.has(path) && path !== manifestName) throw Error('Unlisted file');
    }
  }
  await extras();
  for (const [path, hash] of Object.entries({ ...frontend,
    'data/review.json': selected.reviewSha256, 'data/result.json': selected.resultSha256,
    'data/patch.patch': selected.patchSha256 })) {
    if (sha(files.get(path)) !== hash) throw Error('Qualified frontend or recorded evidence binding changed');
  }
  const review = JSON.parse(files.get('data/review.json'));
  if (review.id !== selected.id || review.sourceHash !== selected.sourceHash || !review.verified ||
      review.active || review.simulated || review.executionUncertain || !review.usageComplete ||
      review.inferenceCalls !== 1 || review.executionCount !== 14 || review.patchSha256 !== selected.patchSha256)
    throw Error('Recorded review identity changed');
  return { files, review, manifestSha256: expectedDigest };
}

export async function verifyRelease(directory, expectedDigest) {
  const release = await loadRelease(directory, expectedDigest);
  return { verified: true, files: release.files.size, manifestSha256: expectedDigest,
    inference: 'none', execution: 'Local byte verification only; no provider or candidate execution' };
}

import { mkdir, writeFile, realpath, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { frontend, selected } from '../apps/judge-review-v3/contract.mjs';
import { releasePaths, manifestName, sha, verifyRelease } from '../apps/judge-review-v3/integrity.mjs';
export { verifyRelease };

export async function createJudgeReviewBundleV3(destination) {
  const root = await realpath(process.cwd()), output = resolve(destination), rel = relative(root, output);
  if (!rel || !(rel === '..' || rel.startsWith('../') || isAbsolute(rel))) throw Error('New directory outside checkout required');
  if (await realpath(dirname(output)) !== dirname(output)) throw Error('Symlink parent refused');
  const sourceRoot = join(root, 'apps/judge-review-v3');
  const source = {
    ...Object.fromEntries(Object.keys(frontend).map(p => [p, `dist/qualified-v6/${p}`])),
    'LICENSE': 'LICENSE', 'REACT_LICENSE.txt': 'node_modules/react/LICENSE',
    'REACT_DOM_LICENSE.txt': 'node_modules/react-dom/LICENSE', 'SCHEDULER_LICENSE.txt': 'node_modules/scheduler/LICENSE',
    'THIRD_PARTY_NOTICES.md': 'apps/judge-review-v2/THIRD_PARTY_NOTICES.md',
    'PREACT_LICENSE.txt': 'apps/judge-review-v2/PREACT_LICENSE.txt',
    'data/review.json': 'evaluation/preact-browser-v2-portable-review.json',
    'data/result.json': 'evaluation/browser-release-v2-results-summary.json',
    'data/patch.recorded.patch': 'reviewer-packs/preact-browser-v2.patch',
    'data/patch.patch': 'review-material/preact-compact-v1/compact.patch',
    'data/patch-base/diff-index.js': 'review-material/preact-compact-v1/original/src/diff/index.js',
    'data/patch-base/diff-children.js': 'review-material/preact-compact-v1/original/src/diff/children.js',
    'data/patch-base/internal.d.ts': 'review-material/preact-compact-v1/original/src/internal.d.ts',
    'data/patch-base/expected.sha256': 'review-material/preact-compact-v1/expected.sha256',
    'data/patch-base/LICENSE': 'review-material/preact-compact-v1/original/LICENSE',
  };
  const entries = [];
  for (const path of releasePaths) {
    const input = source[path] ? join(root, source[path]) : join(sourceRoot, path);
    if (await realpath(input) !== input) throw Error('Symlink source refused');
    const bytes = await readFile(input);
    entries.push({ path, bytes });
  }
  const fixed = {
    ...frontend, 'data/review.json': selected.reviewSha256, 'data/result.json': selected.resultSha256,
    'data/patch.recorded.patch': selected.recordedPatchSha256, 'data/patch.patch': selected.compactPatchSha256,
  };
  for (const [path, hash] of Object.entries(fixed)) {
    if (sha(entries.find(e => e.path === path).bytes) !== hash) throw Error(`Qualified input bytes changed: ${path}`);
  }
  const manifest = { format: 'repolab-judge-review/v3', mode: 'recorded-qualified-product-with-compact-equivalent-patch',
    runId: selected.id, sourceHash: selected.sourceHash,
    inference: 'none', execution: 'Local static packaging only; historical actual result retained',
    patchRepresentation: 'Compact patch is a byte-equivalent alternate diff; exact original patch is retained separately',
    assets: entries.map(({ path, bytes }) => ({ path, sha256: sha(bytes) })) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(output, { mode: 0o755 });
  for (const { path, bytes } of entries) {
    await mkdir(dirname(join(output, path)), { recursive: true, mode: 0o755 });
    await writeFile(join(output, path), bytes, { flag: 'wx', mode: 0o644 });
  }
  await writeFile(join(output, manifestName), manifestBytes, { flag: 'wx', mode: 0o644 });
  return { directory: output, ...await verifyRelease(output, sha(manifestBytes)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, input, expected] = process.argv.slice(2);
  const result = action === 'create' ? await createJudgeReviewBundleV3(input)
    : action === 'verify' ? await verifyRelease(input, expected)
    : (() => { throw Error('Use create NEW_DIRECTORY or verify DIRECTORY TRUSTED_MANIFEST_SHA256'); })();
  console.log(JSON.stringify(result));
}

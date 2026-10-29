import { mkdir, writeFile, realpath, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { frontend, selected } from '../apps/judge-review-v2/contract.mjs';
import { releasePaths, manifestName, sha, verifyRelease } from '../apps/judge-review-v2/integrity.mjs';
export { verifyRelease };

export async function createJudgeReviewBundle(destination) {
  const root = await realpath(process.cwd()), output = resolve(destination), rel = relative(root, output);
  if (!rel || !(rel === '..' || rel.startsWith('../') || isAbsolute(rel))) throw Error('New directory outside checkout required');
  if (await realpath(dirname(output)) !== dirname(output)) throw Error('Symlink parent refused');
  const sourceRoot = join(root, 'apps/judge-review-v2');
  const source = {
    ...Object.fromEntries(Object.keys(frontend).map(p => [p, `dist/qualified-v5/${p}`])),
    'LICENSE': 'LICENSE',
    'REACT_LICENSE.txt': 'node_modules/react/LICENSE', 'REACT_DOM_LICENSE.txt': 'node_modules/react-dom/LICENSE',
    'SCHEDULER_LICENSE.txt': 'node_modules/scheduler/LICENSE',
    'data/review.json': 'evaluation/preact-browser-v2-portable-review.json',
    'data/result.json': 'evaluation/browser-release-v2-results-summary.json',
    'data/patch.patch': 'reviewer-packs/preact-browser-v2.patch',
  };
  const entries = [];
  for (const path of releasePaths) {
    const input = source[path] ? join(root, source[path]) : join(sourceRoot, path);
    if (await realpath(input) !== input) throw Error('Symlink source refused');
    const bytes = await readFile(input);
    entries.push({ path, bytes });
  }
  for (const [path, hash] of Object.entries({ ...frontend, 'data/review.json': selected.reviewSha256,
    'data/result.json': selected.resultSha256, 'data/patch.patch': selected.patchSha256 })) {
    if (sha(entries.find(e => e.path === path).bytes) !== hash) throw Error('Qualified input bytes changed');
  }
  const manifest = { format: 'repolab-judge-review/v2', mode: 'recorded-qualified-product-only',
    runId: selected.id, sourceHash: selected.sourceHash,
    inference: 'none', execution: 'Local static packaging only; historical actual result retained',
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
  const result = action === 'create' ? await createJudgeReviewBundle(input)
    : action === 'verify' ? await verifyRelease(input, expected)
    : (() => { throw Error('Use create NEW_DIRECTORY or verify DIRECTORY TRUSTED_MANIFEST_SHA256'); })();
  console.log(JSON.stringify(result));
}

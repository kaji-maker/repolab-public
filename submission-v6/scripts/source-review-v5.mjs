// Build V5 as an additive, immutable successor to the V4 local source-review candidate.
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReviewCandidateV4 } from './source-review-v4.mjs';
import { scanSource, sha, verifySourceRelease } from './source-release-v2.mjs';

const baseManifest = '855fdb3725fec09ee176b8f64cf4edaeadf210d57ef492f636f428d2312be9ac';
const replacements = {
  'README.md': 'release/source-v5/README.md',
  'package.json': 'release/source-v5/package.json',
  'apps/web/src/FreshPreactV10.tsx': 'release/source-v5/FreshPreactV10.tsx',
  'apps/web/native-repair-v10.html': 'release/source-v5/native-repair-v10.html',
  'apps/api/source-preview-v2.ts': 'apps/api/source-preview-v2.ts',
  'apps/api/qualified-server-v3.ts': 'apps/api/qualified-server-v3.ts',
  'apps/api/cloud-live-server-v2.mjs': 'apps/api/cloud-live-server-v2.mjs',
  'packages/repositories/cloud-dependency-proof-v2.mjs': 'packages/repositories/cloud-dependency-proof-v2.mjs',
  'packages/repositories/cloud-provider-config-v1.mjs': 'packages/repositories/cloud-provider-config-v1.mjs',
  'packages/repositories/cloud-provider-preflight-v1.mjs': 'packages/repositories/cloud-provider-preflight-v1.mjs',
  'packages/repositories/cloud-run-pool-v1.mjs': 'packages/repositories/cloud-run-pool-v1.mjs',
  'packages/repositories/cloud-runtime-policy-v1.mjs': 'packages/repositories/cloud-runtime-policy-v1.mjs',
  'packages/repositories/cloud-runtime-proof-v1.mjs': 'packages/repositories/cloud-runtime-proof-v1.mjs',
  'packages/repositories/cloud-runtime-router-v1.mjs': 'packages/repositories/cloud-runtime-router-v1.mjs',
  'vite.native-v11.config.ts': 'vite.native-v11.config.ts',
  'apps/judge-review-v3/contract.mjs': 'apps/judge-review-v3/contract.mjs',
  'apps/judge-review-v3/integrity.mjs': 'apps/judge-review-v3/integrity.mjs',
  'apps/judge-review-v3/server.mjs': 'apps/judge-review-v3/server.mjs',
  'apps/judge-review-v3/README.md': 'apps/judge-review-v3/README.md',
  'scripts/judge-review-bundle-v3.mjs': 'scripts/judge-review-bundle-v3.mjs',
  'scripts/source-review-v5.mjs': 'scripts/source-review-v5.mjs',
  'tests/judge-review-v3.test.mjs': 'tests/judge-review-v3.test.mjs',
  'tests/source-preview-v2.test.ts': 'tests/source-preview-v2.test.ts',
  'tests/cloud-dependency-proof-v2.test.mjs': 'tests/cloud-dependency-proof-v2.test.mjs',
  'tests/cloud-runtime-proof-v1.test.mjs': 'tests/cloud-runtime-proof-v1.test.mjs',
  'tests/cloud-runtime-http-v1.test.mjs': 'tests/cloud-runtime-http-v1.test.mjs',
  'tests/cloud-run-pool-v1.test.mjs': 'tests/cloud-run-pool-v1.test.mjs',
  'tests/cloud-provider-preflight-v1.test.mjs': 'tests/cloud-provider-preflight-v1.test.mjs',
  'tests/cloud-provider-config-v1.test.mjs': 'tests/cloud-provider-config-v1.test.mjs',
  'release/source-v5/README.md': 'release/source-v5/README.md',
  'release/source-v5/SUBMISSION_BUILD.md': 'release/source-v5/SUBMISSION_BUILD.md',
  'release/source-v5/package.json': 'release/source-v5/package.json',
  'release/source-v5/FreshPreactV10.tsx': 'release/source-v5/FreshPreactV10.tsx',
  'release/source-v5/native-repair-v10.html': 'release/source-v5/native-repair-v10.html',
  'release/source-v5/dist/qualified-v6/native-repair-v10.html': 'release/source-v5/dist/qualified-v6/native-repair-v10.html',
  'release/source-v5/dist/qualified-v6/mark.svg': 'release/source-v5/dist/qualified-v6/mark.svg',
  'release/source-v5/dist/qualified-v6/assets/qualifiedRepair-CJYqIfYI.css': 'release/source-v5/dist/qualified-v6/assets/qualifiedRepair-CJYqIfYI.css',
  'release/source-v5/dist/qualified-v6/assets/qualifiedRepair-CTQOz4bb.js': 'release/source-v5/dist/qualified-v6/assets/qualifiedRepair-CTQOz4bb.js',
  'dist/qualified-v6/native-repair-v10.html': 'release/source-v5/dist/qualified-v6/native-repair-v10.html',
  'dist/qualified-v6/mark.svg': 'release/source-v5/dist/qualified-v6/mark.svg',
  'dist/qualified-v6/assets/qualifiedRepair-CJYqIfYI.css': 'release/source-v5/dist/qualified-v6/assets/qualifiedRepair-CJYqIfYI.css',
  'dist/qualified-v6/assets/qualifiedRepair-CTQOz4bb.js': 'release/source-v5/dist/qualified-v6/assets/qualifiedRepair-CTQOz4bb.js',
};

function asset(path) {
  let cursor = '.';
  for (const part of path.split('/')) { cursor = join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Source symlink refused'); }
  const bytes = fs.readFileSync(path); scanSource(bytes, path); return bytes;
}

export function createReviewCandidateV5(destination) {
  const inputs = Object.fromEntries(Object.entries(replacements).map(([name, path]) => [name, asset(path)]));
  const created = createReviewCandidateV4(destination);
  if (created.manifestSha256 !== baseManifest) throw Error('Base V4 source manifest changed');
  const root = resolve(destination), manifestPath = join(root, 'SOURCE_MANIFEST.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  for (const [name, bytes] of Object.entries(inputs)) {
    const prior = manifest.files.find(item => item.path === name);
    if (prior && !['README.md', 'package.json'].includes(name))
      throw Error('Unexpected existing V5 path');
    if (prior) prior.sha256 = sha(bytes); else manifest.files.push({ path: name, sha256: sha(bytes) });
    const target = join(root, name);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: prior ? 'w' : 'wx' });
  }
  manifest.sourceScope = 'V5 submission source candidate; additive read-only V6 preview and V3 recorded review displaying a compact equivalent patch, plus current hosted runtime source; no private state, provider configuration, dependency authority or live dispatch admission';
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(manifestPath, bytes);
  return { version: 'source-review-v5-submission-candidate', baseManifestSha256: baseManifest, ...verifySourceRelease(root, sha(bytes)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== 'create') throw Error('Use create NEW_DIRECTORY');
  console.log(JSON.stringify(createReviewCandidateV5(process.argv[3])));
}

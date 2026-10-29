import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeSourcePath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe source path');
  if (path.split('/').some(p => ['.git', '.repolab', '.codex', '.claude', '.aws', '.ssh', 'node_modules', 'coverage'].includes(p)) ||
      /(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('/.env.example') && path !== '.env.example' || /\.(sqlite|db|pem|key|log|ndjson|zip|tar|gz)$/.test(path))
    throw Error('Private or executable archive path refused');
  return path;
}
export function scanSource(bytes, path) {
  safeSourcePath(path);
  if (bytes.length > 4_000_000 || bytes.includes(0)) throw Error('Unbounded or binary source asset');
  const text = bytes.toString('utf8');
  const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/];
  if (patterns.some(p => p.test(text))) throw Error('Credential-shaped source bytes refused');
  for (const match of text.matchAll(/(?:apiKey|api_key|NEBIUS_API_KEY|NEBIUS_SANDBOX_TOKEN|access_token|password)\s*[=:]\s*["']([^"'\n]{28,})["']/gi)) {
    if (!/fixture|canary|example|sentinel|placeholder|redacted|dummy|not.a.real/i.test(match[1])) throw Error('Unreviewed credential literal refused');
  }
  return true;
}
function regular(root, path) {
  safeSourcePath(path);
  let cursor = root;
  for (const part of path.split('/')) { cursor = join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Symlink refused'); }
  if (!fs.statSync(cursor).isFile()) throw Error('Regular source file required');
  const bytes = fs.readFileSync(cursor); scanSource(bytes, path); return bytes;
}
export function verifySourceRelease(directory, expectedSha) {
  const root = resolve(directory);
  if (fs.realpathSync(root) !== root || !/^[a-f0-9]{64}$/.test(expectedSha ?? '')) throw Error('Trusted manifest and nonsymlink root required');
  const bytes = regular(root, 'SOURCE_MANIFEST.json');
  if (sha(bytes) !== expectedSha) throw Error('Source manifest digest mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.format !== 'repolab-source-release/v2' || manifest.dispatchAdmission !== false || !Array.isArray(manifest.files)) throw Error('Unsupported source manifest');
  const seen = new Set();
  for (const file of manifest.files) {
    safeSourcePath(file.path);
    if (seen.has(file.path) || file.path === 'SOURCE_MANIFEST.json' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Duplicate or unsafe source entry');
    seen.add(file.path);
    if (sha(regular(root, file.path)) !== file.sha256) throw Error('Source asset changed');
  }
  function walk(dir = '') {
    for (const entry of fs.readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw Error('Symlink refused');
      if (entry.isDirectory()) { if (![...seen].some(p => p.startsWith(path + '/'))) throw Error('Unlisted directory'); walk(path); }
      else if (!seen.has(path) && path !== 'SOURCE_MANIFEST.json') throw Error('Unlisted source file');
    }
  }
  walk();
  return { verified: true, files: seen.size, manifestSha256: expectedSha, inference: 'none', execution: 'Data/hash/source-pattern inspection only; no guest execution' };
}
export function createSourceRelease(destination) {
  const root = fs.realpathSync(process.cwd()), output = resolve(destination);
  if (!relative(root, output).startsWith('../') || fs.realpathSync(dirname(output)) !== dirname(output)) throw Error('New outside-checkout directory required');
  const lock = JSON.parse(regular(root, 'evaluation/source-release-v2.json'));
  const entries = lock.files.map(file => {
    const bytes = regular(root, file.source ?? file.path);
    scanSource(bytes, file.path);
    if (sha(bytes) !== file.sha256) throw Error('Reviewed source lock changed');
    return { path: safeSourcePath(file.path), bytes };
  });
  if (new Set(entries.map(e => e.path)).size !== entries.length) throw Error('Duplicate source destination');
  entries.push({ path: 'evaluation/source-release-v2.json', bytes: regular(root, 'evaluation/source-release-v2.json') });
  const manifestBytes = Buffer.from(JSON.stringify({ format: 'repolab-source-release/v2', dispatchAdmission: false,
    sourceScope: 'Qualified Preact engine/API/frontend and recorded review tooling; private qualification/credentials excluded',
    files: entries.map(({ path, bytes }) => ({ path, sha256: sha(bytes) })) }, null, 2) + '\n');
  fs.mkdirSync(output, { mode: 0o755 });
  for (const { path, bytes } of [...entries, { path: 'SOURCE_MANIFEST.json', bytes: manifestBytes }]) {
    fs.mkdirSync(dirname(join(output, path)), { recursive: true, mode: 0o755 });
    fs.writeFileSync(join(output, path), bytes, { flag: 'wx', mode: 0o644 });
  }
  return { directory: output, ...verifySourceRelease(output, sha(manifestBytes)) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, directory, hash] = process.argv.slice(2);
  console.log(JSON.stringify(action === 'create' ? createSourceRelease(directory) : action === 'verify' ? verifySourceRelease(directory, hash) : (() => { throw Error('Use create NEW_DIRECTORY or verify DIRECTORY TRUSTED_MANIFEST_SHA256'); })()));
}

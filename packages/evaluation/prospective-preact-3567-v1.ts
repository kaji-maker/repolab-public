import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditProspective } from "./prospective-v1.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";

export const CLEANUP_FREEZE: string = "ee67f7900dda8920d4e2b72e46b68a0c1608d1b73a6aed0fe97737c16386304b";
export const CLEANUP_TASK = "preactjs__preact-3567";
export const CLEANUP_COMMIT = "c77e6284c199761d59467d8cc596a2f03540e72c";
export const CLEANUP_TREE = "aa75aa1c9cf7f6e46abaa7d31e24c3bedd1bbb9e";
export const CLEANUP_ARCHIVE = "b5988e4c37e6fa03da53dd7deb2f811672f7c060a4cfc2a2a297475e664b4ea4";
const fixtures = "fixtures/prospective-preact-3567-v1/";
const repository = "repositories/prospective-preact-3567-v1/";
const preparation = ".repolab/prospective-preact-3567-v1-preparation/";
const manifestPath = "evaluation/prospective-preact-3567-v1.json";
export const cleanupStages = ["prepare", "build", "protect", "integrity", "lint", "mocha-A", "typescript",
  "browser-A", "reproduction-A", "mocha-B", "browser-B", "reproduction-B"];
export const cleanupAssets = [
  "packages/evaluation/prospective-preact-3567-v1.ts", "apps/evaluator/prospective-preact-3567-v1.ts",
  "tests/prospective-preact-3567-v1.test.ts", "evaluation/PROSPECTIVE_PREACT_3567_V1.md",
  repository + "original.tar.gz", repository + "LICENSE", repository + "reported.jsx",
  repository + "control-no-reset.jsx", repository + "browser-probe.js", repository + "reproduction.cjs",
  fixtures + "original-manifest.json", fixtures + "commit.json", fixtures + "canonical-tree.json",
  fixtures + "context.json", fixtures + "native-plan.json", fixtures + "node-inventory.json",
  preparation + "execution-blocker.json", "packages/evaluation/prospective-v1.ts", "evaluation/prospective-v1.json",
  "packages/repositories/onboarding-v1.ts",
] as const;
export const cleanupHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function cleanupBytes(path: string) {
  const bytes = readFileSync(path);
  return path === cleanupAssets[0] ? Buffer.from(bytes.toString().replace(CLEANUP_FREEZE, "__CLEANUP_FREEZE__")) : bytes;
}
const readJson = (path: string, reader = cleanupBytes) => JSON.parse(reader(path).toString());
export function originalCleanupComponent(statement: string) {
  const match = /```js\r?\n([\s\S]*?)```/.exec(statement);
  if (!match || !match[1].includes("function Foo()")) throw Error("Missing original reported component");
  return match[1].replace(/\r\n/g, "\n");
}
export function cleanupBrowserFiles(paths: string[]) {
  return paths.filter(p => /^(?:(?:debug|devtools|hooks|compat|test-utils|jsx-runtime)\/)?test\/(?:browser|shared)\/.*\.test\.js$/.test(p)).sort();
}
/** Static parsing of this exact six-file layout only; never executes a test or helper. */
export function originalCleanupNodeCases(files: Map<string, Buffer>) {
  const cases: {id: string; skipped: boolean; file: string}[] = [];
  for (const [path, bytes] of files) {
    if (!path.startsWith("test/node/") && !path.startsWith("test/shared/")) continue;
    const text = bytes.toString();
    const suites = [...text.matchAll(/^\s*describe\('([^']+)'/gm)];
    const names = [...text.matchAll(/^\s*it\('([^']+)'/gm)];
    if (names.length && suites.length !== 1) throw Error("Unreviewed Node source layout");
    for (const name of names) cases.push({id: suites[0][1] + " " + name[1], skipped: false,
      file: path.replace("isValidElementTests.js", "isValidElement.test.js")});
  }
  return cases.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function verifyCleanupSource(reader = cleanupBytes) {
  const manifest = readJson(fixtures + "original-manifest.json", reader);
  const commit = readJson(fixtures + "commit.json", reader), tree = readJson(fixtures + "canonical-tree.json", reader);
  if (manifest.taskId !== CLEANUP_TASK || manifest.repository !== "preactjs/preact" || manifest.baseCommit !== CLEANUP_COMMIT ||
      manifest.archiveRoot !== "preact-" + CLEANUP_COMMIT || manifest.archiveSha256 !== CLEANUP_ARCHIVE ||
      manifest.archiveBytes !== 678301 || manifest.files.length !== 315 || manifest.gitTreeSha1 !== CLEANUP_TREE ||
      commit.sha !== CLEANUP_COMMIT || commit.tree.sha !== CLEANUP_TREE || tree.sha !== CLEANUP_TREE || tree.truncated !== false)
    throw Error("Exact original Preact source identity changed");
  const blobs = tree.tree.filter((x: any) => x.type === "blob").sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (tree.tree.some((x: any) => !["blob", "tree"].includes(x.type)) || blobs.some((x: any) => x.mode !== "100644") ||
      !isDeepStrictEqual(blobs.map((x: any) => ({path: x.path, bytes: x.size, gitBlobSha1: x.sha, gitMode: x.mode})),
        manifest.files.map(({sha256, ...entry}: any) => entry))) throw Error("Original canonical blob inventory changed");
  const files = readPinnedRepositoryArchive(reader(repository + "original.tar.gz"), {
    repository: "preactjs/preact", commit: CLEANUP_COMMIT, archiveRoot: manifest.archiveRoot, archiveSha256: CLEANUP_ARCHIVE, files: manifest.files,
  });
  const pkg = JSON.parse(files.get("package.json")!.toString()), lock = JSON.parse(files.get("package-lock.json")!.toString());
  if (pkg.version !== "10.8.0" || pkg.scripts.build !== "npm-run-all --parallel build:*" ||
      pkg.scripts["build:core"] !== "microbundle build --raw" || pkg.scripts["build:hooks"] !== "microbundle build --raw --cwd hooks" ||
      pkg.scripts.postbuild !== "node ./config/node-13-exports.js && node ./config/compat-entries.js" ||
      pkg.scripts["test:mocha"] !== 'mocha --recursive --require "@babel/register" test/shared test/node' ||
      pkg.scripts["test:ts"] !== "run-p test:ts:*" || pkg.scripts.lint !== "eslint src test debug compat hooks test-utils" ||
      lock.lockfileVersion !== 2 || !files.get("karma.conf.js")!.toString().includes("{debug,devtools,hooks,compat,test-utils,jsx-runtime,}/test/{browser,shared}/**/*.test.js"))
    throw Error("Native script/configuration review changed");
  const context = readJson(fixtures + "context.json", reader), plan = readJson(fixtures + "native-plan.json", reader);
  if (context.instance_id !== CLEANUP_TASK || context.repo !== "preactjs/preact" || context.base_commit !== CLEANUP_COMMIT ||
      context.problemSha256 !== "b5fc52ad605f49c2d9000deb3f3bf3d1e2288f7a58292cade63904bfed12e09f" ||
      cleanupHash(context.problem_statement) !== context.problemSha256 ||
      reader(repository + "reported.jsx").toString() !== originalCleanupComponent(context.problem_statement)) throw Error("Original issue/component binding changed");
  const reported = originalCleanupComponent(context.problem_statement), control = reported.replace("  setA(false);\n", "");
  if (control === reported || reader(repository + "control-no-reset.jsx").toString() !== control) throw Error("Declared no-reset control changed");
  const paths = manifest.files.map((f: any) => f.path as string), browserFiles = cleanupBrowserFiles(paths);
  const tsFiles = paths.filter((p: string) => /^(test|compat\/test)\/ts\/.*\.tsx?$/.test(p)).sort();
  const inventory = readJson(fixtures + "node-inventory.json", reader);
  const nodeFiles = manifest.files.filter((f: any) => f.path.startsWith("test/node/") || f.path.startsWith("test/shared/"));
  const cases = originalCleanupNodeCases(files);
  if (nodeFiles.length !== 6 || cases.length !== 29 || inventory.taskId !== CLEANUP_TASK || inventory.commit !== CLEANUP_COMMIT ||
      !isDeepStrictEqual(inventory.sourceFiles, nodeFiles) || !isDeepStrictEqual(inventory.cases, cases)) throw Error("Task-specific static Node inventory changed");
  const toolchain = Object.fromEntries(["typescript", "mocha", "microbundle", "karma", "esbuild", "@babel/core", "@babel/plugin-transform-react-jsx"]
    .map(name => [name, lock.packages["node_modules/" + name].version]));
  if (browserFiles.length !== 90 || tsFiles.length !== 16 || plan.taskId !== CLEANUP_TASK || plan.commit !== CLEANUP_COMMIT ||
      plan.version !== pkg.version || plan.node !== "20.9.0" || plan.npm !== "10.1.0" || plan.lockfileVersion !== 2 ||
      !isDeepStrictEqual(plan.toolchain, toolchain) || !isDeepStrictEqual(plan.scripts, pkg.scripts) ||
      !isDeepStrictEqual(plan.nodeSourceFiles, nodeFiles.map((f: any) => f.path)) || plan.nodeStaticCases !== 29 ||
      !isDeepStrictEqual(plan.browserFiles, browserFiles) || !isDeepStrictEqual(plan.typescriptFiles, tsFiles) ||
      !isDeepStrictEqual(plan.proposedStages, cleanupStages) || plan.proposedOriginalOperations !== 12 || plan.taskOriginalCeiling !== 12 ||
      plan.nativeRuntimeQualified !== false || plan.originalReproduced !== false || plan.executionAdmission !== false)
    throw Error("Original native inventory or unqualified status changed");
  return {files: files.size, version: pkg.version, archiveBytes: manifest.archiveBytes, archiveSha256: CLEANUP_ARCHIVE,
    gitTreeSha1: CLEANUP_TREE, lockSha256: manifest.files.find((f: any) => f.path === "package-lock.json").sha256,
    nodeSourceFiles: nodeFiles.length, staticNodeCases: cases.length, nodeCaseDigest: cleanupHash(JSON.stringify(cases)),
    browserTestFiles: browserFiles.length, browserFilesDigest: cleanupHash(JSON.stringify(browserFiles)),
    typescriptFiles: tsFiles.length, toolchain, reportedComponentSha256: cleanupHash(reported)};
}
export function auditCleanupPreparation(reader = cleanupBytes) {
  if (CLEANUP_FREEZE === "__UNFROZEN__") throw Error("Original-only preparation not frozen");
  const p = readJson(manifestPath, reader), {digest, ...payload} = p;
  if (digest !== CLEANUP_FREEZE || cleanupHash(JSON.stringify(payload)) !== digest || p.taskId !== CLEANUP_TASK || p.commit !== CLEANUP_COMMIT ||
      p.status !== "PREPARED_ONLY" || p.maxModelCalls !== 0 || p.maxSandboxOperations !== 0 || p.executionAdmission !== false ||
      p.candidateAdmission !== false || p.nativeRuntimeQualified !== false || p.originalReproduced !== false ||
      p.proposedOriginalOperations !== 12 || p.taskOriginalCeiling !== 12 || p.assets.length !== cleanupAssets.length ||
      p.assets.some((a: any, i: number) => a.path !== cleanupAssets[i] || a.sha256 !== cleanupHash(reader(a.path)))) throw Error("Preparation freeze or closed admission changed");
  const parent = auditProspective();
  if (p.prospectiveFreeze !== parent.manifest.digest || parent.tasks.find(t => t.instance_id === CLEANUP_TASK)?.base_commit !== CLEANUP_COMMIT)
    throw Error("Fixed prospective task identity changed");
  verifyCleanupSource(reader);
  return p;
}
/** Missing/changed guards request review and never grant authority. No lease mutation. */
export function currentCleanupBlocker(reader: (path: string) => Buffer = readFileSync) {
  const snapshot = readJson(preparation + "execution-blocker.json");
  const present = (path: string) => {try {reader(path); return true;} catch {return false;}};
  const unchanged = snapshot.files.every((f: any) => present(f.path) && cleanupHash(reader(f.path)) === f.sha256);
  return {status: unchanged ? "UNCHANGED_UNKNOWN_SUBMISSION" : "STATE_CHANGED_REVIEW_REQUIRED", executionAdmission: false,
    bothSharedLeasesPresent: [".repolab/clsx-repair.lock", ".repolab/repositories/clsx-repair.lock"].every(present)};
}
export function refuseCleanupDispatch(): never {
  throw Error("Offline preparation has no dispatch authority; resolve submission uncertainty and freeze qualified execution separately");
}
/** Proposed original gate only; a synthetic report never qualifies execution. */
export function checkCleanupNodeReport(value: unknown) {
  const entry = z.object({fullTitle: z.string(), file: z.string(), pending: z.boolean().optional(), err: z.record(z.string(), z.unknown()).optional()});
  const r = z.object({stats: z.object({tests: z.literal(29), passes: z.literal(29), pending: z.literal(0), failures: z.literal(0)}),
    tests: z.array(entry).length(29), passes: z.array(entry).length(29), pending: z.array(z.unknown()).length(0), failures: z.array(z.unknown()).length(0)}).parse(value);
  const expected = readJson(fixtures + "node-inventory.json").cases.map(({skipped, ...c}: any) => c);
  for (const entries of [r.tests, r.passes]) {
    if (entries.some(e => e.pending || (e.err && Object.keys(e.err).length))) throw Error("Native Node failure or new skip");
    const actual = entries.map(e => ({id: e.fullTitle, file: e.file.replace(/^\/opt\/repolab\/preact\//, "")}))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!isDeepStrictEqual(actual, expected)) throw Error("Original Node case/file identity changed");
  }
  return {passed: 29, skipped: 0, caseDigest: cleanupHash(JSON.stringify(expected))};
}
const Dist = z.object({path: z.enum(["dist/preact.umd.js", "hooks/dist/hooks.umd.js"]), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const Snapshot = z.object({phase: z.enum(["mounted", "after-action", "unmounted"]), text: z.string(), buttonPresent: z.boolean(), sameButton: z.boolean(),
  componentUnmounts: z.number().int().nonnegative(), effectSetups: z.number().int().nonnegative(), effectCleanups: z.number().int().nonnegative(),
  alerts: z.array(z.string()), renderStates: z.array(z.boolean()).nonempty()}).strict();
export function checkCleanupObservations(value: unknown, dist: {path: string; bytes: number; sha256: string}[], browserVersion: string) {
  const row = z.object({name: z.enum(["reported-click", "reported-idle", "no-reset-click"]), sourceSha256: z.string(),
    snapshots: z.array(Snapshot).length(3), warnings: z.array(z.string()).length(0), errors: z.array(z.string()).length(0)}).strict();
  const o = z.object({version: z.literal("10.8.0"), nodeEnv: z.null(), browserVersion: z.string().min(1),
    environment: z.literal("Chromium; built original UMD; natural effect scheduler; instrumented effect/unmount/alert"),
    loaded: z.array(Dist).length(2), observations: z.array(row).length(3)}).strict().parse(value);
  if (o.browserVersion !== browserVersion || !/^\d+\.\d+\.\d+\.\d+$/.test(browserVersion) ||
      !isDeepStrictEqual(o.loaded.map(d => d.path), ["dist/preact.umd.js", "hooks/dist/hooks.umd.js"]) ||
      o.loaded.some(l => !isDeepStrictEqual(dist.find(d => d.path === l.path), l))) throw Error("Unbound browser/build identity");
  const names = ["reported-click", "reported-idle", "no-reset-click"];
  const alert = "This should only happen when component is unmounted?";
  for (let i = 0; i < names.length; i++) {
    const r = o.observations[i], [mount, action, unmount] = r.snapshots;
    const source = i === 2 ? "control-no-reset.jsx" : "reported.jsx";
    if (r.name !== names[i] || r.sourceSha256 !== cleanupHash(readFileSync(repository + source)) ||
        !isDeepStrictEqual(r.snapshots.map(s => s.phase), ["mounted", "after-action", "unmounted"])) throw Error("Public scenario/source identity changed");
    if (mount.text !== "Hi" || !mount.buttonPresent || !mount.sameButton || mount.componentUnmounts !== 0 ||
        mount.effectSetups !== 1 || mount.effectCleanups !== 0 || mount.alerts.length ||
        !isDeepStrictEqual(mount.renderStates, [false])) throw Error("Initial mount/effect did not settle");
    const cleanup = i === 0 ? 1 : 0;
    if (action.text !== "Hi" || !action.buttonPresent || !action.sameButton || action.componentUnmounts !== 0 ||
        action.effectSetups !== 1 + cleanup || action.effectCleanups !== cleanup ||
        !isDeepStrictEqual(action.alerts, Array(cleanup).fill(alert)) ||
        !isDeepStrictEqual(action.renderStates, i === 0 ? [false, true, false] : i === 1 ? [false] : [false, true]))
      throw Error("Original premature cleanup or declared public control not reproduced");
    if (unmount.text !== "" || unmount.buttonPresent || unmount.sameButton || unmount.componentUnmounts !== 1 ||
        unmount.effectSetups !== action.effectSetups || unmount.effectCleanups !== action.effectCleanups + 1 ||
        !isDeepStrictEqual(unmount.alerts, Array(cleanup + 1).fill(alert)) || !isDeepStrictEqual(unmount.renderStates, action.renderStates))
      throw Error("Actual unmount cleanup control failed");
  }
  return o;
}

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditProspective } from "./prospective-v1.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";
import type { OriginalNativeProfile } from "../execution/profiled-native-v1.ts";

export const VUE_WATCH_FREEZE: string =
  "14a0e1e6189fca1e81eb8f1513f2bee8c6aac1734194c9fe87f04dd49a5bced1";
export const VUE_WATCH_TASK = "vuejs__core-11589";
export const VUE_WATCH_COMMIT = "3653bc0f45d6fedf84e29b64ca52584359c383c0";
export const VUE_WATCH_TREE = "c192989d2aa55a643356b0cea11f8ea3ed44f48a";
/** Plain docker.io/library/node:20.9.0-bookworm-slim import; no earlier Vue source inside. */
export const VUE_WATCH_IMAGE = "e9a27985-c3f3-33f0-a138-4d14f9744788";
export const VUE_WATCH_ARCHIVE =
  "eafd5fc8b7a29a955f363e0095c780d46acb7db458628622741dd149e6e4558b";
export const VUE_WATCH_FILES = 694;
export const vueWatchSlots = [
  "prepare",
  "build",
  "protect",
  "integrity",
  "unit-A",
  "reproduction-A",
  "unit-B",
  "reproduction-B",
] as const;
export const vueWatchSaved = ["prepare", "build", "protect"];
const input = "/opt/repolab/prospective-vue";
export const vueWatchUploads = [
  ["repositories/prospective-vue-11589-v1/original.tar.gz", "upstream.tar.gz"],
  [
    "fixtures/prospective-vue-11589-v1/original-manifest.json",
    "manifest.json",
  ],
  ["repositories/prospective-vue-11589-v1/guest.cjs", "guest.cjs"],
  ["repositories/prospective-vue-11589-v1/run-unit.mjs", "run-unit.mjs"],
  [
    "repositories/prospective-vue-11589-v1/reproduction.cjs",
    "reproduction.cjs",
  ],
] as const;
export const vueWatchAssets = [
  "packages/evaluation/prospective-vue-11589-v1.ts",
  "packages/execution/profiled-native-v1.ts",
  "apps/evaluator/prospective-vue-11589-v1.ts",
  "tests/prospective-vue-11589-v1.test.ts",
  "evaluation/PROSPECTIVE_VUE_11739_V2.md",
  ...vueWatchUploads.map((x) => x[0]),
  "repositories/prospective-vue-11589-v1/LICENSE",
  "fixtures/prospective-vue-11589-v1/commit.json",
  "fixtures/prospective-vue-11589-v1/canonical-tree.json",
  "fixtures/vue-native/node20-image.json",
  "evaluation/prospective-v1.json",
  "packages/evaluation/prospective-v1.ts",
  "packages/repositories/onboarding-v1.ts",
  "packages/repositories/repair-lease.ts",
  "packages/execution/recovery-lease-v1.ts",
  "packages/storage/reconciliation.ts",
  "packages/execution/nebius.ts",

];
export const vueTemporaryDirectories = [
  "/tmp/repolab-vue-home", "/tmp/repolab-vue-home/config", "/tmp/repolab-vue-home/cache",
  "/tmp/repolab-vue-npm-cache", "/tmp/repolab-vue-out",
];
export const vueBuiltPackages = [
  "shared",
  "reactivity",
  "runtime-core",
  "runtime-dom",
  "compiler-core",
  "compiler-dom",
  "compiler-ssr",
  "compiler-sfc",
  "server-renderer",
  "vue",
];
/** Development CommonJS artifacts built for native tests and the watcher probe. */
export const vueProbeDist = [
  ...vueBuiltPackages.map((p) => `packages/${p}/dist/${p}.cjs.js`),
].sort();
export const vueWatchHash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function vueWatchBytes(path: string) {
  const b = readFileSync(path);
  return path === vueWatchAssets[0]
    ? Buffer.from(
        b.toString().replace(VUE_WATCH_FREEZE, "__VUE_WATCH_FREEZE__"),
      )
    : b;
}
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
/** Vitest 2 default include, unit-config exclusions; derived from original paths only. */
export function vueExpectedTestFiles(paths: string[]) {
  return paths
    .filter(
      (p) =>
        /(^|\/)[^/]*\.(test|spec)\.(c|m)?[jt]sx?$/.test(p) &&
        !/(^|\/)(node_modules|dist|cypress|e2e)\//.test(p) &&
        !/(^|\/)\.(idea|git|cache|output|temp)\//.test(p),
    )
    .sort();
}
export function verifyVueWatchSource(reader = vueWatchBytes) {
  const manifest = JSON.parse(reader(vueWatchUploads[1][0]).toString());
  const commit = JSON.parse(
    reader("fixtures/prospective-vue-11589-v1/commit.json").toString(),
  );
  const tree = JSON.parse(
    reader("fixtures/prospective-vue-11589-v1/canonical-tree.json").toString(),
  );
  if (
    manifest.taskId !== VUE_WATCH_TASK ||
    manifest.repository !== "vuejs/core" ||
    manifest.baseCommit !== VUE_WATCH_COMMIT ||
    manifest.archiveRoot !== "core-" + VUE_WATCH_COMMIT ||
    manifest.archiveSha256 !== VUE_WATCH_ARCHIVE ||
    manifest.archiveBytes !== 1469298 ||
    manifest.files.length !== VUE_WATCH_FILES ||
    commit.sha !== VUE_WATCH_COMMIT ||
    commit.tree.sha !== VUE_WATCH_TREE ||
    tree.sha !== VUE_WATCH_TREE ||
    manifest.gitTreeSha1 !== VUE_WATCH_TREE ||
    tree.truncated !== false
  )
    throw Error("Pinned Vue source identity changed");
  const blobs = tree.tree
    .filter((x: any) => x.type === "blob")
    .sort((a: any, b: any) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    tree.tree.some((x: any) => !["blob", "tree"].includes(x.type)) ||
    blobs.some((x: any) => x.mode !== "100644") ||
    !isDeepStrictEqual(
      blobs.map((x: any) => ({
        path: x.path,
        bytes: x.size,
        gitBlobSha1: x.sha,
        gitMode: x.mode,
      })),
      manifest.files.map(({ sha256, ...f }: any) => f),
    )
  )
    throw Error("Manifest differs from canonical Git blobs");
  const files = readPinnedRepositoryArchive(reader(vueWatchUploads[0][0]), {
    repository: "vuejs/core",
    commit: VUE_WATCH_COMMIT,
    archiveRoot: manifest.archiveRoot,
    archiveSha256: VUE_WATCH_ARCHIVE,
    files: manifest.files,
  });
  const pkg = JSON.parse(files.get("package.json")!.toString());
  if (
    pkg.version !== "3.5.0-beta.1" ||
    pkg.packageManager !== "pnpm@9.7.0" ||
    pkg.type !== "module" ||
    pkg.scripts.build !== "node scripts/build.js" ||
    pkg.scripts["test-unit"] !== "vitest -c vitest.unit.config.ts" ||
    pkg.scripts.preinstall !== "npx only-allow pnpm" ||
    pkg.scripts.postinstall !== "simple-git-hooks" ||
    pkg.devDependencies.vitest !== "^2.0.5" ||
    pkg.devDependencies.jsdom !== "^24.1.1" ||
    files.get(".node-version")!.toString().trim() !== "20" ||
    files.has("vitest.workspace.ts")
  )
    throw Error("Native script review changed");
  const sha = (p: string) => manifest.files.find((f: any) => f.path === p).sha256;
  const tests = vueExpectedTestFiles(manifest.files.map((f: any) => f.path));
  if (tests.length !== 179) throw Error("Native unit file inventory changed");
  return {
    files: files.size,
    archiveBytes: manifest.archiveBytes,
    archiveSha256: VUE_WATCH_ARCHIVE,
    gitTreeSha1: tree.sha,
    version: pkg.version,
    packageManager: pkg.packageManager,
    lockSha256: sha("pnpm-lock.yaml"),
    vitestConfigSha256: sha("vitest.config.ts"),
    vitestUnitConfigSha256: sha("vitest.unit.config.ts"),
    unitTestFiles: tests.length,
  };
}
export function auditVueWatch(reader = vueWatchBytes) {
  if (VUE_WATCH_FREEZE === "__UNFROZEN__")
    throw Error("Vue watch qualification not frozen");
  const p = readJson("evaluation/prospective-vue-11589-v1.json");
  const { digest, ...payload } = p;
  if (
    digest !== VUE_WATCH_FREEZE ||
    vueWatchHash(JSON.stringify(payload)) !== digest ||
    p.taskId !== VUE_WATCH_TASK ||
    p.commit !== VUE_WATCH_COMMIT ||
    p.image !== VUE_WATCH_IMAGE ||
    p.inferenceCalls !== 0 ||
    p.modelAdmission !== false ||
    p.maxOperations !== vueWatchSlots.length ||
    p.priorOperations !== 0 || p.taskOriginalCeiling !== 12 ||
    !isDeepStrictEqual(p.slots, vueWatchSlots) ||
    p.assets.length !== vueWatchAssets.length ||
    p.assets.some(
      (a: any, i: number) =>
        a.path !== vueWatchAssets[i] || a.sha256 !== vueWatchHash(reader(a.path)),
    )
  )
    throw Error("Vue watch qualification freeze changed");
  const parent = auditProspective();
  if (
    p.prospectiveFreeze !== parent.manifest.digest ||
    parent.tasks.find((t) => t.instance_id === VUE_WATCH_TASK)?.base_commit !==
      VUE_WATCH_COMMIT
  )
    throw Error("Prospective task binding changed");
  const image = JSON.parse(reader("fixtures/vue-native/node20-image.json").toString());
  if (
    image.sandboxImageUuid !== VUE_WATCH_IMAGE ||
    image.tag !== "docker.io/library/node:20.9.0-bookworm-slim" ||
    image.runtimeRequired !== "v20.9.0"
  )
    throw Error("Runtime image binding changed");
  verifyVueWatchSource(reader);
  return p;
}
export function checkTemporaryAccess(value: unknown) {
  const entries = z.array(z.object({path:z.string(),uid:z.literal(1000),gid:z.literal(1000),mode:z.literal("700"),writable:z.literal(true)}).strict()).parse(value);
  if (!isDeepStrictEqual(entries.map(e=>e.path), vueTemporaryDirectories))
    throw Error("Temporary-directory access inventory changed");
  return entries;
}
export function checkPermissionTransition(value: unknown) {
  const v = z.object({
    before:z.object({uid:z.literal(1000),gid:z.literal(1000),error:z.literal("EACCES"),writes:z.array(z.string()).length(0)}).strict(),
    after:z.object({uid:z.literal(1000),gid:z.literal(1000),error:z.null(),writes:z.array(z.string())}).strict(),
  }).strict().parse(value);
  if (!isDeepStrictEqual(v.after.writes, vueTemporaryDirectories))
    throw Error("UID1000 permission correction not exercised completely");
  return v;
}
export function vueWatchEnvironment() {
  return {
    PATH: "/opt/repolab/vue/node_modules/.bin:/usr/local/bin:/usr/bin:/bin",
    SHELL: "/bin/sh",
    TERM: "xterm",
    LANG: "C.UTF-8",
    TZ: "UTC",
    CI: "true",
    HOME: "/tmp/repolab-vue-home",
    XDG_CONFIG_HOME: "/tmp/repolab-vue-home/config",
    XDG_CACHE_HOME: "/tmp/repolab-vue-home/cache",
    NPM_CONFIG_CACHE: "/tmp/repolab-vue-npm-cache",
    NPM_CONFIG_USERCONFIG: input + "/empty-user.conf",
    NPM_CONFIG_GLOBALCONFIG: input + "/empty-global.conf",
  };
}
export function vueWatchRequest(
  slot: string,
  image: string,
  files: Record<string, unknown> = {},
) {
  z.enum(vueWatchSlots).parse(slot);
  z.uuid().parse(image);
  if (slot === "prepare" && image !== VUE_WATCH_IMAGE)
    throw Error("Plain Node 20.9.0 runtime image required");
  if (slot !== "prepare" && Object.keys(files).length)
    throw Error("No later input replacement");
  const saved = vueWatchSaved.includes(slot);
  return {
    command: "/usr/local/bin/node",
    args: [input + "/guest.cjs", slot.replace(/-[AB]$/, "")],
    image,
    shell: false,
    preserve_env: false,
    env: vueWatchEnvironment(),
    cwd: "/opt/repolab",
    uid: saved ? 0 : 1000,
    gid: saved ? 0 : 1000,
    networking: { enabled: slot === "prepare" },
    timeout: 600,
    truncate_output_at: 4194304,
    disposable: !saved,
    resources_limits: { max_layer_bytes: 1073741824 },
    files,
  };
}
export function vueWatchCommands(slot: string): [string, string[]][] {
  const stage = slot.replace(/-[AB]$/, "");
  const node = "/usr/local/bin/node",
    pnpm = "/opt/repolab/pnpm-cli/node_modules/pnpm/bin/pnpm.cjs",
    store = "/opt/repolab/pnpm-store";
  if (stage === "prepare")
    return [
      [
        "/bin/tar",
        [
          "-xzf",
          input + "/upstream.tar.gz",
          "--strip-components=1",
          "-C",
          "/opt/repolab/vue",
        ],
      ],
      [
        "/usr/local/bin/npm",
        [
          "install",
          "--prefix",
          "/opt/repolab/pnpm-cli",
          "pnpm@9.7.0",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
      ],
      [node, [pnpm, "--version"]],
      [
        node,
        [pnpm, "install", "--frozen-lockfile", "--ignore-scripts", "--store-dir", store],
      ],
      [node, [pnpm, "rebuild", "esbuild", "--store-dir", store]],
    ];
  if (stage === "build")
    return [
      [
        node,
        [
          "scripts/build.js",
          ...vueBuiltPackages.map((p) => "^" + p + "$"),
          "--formats",
          "cjs",
        ],
      ],

    ];
  if (stage === "unit") return [[node, [input + "/run-unit.mjs"]]];
  if (stage === "reproduction") return [[node, [input + "/reproduction.cjs"]]];
  return [];
}
const DistEntry = z
  .object({
    path: z.string().regex(/^packages\/[a-z-]+\/dist\/[A-Za-z0-9_.-]+$/),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function vueWatchDist(value: unknown) {
  const dist = z.array(DistEntry).min(vueProbeDist.length).parse(value);
  const paths = dist.map((d) => d.path);
  if (
    new Set(paths).size !== paths.length ||
    vueProbeDist.some((p) => !paths.includes(p)) ||
    paths.some((p) => !vueBuiltPackages.includes(p.split("/")[1]))
  )
    throw Error("Built Vue package identity incomplete");
  return dist;
}
const Assertion = z
  .object({
    ancestorTitles: z.array(z.string()),
    title: z.string(),
    status: z.enum(["passed", "skipped", "pending", "todo"]),
    failureMessages: z.array(z.string()).length(0),
  })
  .passthrough();
const UnitReport = z
  .object({
    success: z.literal(true),
    numTotalTests: z.number().int().positive(),
    numPassedTests: z.number().int(),
    numFailedTests: z.literal(0),
    numPendingTests: z.number().int().nonnegative(),
    numTodoTests: z.number().int().nonnegative(),
    numFailedTestSuites: z.literal(0),
    snapshot: z
      .object({
        added: z.literal(0),
        unmatched: z.literal(0),
        updated: z.literal(0),
        filesAdded: z.literal(0),
        filesUpdated: z.literal(0),
      })
      .passthrough(),
    testResults: z.array(
      z
        .object({
          name: z.string(),
          status: z.literal("passed"),
          assertionResults: z.array(Assertion),
        })
        .passthrough(),
    ),
  })
  .passthrough();
/** Raw reporter bytes are authoritative; guest summaries are never trusted. No upstream code runs here. */
export function vueWatchUnit(raw: unknown, expectedFiles: string[]) {
  const packed = z
    .object({
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      gzipBase64: z.string().max(4194304),
    })
    .strict()
    .parse(raw);
  const bytes = gunzipSync(Buffer.from(packed.gzipBase64, "base64"), {
    maxOutputLength: 64 * 1024 * 1024,
  });
  if (bytes.length !== packed.bytes || vueWatchHash(bytes) !== packed.sha256)
    throw Error("Raw unit report identity changed");
  const r = UnitReport.parse(JSON.parse(bytes.toString("utf8")));
  const prefix = "/opt/repolab/vue/";
  const cases: { id: string; status: string }[] = [];
  const names: string[] = [];
  for (const f of r.testResults) {
    if (!f.name.startsWith(prefix)) throw Error("Reporter path outside original tree");
    const rel = f.name.slice(prefix.length);
    if (names.includes(rel)) throw Error("Duplicate test file");
    names.push(rel);
    const seen = new Map<string, number>();
    for (const a of f.assertionResults) {
      const key = rel + ":" + [...a.ancestorTitles.filter(Boolean), a.title].join(" > "),
        n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      cases.push({ id: key + "#" + n, status: a.status });
    }
  }
  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!isDeepStrictEqual([...names].sort(), expectedFiles))
    throw Error("Complete original unit file inventory not executed");
  const passed = cases.filter((c) => c.status === "passed").length;
  if (cases.length !== r.numTotalTests || passed === 0)
    throw Error("Unit counters differ from case partition");
  return {
    files: names.length,
    total: cases.length,
    passed,
    skipped: cases.length - passed,
    caseDigest: vueWatchHash(JSON.stringify(cases)),
    reporterCounters: {
      total: r.numTotalTests,
      passed: r.numPassedTests,
      pending: r.numPendingTests,
      todo: r.numTodoTests,
    },
    cases,
  };
}
const WatchEvent = z.object({ watcher: z.number().int().min(0).max(4), value: z.number(), previous: z.number() }).strict();
const WatchRow = z.object({
  name: z.enum(["ref-sync", "computed-sync", "ref-default", "computed-default"]),
  before: z.array(WatchEvent), immediate: z.array(WatchEvent), afterTick: z.array(WatchEvent), afterStop: z.array(WatchEvent),
}).strict();
/** Reporter-requested FIFO is an expectation with an explicitly unresolved API guarantee. */
export function vueWatchObservations(value: unknown, dist: {path:string;bytes:number;sha256:string}[]) {
  const o = z.object({
    version: z.literal("3.5.0-beta.1"), nodeEnv: z.null(),
    loaded: z.array(DistEntry), messages: z.array(z.string()).length(0),
    observations: z.array(WatchRow).length(4),
  }).strict().parse(value);
  const names = ["ref-sync", "computed-sync", "ref-default", "computed-default"];
  if (!isDeepStrictEqual(o.observations.map(x=>x.name), names)) throw Error("Watcher scenario inventory changed");
  const required = ["vue","runtime-dom","runtime-core","reactivity","shared"].map(p=>`packages/${p}/dist/${p}.cjs.js`);
  if (new Set(o.loaded.map(x=>x.path)).size !== o.loaded.length || required.some(p=>!o.loaded.some(l=>l.path===p)) ||
      o.loaded.some(l=>!isDeepStrictEqual(dist.find(d=>d.path===l.path),l) || l.path.endsWith(".prod.js")))
    throw Error("Watcher probe did not load bound development artifacts");
  const fifo = [0,1,2,3,4];
  for (const row of o.observations) {
    const events = row.afterTick;
    if (row.before.length || events.length !== 5 ||
        !isDeepStrictEqual(events.map(e=>e.watcher).sort((a,b)=>a-b),fifo) ||
        events.some(e=>e.value!==1 || e.previous!==0) || !isDeepStrictEqual(row.afterStop,events))
      throw Error("Watcher value/cardinality/stop controls failed");
    if (row.name.endsWith("-sync")) {
      if (!isDeepStrictEqual(row.immediate,events)) throw Error("Sync watchers did not execute synchronously");
    } else if (row.immediate.length || !isDeepStrictEqual(events.map(e=>e.watcher),fifo))
      throw Error("Default queued-watcher control failed");
  }
  if (isDeepStrictEqual(o.observations[1].afterTick.map(e=>e.watcher),fifo))
    throw Error("Reported computed-sync ordering difference not reproduced");
  return o;
}
export function parseVueWatchReceipt(
  raw: unknown,
  slot: string,
  id: string,
  image: string,
) {
  z.enum(vueWatchSlots).parse(slot);
  z.uuid().parse(id);
  const stream = z.object({
    value: z.string(),
    encoding: z.enum(["base64", "ascii", "utf8", "utf-8", "plain"]),
    truncated: z.literal(false),
  });
  const op = z
    .object({
      uuid: z.literal(id),
      image_uuid: z.literal(image),
      status: z.literal("SUCCESS"),
      result_image_uuid: z.uuid().nullish(),
      metadata: z.object({
        result: z.object({
          state: z.object({
            exit_code: z.literal(0),
            timed_out: z.literal(false),
            signal: z.union([z.null(), z.literal(0), z.literal(-1)]),
          }),
          stdout: stream,
          stderr: stream,
        }),
      }),
    })
    .passthrough()
    .parse(raw);
  const decode = (s: any) => {
    const b = Buffer.from(s.value, s.encoding === "base64" ? "base64" : "utf8");
    if (b.length > 4194304) throw Error("Oversized native output");
    return b.toString();
  };
  const guest = JSON.parse(decode(op.metadata.result.stdout));
  decode(op.metadata.result.stderr);
  const req = vueWatchRequest(slot, image);
  const stage = slot.replace(/-[AB]$/, "");
  if (
    guest.stage !== stage ||
    guest.runtimeVersion !== "v20.9.0" ||
    guest.uid !== req.uid ||
    guest.gid !== req.gid ||
    guest.completed !== true ||
    guest.originalInputs !== true ||
    guest.sourceArchiveHash !== VUE_WATCH_ARCHIVE ||
    !isDeepStrictEqual(guest.envKeys, Object.keys(req.env).sort())
  )
    throw Error("Vue native environment or original bytes changed");
  if (vueWatchSaved.includes(slot) && !op.result_image_uuid)
    throw Error("Missing saved native image");
  if (
    !Array.isArray(guest.commands) ||
    !isDeepStrictEqual(
      guest.commands.map((c: any) => [c.executable, c.args]),
      vueWatchCommands(slot),
    ) ||
    guest.commands.some(
      (c: any) =>
        c.exitCode !== 0 ||
        c.errorCode !== null ||
        c.signal !== null ||
        typeof c.stdout !== "string" ||
        typeof c.stderr !== "string" ||
        c.stdoutTruncated !== false ||
        c.stderrTruncated !== false,
    )
  )
    throw Error("Native command recipe or child outcome changed");
  if (stage === "prepare") {
    if (guest.pnpmVersion !== "9.7.0" || typeof guest.gitPreexisting !== "boolean")
      throw Error("Package manager identity changed");
    return { op, guest };
  }
  const dist = vueWatchDist(guest.dist);
  if (stage === "build") {
    if (
      !isDeepStrictEqual(guest.buildChangedOriginalPaths, []) ||
      !isDeepStrictEqual(guest.otherDist, [])
    )
      throw Error("Build changed original source or unexpected packages");
    return { op, guest };
  }
  if (!/^[a-f0-9]{64}$/.test(guest.configSha256))
    throw Error("Missing protected native config");
  if (stage === "protect") {
    checkPermissionTransition(guest.permissionTransition);
    checkTemporaryAccess(guest.temporaryDirectories);
    if (
      !isDeepStrictEqual(guest.configDependencies, [
        "scripts/aliases.js",
        "vitest.config.ts",
        "vitest.unit.config.ts",
      ])
    )
      throw Error("Native config dependencies changed");
    return { op, guest };
  }
  if (guest.rootMode !== "555") throw Error("Repository root protection changed");
  checkTemporaryAccess(guest.temporaryDirectories);
  if (stage === "integrity") {
    const probes = [
      ...[
        "pnpm-lock.yaml",
        "packages/reactivity/src/dep.ts",
        "packages/runtime-core/__tests__/apiWatch.spec.ts",
        "packages/runtime-core/dist/runtime-core.cjs.js",
      ].flatMap((path) =>
        ["write", "unlink", "replace"].map((action) => ({ path, action })),
      ),
      { action: "rename-tests" },
      { action: "symlink-test" },
      { action: "write-config" },
      { action: "write-probe" },
    ];
    const roots = [
      "package.json",
      "vitest.config.ts",
      "vitest.unit.config.ts",
      "vitest.workspace.ts",
      "vitest.workspace.js",
      "vite.config.js",
      "repolab-attack.mjs",
      "node_modules-shadow",
    ];
    if (
      !Array.isArray(guest.denials) ||
      !isDeepStrictEqual(
        guest.denials.map(({ error, ...d }: any) => d),
        probes,
      ) ||
      guest.denials.some((d: any) => !["EACCES", "EPERM", "EROFS"].includes(d.error)) ||
      !Array.isArray(guest.rootDenials) ||
      !isDeepStrictEqual(
        guest.rootDenials.map((d: any) => d.path),
        roots,
      ) ||
      guest.rootDenials.some(
        (d: any) => !["EACCES", "EPERM", "EROFS", "EEXIST"].includes(d.error),
      ) ||
      !["ENETUNREACH", "EHOSTUNREACH", "TIMEOUT", "EACCES", "EPERM"].includes(
        guest.network,
      )
    )
      throw Error("Original containment controls failed");
  }
  if (stage === "unit") {
    const manifest = readJson(vueWatchUploads[1][0]);
    vueWatchUnit(
      guest.unitRaw,
      vueExpectedTestFiles(manifest.files.map((f: any) => f.path)),
    );
  }
  if (stage === "reproduction") {
    if (!isDeepStrictEqual(JSON.parse(guest.commands[0].stdout), guest.observations))
      throw Error("Public observations differ from raw probe output");
    vueWatchObservations(guest.observations, dist);
  }
  return { op, guest };
}
export const vueWatchProfile: OriginalNativeProfile = {
  id: "prospective-vue-11589-v1",
  image: VUE_WATCH_IMAGE,
  inputDirectory: input,
  slots: vueWatchSlots,
  savedSlots: vueWatchSaved,
  uploads: vueWatchUploads,
  audit: auditVueWatch,
  request: vueWatchRequest,
  parse: parseVueWatchReceipt,
};

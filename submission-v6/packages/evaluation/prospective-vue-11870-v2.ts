import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditProspective } from "./prospective-v1.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";
import type { RetryingOriginalNativeProfile } from "../execution/profiled-native-v3.ts";
import {auditListPreparation,verifyListSource,LIST_FREEZE,listAssets,checkListObservations} from "./prospective-vue-11870-v1.ts";
import {auditSandboxStatusRetryQualification,STATUS_RETRY_FREEZE} from "./sandbox-status-retry-v1.ts";
import {TRANSPORT_FREEZE} from "./sandbox-transport-v1.ts";

export const VUE_LIST_FREEZE: string =
  "f40e66854430679a91552be7e1e3dc3a610e70e8cdffd3599e46aec2d53fbfaf";
export const VUE_LIST_TASK = "vuejs__core-11870";
export const VUE_LIST_COMMIT = "67d6596d40b1807b9cd8eb0d9282932ea77be3c0";
export const VUE_LIST_TREE = "1fdc2d89d23426bcd00db4b3ed24225b98a122cd";
/** Plain docker.io/library/node:20.9.0-bookworm-slim import; no earlier Vue source inside. */
export const VUE_LIST_IMAGE = "e9a27985-c3f3-33f0-a138-4d14f9744788";
export const VUE_LIST_ARCHIVE =
  "a0cc98ea4ac0db588169a339c4ed4604d6879e0611d1c06851653067b15e9d5b";
export const VUE_LIST_FILES = 697;
export const vueListSlots = [
  "prepare",
  "build",
  "protect",
  "integrity",
  "unit-A",
  "reproduction-A",
  "unit-B",
  "reproduction-B",
] as const;
export const vueListSaved = ["prepare", "build", "protect"];
const input = "/opt/repolab/prospective-vue-11870";
export const vueListUploads = [
 ["repositories/prospective-vue-11870-v1/original.tar.gz","upstream.tar.gz"],
 ["fixtures/prospective-vue-11870-v1/original-manifest.json","manifest.json"],
 ["repositories/prospective-vue-11870-v1/guest-v2.cjs","guest.cjs"],
 ["repositories/prospective-vue-11870-v1/run-unit-v2.mjs","run-unit.mjs"],
 ["repositories/prospective-vue-11870-v1/reproduction.cjs","reproduction.cjs"],
 ["repositories/prospective-vue-11870-v1/reported.vue","reported.vue"],
 ["repositories/prospective-vue-11870-v1/control-raw.vue","control-raw.vue"],
 ["repositories/prospective-vue-11870-v1/control-deep.vue","control-deep.vue"],
] as const;
export const vueListAssets = [...new Set([
 "packages/evaluation/prospective-vue-11870-v2.ts","apps/evaluator/prospective-vue-11870-v2.ts","tests/prospective-vue-11870-v2.test.ts",
 "evaluation/PROSPECTIVE_VUE_11870_V2.md",...vueListUploads.map(x=>x[0]),...listAssets,
 "evaluation/prospective-vue-11870-v1.json","fixtures/vue-native/node20-image.json",
 "packages/execution/profiled-native-v3.ts","packages/execution/sandbox-status-retry-v1.ts","packages/evaluation/sandbox-status-retry-v1.ts",
 "evaluation/sandbox-status-retry-v1.json","evaluation/sandbox-transport-v1.json",
 ".repolab/prospective-vue-11870-v2/qualification/historical-code.json",
 ".repolab/prospective-vue-11870-v2/qualification/execution-state.json",
 ".repolab/prospective-preact-3763-v3/qualification/stopped-audit-1.json",
 ".repolab/prospective-preact-3763-v3/run/mocha-B.json",
 ".repolab/prospective-preact-3763-v3/run/recovery-80731e27-6e6e-4984-b455-6de8c498dec2-4085eff2-ad6b-4b70-b986-516b8b09c94e.json",
])];
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
/** Development CommonJS artifacts built for native tests and the shallow-list probe. */
export const vueProbeDist = [
  ...vueBuiltPackages.map((p) => `packages/${p}/dist/${p}.cjs.js`),
  "packages/vue/dist/vue.runtime.global.js",
].sort();
export const vueListHash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function vueListBytes(path: string) {
  const b = readFileSync(path);
  return path === vueListAssets[0]
    ? Buffer.from(
        b.toString().replace(VUE_LIST_FREEZE, "__VUE_LIST_FREEZE__"),
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
export function verifyVueListSource(reader = vueListBytes) { return verifyListSource(reader); }
export function auditPriorExecutionState() {
 const dir=".repolab/prospective-preact-3763-v3/",summary=readJson(dir+"qualification/stopped-audit-1.json"),raw=readJson(dir+"run/mocha-B.json");
 const recovery=readJson(dir+"run/recovery-80731e27-6e6e-4984-b455-6de8c498dec2-4085eff2-ad6b-4b70-b986-516b8b09c94e.json");
 if(summary.status!=="STOPPED_UNQUALIFIED_READ_ONLY_RESOLVED" || summary.workflowResumable!==false || summary.unknownSubmissions!==0 ||
    raw.state!=="UNKNOWN" || recovery.verified!==false || recovery.state!=="TERMINAL" || recovery.raw.status!=="SUCCESS" ||
    recovery.raw.uuid!==raw.id || recovery.raw.image_uuid!==raw.request.image || !isDeepStrictEqual(recovery.owner,raw.owner) ||
    recovery.originalHash!==vueListHash(readFileSync(dir+"run/mocha-B.json")))throw Error("Prior execution resolution changed");
 return {unknownSubmissions:0,preactResumable:false};
}
export function auditVueList(reader = vueListBytes) {
  if (VUE_LIST_FREEZE === "__UNFROZEN__")
    throw Error("Vue shallow-list qualification not frozen");
  const p = readJson("evaluation/prospective-vue-11870-v2.json");
  const { digest, ...payload } = p;
  if (
    digest !== VUE_LIST_FREEZE ||
    vueListHash(JSON.stringify(payload)) !== digest ||
    p.taskId !== VUE_LIST_TASK ||
    p.commit !== VUE_LIST_COMMIT ||
    p.image !== VUE_LIST_IMAGE ||
    p.inferenceCalls !== 0 ||
    p.modelAdmission !== false || p.candidateAdmission!==false || p.executionAdmission!==true ||
    p.preparationFreeze!==LIST_FREEZE || p.transportFreeze!==TRANSPORT_FREEZE || p.statusRetryFreeze!==STATUS_RETRY_FREEZE || p.transportClient!=="profiled-native-v3" ||
    p.maxOperations !== vueListSlots.length ||
    p.priorOperations !== 0 || p.taskOriginalCeiling !== 12 ||
    !isDeepStrictEqual(p.slots, vueListSlots) ||
    p.assets.length !== vueListAssets.length ||
    p.assets.some(
      (a: any, i: number) =>
        a.path !== vueListAssets[i] || a.sha256 !== vueListHash(reader(a.path)),
    )
  )
    throw Error("Vue shallow-list qualification freeze changed");
  const parent = auditProspective();
  if (
    p.prospectiveFreeze !== parent.manifest.digest ||
    parent.tasks.find((t) => t.instance_id === VUE_LIST_TASK)?.base_commit !==
      VUE_LIST_COMMIT
  )
    throw Error("Prospective task binding changed");
  const image = JSON.parse(reader("fixtures/vue-native/node20-image.json").toString());
  if (
    image.sandboxImageUuid !== VUE_LIST_IMAGE ||
    image.tag !== "docker.io/library/node:20.9.0-bookworm-slim" ||
    image.runtimeRequired !== "v20.9.0"
  )
    throw Error("Runtime image binding changed");
  auditListPreparation();
  auditSandboxStatusRetryQualification();
  auditPriorExecutionState();
  verifyVueListSource(reader);
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
export function vueListEnvironment() {
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
export function vueListRequest(
  slot: string,
  image: string,
  files: Record<string, unknown> = {},
) {
  z.enum(vueListSlots).parse(slot);
  z.uuid().parse(image);
  if (slot === "prepare" && image !== VUE_LIST_IMAGE)
    throw Error("Plain Node 20.9.0 runtime image required");
  if (slot !== "prepare" && Object.keys(files).length)
    throw Error("No later input replacement");
  const saved = vueListSaved.includes(slot);
  return {
    command: "/usr/local/bin/node",
    args: [input + "/guest.cjs", slot.replace(/-[AB]$/, "")],
    image,
    shell: false,
    preserve_env: false,
    env: vueListEnvironment(),
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
export function vueListCommands(slot: string): [string, string[]][] {
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
          "pnpm@9.10.0",
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
      [node,["scripts/build.js","^vue$","--formats","global-runtime"]],
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
export function vueListDist(value: unknown) {
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
export function vueListUnit(raw: unknown, expectedFiles: string[]) {
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
  if (bytes.length !== packed.bytes || vueListHash(bytes) !== packed.sha256)
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
    caseDigest: vueListHash(JSON.stringify(cases)),
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
export function vueListObservations(value:unknown,dist:{path:string;bytes:number;sha256:string}[]) {return checkListObservations(value,dist);}
export const VUE_LIST_WORKSPACE_HASH=vueListHash("export default [];\n");
export function checkUnitRuntimeBinding(value:unknown) {
 return z.object({vitestVersion:z.literal("2.0.5"),workspaceFile:z.literal("/opt/repolab/prospective-vue-11870-config/empty-workspace.mjs"),
  workspaceSha256:z.literal(VUE_LIST_WORKSPACE_HASH),projects:z.tuple([z.object({root:z.literal("/opt/repolab/vue"),configFile:z.literal(false),
   globals:z.literal(true),pool:z.literal("threads"),setupFiles:z.tuple([z.literal("scripts/setup-vitest.ts")]),excludeE2e:z.literal(true),
   vueAlias:z.literal("packages/vue/src/index.ts")}).strict()])}).strict().parse(value);
}
export function parseVueListReceipt(
  raw: unknown,
  slot: string,
  id: string,
  image: string,
) {
  z.enum(vueListSlots).parse(slot);
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
  const req = vueListRequest(slot, image);
  const stage = slot.replace(/-[AB]$/, "");
  if (
    guest.stage !== stage ||
    guest.runtimeVersion !== "v20.9.0" ||
    guest.uid !== req.uid ||
    guest.gid !== req.gid ||
    guest.completed !== true ||
    guest.originalInputs !== true ||
    guest.sourceArchiveHash !== VUE_LIST_ARCHIVE ||
    !isDeepStrictEqual(guest.envKeys, Object.keys(req.env).sort())
  )
    throw Error("Vue native environment or original bytes changed");
  if (vueListSaved.includes(slot) && !op.result_image_uuid)
    throw Error("Missing saved native image");
  if (
    !Array.isArray(guest.commands) ||
    !isDeepStrictEqual(
      guest.commands.map((c: any) => [c.executable, c.args]),
      vueListCommands(slot),
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
    if (guest.pnpmVersion !== "9.10.0" || typeof guest.gitPreexisting !== "boolean")
      throw Error("Package manager identity changed");
    return { op, guest };
  }
  const dist = vueListDist(guest.dist);
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
  if(guest.workspaceSha256!==VUE_LIST_WORKSPACE_HASH)throw Error("Protected empty workspace identity changed");
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
      { action: "write-workspace" },
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
    checkUnitRuntimeBinding(guest.unitRuntimeBinding);
    const manifest = readJson(vueListUploads[1][0]);
    vueListUnit(
      guest.unitRaw,
      vueExpectedTestFiles(manifest.files.map((f: any) => f.path)),
    );
  }
  if (stage === "reproduction") {
    const lines=guest.commands[0].stdout.trimEnd().split("\n"),observed=JSON.parse(lines.pop()!);
    const info=Array.from({length:3},()=>["You are running a development build of Vue.","Make sure to use the production build (*.prod.js) when deploying for production."]).flat();
    if (!isDeepStrictEqual(observed, guest.observations) || !isDeepStrictEqual(lines,guest.probeInformationLines) ||
        !(lines.length===0 || isDeepStrictEqual(lines,info))) throw Error("Public observations or informational output differ from raw probe output");
    vueListObservations(guest.observations, dist);
  }
  return { op, guest };
}
export const vueListProfile: RetryingOriginalNativeProfile = {
  id: "prospective-vue-11870-v2",
  transportFreeze:TRANSPORT_FREEZE,statusRetryFreeze:STATUS_RETRY_FREEZE,executionFreeze:VUE_LIST_FREEZE,
  image: VUE_LIST_IMAGE,
  inputDirectory: input,
  slots: vueListSlots,
  savedSlots: vueListSaved,
  uploads: vueListUploads,
  audit: auditVueList,
  request: vueListRequest,
  parse: parseVueListReceipt,
};

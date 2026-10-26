import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditProspective } from "./prospective-v1.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";
import type { OriginalNativeProfile } from "../execution/profiled-native-v1.ts";

export const VUE_FOCUS_FREEZE: string =
  "e89d60e359ab987362c2cda0cb3f4e52738498fabcf6e930d0f4321eb980477e";
export const VUE_FOCUS_TASK = "vuejs__core-11739";
export const VUE_FOCUS_COMMIT = "cb843e0be31f9e563ccfc30eca0c06f2a224b505";
export const VUE_FOCUS_TREE = "d5445cfcb12b754f3d24171a3e14ab66ad7f7712";
/** Plain docker.io/library/node:20.9.0-bookworm-slim import; no earlier Vue source inside. */
export const VUE_FOCUS_IMAGE = "e9a27985-c3f3-33f0-a138-4d14f9744788";
export const VUE_FOCUS_ARCHIVE =
  "9bf326c2372070f53f3b9d3fde0cb18bf28649535915d04191123f8bf2eabfc9";
export const VUE_FOCUS_FILES = 697;
export const vueFocusSlots = [
  "prepare",
  "build",
  "protect",
  "integrity",
  "unit-A",
  "reproduction-A",
  "unit-B",
  "reproduction-B",
] as const;
export const vueFocusSaved = ["prepare", "build", "protect"];
const input = "/opt/repolab/prospective-vue";
export const vueFocusUploads = [
  ["repositories/prospective-vue-11739-v1/original.tar.gz", "upstream.tar.gz"],
  [
    "fixtures/prospective-vue-11739-v1/original-manifest.json",
    "manifest.json",
  ],
  ["repositories/prospective-vue-11739-v1/guest.cjs", "guest.cjs"],
  ["repositories/prospective-vue-11739-v1/run-unit.mjs", "run-unit.mjs"],
  [
    "repositories/prospective-vue-11739-v1/reproduction.cjs",
    "reproduction.cjs",
  ],
] as const;
export const vueFocusAssets = [
  "packages/evaluation/prospective-vue-11739-v1.ts",
  "packages/execution/profiled-native-v1.ts",
  "apps/evaluator/prospective-vue-11739-v1.ts",
  "tests/prospective-vue-11739-v1.test.ts",
  "evaluation/PROSPECTIVE_VUE_11739_V1.md",
  ...vueFocusUploads.map((x) => x[0]),
  "repositories/prospective-vue-11739-v1/LICENSE",
  "fixtures/prospective-vue-11739-v1/commit.json",
  "fixtures/prospective-vue-11739-v1/canonical-tree.json",
  "fixtures/vue-native/node20-image.json",
  "evaluation/prospective-v1.json",
  "packages/evaluation/prospective-v1.ts",
  "packages/repositories/onboarding-v1.ts",
  "packages/repositories/repair-lease.ts",
  "packages/execution/recovery-lease-v1.ts",
  "packages/storage/reconciliation.ts",
  "packages/execution/nebius.ts",
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
/** Development builds the probe must load: Node SSR CommonJS plus the browser client runtime. */
export const vueProbeDist = [
  ...vueBuiltPackages.map((p) => `packages/${p}/dist/${p}.cjs.js`),
  "packages/vue/dist/vue.runtime.global.js",
].sort();
export const vueFocusHash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function vueFocusBytes(path: string) {
  const b = readFileSync(path);
  return path === vueFocusAssets[0]
    ? Buffer.from(
        b.toString().replace(VUE_FOCUS_FREEZE, "__VUE_FOCUS_FREEZE__"),
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
export function verifyVueFocusSource(reader = vueFocusBytes) {
  const manifest = JSON.parse(reader(vueFocusUploads[1][0]).toString());
  const commit = JSON.parse(
    reader("fixtures/prospective-vue-11739-v1/commit.json").toString(),
  );
  const tree = JSON.parse(
    reader("fixtures/prospective-vue-11739-v1/canonical-tree.json").toString(),
  );
  if (
    manifest.taskId !== VUE_FOCUS_TASK ||
    manifest.repository !== "vuejs/core" ||
    manifest.baseCommit !== VUE_FOCUS_COMMIT ||
    manifest.archiveRoot !== "core-" + VUE_FOCUS_COMMIT ||
    manifest.archiveSha256 !== VUE_FOCUS_ARCHIVE ||
    manifest.archiveBytes !== 1476297 ||
    manifest.files.length !== VUE_FOCUS_FILES ||
    commit.sha !== VUE_FOCUS_COMMIT ||
    commit.tree.sha !== VUE_FOCUS_TREE ||
    tree.sha !== VUE_FOCUS_TREE ||
    manifest.gitTreeSha1 !== VUE_FOCUS_TREE ||
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
  const files = readPinnedRepositoryArchive(reader(vueFocusUploads[0][0]), {
    repository: "vuejs/core",
    commit: VUE_FOCUS_COMMIT,
    archiveRoot: manifest.archiveRoot,
    archiveSha256: VUE_FOCUS_ARCHIVE,
    files: manifest.files,
  });
  const pkg = JSON.parse(files.get("package.json")!.toString());
  if (
    pkg.version !== "3.5.0-rc.1" ||
    pkg.packageManager !== "pnpm@9.9.0" ||
    pkg.type !== "module" ||
    pkg.scripts.build !== "node scripts/build.js" ||
    pkg.scripts["test-unit"] !== "vitest -c vitest.unit.config.ts" ||
    pkg.scripts.preinstall !== "npx only-allow pnpm" ||
    pkg.scripts.postinstall !== "simple-git-hooks" ||
    pkg.devDependencies.vitest !== "^2.0.5" ||
    pkg.devDependencies.jsdom !== "^25.0.0" ||
    files.get(".node-version")!.toString().trim() !== "20" ||
    !files.get("vitest.workspace.ts")!.toString().includes("vitest.unit.config.ts")
  )
    throw Error("Native script review changed");
  const sha = (p: string) => manifest.files.find((f: any) => f.path === p).sha256;
  const tests = vueExpectedTestFiles(manifest.files.map((f: any) => f.path));
  if (tests.length !== 180) throw Error("Native unit file inventory changed");
  return {
    files: files.size,
    archiveBytes: manifest.archiveBytes,
    archiveSha256: VUE_FOCUS_ARCHIVE,
    gitTreeSha1: tree.sha,
    version: pkg.version,
    packageManager: pkg.packageManager,
    lockSha256: sha("pnpm-lock.yaml"),
    vitestConfigSha256: sha("vitest.config.ts"),
    vitestUnitConfigSha256: sha("vitest.unit.config.ts"),
    unitTestFiles: tests.length,
  };
}
export function auditVueFocus(reader = vueFocusBytes) {
  if (VUE_FOCUS_FREEZE === "__UNFROZEN__")
    throw Error("Vue focus qualification not frozen");
  const p = readJson("evaluation/prospective-vue-11739-v1.json");
  const { digest, ...payload } = p;
  if (
    digest !== VUE_FOCUS_FREEZE ||
    vueFocusHash(JSON.stringify(payload)) !== digest ||
    p.taskId !== VUE_FOCUS_TASK ||
    p.commit !== VUE_FOCUS_COMMIT ||
    p.image !== VUE_FOCUS_IMAGE ||
    p.inferenceCalls !== 0 ||
    p.modelAdmission !== false ||
    p.maxOperations !== vueFocusSlots.length ||
    !isDeepStrictEqual(p.slots, vueFocusSlots) ||
    p.assets.length !== vueFocusAssets.length ||
    p.assets.some(
      (a: any, i: number) =>
        a.path !== vueFocusAssets[i] || a.sha256 !== vueFocusHash(reader(a.path)),
    )
  )
    throw Error("Vue focus qualification freeze changed");
  const parent = auditProspective();
  if (
    p.prospectiveFreeze !== parent.manifest.digest ||
    parent.tasks.find((t) => t.instance_id === VUE_FOCUS_TASK)?.base_commit !==
      VUE_FOCUS_COMMIT
  )
    throw Error("Prospective task binding changed");
  const image = JSON.parse(reader("fixtures/vue-native/node20-image.json").toString());
  if (
    image.sandboxImageUuid !== VUE_FOCUS_IMAGE ||
    image.tag !== "docker.io/library/node:20.9.0-bookworm-slim" ||
    image.runtimeRequired !== "v20.9.0"
  )
    throw Error("Runtime image binding changed");
  verifyVueFocusSource(reader);
  return p;
}
export function vueFocusEnvironment() {
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
export function vueFocusRequest(
  slot: string,
  image: string,
  files: Record<string, unknown> = {},
) {
  z.enum(vueFocusSlots).parse(slot);
  z.uuid().parse(image);
  if (slot === "prepare" && image !== VUE_FOCUS_IMAGE)
    throw Error("Plain Node 20.9.0 runtime image required");
  if (slot !== "prepare" && Object.keys(files).length)
    throw Error("No later input replacement");
  const saved = vueFocusSaved.includes(slot);
  return {
    command: "/usr/local/bin/node",
    args: [input + "/guest.cjs", slot.replace(/-[AB]$/, "")],
    image,
    shell: false,
    preserve_env: false,
    env: vueFocusEnvironment(),
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
export function vueFocusCommands(slot: string): [string, string[]][] {
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
          "pnpm@9.9.0",
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
      [
        node,
        ["scripts/build.js", "^vue$", "--formats", "global-runtime", "--devOnly"],
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
export function vueFocusDist(value: unknown) {
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
export function vueFocusUnit(raw: unknown, expectedFiles: string[]) {
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
  if (bytes.length !== packed.bytes || vueFocusHash(bytes) !== packed.sha256)
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
    caseDigest: vueFocusHash(JSON.stringify(cases)),
    reporterCounters: {
      total: r.numTotalTests,
      passed: r.numPassedTests,
      pending: r.numPendingTests,
      todo: r.numTodoTests,
    },
    cases,
  };
}
const Observation = z.union([
  z
    .object({
      name: z.string(),
      mode: z.enum(["dev", "inline"]),
      cssVars: z.array(z.string()),
      serverHtml: z.string().max(65536),
      serverMessages: z.array(z.string()),
      serverRootStyle: z.string().nullable(),
      clientRootStyle: z.string().nullable(),
      mismatches: z.array(z.string()),
      hydrationWarnings: z.array(z.string()),
      hydrationErrors: z.number().int().nonnegative(),
      otherBrowserMessages: z.array(z.string()),
    })
    .strict(),
  z
    .object({ name: z.string(), mode: z.enum(["dev", "inline"]), error: z.string() })
    .strict(),
]);
const scenarioNames = [
  "reported",
  "parentVarsChildWithoutStyle",
  "childStyleParentWithoutVars",
  "detectorLive",
];
/**
 * Prospective rule. Dev mode mirrors the playground default; inline is production-like. Reproduced
 * only if the verbatim report yields style-only hydration mismatches in at least one mode, while in
 * both modes the report compiles and runs, both controls stay silent and the detector fires.
 */
export function vueFocusObservations(value: unknown, dist: { path: string; sha256: string }[]) {
  const o = z
    .object({
      nodeEnv: z.null(),
      loaded: z.array(DistEntry.extend({ path: z.string() })),
      observations: z.array(Observation).length(8),
    })
    .strict()
    .parse(value);
  if (
    !isDeepStrictEqual(
      o.observations.map((x) => [x.mode, x.name]),
      ["dev", "inline"].flatMap((m) => scenarioNames.map((n) => [m, n])),
    )
  )
    throw Error("Reproduction scenario order changed");
  const loaded = o.loaded.map((l) => l.path);
  if (
    vueProbeDist.some((p) => !loaded.includes(p)) ||
    loaded.some((p) => /\.prod\.js$/.test(p) || /esm-/.test(p)) ||
    o.loaded.some(
      (l) =>
        l.path.includes("/dist/") &&
        dist.find((d) => d.path === l.path)?.sha256 !== l.sha256,
    )
  )
    throw Error("Probe did not load the bound development builds");
  const silent = (x: any) =>
    !x.error &&
    x.mismatches.length === 0 &&
    x.hydrationWarnings.length === 0 &&
    x.hydrationErrors === 0 &&
    x.serverMessages.length === 0;
  const styleOnly = (x: any) =>
    !x.error &&
    x.mismatches.length > 0 &&
    x.mismatches.length === x.hydrationWarnings.length &&
    x.mismatches.every((m: string) => m === "style") &&
    x.serverMessages.length === 0;
  const get = (mode: string, name: string) =>
    o.observations.find((x) => x.mode === mode && x.name === name) as any;
  for (const mode of ["dev", "inline"]) {
    if (
      !silent(get(mode, "parentVarsChildWithoutStyle")) ||
      !silent(get(mode, "childStyleParentWithoutVars"))
    )
      throw Error("Hydration controls did not pass");
    if (!styleOnly(get(mode, "detectorLive")))
      throw Error("Mismatch detector is not live");
  }
  if (get("dev", "reported").error || get("inline", "reported").error)
    throw Error("Reported scenario observation failed");
  if (!styleOnly(get("dev", "reported")) && !styleOnly(get("inline", "reported")))
    throw Error("Original SSR/CSS v-bind report not reproduced with passing controls");
  return o;
}
export function parseVueFocusReceipt(
  raw: unknown,
  slot: string,
  id: string,
  image: string,
) {
  z.enum(vueFocusSlots).parse(slot);
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
  const req = vueFocusRequest(slot, image);
  const stage = slot.replace(/-[AB]$/, "");
  if (
    guest.stage !== stage ||
    guest.runtimeVersion !== "v20.9.0" ||
    guest.uid !== req.uid ||
    guest.gid !== req.gid ||
    guest.completed !== true ||
    guest.originalInputs !== true ||
    guest.sourceArchiveHash !== VUE_FOCUS_ARCHIVE ||
    !isDeepStrictEqual(guest.envKeys, Object.keys(req.env).sort())
  )
    throw Error("Vue native environment or original bytes changed");
  if (vueFocusSaved.includes(slot) && !op.result_image_uuid)
    throw Error("Missing saved native image");
  if (
    !Array.isArray(guest.commands) ||
    !isDeepStrictEqual(
      guest.commands.map((c: any) => [c.executable, c.args]),
      vueFocusCommands(slot),
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
    if (guest.pnpmVersion !== "9.9.0" || typeof guest.gitPreexisting !== "boolean")
      throw Error("Package manager identity changed");
    return { op, guest };
  }
  const dist = vueFocusDist(guest.dist);
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
  if (stage === "integrity") {
    const probes = [
      ...[
        "pnpm-lock.yaml",
        "packages/runtime-core/src/hydration.ts",
        "packages/runtime-core/__tests__/hydration.spec.ts",
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
    const manifest = readJson(vueFocusUploads[1][0]);
    vueFocusUnit(
      guest.unitRaw,
      vueExpectedTestFiles(manifest.files.map((f: any) => f.path)),
    );
  }
  if (stage === "reproduction") {
    if (!isDeepStrictEqual(JSON.parse(guest.commands[0].stdout), guest.observations))
      throw Error("Public observations differ from raw probe output");
    vueFocusObservations(guest.observations, dist);
  }
  return { op, guest };
}
export const vueFocusProfile: OriginalNativeProfile = {
  id: "prospective-vue-11739-v1",
  image: VUE_FOCUS_IMAGE,
  inputDirectory: input,
  slots: vueFocusSlots,
  savedSlots: vueFocusSaved,
  uploads: vueFocusUploads,
  audit: auditVueFocus,
  request: vueFocusRequest,
  parse: parseVueFocusReceipt,
};

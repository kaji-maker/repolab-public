import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { auditExternalIntake } from "./external-intake.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";

export const VUE_NATIVE_FREEZE =
  "79b717f98fb54230eb9cfe13c4ff1c65f91896a3f1f1563767da109d6cbdefff";
export const VUE_NATIVE_IMAGE = "e9a27985-c3f3-33f0-a138-4d14f9744788";
export const VUE_NATIVE_ARCHIVE =
  "1b6614f714c58464a223a853b2fa80afa20aa135286a441789bf8a8268893a6d";
export const VUE_NATIVE_COMMIT = "706d4ac1d0210b2d9134b3228280187fe02fc971";
export const VUE_NATIVE_TREE = "89a8df40e9410ffd7d68b5c25df4bf55fd95a2fc";
export const VUE_FEASIBILITY_PARENT =
  "1abc6795d08f0e3e404a4bcdb811b3ea5bd31d0004d53743be77ab58d7b02a1f";

export const vueNativeAssets = [
  "packages/evaluation/vue-native-v1.ts",
  "packages/execution/vue-native-v1.ts",
  "apps/evaluator/vue-native-v1.ts",
  "tests/vue-native-v1.test.ts",
  "evaluation/VUE_NATIVE_V1.md",
  "fixtures/vue-native/original-manifest.json",
  "fixtures/vue-native/node20-image.json",
  "fixtures/vue-native/baseline-identities-v1.json",
  "repositories/vue-native-v1/original.tar.gz",
  "repositories/vue-native-v1/LICENSE",
  "repositories/vue-native-v1/guest.cjs",
  "repositories/vue-native-v1/reproduction.cjs",
];

export const vueNativeSlots = [
  "prepare",
  "build",
  "protect",
  "integrity",
  "unit-A",
  "reproduction-A",
  "unit-B",
  "reproduction-B",
] as const;

export type VueNativeSlot = (typeof vueNativeSlots)[number];

export const shaVueNative = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");

export function vueNativeAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === vueNativeAssets[0]
    ? Buffer.from(
        b.toString("utf8").replace(VUE_NATIVE_FREEZE, "__VUE_NATIVE_FREEZE__"),
      )
    : b;
}

export function verifyVueSourceArchive() {
  const manifest = JSON.parse(
    readFileSync("fixtures/vue-native/original-manifest.json", "utf8"),
  );
  const tree = JSON.parse(
    readFileSync(
      ".repolab/external-intake-v1/vuejs__core-11899-canonical-tree.json",
      "utf8",
    ),
  );
  const archive = readFileSync("repositories/vue-native-v1/original.tar.gz");
  if (
    manifest.format !== "repolab-vue-source/v1" ||
    manifest.taskId !== "vuejs__core-11899" ||
    manifest.baseCommit !== VUE_NATIVE_COMMIT ||
    manifest.gitTreeSha1 !== VUE_NATIVE_TREE ||
    manifest.archiveSha256 !== VUE_NATIVE_ARCHIVE ||
    manifest.archiveBytes !== 1485332 ||
    manifest.files.length !== 697 ||
    tree.sha !== VUE_NATIVE_TREE ||
    Boolean(tree.truncated)
  )
    throw Error("Vue manifest or canonical tree metadata changed");
  const blobs = tree.tree
    .filter((e: { type: string }) => e.type === "blob")
    .sort((a: { path: string }, b: { path: string }) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
  if (
    blobs.length !== 697 ||
    manifest.files.some(
      (
        f: {
          path: string;
          gitBlobSha1: string;
          bytes: number;
          gitMode: string;
        },
        i: number,
      ) =>
        f.path !== blobs[i].path ||
        f.gitBlobSha1 !== blobs[i].sha ||
        f.bytes !== blobs[i].size ||
        f.gitMode !== blobs[i].mode ||
        f.gitMode !== "100644",
    )
  )
    throw Error("Vue manifest files diverge from frozen canonical Git tree");
  const files = readPinnedRepositoryArchive(archive, {
    repository: "vuejs/core",
    commit: VUE_NATIVE_COMMIT,
    archiveRoot: "core-" + VUE_NATIVE_COMMIT,
    archiveSha256: VUE_NATIVE_ARCHIVE,
    files: manifest.files,
  });
  const rootPkg = JSON.parse(files.get("package.json")!.toString("utf8"));
  const sfcPkg = JSON.parse(
    files.get("packages/compiler-sfc/package.json")!.toString("utf8"),
  );
  const workspaceYaml = files.get("pnpm-workspace.yaml")!.toString("utf8");
  const pkgPaths = [...files.keys()]
    .filter((p) => p === "package.json" || p.endsWith("/package.json"))
    .sort();
  const subpkgLifecycleCount = pkgPaths
    .filter((p) => p !== "package.json")
    .reduce((acc, p) => {
      const scripts = JSON.parse(files.get(p)!.toString("utf8")).scripts ?? {};
      return (
        acc +
        Object.keys(scripts).filter((k) =>
          /^(pre|post)?(install|pack|publish|prepare|version)$/.test(k),
        ).length
      );
    }, 0);
  if (
    rootPkg.packageManager !== "pnpm@9.10.0" ||
    rootPkg.scripts?.preinstall !== "npx only-allow pnpm" ||
    rootPkg.scripts?.postinstall !== "simple-git-hooks" ||
    rootPkg.scripts?.["test-unit"] !== "vitest -c vitest.unit.config.ts" ||
    rootPkg.scripts?.["build-all-cjs"] !==
      "node scripts/build.js vue runtime compiler reactivity shared -af cjs" ||
    sfcPkg.name !== "@vue/compiler-sfc" ||
    sfcPkg.version !== "3.5.4" ||
    !workspaceYaml.includes("catalog:") ||
    pkgPaths.length !== 22 ||
    subpkgLifecycleCount !== 0
  )
    throw Error("Vue workspace or lifecycle script review invariants changed");
  return {
    fileCount: files.size,
    archiveBytes: archive.length,
    archiveSha256: VUE_NATIVE_ARCHIVE,
    gitTreeSha1: VUE_NATIVE_TREE,
    packageManager: rootPkg.packageManager as string,
    workspacePackageJsonCount: pkgPaths.length,
    subpackageLifecycleScripts: subpkgLifecycleCount,
    rootLifecycleScripts: {
      preinstall: rootPkg.scripts.preinstall as string,
      postinstall: rootPkg.scripts.postinstall as string,
    },
  };
}

export function auditVueNativeFreeze(reader = vueNativeAssetBytes) {
  const p = JSON.parse(readFileSync("evaluation/vue-native-v1.json", "utf8"));
  const { digest, ...payload } = p;
  if (
    digest !== VUE_NATIVE_FREEZE ||
    shaVueNative(JSON.stringify(payload)) !== digest ||
    p.parentDigest !== auditExternalIntake().protocol.digest ||
    p.feasibilityParentDigest !== VUE_FEASIBILITY_PARENT ||
    p.taskId !== "vuejs__core-11899" ||
    p.baseCommit !== VUE_NATIVE_COMMIT ||
    p.gitTreeSha1 !== VUE_NATIVE_TREE ||
    p.archiveSha256 !== VUE_NATIVE_ARCHIVE ||
    JSON.stringify(p.slots) !== JSON.stringify(vueNativeSlots) ||
    p.image !== VUE_NATIVE_IMAGE ||
    p.inferenceCalls !== 0 ||
    p.modelAdmission !== false ||
    p.docusaurusStatus !== "UNSUPPORTED_RETAINED_IN_DENOMINATOR" ||
    p.selectedExternalDenominator !== 3 ||
    p.assets.length !== vueNativeAssets.length ||
    p.assets.some(
      (a: { path: string; sha256: string }, i: number) =>
        a.path !== vueNativeAssets[i] ||
        shaVueNative(reader(a.path)) !== a.sha256,
    )
  )
    throw Error("Vue native baseline freeze changed");
  return p;
}

export function vueNativeStage(slot: VueNativeSlot) {
  z.enum(vueNativeSlots).parse(slot);
  return slot.replace(/-[AB]$/, "");
}

export function vueNativeEnvironment(_slot: VueNativeSlot) {
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
    NPM_CONFIG_USERCONFIG: "/opt/repolab/native/empty-user.conf",
    NPM_CONFIG_GLOBALCONFIG: "/opt/repolab/native/empty-global.conf",
  };
}

export function vueNativeRequest(
  slot: VueNativeSlot,
  image: string,
  files: Record<string, unknown> = {},
) {
  z.uuid().parse(image);
  const saved = ["prepare", "build", "protect"].includes(slot);
  if (slot === "prepare" && image !== VUE_NATIVE_IMAGE)
    throw Error("Vue native parent image changed");
  return {
    command: "/usr/local/bin/node",
    args: ["/opt/repolab/native/guest.cjs", vueNativeStage(slot)],
    image,
    shell: false,
    preserve_env: false,
    env: vueNativeEnvironment(slot),
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

const stream = z.object({
  value: z.string(),
  encoding: z.enum(["base64", "ascii", "utf-8", "utf8", "plain"]),
  truncated: z.boolean(),
});

const Operation = z
  .object({
    uuid: z.uuid(),
    image_uuid: z.uuid(),
    status: z.string(),
    result_image_uuid: z.uuid().nullish(),
    metadata: z
      .object({
        result: z
          .object({
            state: z.object({
              exit_code: z.number().int(),
              signal: z.number().int().nullable(),
              timed_out: z.boolean(),
            }),
            stdout: stream,
            stderr: stream,
          })
          .passthrough(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const Guest = z
  .object({
    stage: z.string(),
    runtimeVersion: z.literal("v20.9.0"),
    uid: z.number().int(),
    gid: z.number().int(),
    envKeys: z.array(z.string()),
    sourceArchiveHash: z.literal(VUE_NATIVE_ARCHIVE),
    originalInputs: z.literal(true),
    completed: z.literal(true),
    commands: z.array(
      z.object({
        executable: z.string(),
        args: z.array(z.string()),
        exitCode: z.literal(0),
        signal: z.null(),
        errorCode: z.null(),
        stdout: z.string(),
        stderr: z.string(),
      }),
    ),
  })
  .passthrough();

export function parseVueNativeReceipt(
  raw: unknown,
  slot: VueNativeSlot,
  id: string,
  image: string,
) {
  const op = Operation.parse(raw);
  if (
    op.uuid !== id ||
    op.image_uuid !== image ||
    op.status !== "SUCCESS" ||
    !op.metadata?.result
  )
    throw Error("Vue native operation identity or terminal status invalid");
  const r = op.metadata.result;
  if (
    r.state.exit_code !== 0 ||
    r.state.timed_out ||
    ![null, 0, -1].includes(r.state.signal)
  )
    throw Error("Vue native process failed");
  const decode = (s: z.infer<typeof stream>) => {
    const b = Buffer.from(s.value, s.encoding === "base64" ? "base64" : "utf8");
    if (s.truncated || b.length > 4194304)
      throw Error("Vue native output truncated");
    return b.toString("utf8");
  };
  const guest = Guest.parse(JSON.parse(decode(r.stdout)));
  decode(r.stderr);
  const request = vueNativeRequest(slot, image);
  if (
    guest.stage !== vueNativeStage(slot) ||
    guest.uid !== request.uid ||
    guest.gid !== request.gid ||
    JSON.stringify([...guest.envKeys].sort()) !==
      JSON.stringify(Object.keys(request.env).sort())
  )
    throw Error("Vue native execution environment changed");
  if (!request.disposable && !op.result_image_uuid)
    throw Error("Missing prepared Vue image");
  const pnpmBin = "/opt/repolab/pnpm-cli/node_modules/pnpm/bin/pnpm.cjs";
  const expected: Record<string, [string, string[]][]> = {
    prepare: [
      [
        "/bin/tar",
        [
          "-xzf",
          "/opt/repolab/native/upstream.tar.gz",
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
      ["/usr/local/bin/node", [pnpmBin, "--version"]],
      [
        "/usr/local/bin/node",
        [
          pnpmBin,
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--store-dir",
          "/opt/repolab/pnpm-store",
        ],
      ],
      ["/usr/local/bin/node", [pnpmBin, "rebuild", "esbuild"]],
    ],
    build: [["/usr/local/bin/node", [pnpmBin, "run", "build-all-cjs"]]],
    protect: [],
    integrity: [],
    unit: [
      [
        "/usr/local/bin/node",
        [
          "/opt/repolab/vue/node_modules/vitest/vitest.mjs",
          "run",
          "-c",
          "vitest.unit.config.ts",
          "--reporter=json",
          "--outputFile=/tmp/repolab-vue-out/vitest.json",
          "packages/compiler-sfc/__tests__",
        ],
      ],
    ],
    reproduction: [
      ["/usr/local/bin/node", ["/opt/repolab/native/reproduction.cjs"]],
    ],
  };
  if (
    JSON.stringify(guest.commands.map((c) => [c.executable, c.args])) !==
    JSON.stringify(expected[vueNativeStage(slot)])
  )
    throw Error("Vue native commands changed");
  return { op, guest };
}

const Observations = z
  .object({
    mediaNested: z
      .object({
        errors: z.literal(0),
        hostDeclScoped: z.literal(true),
        childRuleScoped: z.literal(true),
        atRuleDeclScoped: z.literal(false),
      })
      .strict(),
    containerNested: z
      .object({
        errors: z.literal(0),
        hostDeclScoped: z.literal(true),
        childRuleScoped: z.literal(true),
        atRuleDeclScoped: z.literal(false),
      })
      .strict(),
    plainNestedControl: z
      .object({
        errors: z.literal(0),
        hostDeclScoped: z.literal(true),
        childRuleScoped: z.literal(true),
      })
      .strict(),
    topLevelMediaControl: z
      .object({
        errors: z.literal(0),
        mediaPresent: z.literal(true),
        innerRuleScoped: z.literal(true),
      })
      .strict(),
  })
  .strict();

export function vueNativeObservations(value: unknown) {
  return Observations.parse(value);
}

export function vueNativeIntegrity(value: unknown) {
  const p = z
    .object({
      denials: z
        .array(
          z
            .object({
              path: z.string().optional(),
              action: z.string(),
              error: z.enum(["EACCES", "EPERM", "EROFS", "EEXIST"]),
            })
            .strict(),
        )
        .length(11),
      network: z.enum([
        "TIMEOUT",
        "ENETUNREACH",
        "EHOSTUNREACH",
        "ECONNREFUSED",
        "EACCES",
        "EPERM",
      ]),
    })
    .parse(value);
  const expected = [
    ...[
      "pnpm-lock.yaml",
      "packages/compiler-sfc/src/style/pluginScoped.ts",
      "packages/compiler-sfc/__tests__/compileStyle.spec.ts",
    ].flatMap((path) =>
      ["write", "unlink", "replace"].map((action) => ({ path, action })),
    ),
    { action: "rename-tests" },
    { action: "symlink-test" },
  ];
  if (
    JSON.stringify(p.denials.map(({ error, ...d }) => d)) !==
    JSON.stringify(expected)
  )
    throw Error("Vue integrity probes changed");
  return p;
}

export function vueNativeSuite(value: unknown) {
  const u = z
    .object({
      success: z.literal(true),
      numTotalTestSuites: z.number().int().positive(),
      numPassedTestSuites: z.number().int().positive(),
      numFailedTestSuites: z.literal(0),
      numTotalTests: z.number().int().positive(),
      numPassedTests: z.number().int().positive(),
      numFailedTests: z.literal(0),
      numPendingTests: z.number().int().nonnegative(),
      cases: z.array(
        z
          .object({
            id: z.string().min(1),
            status: z.enum(["passed", "pending", "skipped", "todo"]),
            skipped: z.boolean(),
          })
          .strict(),
      ),
    })
    .parse(value);
  if (
    u.numTotalTestSuites !== u.numPassedTestSuites ||
    u.numTotalTests !== u.cases.length ||
    u.numPassedTests + u.numPendingTests !== u.cases.length ||
    u.cases.filter((c) => c.skipped).length !== u.numPendingTests ||
    u.cases.some(
      (c) =>
        (c.skipped && c.status === "passed") ||
        (!c.skipped && c.status !== "passed"),
    )
  )
    throw Error("Inconsistent Vitest unit counts");
  const cases = u.cases.map((c) => ({ id: c.id, skipped: c.skipped }));
  if (!cases.length || new Set(cases.map((c) => c.id)).size !== cases.length)
    throw Error("Empty or duplicate Vitest case identities");
  cases.sort((a, b) => a.id.localeCompare(b.id));
  return {
    suites: u.numTotalTestSuites,
    passed: cases.filter((c) => !c.skipped).length,
    skipped: cases.filter((c) => c.skipped).length,
    caseDigest: shaVueNative(JSON.stringify(cases)),
    cases,
  };
}

export function checkedVueNativeSuite(value: unknown) {
  const summary = vueNativeSuite(value);
  const expected = JSON.parse(
    readFileSync("fixtures/vue-native/baseline-identities-v1.json", "utf8"),
  ).unit;
  if (
    summary.caseDigest !== expected.caseDigest ||
    summary.suites !== expected.suites ||
    summary.passed !== expected.passed ||
    summary.skipped !== expected.skipped
  )
    throw Error("Original Vue native test inventory changed");
  return summary;
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { auditExternalIntake } from "./external-intake.ts";

export const NATIVE_FREEZE = "d4354da0b3ca91dffbdd38ef4f818246495f235f739045f53fc3c53ea278b826";
export const NATIVE_IMAGE = "53fcf4f1-cd27-4c6a-ab09-35cd4dbc9119";
export const NATIVE_ARCHIVE =
  "88d58cccfa506ba27b82c201cdccfe731fdd0870175e76695d3fda9386a756bf";
export const nativeAssets = [
  "packages/evaluation/preact-native-v3.ts",
  "packages/execution/preact-native-v3.ts",
  "apps/evaluator/preact-native-v3.ts",
  "tests/preact-native-v3.test.ts",
  "evaluation/PREACT_NATIVE_V3.md",
  "fixtures/preact-native/original-manifest.json",
  "repositories/preact-native-v1/original.tar.gz",
  "repositories/preact-native-v1/LICENSE",
  "repositories/preact-native-v3/guest.cjs",
  "repositories/preact-native-v1/karma.cjs",
  "repositories/preact-native-v1/reproduction.html",
  "evaluation/preact-native-v1.json",
  "evaluation/preact-native-v2.json",
  "evaluation/preact-native-v2-results-summary.json",
  "evaluation/preact-native-v1-results-summary.json",
];
export const nativeSlots = [
  "prepare",
  "build",
  "protect",
  "integrity",
  "lint",
  "mocha-A",
  "types",
  "browser-A",
  "reproduction-A",
  "mocha-B",
  "browser-B",
  "reproduction-B",
] as const;
export type NativeSlot = (typeof nativeSlots)[number];
export const shaNative = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function nativeAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === nativeAssets[0]
    ? Buffer.from(
        b.toString("utf8").replace(NATIVE_FREEZE, "__NATIVE_FREEZE__"),
      )
    : b;
}
export function auditNativeFreeze(reader = nativeAssetBytes) {
  const p = JSON.parse(
    readFileSync("evaluation/preact-native-v3.json", "utf8"),
  );
  const { digest, ...payload } = p;
  if (
    digest !== NATIVE_FREEZE ||
    shaNative(JSON.stringify(payload)) !== digest ||
    p.parentDigest !== auditExternalIntake().protocol.digest ||
    p.previousFailedFreeze !==
      "865e01356836a6b52b64803cd6c51cba7b6289dd2298d86de78d139464025d83" ||
    JSON.stringify(p.slots) !== JSON.stringify(nativeSlots) ||
    p.image !== NATIVE_IMAGE ||
    p.inferenceCalls !== 0 ||
    p.modelAdmission !== false ||
    p.assets.length !== nativeAssets.length ||
    p.assets.some(
      (a: { path: string; sha256: string }, i: number) =>
        a.path !== nativeAssets[i] || shaNative(reader(a.path)) !== a.sha256,
    )
  )
    throw Error("Native baseline freeze changed");
  return p;
}
export function nativeStage(slot: NativeSlot) {
  z.enum(nativeSlots).parse(slot);
  return slot.replace(/-[AB]$/, "");
}
export function nativeEnvironment(slot: NativeSlot) {
  const env: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    SHELL: "/bin/sh",
    TERM: "xterm",
    LANG: "C.UTF-8",
    TZ: "UTC",
    CI: "true",
    CHROME_BIN: "/usr/bin/chromium",
    XDG_CONFIG_HOME: "/tmp/repolab-native-home/config",
    XDG_CACHE_HOME: "/tmp/repolab-native-home/cache",
    NPM_CONFIG_CACHE: "/tmp/repolab-native-npm-cache",
    NPM_CONFIG_USERCONFIG: "/opt/repolab/native/empty-user.conf",
    NPM_CONFIG_GLOBALCONFIG: "/opt/repolab/native/empty-global.conf",
    BABEL_DISABLE_CACHE: "true",
  };
  if (nativeStage(slot) === "browser")
    Object.assign(env, {
      COVERAGE: "true",
      MINIFY: "true",
      BABEL_NO_MODULES: "true",
    });
  return env;
}
export function nativeRequest(
  slot: NativeSlot,
  image: string,
  files: Record<string, unknown> = {},
) {
  z.uuid().parse(image);
  const saved = ["prepare", "build", "protect"].includes(slot);
  if (slot === "prepare" && image !== NATIVE_IMAGE)
    throw Error("Native parent image changed");
  return {
    command: "/usr/local/bin/node",
    args: ["/opt/repolab/native/guest.cjs", nativeStage(slot)],
    image,
    shell: false,
    preserve_env: false,
    env: nativeEnvironment(slot),
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
    runtimeVersion: z.literal("v24.18.0"),
    uid: z.number().int(),
    gid: z.number().int(),
    envKeys: z.array(z.string()),
    sourceArchiveHash: z.literal(NATIVE_ARCHIVE),
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
export function parseNativeReceipt(
  raw: unknown,
  slot: NativeSlot,
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
    throw Error("Native operation identity or terminal status invalid");
  const r = op.metadata.result;
  if (
    r.state.exit_code !== 0 ||
    r.state.timed_out ||
    ![null, 0, -1].includes(r.state.signal)
  )
    throw Error("Native process failed");
  const decode = (s: z.infer<typeof stream>) => {
    const b = Buffer.from(s.value, s.encoding === "base64" ? "base64" : "utf8");
    if (s.truncated || b.length > 4194304)
      throw Error("Native output truncated");
    return b.toString("utf8");
  };
  const guest = Guest.parse(JSON.parse(decode(r.stdout)));
  decode(r.stderr);
  const request = nativeRequest(slot, image);
  if (
    guest.stage !== nativeStage(slot) ||
    guest.uid !== request.uid ||
    guest.gid !== request.gid ||
    JSON.stringify([...guest.envKeys].sort()) !==
      JSON.stringify(Object.keys(request.env).sort())
  )
    throw Error("Native execution environment changed");
  if (!request.disposable && !op.result_image_uuid)
    throw Error("Missing prepared image");
  const expected: Record<string, [string, string[]][]> = {
    build: [
      ["/usr/local/bin/npm", ["run", "build"]],
      [
        "/bin/tar",
        [
          "-xzf",
          "/opt/repolab/native/upstream.tar.gz",
          "--strip-components=1",
          "-C",
          "/opt/repolab/preact",
        ],
      ],
    ],
    protect: [],
    integrity: [],
    lint: [["/usr/local/bin/npm", ["run", "lint"]]],
    mocha: [
      [
        "/usr/local/bin/node",
        [
          "/opt/repolab/preact/node_modules/mocha/bin/mocha",
          "--recursive",
          "--require",
          "@babel/register",
          "--reporter",
          "json",
          "test/shared",
          "test/node",
        ],
      ],
    ],
    types: [["/usr/local/bin/npm", ["run", "test:ts"]]],
    browser: [["/usr/local/bin/node", ["/opt/repolab/native/karma.cjs"]]],
    reproduction: [
      [
        "/usr/bin/chromium",
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--dump-dom",
          "file:///opt/repolab/native/reproduction.html",
        ],
      ],
    ],
    prepare: [
      [
        "/bin/tar",
        [
          "-xzf",
          "/opt/repolab/native/upstream.tar.gz",
          "--strip-components=1",
          "-C",
          "/opt/repolab/preact",
        ],
      ],
      ["/usr/bin/apt-get", ["update", "-q"]],
      [
        "/usr/bin/apt-get",
        [
          "install",
          "-y",
          "--no-install-recommends",
          "chromium",
          "ca-certificates",
        ],
      ],
      [
        "/usr/local/bin/npm",
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      ],
      ["/usr/local/bin/npm", ["rebuild", "esbuild", "--no-audit", "--no-fund"]],
      ["/usr/bin/chromium", ["--version"]],
    ],
  };
  if (
    JSON.stringify(guest.commands.map((c) => [c.executable, c.args])) !==
    JSON.stringify(expected[nativeStage(slot)])
  )
    throw Error("Native commands changed");
  return { op, guest };
}
const Observations = z
  .object({
    cleanup: z
      .object({
        mounts: z.literal(1),
        cleanups: z.literal(0),
        nullCalls: z.literal(1),
      })
      .strict(),
    cleanupBeforeUnmount: z.literal(0),
    legacy: z
      .object({ mounts: z.literal(1), nullCalls: z.literal(1) })
      .strict(),
    objectMounted: z.literal("INPUT"),
    objectCleared: z.literal(true),
  })
  .strict();
export function nativeObservations(value: unknown) {
  return Observations.parse(value);
}
export function nativeIntegrity(value: unknown) {
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
      "package-lock.json",
      "src/diff/index.js",
      "test/browser/refs.test.js",
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
    throw Error("Integrity probes changed");
  return p;
}
export function nativeSuite(value: unknown, kind: "mocha" | "browser") {
  let cases: { id: string; skipped: boolean }[];
  if (kind === "mocha") {
    const m = z
      .object({
        stats: z.object({
          tests: z.number().int().positive(),
          passes: z.number().int().positive(),
          pending: z.number().int().nonnegative(),
          failures: z.literal(0),
        }),
        tests: z.array(
          z.object({
            fullTitle: z.string().min(1),
            pending: z.boolean().optional(),
            err: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
        pending: z.array(z.object({ fullTitle: z.string() })),
        failures: z.array(z.unknown()).length(0),
        passes: z.array(z.object({ fullTitle: z.string() })),
      })
      .parse(value);
    if (
      m.stats.tests !== m.tests.length ||
      m.stats.passes !== m.passes.length ||
      m.stats.pending !== m.pending.length ||
      m.tests.length !== m.passes.length + m.pending.length ||
      m.tests.some((c) => c.err && Object.keys(c.err).length)
    )
      throw Error("Inconsistent Mocha counts");
    const pending = new Set(m.pending.map((c) => c.fullTitle));
    cases = m.tests.map((c) => ({
      id: c.fullTitle,
      skipped: pending.has(c.fullTitle),
    }));
  } else {
    const b = z
      .object({
        result: z.object({
          success: z.number().int().positive(),
          failed: z.literal(0),
          skipped: z.number().int().nonnegative(),
          error: z.boolean().optional(),
          disconnected: z.boolean().optional(),
        }),
        cases: z.array(
          z.object({
            suite: z.array(z.string()),
            description: z.string().min(1),
            success: z.boolean(),
            skipped: z.boolean(),
            log: z.array(z.string()),
          }),
        ),
      })
      .parse(value);
    if (
      b.result.error ||
      b.result.disconnected ||
      b.result.success + b.result.skipped !== b.cases.length ||
      b.cases.filter((c) => c.skipped).length !== b.result.skipped ||
      b.cases.some((c) => !c.skipped && !c.success)
    )
      throw Error("Inconsistent browser counts");
    cases = b.cases.map((c) => ({
      id: [...c.suite, c.description].join(" > "),
      skipped: c.skipped,
    }));
  }
  if (!cases.length || new Set(cases.map((c) => c.id)).size !== cases.length)
    throw Error("Empty or duplicate test identities");
  cases.sort((a, b) => a.id.localeCompare(b.id));
  return {
    passed: cases.filter((c) => !c.skipped).length,
    skipped: cases.filter((c) => c.skipped).length,
    caseDigest: shaNative(JSON.stringify(cases)),
    cases,
  };
}

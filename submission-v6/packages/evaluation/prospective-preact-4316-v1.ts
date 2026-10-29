import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditProspective, readProspectiveTask } from "./prospective-v1.ts";
import { readPinnedRepositoryArchive } from "../repositories/onboarding-v1.ts";
import {
  nativeEnvironment,
  nativeSuite,
  parseNativeReceipt,
  auditNativeFreeze,
  NATIVE_IMAGE,
} from "./preact-native-v5.ts";
import type { OriginalNativeProfile } from "../execution/profiled-native-v1.ts";

export const FOCUS_FREEZE: string =
  "5931b339513d463debaefe544af1efc04838a80ae9e0ab63343151af84f40ec9";
export const FOCUS_TASK = "preactjs__preact-4316";
export const FOCUS_COMMIT = "b820d8b73eade8bc5b3fbf7e5fe0dd5150de80e2";
export const FOCUS_IMAGE = "e7975706-7ec1-4eba-81a3-0ff69d04e94a";
export const FOCUS_ARCHIVE =
  "79df72773cf63b53375565ae2c9f2b4df53e74d87c47765104d90b85b5409732";
export const focusSlots = [
  "prepare",
  "build",
  "protect",
  "integrity",
  "lint",
  "mocha-A",
  "browser-A",
  "reproduction-A",
  "mocha-B",
  "browser-B",
  "reproduction-B",
] as const;
export const focusSaved = ["prepare", "build", "protect"];
export const focusUploads = [
  [
    "repositories/prospective-preact-4316-v1/original.tar.gz",
    "upstream.tar.gz",
  ],
  [
    "fixtures/prospective-preact-4316-v1/original-manifest.json",
    "manifest.json",
  ],
  ["repositories/prospective-preact-4316-v1/guest.cjs", "guest.cjs"],
  ["repositories/prospective-preact-4316-v1/karma.cjs", "karma.cjs"],
  [
    "repositories/prospective-preact-4316-v1/reproduction.html",
    "reproduction.html",
  ],
] as const;
export const focusAssets = [
  "packages/evaluation/prospective-preact-4316-v1.ts",
  "packages/execution/profiled-native-v1.ts",
  "apps/evaluator/prospective-preact-4316-v1.ts",
  "tests/prospective-preact-4316-v1.test.ts",
  "evaluation/PROSPECTIVE_PREACT_4316_V1.md",
  ...focusUploads.map((x) => x[0]),
  "repositories/prospective-preact-4316-v1/LICENSE",
  "fixtures/prospective-preact-4316-v1/commit.json",
  "fixtures/prospective-preact-4316-v1/canonical-tree.json",
  "evaluation/prospective-v1.json",
  "packages/repositories/repair-lease.ts",
  "packages/execution/recovery-lease-v1.ts",
  "packages/storage/reconciliation.ts",
  "packages/execution/nebius.ts",
  "evaluation/preact-native-v5.json",
  "fixtures/preact-native/baseline-identities-v1.json",
  "fixtures/preact-native/original-manifest.json",
  ".repolab/preact-native-v5/run/prepare.json",
];
export const focusHash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function focusBytes(path: string) {
  const b = readFileSync(path);
  return path === focusAssets[0]
    ? Buffer.from(b.toString().replace(FOCUS_FREEZE, "__FOCUS_FREEZE__"))
    : b;
}
export function verifyFocusSource() {
  const manifest = JSON.parse(readFileSync(focusUploads[1][0], "utf8"));
  const commit = JSON.parse(
    readFileSync("fixtures/prospective-preact-4316-v1/commit.json", "utf8"),
  );
  const tree = JSON.parse(
    readFileSync(
      "fixtures/prospective-preact-4316-v1/canonical-tree.json",
      "utf8",
    ),
  );
  if (
    manifest.taskId !== FOCUS_TASK ||
    manifest.baseCommit !== FOCUS_COMMIT ||
    manifest.archiveSha256 !== FOCUS_ARCHIVE ||
    manifest.archiveBytes !== 653607 ||
    manifest.files.length !== 335 ||
    commit.sha !== FOCUS_COMMIT ||
    commit.tree.sha !== tree.sha ||
    tree.sha !== manifest.gitTreeSha1 ||
    tree.truncated !== false
  )
    throw Error("Pinned focus source identity changed");
  const blobs = tree.tree
    .filter((x: any) => x.type === "blob")
    .sort((a: any, b: any) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    blobs.length !== 335 ||
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
  const files = readPinnedRepositoryArchive(readFileSync(focusUploads[0][0]), {
    repository: "preactjs/preact",
    commit: FOCUS_COMMIT,
    archiveRoot: "preact-" + FOCUS_COMMIT,
    archiveSha256: FOCUS_ARCHIVE,
    files: manifest.files,
  });
  const pkg = JSON.parse(files.get("package.json")!.toString());
  if (
    pkg.version !== "10.20.0" ||
    pkg.scripts.build !== "npm-run-all --parallel build:*" ||
    pkg.scripts.postbuild !==
      "node ./config/node-13-exports.js && node ./config/compat-entries.js" ||
    pkg.scripts["test:mocha"] !==
      'mocha --recursive --require "@babel/register" test/shared test/node' ||
    pkg.scripts["test:ts"] !== "run-p test:ts:*" ||
    pkg.scripts.lint !== "run-s eslint tsc"
  )
    throw Error("Native script review changed");
  const old = JSON.parse(
    readFileSync("fixtures/preact-native/original-manifest.json", "utf8"),
  );
  const nodeFiles = manifest.files.filter(
    (f: any) =>
      f.path.startsWith("test/shared/") || f.path.startsWith("test/node/"),
  );
  if (
    nodeFiles.length !== 6 ||
    nodeFiles.some(
      (f: any) =>
        old.files.find((o: any) => o.path === f.path)?.sha256 !== f.sha256,
    )
  )
    throw Error("Node suite differs from bound source-identical inventory");
  return {
    files: files.size,
    archiveBytes: 653607,
    archiveSha256: FOCUS_ARCHIVE,
    gitTreeSha1: tree.sha,
    version: pkg.version,
    lockSha256: manifest.files.find((f: any) => f.path === "package-lock.json")
      .sha256,
    nodeTestFiles: nodeFiles.length,
  };
}
export function auditFocus(reader = focusBytes) {
  if (FOCUS_FREEZE === "__UNFROZEN__")
    throw Error("Focus qualification not frozen");
  const p = JSON.parse(
    readFileSync("evaluation/prospective-preact-4316-v1.json", "utf8"),
  );
  const { digest, ...payload } = p;
  if (
    digest !== FOCUS_FREEZE ||
    focusHash(JSON.stringify(payload)) !== digest ||
    p.taskId !== FOCUS_TASK ||
    p.commit !== FOCUS_COMMIT ||
    p.image !== FOCUS_IMAGE ||
    p.inferenceCalls !== 0 ||
    p.modelAdmission !== false ||
    p.maxOperations !== 11 ||
    !isDeepStrictEqual(p.slots, focusSlots) ||
    p.assets.length !== focusAssets.length ||
    p.assets.some(
      (a: any, i: number) =>
        a.path !== focusAssets[i] || a.sha256 !== focusHash(reader(a.path)),
    )
  )
    throw Error("Focus qualification freeze changed");
  const parent = auditProspective();
  if (
    p.prospectiveFreeze !== parent.manifest.digest ||
    parent.tasks.find((t) => t.instance_id === FOCUS_TASK)?.base_commit !==
      FOCUS_COMMIT
  )
    throw Error("Prospective task binding changed");
  auditNativeFreeze();
  const seed = JSON.parse(
    readFileSync(".repolab/preact-native-v5/run/prepare.json", "utf8"),
  );
  const verified = parseNativeReceipt(
    seed.latest,
    "prepare",
    seed.id,
    NATIVE_IMAGE,
  );
  if (verified.op.result_image_uuid !== FOCUS_IMAGE)
    throw Error("Node/Chromium seed image changed");
  verifyFocusSource();
  return p;
}
export function focusRequest(
  slot: string,
  image: string,
  files: Record<string, unknown> = {},
) {
  z.enum(focusSlots).parse(slot);
  z.uuid().parse(image);
  if (slot === "prepare" && image !== FOCUS_IMAGE)
    throw Error("Prepared Node/Chromium seed required");
  if (slot !== "prepare" && Object.keys(files).length)
    throw Error("No later input replacement");
  const saved = focusSaved.includes(slot),
    stage = slot.replace(/-[AB]$/, "");
  const env = {
    ...nativeEnvironment(
      (stage === "mocha"
        ? "mocha-A"
        : stage === "browser"
          ? "browser-A"
          : stage === "reproduction"
            ? "reproduction-A"
            : stage) as any,
    ),
    NPM_CONFIG_USERCONFIG: "/opt/repolab/prospective-native/empty-user.conf",
    NPM_CONFIG_GLOBALCONFIG:
      "/opt/repolab/prospective-native/empty-global.conf",
  };
  return {
    command: "/usr/local/bin/node",
    args: ["/opt/repolab/prospective-native/guest.cjs", stage],
    image,
    shell: false,
    preserve_env: false,
    env,
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
export const focusExpectedObservations = {
  observations: [
    {
      prop: "onFocusIn",
      type: "focusin",
      calls: 0,
      registrations: ["FocusIn"],
    },
    {
      prop: "onFocusOut",
      type: "focusout",
      calls: 0,
      registrations: ["FocusOut"],
    },
    {
      prop: "onfocusin",
      type: "focusin",
      calls: 1,
      registrations: ["focusin"],
    },
    {
      prop: "onfocusout",
      type: "focusout",
      calls: 1,
      registrations: ["focusout"],
    },
    { prop: "onFocus", type: "focus", calls: 1, registrations: ["focus"] },
    { prop: "onClick", type: "click", calls: 1, registrations: ["click"] },
    {
      prop: "onMyEvent",
      type: "MyEvent",
      calls: 1,
      registrations: ["MyEvent"],
    },
  ],
};
export function focusSuite(value: unknown, kind: "mocha" | "browser") {
  const result = nativeSuite(value, kind);
  if (kind === "mocha") {
    const expected = JSON.parse(
      readFileSync(
        "fixtures/preact-native/baseline-identities-v1.json",
        "utf8",
      ),
    ).mocha;
    if (!isDeepStrictEqual(result.cases, expected.cases))
      throw Error("Source-identical original Node suite inventory changed");
  }
  return result;
}
export function parseFocusReceipt(
  raw: unknown,
  slot: string,
  id: string,
  image: string,
) {
  z.enum(focusSlots).parse(slot);
  z.uuid().parse(id);
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
          stdout: z.object({
            value: z.string(),
            encoding: z.enum(["base64", "ascii", "utf8", "utf-8", "plain"]),
            truncated: z.literal(false),
          }),
          stderr: z.object({
            value: z.string(),
            encoding: z.enum(["base64", "ascii", "utf8", "utf-8", "plain"]),
            truncated: z.literal(false),
          }),
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
  const req = focusRequest(slot, image);
  if (
    guest.stage !== slot.replace(/-[AB]$/, "") ||
    guest.runtimeVersion !== "v20.9.0" ||
    guest.uid !== req.uid ||
    guest.gid !== req.gid ||
    guest.completed !== true ||
    guest.originalInputs !== true ||
    guest.sourceArchiveHash !== FOCUS_ARCHIVE ||
    !isDeepStrictEqual(guest.envKeys, Object.keys(req.env).sort())
  )
    throw Error("Focus native environment or original bytes changed");
  if (focusSaved.includes(slot) && !op.result_image_uuid)
    throw Error("Missing saved native image");
  const expected = focusCommands(slot);
  if (
    !Array.isArray(guest.commands) ||
    !isDeepStrictEqual(
      guest.commands.map((c: any) => [c.executable, c.args]),
      expected,
    ) ||
    guest.commands.some(
      (c: any) =>
        c.exitCode !== 0 ||
        c.errorCode !== null ||
        c.signal !== null ||
        typeof c.stdout !== "string" ||
        typeof c.stderr !== "string",
    )
  )
    throw Error("Native command recipe or child outcome changed");
  if (
    slot !== "prepare" &&
    (!/^[a-f0-9]{64}$/.test(guest.umd?.sha256) ||
      !Number.isSafeInteger(guest.umd.bytes) ||
      guest.umd.bytes <= 0)
  )
    throw Error("Missing tested original UMD identity");
  if (slot === "integrity") {
    const expectedProbes = [
      ...[
        "package-lock.json",
        "src/diff/props.js",
        "test/browser/refs.test.js",
      ].flatMap((path) =>
        ["write", "unlink", "replace"].map((action) => ({ path, action })),
      ),
      { action: "rename-tests" },
      { action: "symlink-test" },
    ];
    if (
      !Array.isArray(guest.denials) ||
      !isDeepStrictEqual(
        guest.denials.map(({ error, ...d }: any) => d),
        expectedProbes,
      ) ||
      guest.denials.some(
        (d: any) => !["EACCES", "EPERM", "EROFS", "EEXIST"].includes(d.error),
      ) ||
      guest.network !== "ENETUNREACH"
    )
      throw Error("Original containment controls failed");
  }
  if (slot.startsWith("mocha")) {
    if (
      !isDeepStrictEqual(JSON.parse(guest.commands[0].stdout), guest.mocha) ||
      guest.typeOutput !== guest.commands[1].stdout
    )
      throw Error("Native summaries differ from raw child output");
    focusSuite(guest.mocha, "mocha");
    if (
      typeof guest.typeOutput !== "string" ||
      ![...guest.typeOutput.matchAll(/\n\s*(\d+) passing \(/g)].some(
        (m) => Number(m[1]) > 0,
      )
    )
      throw Error("Missing successful native TypeScript runtime suite");
  }
  if (slot.startsWith("browser")) focusSuite(guest.browser, "browser");
  if (slot.startsWith("reproduction")) {
    const match = guest.commands[0].stdout.match(
      /<pre id="repolab-observations">([^<]*)<\/pre>/,
    );
    if (
      !match ||
      !isDeepStrictEqual(
        JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")),
        guest.observations,
      )
    )
      throw Error("Public observations differ from actual browser output");
  }
  if (
    slot.startsWith("reproduction") &&
    !isDeepStrictEqual(guest.observations, focusExpectedObservations)
  )
    throw Error("Original focus report not reproduced with passing controls");
  return { op, guest };
}
export function focusCommands(slot: string): [string, string[]][] {
  const stage = slot.replace(/-[AB]$/, "");
  const node = "/usr/local/bin/node",
    npm = "/usr/local/bin/npm",
    input = "/opt/repolab/prospective-native";
  if (stage === "prepare")
    return [
      [
        "/bin/tar",
        [
          "-xzf",
          input + "/upstream.tar.gz",
          "--strip-components=1",
          "-C",
          "/opt/repolab/preact",
        ],
      ],
      [npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]],
      [npm, ["rebuild", "esbuild", "--no-audit", "--no-fund"]],
      ["/usr/bin/chromium", ["--version"]],
    ];
  if (stage === "build")
    return [
      [npm, ["run", "build"]],
      [
        "/bin/tar",
        [
          "-xzf",
          input + "/upstream.tar.gz",
          "--strip-components=1",
          "-C",
          "/opt/repolab/preact",
        ],
      ],
    ];
  if (stage === "mocha")
    return [
      [
        node,
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
      [npm, ["run", "test:ts"]],
    ];
  if (stage === "browser") return [[node, [input + "/karma.cjs"]]];
  if (stage === "lint") return [[npm, ["run", "lint"]]];
  if (stage === "reproduction")
    return [
      [
        "/usr/bin/chromium",
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--dump-dom",
          "file://" + input + "/reproduction.html",
        ],
      ],
    ];
  return [];
}
export const focusProfile: OriginalNativeProfile = {
  id: "prospective-preact-4316-v1",
  image: FOCUS_IMAGE,
  inputDirectory: "/opt/repolab/prospective-native",
  slots: focusSlots,
  savedSlots: focusSaved,
  uploads: focusUploads,
  audit: auditFocus,
  request: focusRequest,
  parse: parseFocusReceipt,
};

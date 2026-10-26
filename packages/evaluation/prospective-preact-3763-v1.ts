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
  "a33e4a28d8e484831418ff9bc5578f10a1ea72427bcda2fe1b4bc04e5f255b61";
export const FOCUS_TASK = "preactjs__preact-3763";
export const FOCUS_COMMIT = "e968a5a4000dfa9bec7e8d7b26543b23def6d29d";
export const FOCUS_IMAGE = "e7975706-7ec1-4eba-81a3-0ff69d04e94a";
export const FOCUS_ARCHIVE =
  "58878a19db0d6b5d8b265aee37fc542d0ff5ef77a8e5c7d4439c3e89682893ea";
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
export const focusTemporaryDirectories = [
  "/tmp/repolab-native-home", "/tmp/repolab-native-home/config",
  "/tmp/repolab-native-home/cache", "/tmp/repolab-native-npm-cache", "/tmp/repolab-native-out",
];
export function checkFocusTemporaryAccess(value:unknown) {
  const entries=z.array(z.object({path:z.string(),uid:z.literal(1000),gid:z.literal(1000),mode:z.literal("700"),writable:z.literal(true)}).strict()).parse(value);
  if(!isDeepStrictEqual(entries.map(e=>e.path),focusTemporaryDirectories))throw Error("Temporary access inventory changed");
  return entries;
}
export const focusUploads = [
  [
    "repositories/prospective-preact-3763-v1/original.tar.gz",
    "upstream.tar.gz",
  ],
  [
    "fixtures/prospective-preact-3763-v1/original-manifest.json",
    "manifest.json",
  ],
  ["repositories/prospective-preact-3763-v1/guest.cjs", "guest.cjs"],
  ["repositories/prospective-preact-3763-v1/karma.cjs", "karma.cjs"],
  [
    "repositories/prospective-preact-3763-v1/reproduction.html",
    "reproduction.html",
  ],
] as const;
export const focusAssets = [
  "packages/evaluation/prospective-preact-3763-v1.ts",
  "packages/execution/profiled-native-v1.ts",
  "apps/evaluator/prospective-preact-3763-v1.ts",
  "tests/prospective-preact-3763-v1.test.ts",
  "evaluation/PROSPECTIVE_PREACT_3763_V1.md",
  ...focusUploads.map((x) => x[0]),
  "repositories/prospective-preact-3763-v1/LICENSE",
  "fixtures/prospective-preact-3763-v1/commit.json",
  "fixtures/prospective-preact-3763-v1/canonical-tree.json",
  "evaluation/prospective-v1.json",
  "packages/repositories/repair-lease.ts",
  "packages/execution/recovery-lease-v1.ts",
  "packages/storage/reconciliation.ts",
  "packages/execution/nebius.ts",
  "evaluation/preact-native-v5.json",
  "fixtures/prospective-preact-3763-v1/node-inventory.json",
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
    readFileSync("fixtures/prospective-preact-3763-v1/commit.json", "utf8"),
  );
  const tree = JSON.parse(
    readFileSync(
      "fixtures/prospective-preact-3763-v1/canonical-tree.json",
      "utf8",
    ),
  );
  if (
    manifest.taskId !== FOCUS_TASK ||
    manifest.baseCommit !== FOCUS_COMMIT ||
    manifest.archiveSha256 !== FOCUS_ARCHIVE ||
    manifest.archiveBytes !== 755963 ||
    manifest.files.length !== 321 ||
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
    blobs.length !== 321 ||
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
    pkg.version !== "10.11.1" ||
    pkg.scripts.build !== "npm-run-all --parallel build:*" ||
    pkg.scripts.postbuild !==
      "node ./config/node-13-exports.js && node ./config/compat-entries.js" ||
    pkg.scripts["test:mocha"] !==
      'mocha --recursive --require "@babel/register" test/shared test/node' ||
    pkg.scripts["test:ts"] !== "run-p test:ts:*" ||
    pkg.scripts.lint !== "eslint src test debug compat hooks test-utils"
  )
    throw Error("Native script review changed");
  const inventory = JSON.parse(readFileSync("fixtures/prospective-preact-3763-v1/node-inventory.json","utf8"));
  const nodeFiles = manifest.files.filter((f:any)=>f.path.startsWith("test/shared/")||f.path.startsWith("test/node/"));
  if (inventory.taskId!==FOCUS_TASK || inventory.commit!==FOCUS_COMMIT || nodeFiles.length!==6 || !isDeepStrictEqual(nodeFiles,inventory.sourceFiles) || inventory.cases.length!==29)
    throw Error("Task-specific original Node source inventory changed");
  return {
    files: files.size,
    archiveBytes: 755963,
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
    readFileSync("evaluation/prospective-preact-3763-v1.json", "utf8"),
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
export const callbackRows = ["reported-sync-subscription", "single-update", "subscription-only", "serial-updates"] as const;
const State = z.object({ test:z.boolean(), data:z.string().nullable() }).strict();
const Callback = z.object({ label:z.enum(["before","subscription","after"]), state:State }).strict();
const Snapshot = z.object({ callbacks:z.array(Callback), state:State, text:z.string() }).strict();
export function checkCallbackObservations(value:unknown) {
  const o=z.object({
    subscriptionModel:z.literal("reviewed synchronous subscribe callback; no RxJS dependency or version supplied"),
    errors:z.array(z.string()).length(0),
    observations:z.array(z.object({name:z.enum(callbackRows), deliveries:z.array(z.string()), early:Snapshot,late:Snapshot,error:z.null()}).strict()).length(4),
  }).strict().parse(value);
  if(!isDeepStrictEqual(o.observations.map(r=>r.name),callbackRows))throw Error("Callback scenario inventory changed");
  const rows=o.observations;
  const expectedLabels=[["before"],["before"],["subscription"],["before","subscription","after"]];
  const expectedStates=[{test:true,data:"subscribed"},{test:true,data:null},{test:false,data:"subscribed"},{test:true,data:"subscribed"}];
  for(let i=0;i<rows.length;i++){
    const r=rows[i], state=expectedStates[i];
    if(!isDeepStrictEqual(r.early,r.late) || !isDeepStrictEqual(r.late.state,state) ||
       r.late.text!==JSON.stringify(state) || !isDeepStrictEqual(r.late.callbacks.map(c=>c.label),expectedLabels[i]) ||
       !isDeepStrictEqual(r.deliveries, i===1?[]:["subscribed"]))
      throw Error("Original callback report or control not reproduced");
    for(const c of r.late.callbacks){
      const expected=i===3&&c.label==="before"?{test:true,data:null}:state;
      if(!isDeepStrictEqual(c.state,expected))throw Error("Callback observed incorrect committed state");
    }
  }
  return o;
}
export function focusSuite(value: unknown, kind: "mocha" | "browser") {
  const result = nativeSuite(value, kind);
  if (kind === "mocha") {
    const expected=JSON.parse(readFileSync("fixtures/prospective-preact-3763-v1/node-inventory.json","utf8")).cases;
    if(!isDeepStrictEqual(result.cases,expected.map(({file,...c}:any)=>c).sort((a:any,b:any)=>a.id.localeCompare(b.id))))
      throw Error("Task-specific original Node case inventory changed");
    const raw=z.object({tests:z.array(z.object({fullTitle:z.string(),file:z.string()}))}).parse(value);
    if(raw.tests.some(c=>expected.find((e:any)=>e.id===c.fullTitle)?.file!==c.file.replace(/^\/opt\/repolab\/preact\//,"")))
      throw Error("Original Node case file binding changed");
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
  if(!["prepare","build"].includes(slot)) checkFocusTemporaryAccess(guest.temporaryDirectories);
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
        "src/diff/index.js",
        "test/browser/lifecycles/componentDidMount.test.js",
        "dist/preact.umd.js",
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
      guest.network !== "ENETUNREACH" ||
      !Array.isArray(guest.rootDenials) ||
      !isDeepStrictEqual(guest.rootDenials.map((d:any)=>d.path),["package.json","vite.config.js","repolab-attack.mjs"]) ||
      guest.rootDenials.some((d:any)=>!["EACCES","EPERM","EROFS","EEXIST"].includes(d.error))
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
    !checkCallbackObservations(guest.observations)
  )
    throw Error("Original callback report not reproduced with passing controls");
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
          "--virtual-time-budget=5000",
          "--dump-dom",
          "file://" + input + "/reproduction.html",
        ],
      ],
    ];
  return [];
}
export const focusProfile: OriginalNativeProfile = {
  id: "prospective-preact-3763-v1",
  image: FOCUS_IMAGE,
  inputDirectory: "/opt/repolab/prospective-native",
  slots: focusSlots,
  savedSlots: focusSaved,
  uploads: focusUploads,
  audit: auditFocus,
  request: focusRequest,
  parse: parseFocusReceipt,
};

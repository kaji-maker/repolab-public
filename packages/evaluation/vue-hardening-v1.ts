import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditVueNativeRun } from "../../apps/evaluator/vue-native-v4.ts";
import {
  vueNativeRequest,
  vueNativeObservations,
  VUE_NATIVE_ARCHIVE,
} from "./vue-native-v4.ts";

export const VUE_HARDENING_FREEZE: string =
  "7efa7265108b480020adff4cc6d111ae0cc65810637a186d775ba25b47adf797";
export const VUE_HARDENING_PARENT =
  "54c4f6933bdbd7460ca00934e91dde29748cc4325b5a4c0fffad36e635fb6570";
export const VUE_HARDENING_IMAGE = "76c9fd8c-ee94-4c79-87c9-ba0170316a2a";
export const vueHardeningSlots = [
  "harden",
  "integrity",
  "unit-A",
  "reproduction-A",
  "unit-B",
  "reproduction-B",
] as const;
export type VueHardeningSlot = (typeof vueHardeningSlots)[number];
export const vueHardeningAssets = [
  "packages/evaluation/vue-hardening-v1.ts",
  "packages/execution/vue-hardening-v1.ts",
  "apps/evaluator/vue-hardening-v1.ts",
  "repositories/vue-hardening-v1/guest.cjs",
  "repositories/vue-hardening-v1/run-unit.mjs",
  "tests/vue-hardening-v1.test.ts",
  "evaluation/VUE_HARDENING_V1.md",
  "packages/repositories/repair-lease.ts",
  "packages/execution/recovery-lease-v1.ts",
  "evaluation/vue-native-v4.json",
  "evaluation/vue-native-v4-results-summary.json",
  "fixtures/vue-native/baseline-identities-v1.json",
  "packages/storage/reconciliation.ts",
  "packages/execution/nebius.ts",
] as const;
export const vueHash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export function vueHardeningAssetBytes(path: string) {
  const b = readFileSync(path);
  return path === vueHardeningAssets[0]
    ? Buffer.from(
        b.toString().replace(VUE_HARDENING_FREEZE, "__VUE_HARDENING_FREEZE__"),
      )
    : b;
}
export function auditVueHardening() {
  if (VUE_HARDENING_FREEZE === "__UNFROZEN__")
    throw Error("Vue hardening is not frozen");
  const manifest = JSON.parse(
    readFileSync("evaluation/vue-hardening-v1.json", "utf8"),
  );
  const { digest, ...payload } = manifest;
  if (
    digest !== VUE_HARDENING_FREEZE ||
    vueHash(JSON.stringify(payload)) !== digest ||
    payload.parent !== VUE_HARDENING_PARENT ||
    payload.image !== VUE_HARDENING_IMAGE ||
    payload.modelAdmission !== false ||
    payload.inferenceCalls !== 0 ||
    !isDeepStrictEqual(payload.slots, vueHardeningSlots) ||
    payload.assets.length !== vueHardeningAssets.length ||
    payload.assets.some(
      (a: { path: string; sha256: string }, i: number) =>
        a.path !== vueHardeningAssets[i] ||
        a.sha256 !== vueHash(vueHardeningAssetBytes(a.path)),
    )
  )
    throw Error("Vue hardening freeze changed");
  const parent = auditVueNativeRun();
  if (
    parent.freeze !== VUE_HARDENING_PARENT ||
    parent.protectedImage !== VUE_HARDENING_IMAGE
  )
    throw Error("Vue original baseline binding changed");
  return manifest;
}
export function vueHardeningRequest(
  slot: VueHardeningSlot,
  image: string,
  files: Record<string, unknown> = {},
) {
  z.enum(vueHardeningSlots).parse(slot);
  z.uuid().parse(image);
  if (slot === "harden" && image !== VUE_HARDENING_IMAGE)
    throw Error("Original protected parent required");
  if (slot !== "harden" && Object.keys(files).length)
    throw Error("No later uploads");
  const base = vueNativeRequest("integrity", image);
  return {
    ...base,
    args: ["/opt/repolab/hardening/guest.cjs", slot.replace(/-[AB]$/, "")],
    uid: slot === "harden" ? 0 : 1000,
    gid: slot === "harden" ? 0 : 1000,
    disposable: slot !== "harden",
    networking: { enabled: false },
    files,
  };
}

const windowsSkip =
  "packages/compiler-sfc/__tests__/compileScript/resolveType.spec.ts:resolveType > external type imports > relative ts on Windows#1";
/** Full reporter data remains separate from normalized case counts. No upstream code executes here. */
export function checkedVueReporter(raw: unknown) {
  const assertion = z
    .object({
      title: z.string(),
      ancestorTitles: z.array(z.string()),
      status: z.enum([
        "passed",
        "failed",
        "pending",
        "skipped",
        "todo",
        "disabled",
      ]),
    })
    .passthrough();
  const r = z
    .object({
      success: z.literal(true),
      numTotalTests: z.number().int(),
      numPassedTests: z.number().int(),
      numFailedTests: z.literal(0),
      numPendingTests: z.number().int().nonnegative(),
      numTodoTests: z.number().int().nonnegative(),
      numFailedTestSuites: z.literal(0),
      testResults: z.array(
        z
          .object({
            name: z.string(),
            status: z.literal("passed"),
            assertionResults: z.array(assertion),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(raw);
  const cases: { id: string; status: string; skipped: boolean }[] = [];
  const names = new Set<string>();
  for (const f of r.testResults) {
    const prefix = "/opt/repolab/vue/";
    if (!f.name.startsWith(prefix))
      throw Error("Reporter path outside original tree");
    const rel = f.name.slice(prefix.length);
    if (
      !/^packages\/compiler-sfc\/__tests__\/[A-Za-z0-9_./-]+\.spec\.ts$/.test(
        rel,
      ) ||
      rel.split("/").includes("..") ||
      names.has(rel)
    )
      throw Error("Duplicate or invalid test file");
    names.add(rel);
    const seen = new Map<string, number>();
    for (const a of f.assertionResults) {
      const title = [
        ...a.ancestorTitles.filter((t) => t && t !== rel && t !== f.name),
        a.title,
      ].join(" > ");
      const key = rel + ":" + title,
        n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      cases.push({
        id: key + "#" + n,
        status: a.status,
        skipped: a.status !== "passed",
      });
    }
  }
  cases.sort((a, b) => a.id.localeCompare(b.id));
  const old = JSON.parse(
    readFileSync("fixtures/vue-native/baseline-identities-v1.json", "utf8"),
  ).unit;
  const expected = [
    ...old.cases.map((c: { id: string }) => ({
      id: c.id,
      status: "passed",
      skipped: false,
    })),
    { id: windowsSkip, status: "skipped", skipped: true },
  ].sort((a, b) => a.id.localeCompare(b.id));
  if (
    r.testResults.length !== 19 ||
    !isDeepStrictEqual(cases, expected) ||
    r.numTotalTests !== cases.length ||
    r.numPassedTests + r.numPendingTests + r.numTodoTests !== r.numTotalTests ||
    !(
      (r.numPassedTests === 412 &&
        r.numPendingTests === 1 &&
        r.numTodoTests === 0) ||
      (r.numPassedTests === 413 &&
        r.numPendingTests === 0 &&
        r.numTodoTests === 0)
    )
  )
    throw Error("Full original Vue test inventory or counters changed");
  return {
    suites: 19,
    total: cases.length,
    passed: 412,
    skipped: 1,
    caseDigest: vueHash(JSON.stringify(cases)),
    reporterCounters: {
      total: r.numTotalTests,
      passed: r.numPassedTests,
      pending: r.numPendingTests,
      todo: r.numTodoTests,
    },
    reporterCounterDiscrepancy: r.numPassedTests !== 412,
    cases,
  };
}

export function parseVueHardeningReceipt(
  raw: unknown,
  slot: VueHardeningSlot,
  id: string,
  image: string,
) {
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
            encoding: z.enum(["base64", "ascii", "utf-8", "utf8", "plain"]),
            truncated: z.literal(false),
          }),
          stderr: z.object({
            value: z.string(),
            encoding: z.enum(["base64", "ascii", "utf-8", "utf8", "plain"]),
            truncated: z.literal(false),
          }),
        }),
      }),
    })
    .passthrough()
    .parse(raw);
  const decode = (s: { value: string; encoding: string }) => {
    const bytes = Buffer.from(
      s.value,
      s.encoding === "base64" ? "base64" : "utf8",
    );
    if (bytes.length > 4194304) throw Error("Oversized guest output");
    return bytes.toString("utf8");
  };
  decode(op.metadata.result.stderr);
  const guest = JSON.parse(decode(op.metadata.result.stdout));
  const request = vueHardeningRequest(slot, image);
  if (
    guest.completed !== true ||
    guest.originalInputs !== true ||
    guest.runtimeVersion !== "v20.9.0" ||
    guest.stage !== slot.replace(/-[AB]$/, "") ||
    guest.uid !== request.uid ||
    guest.gid !== request.gid ||
    guest.sourceArchiveHash !== VUE_NATIVE_ARCHIVE ||
    !isDeepStrictEqual(guest.envKeys, Object.keys(request.env).sort()) ||
    guest.rootMode !== "555"
  )
    throw Error("Vue hardening environment or original identity changed");
  if (
    !/^[a-f0-9]{64}$/.test(guest.configSha256) ||
    (slot === "harden" && !op.result_image_uuid)
  )
    throw Error("Missing protected config/image");
  if (slot === "integrity") {
    const expected = [
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
      !Array.isArray(guest.rootDenials) ||
      !isDeepStrictEqual(
        guest.rootDenials.map((x: any) => x.path),
        expected,
      ) ||
      guest.rootDenials.some(
        (x: any) => !["EACCES", "EPERM", "EEXIST"].includes(x.error),
      ) ||
      !Array.isArray(guest.protectedDenials) ||
      guest.protectedDenials.length !== 3 ||
      !isDeepStrictEqual(
        guest.protectedDenials.map((x: any) => x.action),
        ["write-source", "unlink-test", "rename-tests"],
      ) ||
      guest.protectedDenials.some(
        (x: any) => !["EACCES", "EPERM"].includes(x.error),
      ) ||
      guest.network !== "ENETUNREACH"
    )
      throw Error("Vue writable-root boundary not qualified");
  }
  if (slot.startsWith("unit")) checkedVueReporter(guest.unitReport);
  if (slot.startsWith("reproduction"))
    vueNativeObservations(guest.observations);
  return { op, guest };
}

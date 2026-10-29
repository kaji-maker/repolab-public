import { readFileSync } from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { readRepositorySnapshot } from "../repositories/prepare.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import {
  readSandboxIsolation,
  sandboxReady,
  sandboxScope,
} from "../execution/readiness.ts";
import { checkPilotExecution } from "./github-pilot-v2.ts";
import { auditIntakeControls } from "./github-intake-controls.ts";
import { studyRemote } from "./study-execution.ts";
import type { StudyRemote, StudyRunSpec } from "./study-execution.ts";
import type { Execution } from "../contracts/index.ts";

export const frozenDsetQualificationDigest = "672ec185ecc02eb3b3060a101629aca4cfefdf5e7c0c30bdddc0d41233927154";
export const dsetQualificationAssets = [
  "packages/evaluation/dset-qualification.ts",
  "apps/evaluator/dset-qualification.ts",
  "repositories/dset-decimal.case.json",
  "fixtures/dset-upstream/original-snapshot.json",
  "fixtures/dset-upstream/dependency-lock.json",
  "repositories/dset-qualification/baseline-runner.mjs",
  "repositories/dset-qualification/observer.mjs",
  "evaluation/dset-decimal-cases.json",
  "tests/dset-qualification.test.ts",
  "evaluation/DSET_QUALIFICATION_V1.md",
] as const;
const previousDigest =
  "5753daaa466cee17f0c2c9576e75da1f5e1aafb8871c7fb75160c050d582c4ff";
export function dsetAssetBytes(path: string) {
  const bytes = readFileSync(path, "utf8");
  return path === dsetQualificationAssets[0]
    ? bytes.replace(
        /export const frozenDsetQualificationDigest =\s*"[a-f0-9]{64}";/,
        'export const frozenDsetQualificationDigest = "' +
          "0".repeat(64) +
          '";',
      )
    : bytes;
}
export function auditDsetQualification() {
  const p = z
    .strictObject({
      format: z.literal("repolab-dset-qualification/v1"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousDigest: z.literal(previousDigest),
      task: z.literal("dset-decimal-path"),
      scope: z.literal(
        "public-historical-qualification-no-model-repair-or-heldout-claim",
      ),
      maxInferenceCalls: z.literal(0),
      maxOperations: z.literal(7),
      assets: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(10),
    })
    .parse(
      JSON.parse(readFileSync("evaluation/dset-qualification-v1.json", "utf8")),
    );
  const { digest, ...payload } = p;
  if (
    digest !== frozenDsetQualificationDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditIntakeControls().digest !== previousDigest ||
    p.assets.some(
      (a, i) =>
        a.path !== dsetQualificationAssets[i] ||
        sha256(dsetAssetBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("Dset qualification freeze mismatch");
  return p;
}
export function dsetTask() {
  const s = readRepositorySnapshot(
    JSON.parse(
      readFileSync("fixtures/dset-upstream/original-snapshot.json", "utf8"),
    ),
  );
  if (
    s.digest !==
      "023e7ad48c59054c5e4f3c8ff2dd459e6fdee09e1e407c3e2562c56f5beab0f9" ||
    s.manifest.id !== "dset-decimal-path" ||
    s.manifest.commit !== "e836a01c07a439587a3d1f3c49cd002b750b8a90" ||
    JSON.stringify(s.manifest) !==
      JSON.stringify(
        JSON.parse(readFileSync("repositories/dset-decimal.case.json", "utf8")),
      )
  )
    throw Error("Dset original snapshot identity changed");
  const file = (path: string) => s.files.find((f) => f.path === path)!.content;
  return {
    snapshot: s,
    source: file("src/index.js"),
    test: file("test/index.js"),
    report: s.manifest.report,
  };
}
export function dsetCases() {
  return z
    .strictObject({
      format: z.literal("repolab-dset-qualification-cases/v1"),
      reportedId: z.literal("reported-fraction"),
      referenceBefore: z.literal("+keys[i + 1] > -1 ? [] : {}"),
      referenceAfter: z.string(),
      weakAfter: z.string(),
      expectationOrigin: z.string(),
      cases: z
        .array(
          z.strictObject({
            id: z.string(),
            object: z.record(z.string(), z.unknown()),
            path: z.union([z.string(), z.array(z.string())]),
            value: z.unknown(),
            observe: z.array(z.string()),
            expected: z.string(),
          }),
        )
        .length(16),
    })
    .parse(
      JSON.parse(readFileSync("evaluation/dset-decimal-cases.json", "utf8")),
    );
}
export type DsetVariant = "original" | "weak" | "reference";
export function dsetQualificationSource(variant: string) {
  if (!["original", "weak", "reference"].includes(variant))
    throw Error("Unreviewed qualification source");
  const source = dsetTask().source,
    c = dsetCases();
  if (variant === "original") return source;
  if (source.split(c.referenceBefore).length !== 2)
    throw Error("Reference expression not unique");
  return source.replace(
    c.referenceBefore,
    variant === "weak" ? c.weakAfter : c.referenceAfter,
  );
}
export function dsetBaselineSpec(variant: DsetVariant): StudyRunSpec {
  const t = dsetTask(),
    source = dsetQualificationSource(variant),
    root = "/tmp/repolab/dset";
  if (!source.startsWith("export default function ("))
    throw Error("Unexpected export adapter input");
  const files = t.snapshot.files.map((f) => ({
    path: root + "/" + f.path,
    content: f.path === "src/index.js" ? source : f.content,
  }));
  files.push(
    {
      path: root + "/dist/dset.js",
      content: "module.exports = " + source.slice("export default ".length),
    },
    {
      path: root + "/dependency-lock.json",
      content: readFileSync(
        "fixtures/dset-upstream/dependency-lock.json",
        "utf8",
      ),
    },
  );
  const inputs = Object.fromEntries(
    files.map((f) => [f.path, sha256(f.content)]),
  );
  files.push({
    path: "/opt/repolab/baseline-runner.mjs",
    content: readFileSync(
      "repositories/dset-qualification/baseline-runner.mjs",
      "utf8",
    ).replace("__INPUTS__", JSON.stringify(inputs)),
  });
  return {
    phase: "baseline",
    files,
    sourceHash: sha256(source),
    testHash: sha256(JSON.stringify(files)),
  };
}
export function dsetObservationSpec(
  variant: DsetVariant,
  scope: "report" | "all",
): StudyRunSpec {
  if (!["report", "all"].includes(scope)) throw Error("Unscheduled probes");
  const source = dsetQualificationSource(variant),
    c = dsetCases();
  const probes = (
    scope === "report" ? c.cases.filter((p) => p.id === c.reportedId) : c.cases
  ).map(({ id, object, path, value, observe }) => ({
    id,
    object,
    path,
    value,
    observe,
  }));
  const tests = readFileSync(
    "repositories/dset-qualification/observer.mjs",
    "utf8",
  ).replace("__PROBES__", JSON.stringify(probes));
  return {
    phase: "observations",
    sourceHash: sha256(source),
    testHash: sha256(tests),
    files: [
      { path: "/tmp/repolab/dset-module.mjs", content: source },
      { path: "/tmp/repolab/test.mjs", content: tests },
    ],
  };
}
export const dsetAssertions = [
  "exports a function",
  "does not return output",
  "mutates; adds simple key:val",
  "mutates; adds deeply nested key:val",
  "mutates; changes the value via array-type keys",
  "mutates; can create arrays via flag and when next key is numeric",
  "mutates; writes into/preserves existing object",
  "refuses to convert existing non-object value into object",
  "mutates; writes into existing object w/ array value",
  "silently preserves existing non-null value",
  "preserves existing value",
  "silently preserves `0` as existing non-null value",
  "preserves existing object values",
];
export function checkDsetTap(text: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const allowed = new Set([
    "TAP version 13",
    "# dset",
    "1..13",
    "# tests 13",
    "# pass  13",
    "# ok",
    ...dsetAssertions.map((a, i) => `ok ${i + 1} ${a}`),
  ]);
  if (
    lines.some((l) => !allowed.has(l)) ||
    lines.length !== allowed.size ||
    new Set(lines).size !== allowed.size ||
    lines[0] !== "TAP version 13" ||
    lines.at(-1) !== "# ok" ||
    JSON.stringify(lines.filter((l) => l.startsWith("ok "))) !==
      JSON.stringify(dsetAssertions.map((a, i) => `ok ${i + 1} ${a}`))
  )
    throw Error("Incomplete, failed or substituted upstream TAP");
  return { passed: true, assertionCount: 13 };
}
export function checkDsetBaseline(
  e: Execution,
  variant: DsetVariant,
  image: string,
) {
  const spec = dsetBaselineSpec(variant);
  checkPilotExecution(e, spec, image);
  const b = z
    .strictObject({
      protocol: z.literal("repolab-dset-upstream/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      adapter: z.literal(
        "exact-export-default-prefix-to-commonjs-assignment/v1",
      ),
      protectedInputs: z.literal(true),
      protectedDirectories: z.literal(true),
      dependencyCount: z.literal(173),
      tapeVersion: z.literal("4.17.0"),
      controls: z
        .array(z.strictObject({ name: z.string(), denied: z.literal(true) }))
        .length(9),
      before: z.record(z.string(), z.string()),
      after: z.record(z.string(), z.string()),
      child: z.strictObject({
        exitCode: z.literal(0),
        signal: z.null(),
        error: z.null(),
        stdout: z.string(),
        stderr: z.string(),
      }),
    })
    .parse(JSON.parse(e.stdout));
  const hashes = Object.fromEntries(
    spec.files.slice(0, -1).map((f) => [f.path, sha256(f.content)]),
  );
  const names = [
    "write-source",
    "write-test",
    "write-adapter",
    "write-metadata",
    "write-lock",
    "unlink-source",
    "rename-source",
    "chmod-source",
    "create-module",
  ];
  if (
    e.exitCode !== 0 ||
    JSON.stringify(b.before) !== JSON.stringify(hashes) ||
    JSON.stringify(b.after) !== JSON.stringify(hashes) ||
    JSON.stringify(b.controls.map((c) => c.name)) !== JSON.stringify(names)
  )
    throw Error("Baseline input or control integrity changed");
  return {
    ...checkDsetTap(b.child.stdout),
    filesystemDenials: 9,
    dependencyCount: 173,
    tapeVersion: "4.17.0",
  };
}
export function checkDsetObservations(
  e: Execution,
  variant: DsetVariant,
  scope: "report" | "all",
  image: string,
) {
  checkPilotExecution(e, dsetObservationSpec(variant, scope), image);
  const body = z
    .strictObject({
      protocol: z.literal("repolab-dset-observations/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      observations: z
        .array(
          z.union([
            z.strictObject({
              id: z.string(),
              status: z.literal("returned"),
              actual: z.string().max(16000),
            }),
            z.strictObject({ id: z.string(), status: z.literal("threw") }),
          ]),
        )
        .min(1)
        .max(16),
    })
    .parse(JSON.parse(e.stdout));
  const c = dsetCases(),
    probes =
      scope === "report"
        ? c.cases.filter((p) => p.id === c.reportedId)
        : c.cases;
  if (
    body.observations.length !== probes.length ||
    new Set(body.observations.map((o) => o.id)).size !== probes.length ||
    e.exitCode !== (body.observations.some((o) => o.status === "threw") ? 1 : 0)
  )
    throw Error("Incomplete or inconsistent observations");
  return probes.map((p) => {
    const o = body.observations.find((o) => o.id === p.id);
    if (!o) throw Error("Missing observation");
    return {
      id: p.id,
      status: o.status,
      actual: o.status === "returned" ? o.actual : null,
      expected: p.expected,
      passed: o.status === "returned" && o.actual === p.expected,
    };
  });
}
export const dsetSchedule = [
  { variant: "original", kind: "baseline" },
  { variant: "reference", kind: "baseline" },
  { variant: "original", kind: "report" },
  { variant: "original", kind: "report" },
  { variant: "original", kind: "all" },
  { variant: "weak", kind: "all" },
  { variant: "reference", kind: "all" },
] as const;
export function recomputeDsetQualification(r: any, allowSimulation = false) {
  const p = auditDsetQualification();
  if (
    r.format !== "repolab-dset-qualification-result/v1" ||
    r.studyDigest !== p.digest ||
    r.task !== p.task ||
    r.inferenceCalls !== 0 ||
    r.modelRepairRun !== false ||
    r.operationAttempts !== 7 ||
    r.checks.length !== 7 ||
    !z.uuid().safeParse(r.id).success ||
    !z.uuid().safeParse(r.image).success ||
    !Number.isFinite(Date.parse(r.completedAt)) ||
    !Number.isFinite(Date.parse(r.startedAt)) ||
    Date.parse(r.completedAt) < Date.parse(r.startedAt) ||
    r.provenance?.inference !== "none" ||
    (r.provenance.execution !== "nebius-sandbox" &&
      !(allowSimulation && r.provenance.execution === "simulation"))
  )
    throw Error("Qualification provenance or completion invalid");
  const operations = new Set(),
    ids = new Set();
  const checks = r.checks.map((saved: any, i: number) => {
    const planned = dsetSchedule[i];
    if (saved.variant !== planned.variant || saved.kind !== planned.kind)
      throw Error("Qualification schedule changed");
    const e = saved.execution;
    if (operations.has(e.operationId) || ids.has(e.id))
      throw Error("Qualification execution reused");
    operations.add(e.operationId);
    ids.add(e.id);
    return planned.kind === "baseline"
      ? checkDsetBaseline(e, planned.variant, r.image)
      : {
          rows: checkDsetObservations(
            e,
            planned.variant,
            planned.kind,
            r.image,
          ),
        };
  });
  const originalReport = checks[2].rows!,
    second = checks[3].rows!,
    original = checks[4].rows!,
    weak = checks[5].rows!,
    reference = checks[6].rows!;
  const first = originalReport[0],
    actual = first.status === "returned" ? JSON.parse(first.actual!) : null;
  const reportedActual = JSON.stringify({
    kind: "array",
    entries: [["10.2", { baz: "bar" }]],
    object: { foo: [] },
  });
  const qualified =
    JSON.stringify(originalReport) === JSON.stringify(second) &&
    first.actual === reportedActual &&
    actual?.kind === "array" &&
    !first.passed &&
    original.some((p: any) => !p.passed) &&
    weak[0].passed &&
    weak.some((p: any) => !p.passed) &&
    reference.every((p: any) => p.passed);
  return {
    qualified,
    reportedReproducedTwice: qualified,
    upstreamAssertions: 13,
    original: {
      passed: original.filter((p: any) => p.passed).length,
      total: 16,
    },
    weak: { passed: weak.filter((p: any) => p.passed).length, total: 16 },
    reference: {
      passed: reference.filter((p: any) => p.passed).length,
      total: 16,
    },
    uniqueOperations: operations.size,
    inferenceCalls: 0,
    modelRepairRun: false,
    provenance: r.provenance,
  };
}
export async function qualifyDset(options: {
  directory: string;
  config?: SandboxConfig;
  remote?: StudyRemote;
  signal?: AbortSignal;
}) {
  const p = auditDsetQualification(),
    config = options.config ?? sandboxConfigFromEnv(),
    id = randomUUID();
  const signal = options.signal ?? new AbortController().signal;
  if (!options.remote) {
    readSandboxIsolation(config);
    if (!sandboxReady(config))
      throw Error("Current sandbox readiness required");
  }
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const path = join(options.directory, "qualification.json");
  const record: any = {
    format: "repolab-dset-qualification-result/v1",
    id,
    studyDigest: p.digest,
    task: p.task,
    image: config.image,
    scope: sandboxScope(config),
    startedAt: new Date().toISOString(),
    status: "QUALIFYING",
    inferenceCalls: 0,
    modelRepairRun: false,
    operationAttempts: 0,
    qualified: false,
    checks: [],
    operations: [],
    provenance: {
      inference: "none",
      execution: options.remote ? "simulation" : "nebius-sandbox",
    },
  };
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  const persist = async () => {
    const temp = path + "." + randomUUID();
    await writeFile(temp, JSON.stringify(record, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path);
  };
  const run =
    options.remote ??
    studyRemote(config, async (op) => {
      record.operations.push(structuredClone(op));
      await persist();
    });
  const seen = new Set(),
    ids = new Set();
  try {
    for (const planned of dsetSchedule) {
      signal.throwIfAborted();
      if (record.operationAttempts >= p.maxOperations)
        throw Error("Qualification operation cap");
      record.operationAttempts++;
      await persist();
      const spec =
        planned.kind === "baseline"
          ? dsetBaselineSpec(planned.variant)
          : dsetObservationSpec(planned.variant, planned.kind);
      const e = (await run(config.image, spec, signal)).execution;
      record.checks.push({ ...planned, execution: e });
      await persist();
      checkPilotExecution(e, spec, config.image);
      if (seen.has(e.operationId) || ids.has(e.id))
        throw Error("Operation reused");
      seen.add(e.operationId);
      ids.add(e.id);
      if (planned.kind === "baseline")
        checkDsetBaseline(e, planned.variant, config.image);
      else
        checkDsetObservations(e, planned.variant, planned.kind, config.image);
    }
    record.completedAt = new Date().toISOString();
    record.summary = recomputeDsetQualification(record, !!options.remote);
    record.qualified = record.summary.qualified;
    record.status = record.qualified
      ? "QUALIFIED_FOR_FUTURE_STUDY"
      : "NOT_QUALIFIED";
  } catch {
    record.status = signal.aborted ? "CANCELLED" : "ERROR";
    record.error =
      "Qualification stopped; inspect retained execution evidence. No model repair or automatic retry.";
  } finally {
    record.completedAt = new Date().toISOString();
    await persist();
  }
  return { path, record };
}

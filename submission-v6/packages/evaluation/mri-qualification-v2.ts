import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { readRepositorySnapshot } from "../repositories/prepare.ts";
import { auditMriQualification as auditPreviousMriQualification } from "./mri-qualification.ts";
import { checkPilotExecution } from "./github-pilot-v2.ts";
import { runReviewedQualification } from "./reviewed-qualification.ts";
import type { ReviewedQualificationAdapter } from "./reviewed-qualification.ts";
import type { StudyRunSpec } from "./study-execution.ts";
import type { Execution } from "../contracts/index.ts";

export const frozenMriQualificationDigest = "ce6368a3aaa13b73ecf2152318e3d129ade6b1eeceb4c04fadcc276f88ce08b7";
export const mriQualificationAssets = [
  "packages/evaluation/mri-qualification-v2.ts",
  "packages/evaluation/reviewed-qualification.ts",
  "apps/evaluator/mri-qualification-v2.ts",
  "repositories/mri-zero.case.json",
  "fixtures/mri-upstream/original-snapshot.json",
  "fixtures/mri-upstream/dependency-lock.json",
  "repositories/mri-qualification/baseline-runner.mjs",
  "repositories/mri-qualification/observer.mjs",
  "evaluation/mri-zero-cases.json",
  "evaluation/mri-upstream-tap-v2.json",
  "tests/mri-qualification-v2.test.ts",
  "evaluation/MRI_QUALIFICATION_V2.md",
] as const;
const previousDigest =
  "3de889000dbc99bc9dfb745724f343dadfc294d2e2b9dc2b51fe2e263bc28485";
export function mriAssetBytes(path: string) {
  const bytes = readFileSync(path, "utf8");
  return path === mriQualificationAssets[0]
    ? bytes.replace(
        /export const frozenMriQualificationDigest =\s*"[a-f0-9]{64}";/,
        'export const frozenMriQualificationDigest = "' + "0".repeat(64) + '";',
      )
    : bytes;
}
export function auditMriQualification() {
  const p = z
    .strictObject({
      format: z.literal("repolab-mri-qualification/v2"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousDigest: z.literal(previousDigest),
      task: z.literal("mri-zero-number"),
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
        .length(12),
    })
    .parse(
      JSON.parse(readFileSync("evaluation/mri-qualification-v2.json", "utf8")),
    );
  const { digest, ...payload } = p;
  if (
    digest !== frozenMriQualificationDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditPreviousMriQualification().digest !== previousDigest ||
    p.assets.some(
      (a, i) =>
        a.path !== mriQualificationAssets[i] ||
        sha256(mriAssetBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("MRI qualification freeze mismatch");
  return p;
}
export function mriTask() {
  const s = readRepositorySnapshot(
    JSON.parse(
      readFileSync("fixtures/mri-upstream/original-snapshot.json", "utf8"),
    ),
  );
  if (
    s.digest !==
      "9187e232545b41260b0de85b979df74f60ab15f42a60ce1d90ec6143eb4ea08a" ||
    s.manifest.id !== "mri-zero-number" ||
    s.manifest.commit !== "22df50ca04e2e474765bb4e2ec1bf8a052db9ed9" ||
    JSON.stringify(s.manifest) !==
      JSON.stringify(
        JSON.parse(readFileSync("repositories/mri-zero.case.json", "utf8")),
      )
  )
    throw Error("MRI original snapshot identity changed");
  return {
    snapshot: s,
    source: s.files.find((f) => f.path === "lib/index.js")!.content,
    report: s.manifest.report,
  };
}
export function mriCases() {
  return z
    .strictObject({
      format: z.literal("repolab-mri-qualification-cases/v1"),
      reportedId: z.literal("reported-zero"),
      referenceBefore: z.literal("(!isBool(any) && Number(any)) || any"),
      referenceAfter: z.string(),
      weakAfter: z.string(),
      expectationOrigin: z.string(),
      cases: z
        .array(
          z.strictObject({
            id: z.string(),
            args: z.array(z.string()),
            options: z.record(z.string(), z.unknown()),
            expected: z.string(),
          }),
        )
        .length(22),
    })
    .parse(JSON.parse(readFileSync("evaluation/mri-zero-cases.json", "utf8")));
}
export type MriVariant = "original" | "weak" | "reference";
export function mriQualificationSource(variant: string) {
  if (!["original", "weak", "reference"].includes(variant))
    throw Error("Unreviewed qualification source");
  const source = mriTask().source,
    c = mriCases();
  if (variant === "original") return source;
  if (source.split(c.referenceBefore).length !== 2)
    throw Error("Reference expression not unique");
  return source.replace(
    c.referenceBefore,
    variant === "weak" ? c.weakAfter : c.referenceAfter,
  );
}
export function mriBaselineSpec(variant: MriVariant): StudyRunSpec {
  const source = mriQualificationSource(variant),
    root = "/tmp/repolab/mri";
  const files = mriTask().snapshot.files.map((f) => ({
    path: root + "/" + f.path,
    content: f.path === "lib/index.js" ? source : f.content,
  }));
  files.push({
    path: root + "/dependency-lock.json",
    content: readFileSync("fixtures/mri-upstream/dependency-lock.json", "utf8"),
  });
  const inputs = Object.fromEntries(
    files.map((f) => [f.path, sha256(f.content)]),
  );
  files.push({
    path: "/opt/repolab/baseline-runner.mjs",
    content: readFileSync(
      "repositories/mri-qualification/baseline-runner.mjs",
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
export function mriObservationSpec(
  variant: MriVariant,
  scope: "report" | "all",
): StudyRunSpec {
  if (!["report", "all"].includes(scope)) throw Error("Unscheduled probes");
  const source = mriQualificationSource(variant),
    c = mriCases();
  const probes = (
    scope === "report" ? c.cases.filter((p) => p.id === c.reportedId) : c.cases
  ).map(({ id, args, options }) => ({ id, args, options }));
  const tests = readFileSync(
    "repositories/mri-qualification/observer.mjs",
    "utf8",
  ).replace("__PROBES__", JSON.stringify(probes));
  return {
    phase: "observations",
    sourceHash: sha256(source),
    testHash: sha256(tests),
    files: [
      { path: "/tmp/repolab/mri-module.cjs", content: source },
      { path: "/tmp/repolab/test.mjs", content: tests },
    ],
  };
}
export function mriExpectedTap() {
  const t = z
    .strictObject({
      format: z.literal("repolab-mri-upstream-tap/v1"),
      derivation: z.string(),
      assertionCount: z.literal(49),
      testHashes: z
        .array(z.strictObject({ path: z.string(), sha256: z.string() }))
        .length(2),
      groups: z
        .array(
          z.strictObject({
            file: z.string(),
            name: z.string(),
            assertions: z.array(
              z.strictObject({ method: z.string(), message: z.string() }),
            ),
          }),
        )
        .length(15),
    })
    .parse(
      JSON.parse(readFileSync("evaluation/mri-upstream-tap-v2.json", "utf8")),
    );
  const original = mriTask()
    .snapshot.files.filter((f) => f.role === "baseline")
    .map(({ path, sha256 }) => ({ path, sha256 }));
  if (JSON.stringify(t.testHashes) !== JSON.stringify(original))
    throw Error("TAP identities from other tests");
  let count = 0;
  const lines = ["TAP version 13"];
  for (const group of t.groups) {
    lines.push("# " + group.name);
    for (const a of group.assertions) lines.push(`ok ${++count} ${a.message}`);
  }
  if (count !== t.assertionCount) throw Error("TAP assertion count mismatch");
  return [...lines, "1..49", "# tests 49", "# pass  49", "# ok"];
}
export function checkMriTap(text: string) {
  if (
    JSON.stringify(text.trim().split(/\r?\n/).filter(Boolean)) !==
    JSON.stringify(mriExpectedTap())
  )
    throw Error("Incomplete, failed or substituted upstream TAP");
  return { passed: true, assertionCount: 49, testFiles: 2 };
}
export function checkMriBaseline(
  e: Execution,
  variant: MriVariant,
  image: string,
) {
  const spec = mriBaselineSpec(variant);
  checkPilotExecution(e, spec, image);
  const b = z
    .strictObject({
      protocol: z.literal("repolab-mri-upstream/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      recipe: z.literal("original-commonjs-two-files-tape-cli/v1"),
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
    "write-unknown-test",
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
    ...checkMriTap(b.child.stdout),
    filesystemDenials: 9,
    dependencyCount: 173,
    tapeVersion: "4.17.0",
  };
}
export function checkMriObservations(
  e: Execution,
  variant: MriVariant,
  scope: "report" | "all",
  image: string,
) {
  checkPilotExecution(e, mriObservationSpec(variant, scope), image);
  const body = z
    .strictObject({
      protocol: z.literal("repolab-mri-observations/v1"),
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
        .max(22),
    })
    .parse(JSON.parse(e.stdout));
  const c = mriCases(),
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
export const mriSchedule = [
  { variant: "original", kind: "baseline" },
  { variant: "reference", kind: "baseline" },
  { variant: "original", kind: "report" },
  { variant: "original", kind: "report" },
  { variant: "original", kind: "all" },
  { variant: "weak", kind: "all" },
  { variant: "reference", kind: "all" },
] as const;
export function recomputeMriQualification(r: any, allowSimulation = false) {
  const p = auditMriQualification();
  if (
    r.format !== "repolab-mri-qualification-result/v2" ||
    r.studyDigest !== p.digest ||
    r.task !== p.task ||
    r.inferenceCalls !== 0 ||
    r.modelRepairRun !== false ||
    r.operationAttempts !== 7 ||
    r.checks.length !== 7 ||
    !z.uuid().safeParse(r.id).success ||
    !z.uuid().safeParse(r.image).success ||
    !z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .safeParse(r.scope).success ||
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
    const planned = mriSchedule[i];
    if (saved.variant !== planned.variant || saved.kind !== planned.kind)
      throw Error("Qualification schedule changed");
    const e = saved.execution;
    if (operations.has(e.operationId) || ids.has(e.id))
      throw Error("Qualification execution reused");
    operations.add(e.operationId);
    ids.add(e.id);
    return planned.kind === "baseline"
      ? checkMriBaseline(e, planned.variant, r.image)
      : {
          rows: checkMriObservations(e, planned.variant, planned.kind, r.image),
        };
  });
  const first = checks[2].rows!,
    second = checks[3].rows!,
    original = checks[4].rows!,
    weak = checks[5].rows!,
    reference = checks[6].rows!;
  const qualified =
    JSON.stringify(first) === JSON.stringify(second) &&
    first[0].status === "returned" &&
    first[0].actual === JSON.stringify({ _: [], bar: "0" }) &&
    !first[0].passed &&
    original.some((p: any) => !p.passed) &&
    weak[0].passed &&
    weak.some((p: any) => !p.passed) &&
    reference.every((p: any) => p.passed);
  return {
    qualified,
    reportedReproducedTwice: qualified,
    upstreamAssertions: 49,
    testFiles: 2,
    original: {
      passed: original.filter((p: any) => p.passed).length,
      total: 22,
    },
    weak: { passed: weak.filter((p: any) => p.passed).length, total: 22 },
    reference: {
      passed: reference.filter((p: any) => p.passed).length,
      total: 22,
    },
    uniqueOperations: operations.size,
    inferenceCalls: 0,
    modelRepairRun: false,
    provenance: r.provenance,
  };
}
const adapter: ReviewedQualificationAdapter = {
  format: "repolab-mri-qualification-result/v2",
  freeze: auditMriQualification,
  schedule: mriSchedule,
  spec(step) {
    const s = mriSchedule.find(
      (s) => s.variant === step.variant && s.kind === step.kind,
    );
    if (!s) throw Error("Unscheduled qualification step");
    return s.kind === "baseline"
      ? mriBaselineSpec(s.variant)
      : mriObservationSpec(s.variant, s.kind);
  },
  validate(e, step, image) {
    const s = mriSchedule.find(
      (s) => s.variant === step.variant && s.kind === step.kind,
    );
    if (!s) throw Error("Unscheduled qualification step");
    return s.kind === "baseline"
      ? checkMriBaseline(e, s.variant, image)
      : checkMriObservations(e, s.variant, s.kind, image);
  },
  recompute: recomputeMriQualification,
};
export function qualifyMri(
  options: Parameters<typeof runReviewedQualification>[1],
) {
  return runReviewedQualification(adapter, options);
}

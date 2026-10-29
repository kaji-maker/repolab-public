import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import type { Execution } from "../contracts/index.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import { auditMriQualification } from "./mri-qualification-v3.ts";
import { checkPilotExecution } from "./github-pilot-v2.ts";
import { runReviewedQualification } from "./reviewed-qualification.ts";
import type { ReviewedQualificationAdapter } from "./reviewed-qualification.ts";
import type { StudyRemote, StudyRunSpec } from "./study-execution.ts";

export const frozenUnrunControlsDigest = "c98680cfa17ea2d0c5ac5fa2bbd0b73a72c57291878136636cdce1127b06954f";
export const unrunControlAssets = [
  "packages/evaluation/unrun-controls.ts",
  "apps/evaluator/unrun-controls.ts",
  "fixtures/unrun-controls/shipping-fee.cjs",
  "fixtures/unrun-controls/refund-amount.cjs",
  "fixtures/unrun-controls/shipping-policy.json",
  "evaluation/unrun-controls-cases.json",
  "repositories/unrun-controls/observer.mjs",
  "tests/unrun-controls.test.ts",
  "evaluation/UNRUN_CONTROLS_V1.md",
] as const;
const previousDigest =
  "e82113c0c208fd7aa61a12ddba304cbfe1bf75fda1b39db574259ba37609f05c";
export function unrunControlAssetBytes(path: string) {
  const bytes = readFileSync(path, "utf8");
  return path === unrunControlAssets[0]
    ? bytes.replace(
        /export const frozenUnrunControlsDigest =\s*"[a-f0-9]{64}";/,
        'export const frozenUnrunControlsDigest = "' + "0".repeat(64) + '";',
      )
    : bytes;
}
export function auditUnrunControls() {
  const p = z
    .strictObject({
      format: z.literal("repolab-unrun-controls/v1"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousDigest: z.literal(previousDigest),
      scope: z.literal(
        "authored-model-unrun-controls-no-external-heldout-claim",
      ),
      maxInferenceCalls: z.literal(0),
      maxOperations: z.literal(4),
      tasks: z.tuple([
        z.literal("refund-missing-facts"),
        z.literal("shipping-already-correct"),
      ]),
      assets: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(9),
    })
    .parse(
      JSON.parse(readFileSync("evaluation/unrun-controls-v1.json", "utf8")),
    );
  const { digest, ...payload } = p;
  if (
    digest !== frozenUnrunControlsDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditMriQualification().digest !== previousDigest ||
    p.assets.some(
      (a, i) =>
        a.path !== unrunControlAssets[i] ||
        sha256(unrunControlAssetBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("Unrun control freeze mismatch");
  return p;
}

const scalar = z.union([
  z.number().int().min(0).max(1000000),
  z.string().min(1).max(80),
]);
const reportSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(4000)
    .refine((s) => !s.includes("\0")),
  facts: z.strictObject({
    args: z.array(scalar).length(2).optional(),
    actual: z.number().int().min(0).max(1000000).optional(),
    expected: z.number().int().min(0).max(1000000).optional(),
    currency: z.literal("USD").optional(),
    policy: z.string().min(1).max(80).optional(),
  }),
});
const probeSchema = z.strictObject({
  id: z.string().min(1).max(80),
  args: z.tuple([
    z.number().int().min(0).max(1000000),
    z.enum(["local", "remote"]),
  ]),
  expected: z.enum(["0", "250", "500", "1000"]),
});
export function unrunControlCases() {
  const taskSchema = z.strictObject({
    id: z.enum(["shipping-already-correct", "refund-missing-facts"]),
    kind: z.enum(["already-correct", "missing-facts"]),
    source: z.string(),
    report: reportSchema,
    requiredFacts: z.tuple([
      z.literal("args"),
      z.literal("actual"),
      z.literal("expected"),
      z.literal("currency"),
      z.literal("policy"),
    ]),
  });
  const c = z
    .strictObject({
      format: z.literal("repolab-unrun-controls-cases/v1"),
      origin: z.string(),
      tasks: z.tuple([taskSchema, taskSchema]),
      shippingBaseline: z.array(probeSchema).length(6),
      shippingControls: z.array(probeSchema).length(12),
    })
    .parse(
      JSON.parse(readFileSync("evaluation/unrun-controls-cases.json", "utf8")),
    );
  if (
    c.tasks[0].id !== "shipping-already-correct" ||
    c.tasks[0].kind !== "already-correct" ||
    c.tasks[0].source !== unrunControlAssets[2] ||
    c.tasks[1].id !== "refund-missing-facts" ||
    c.tasks[1].kind !== "missing-facts" ||
    c.tasks[1].source !== unrunControlAssets[3] ||
    new Set([...c.shippingBaseline, ...c.shippingControls].map((x) => x.id))
      .size !== 18
  )
    throw Error("Control case identity or baseline changed");
  return c;
}
export function assessUnrunControlReport(name: string, report: unknown) {
  const task = unrunControlCases().tasks.find((t) => t.id === name);
  if (!task) throw Error("Unsupported control task");
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success)
    return {
      status: "INVALID_REPORT" as const,
      missing: [] as string[],
      question: null,
    };
  const missing = task.requiredFacts.filter(
    (k) => parsed.data.facts[k] === undefined,
  );
  if (missing.length)
    return {
      status: "NEEDS_FACTS" as const,
      missing,
      question:
        "Provide " +
        missing.join(", ") +
        " for one concrete minor-unit example; identify the policy before changing amounts.",
    };
  if (
    name !== "shipping-already-correct" ||
    JSON.stringify(parsed.data) !== JSON.stringify(task.report)
  )
    return {
      status: "UNSUPPORTED_REPORT" as const,
      missing: [] as string[],
      question: null,
    };
  return { status: "READY" as const, missing: [] as string[], question: null };
}

export type UnrunControlScope = "baseline" | "report" | "controls";
export const unrunControlSchedule = [
  { variant: "original", kind: "baseline" },
  { variant: "original", kind: "report" },
  { variant: "original", kind: "report" },
  { variant: "original", kind: "controls" },
] as const;
export const unrunFilesystemControls = [
  "write-source",
  "write-observer",
  "write-policy",
  "unlink-source",
  "rename-source",
  "chmod-source",
  "create-module",
  "unlink-observer",
  "chmod-observer",
] as const;
export function unrunControlProbes(scope: UnrunControlScope) {
  const c = unrunControlCases();
  if (scope === "baseline") return c.shippingBaseline;
  if (scope === "controls") return c.shippingControls;
  if (scope === "report")
    return [
      {
        id: "reported-free-shipping",
        args: c.tasks[0].report.facts.args!,
        expected: JSON.stringify(c.tasks[0].report.facts.expected),
      },
    ];
  throw Error("Unsupported control observation scope");
}
export function unrunControlSpec(scope: UnrunControlScope): StudyRunSpec {
  const source = readFileSync(unrunControlAssets[2], "utf8"),
    policy = readFileSync(unrunControlAssets[4], "utf8");
  const files = [
    { path: "/tmp/repolab/control-source.cjs", content: source },
    { path: "/tmp/repolab/control-policy.json", content: policy },
  ];
  const hashes = Object.fromEntries(
    files.map((f) => [f.path, sha256(f.content)]),
  );
  const template = readFileSync(unrunControlAssets[6], "utf8");
  if (
    template.split("__INPUTS__").length !== 2 ||
    template.split("__PROBES__").length !== 2
  )
    throw Error("Observer placeholder changed");
  const observer = template
    .replace("__INPUTS__", JSON.stringify(hashes))
    .replace(
      "__PROBES__",
      JSON.stringify(
        unrunControlProbes(scope).map(({ id, args }) => ({ id, args })),
      ),
    );
  return {
    phase: "observations",
    sourceHash: sha256(source),
    testHash: sha256(observer),
    files: [...files, { path: "/tmp/repolab/test.mjs", content: observer }],
  };
}
export function checkUnrunControlObservation(
  e: Execution,
  scope: UnrunControlScope,
  image: string,
) {
  const spec = unrunControlSpec(scope);
  checkPilotExecution(e, spec, image);
  const hashMap = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/));
  const body = z
    .strictObject({
      protocol: z.literal("repolab-unrun-control-observations/v1"),
      runtimeVersion: z.literal("v24.18.0"),
      uid: z.literal(1000),
      protectedFiles: z.literal(true),
      protectedDirectory: z.literal(true),
      before: hashMap,
      after: hashMap,
      controls: z
        .array(z.strictObject({ name: z.string(), denied: z.literal(true) }))
        .length(9),
      observations: z
        .array(
          z.union([
            z.strictObject({
              id: z.string(),
              status: z.literal("returned"),
              actual: z.string().max(1000),
            }),
            z.strictObject({ id: z.string(), status: z.literal("threw") }),
          ]),
        )
        .min(1)
        .max(12),
    })
    .parse(JSON.parse(e.stdout));
  const hashes = Object.fromEntries(
    spec.files.slice(0, 2).map((f) => [f.path, sha256(f.content)]),
  );
  if (
    JSON.stringify(body.before) !== JSON.stringify(hashes) ||
    JSON.stringify(body.after) !== JSON.stringify(hashes) ||
    body.controls.some((c, i) => c.name !== unrunFilesystemControls[i])
  )
    throw Error("Control input hashes or filesystem denials changed");
  const probes = unrunControlProbes(scope);
  if (
    body.observations.length !== probes.length ||
    new Set(body.observations.map((o) => o.id)).size !== probes.length ||
    e.exitCode !== (body.observations.some((o) => o.status === "threw") ? 1 : 0)
  )
    throw Error("Incomplete or inconsistent control observations");
  return probes.map((p) => {
    const o = body.observations.find((o) => o.id === p.id);
    if (!o) throw Error("Missing control observation");
    return {
      id: p.id,
      status: o.status,
      actual: o.status === "returned" ? o.actual : null,
      expected: p.expected,
      passed: o.status === "returned" && o.actual === p.expected,
    };
  });
}
export function recomputeAlreadyCorrectControl(
  r: any,
  allowSimulation = false,
) {
  const p = auditUnrunControls();
  if (
    r.format !== "repolab-unrun-already-correct-result/v1" ||
    r.studyDigest !== p.digest ||
    r.task !== "shipping-already-correct" ||
    r.inferenceCalls !== 0 ||
    r.modelRepairRun !== false ||
    r.operationAttempts !== 4 ||
    r.checks?.length !== 4 ||
    !z.uuid().safeParse(r.id).success ||
    !z.uuid().safeParse(r.image).success ||
    !z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .safeParse(r.scope).success ||
    !Number.isFinite(Date.parse(r.startedAt)) ||
    !Number.isFinite(Date.parse(r.completedAt)) ||
    Date.parse(r.completedAt) < Date.parse(r.startedAt) ||
    r.provenance?.inference !== "none" ||
    (r.provenance.execution !== "nebius-sandbox" &&
      !(allowSimulation && r.provenance.execution === "simulation"))
  )
    throw Error("Control completion or provenance invalid");
  const ids = new Set(),
    operations = new Set();
  const rows = r.checks.map((c: any, i: number) => {
    const step = unrunControlSchedule[i];
    if (
      c.variant !== step.variant ||
      c.kind !== step.kind ||
      ids.has(c.execution.id) ||
      operations.has(c.execution.operationId)
    )
      throw Error("Control schedule or fresh identity changed");
    ids.add(c.execution.id);
    operations.add(c.execution.operationId);
    return checkUnrunControlObservation(c.execution, step.kind, r.image);
  });
  const qualified =
    JSON.stringify(rows[1]) === JSON.stringify(rows[2]) &&
    rows.every((row: any[]) => row.every((x) => x.passed));
  return {
    qualified,
    task: r.task,
    decision: qualified ? "ALREADY_SATISFIED_FOR_REPORT" : "NOT_QUALIFIED",
    baseline: { passed: rows[0].filter((x: any) => x.passed).length, total: 6 },
    reportSatisfiedTwice: qualified,
    controls: {
      passed: rows[3].filter((x: any) => x.passed).length,
      total: 12,
    },
    uniqueOperations: operations.size,
    inferenceCalls: 0,
    modelRepairRun: false,
    repairAdmission: false,
    provenance: r.provenance,
  };
}
const alreadyCorrectAdapter: ReviewedQualificationAdapter = {
  freeze: () => ({ ...auditUnrunControls(), task: "shipping-already-correct" }),
  format: "repolab-unrun-already-correct-result/v1",
  schedule: unrunControlSchedule,
  spec: (step) => {
    if (
      step.variant !== "original" ||
      !unrunControlSchedule.some((s) => s.kind === step.kind)
    )
      throw Error("Unsupported control source or scope");
    return unrunControlSpec(step.kind as UnrunControlScope);
  },
  validate: (e, step, image) =>
    checkUnrunControlObservation(e, step.kind as UnrunControlScope, image),
  recompute: recomputeAlreadyCorrectControl,
};
export async function qualifyAlreadyCorrectControl(options: {
  directory: string;
  config?: SandboxConfig;
  remote?: StudyRemote;
  signal?: AbortSignal;
}) {
  if (
    assessUnrunControlReport(
      "shipping-already-correct",
      unrunControlCases().tasks[0].report,
    ).status !== "READY"
  )
    throw Error("Control report is not ready");
  return runReviewedQualification(alreadyCorrectAdapter, options);
}
export async function qualifyMissingFactsControl(options: {
  directory: string;
  signal?: AbortSignal;
}) {
  const p = auditUnrunControls(),
    task = unrunControlCases().tasks[1],
    at = new Date().toISOString();
  const assessment = assessUnrunControlReport(task.id, task.report);
  const record = {
    format: "repolab-unrun-missing-facts-result/v1",
    id: randomUUID(),
    studyDigest: p.digest,
    task: task.id,
    sourceHash: sha256(readFileSync(task.source, "utf8")),
    report: task.report,
    assessment,
    status: options.signal?.aborted ? "CANCELLED" : assessment.status,
    startedAt: at,
    completedAt: new Date().toISOString(),
    operationAttempts: 0,
    operations: [],
    checks: [],
    inferenceCalls: 0,
    modelRepairRun: false,
    repairAdmission: false,
    provenance: { inference: "none", execution: "none" },
  };
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const path = join(options.directory, "missing-facts.json");
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return { path, record };
}
export function recomputeMissingFactsControl(input: unknown) {
  const p = auditUnrunControls(),
    task = unrunControlCases().tasks[1];
  const r = z
    .strictObject({
      format: z.literal("repolab-unrun-missing-facts-result/v1"),
      id: z.uuid(),
      studyDigest: z.literal(p.digest),
      task: z.literal("refund-missing-facts"),
    sourceHash: z.literal(sha256(readFileSync(task.source, "utf8"))),
      report: reportSchema,
      assessment: z.strictObject({
        status: z.literal("NEEDS_FACTS"),
        missing: z.array(z.string()),
        question: z.string(),
      }),
      status: z.enum(["NEEDS_FACTS", "CANCELLED"]),
      startedAt: z.string().datetime(),
      completedAt: z.string().datetime(),
      operationAttempts: z.literal(0),
      operations: z.array(z.never()).length(0),
      checks: z.array(z.never()).length(0),
      inferenceCalls: z.literal(0),
      modelRepairRun: z.literal(false),
      repairAdmission: z.literal(false),
      provenance: z.strictObject({
        inference: z.literal("none"),
        execution: z.literal("none"),
      }),
    })
    .parse(input);
  if (
    JSON.stringify(r.report) !== JSON.stringify(task.report) ||
    JSON.stringify(r.assessment) !==
      JSON.stringify(assessUnrunControlReport(task.id, task.report)) ||
    Date.parse(r.completedAt) < Date.parse(r.startedAt)
  )
    throw Error("Missing-facts report or assessment changed");
  return {
    qualified: r.status === "NEEDS_FACTS",
    task: r.task,
    decision: r.status,
    missing: r.assessment.missing,
    question: r.assessment.question,
    uniqueOperations: 0,
    inferenceCalls: 0,
    modelRepairRun: false,
    repairAdmission: false,
    provenance: r.provenance,
  };
}
export function recomputeUnrunControls(
  missing: unknown,
  already: any,
  allowSimulation = false,
) {
  const first = recomputeMissingFactsControl(missing),
    second = recomputeAlreadyCorrectControl(already, allowSimulation);
  if (
    second.qualified !== already.qualified ||
    JSON.stringify(second) !== JSON.stringify(already.summary) ||
    already.status !==
      (second.qualified ? "QUALIFIED_FOR_FUTURE_STUDY" : "NOT_QUALIFIED")
  )
    throw Error("Saved control decision differs from raw evidence");
  return {
    format: "repolab-unrun-controls-summary/v1",
    digest: auditUnrunControls().digest,
    qualified: first.qualified && second.qualified,
    tasks: [first, second],
    inferenceCalls: 0,
    modelRepairRun: false,
    uniqueOperations: second.uniqueOperations,
    repairAdmission: false,
  };
}

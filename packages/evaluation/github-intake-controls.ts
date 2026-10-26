import { readFileSync } from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import {
  readSandboxIsolation,
  sandboxReady,
  sandboxScope,
} from "../execution/readiness.ts";
import { studyRemote } from "./study-execution.ts";
import type { StudyRemote } from "./study-execution.ts";
import type { Execution } from "../contracts/index.ts";
import {
  auditGitHubPilot,
  pilotTask,
  applyPilotPatch,
  groundPilotContract,
  baselinePilotSpec,
  observationPilotSpec,
  checkPilotBaseline,
  checkPilotObservation,
  checkPilotExecution,
  pilotCore,
  pilotControls,
} from "./github-pilot-v2.ts";

export const frozenIntakeControlsDigest = "5753daaa466cee17f0c2c9576e75da1f5e1aafb8871c7fb75160c050d582c4ff";
export const intakeControlAssets = [
  "packages/evaluation/github-intake-controls.ts",
  "apps/evaluator/github-intake-controls.ts",
  "fixtures/dlv-upstream/verified-repair-control.json",
  "tests/github-intake-controls.test.ts",
  "evaluation/GITHUB_INTAKE_CONTROLS_V1.md",
] as const;
export function intakeAssetBytes(path: string) {
  const bytes = readFileSync(path, "utf8");
  return path === intakeControlAssets[0]
    ? bytes.replace(
        /export const frozenIntakeControlsDigest =\s*"[a-f0-9]{64}";/,
        'export const frozenIntakeControlsDigest = "' + "0".repeat(64) + '";',
      )
    : bytes;
}
export function auditIntakeControls() {
  const manifest = z
    .strictObject({
      format: z.literal("repolab-github-intake-controls/v1"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      previousPilotDigest: z.literal(
        "548b6a12599f09b280458c0f7d0e73874dd3c657b9ac5f02ab4ec382158ba632",
      ),
      scope: z.literal(
        "exposed-development-preconditions-no-new-bug-or-heldout-claim",
      ),
      maxInferenceCalls: z.literal(0),
      maxOperationsPerCase: z.literal(4),
      maxOperations: z.literal(8),
      schedule: z.tuple([
        z.literal("missing-facts"),
        z.literal("already-satisfied"),
        z.literal("bug-positive"),
      ]),
      assets: z
        .array(
          z.strictObject({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .length(5),
    })
    .parse(
      JSON.parse(
        readFileSync("evaluation/github-intake-controls-v1.json", "utf8"),
      ),
    );
  const { digest, ...payload } = manifest;
  if (
    digest !== frozenIntakeControlsDigest ||
    sha256(JSON.stringify(payload)) !== digest ||
    auditGitHubPilot().digest !== manifest.previousPilotDigest ||
    manifest.assets.some(
      (a, i) =>
        a.path !== intakeControlAssets[i] ||
        sha256(intakeAssetBytes(a.path)) !== a.sha256,
    )
  )
    throw Error("Intake control freeze mismatch");
  return manifest;
}
/** This adapter admits the documented fixed dlv report, not arbitrary GitHub reports. */
export function assessDlvReport(report: unknown) {
  if (
    typeof report !== "string" ||
    !report.length ||
    Buffer.byteLength(report) > 8000 ||
    report.includes("\0")
  )
    return {
      status: "INVALID_REPORT" as const,
      missing: [] as string[],
      question: null,
    };
  const stringValue = '"(?:\\\\.|[^"\\\\])*"';
  const scalar = "(?:" + stringValue + "|null|true|false|-?[0-9]+)";
  const fields = {
    object: /Given object (\{[^\n]+\})(?=,|$)/,
    key: new RegExp(
      "(?:,|^)\\s*key (" + stringValue + "|\\[[^\\n]+\\])(?=,|\\.|$)",
    ),
    default: new RegExp("(?:,|^)\\s*and default (" + scalar + ")(?=,|\\.|$)"),
    actual: new RegExp("dlv returns (" + scalar + ")(?= but|\\.|$)"),
    expected: new RegExp("but must return (" + scalar + ")(?= because|\\.|$)"),
  };
  const missing = Object.entries(fields)
    .filter(([, pattern]) => !pattern.test(report))
    .map(([name]) => name);
  if (missing.length)
    return {
      status: "NEEDS_FACTS" as const,
      missing,
      question:
        "Provide the missing " +
        missing.join(", ") +
        " for one concrete lookup example.",
    };
  const canonical = pilotTask().report.match(
    /Given object .*?because the complete path does not exist\./,
  )![0];
  if (
    report.split(canonical).length !== 2 ||
    (report.match(/Given object /g) ?? []).length !== 1
  )
    return {
      status: "UNSUPPORTED_REPORT" as const,
      missing: [] as string[],
      question: null,
    };
  try {
    // Values come from explicit report text; the existing closed schema validates their identity.
    const parsed = Object.fromEntries(
      Object.entries(fields).map(([name, pattern]) => [
        name,
        JSON.parse(report.match(pattern)![1]),
      ]),
    );
    const contract = groundPilotContract(
      {
        format: "repolab-dlv-grounded-contract/v1",
        object: parsed.object,
        key: parsed.key,
        defaultValue: parsed.default,
        expected: parsed.expected,
        sourceQuote: canonical,
      },
      report,
    );
    if (parsed.actual !== null)
      throw Error("Actual behavior outside report scope");
    return {
      status: "READY" as const,
      missing: [] as string[],
      question: null,
      contract,
    };
  } catch {
    return {
      status: "UNSUPPORTED_REPORT" as const,
      missing: [] as string[],
      question: null,
    };
  }
}
export function admitVerifiedControl(input: unknown) {
  const c = z
    .strictObject({
      format: z.literal("repolab-dlv-verified-source-control/v1"),
      originRunId: z.literal("ecfcbb24-5f23-4eda-aa5d-846c0d6b6e3b"),
      originStudyDigest: z.literal(
        "548b6a12599f09b280458c0f7d0e73874dd3c657b9ac5f02ab4ec382158ba632",
      ),
      sourceHash: z.literal(
        "c30fc8a504bb7d4fdbd7911bb9880d377691578fef069b9bd71ba89c407e7a3f",
      ),
      source: z.string().max(16000),
      patch: z.unknown(),
      sourceOrigin: z.string(),
      scope: z.string(),
    })
    .parse(input);
  const exact = applyPilotPatch(c.patch);
  if (
    exact.source !== c.source ||
    exact.sourceHash !== c.sourceHash ||
    sha256(c.source) !== c.sourceHash
  )
    throw Error("Control source or model-edit correspondence changed");
  return c;
}
export function intakeControlCase(name: string) {
  const subject = name === "already-satisfied" ? "verified-repair" : "original";
  if (!["missing-facts", "already-satisfied", "bug-positive"].includes(name))
    throw Error("Unscheduled control");
  return {
    name,
    subject,
    report:
      name === "missing-facts"
        ? "A nested lookup returns null instead of the value I want."
        : pilotTask().report,
    expectedStatus:
      name === "missing-facts"
        ? "NEEDS_FACTS"
        : name === "already-satisfied"
          ? "ALREADY_SATISFIED_FOR_REPORT"
          : "REPRODUCED",
  };
}
export function intakeSubject(subject: string) {
  if (subject === "original")
    return {
      source: pilotTask().source,
      sourceOrigin: "pinned upstream original",
      originRunId: null,
    };
  if (subject !== "verified-repair") throw Error("Unreviewed source subject");
  const c = admitVerifiedControl(
    JSON.parse(
      readFileSync(
        "fixtures/dlv-upstream/verified-repair-control.json",
        "utf8",
      ),
    ),
  );
  return {
    source: c.source,
    sourceOrigin: c.sourceOrigin,
    originRunId: c.originRunId,
  };
}
interface Options {
  directory: string;
  config?: SandboxConfig;
  remote?: StudyRemote;
  signal?: AbortSignal;
  seenOperations?: Set<string>;
  seenExecutions?: Set<string>;
  budget?: { attempts: number };
}
export async function checkDlvIntake(name: string, options: Options) {
  const protocol = auditIntakeControls(),
    input = intakeControlCase(name);
  const assessed = assessDlvReport(input.report),
    id = randomUUID(),
    path = join(options.directory, name + ".json");
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const record: any = {
    format: "repolab-dlv-intake-check/v1",
    id,
    studyDigest: protocol.digest,
    name,
    subject: input.subject,
    report: input.report,
    startedAt: new Date().toISOString(),
    status: "ADMITTING",
    assessment: assessed,
    repairAdmission: false,
    inferenceCalls: 0,
    operationAttempts: 0,
    executions: [],
    operations: [],
    checks: [],
    provenance: {
      inference: "none; deterministic report gate",
      execution: "none",
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
  try {
    if (assessed.status !== "READY") {
      record.status = assessed.status;
      return record;
    }
    const signal = options.signal ?? new AbortController().signal;
    const config = options.config ?? sandboxConfigFromEnv();
    if (!options.remote) {
      readSandboxIsolation(config);
      if (!sandboxReady(config))
        throw Error("Current sandbox readiness required");
    }
    const subject = intakeSubject(input.subject);
    record.sourceHash = sha256(subject.source);
    record.sourceOrigin = subject.sourceOrigin;
    record.originRunId = subject.originRunId;
    record.image = config.image;
    record.scope = sandboxScope(config);
    await persist();
    const raw =
      options.remote ??
      studyRemote(config, async (op) => {
        record.operations.push(structuredClone(op));
        await persist();
      });
    const seen = options.seenOperations ?? new Set<string>(),
      ids = options.seenExecutions ?? new Set<string>();
    const run = async (spec: ReturnType<typeof baselinePilotSpec>) => {
      signal.throwIfAborted();
      if (
        record.operationAttempts >= protocol.maxOperationsPerCase ||
        (options.budget && options.budget.attempts >= protocol.maxOperations)
      )
        throw Error("Intake operation cap");
      record.operationAttempts++;
      if (options.budget) options.budget.attempts++;
      await persist();
      const e = (await raw(config.image, spec, signal)).execution;
      record.executions.push(e);
      record.provenance.execution = options.remote
        ? "simulation"
        : "nebius-sandbox";
      await persist();
      checkPilotExecution(e, spec, config.image);
      if (seen.has(e.operationId!) || ids.has(e.id))
        throw Error("Repeated operation identity");
      seen.add(e.operationId!);
      ids.add(e.id);
      return e;
    };
    const baseline = checkPilotBaseline(
      await run(baselinePilotSpec(subject.source)),
      subject.source,
      config.image,
    );
    record.checks.push({
      name: "unchanged upstream and filesystem",
      ...baseline,
    });
    await persist();
    if (!baseline.passed) throw Error("Baseline does not pass");
    const reports = [];
    for (let repetition = 0; repetition < 2; repetition++) {
      const rows = checkPilotObservation(
        await run(observationPilotSpec(subject.source, pilotCore)),
        subject.source,
        config.image,
        pilotCore,
      );
      reports.push(rows);
      record.checks.push({ name: "reported lookup " + (repetition + 1), rows });
      await persist();
    }
    if (JSON.stringify(reports[0]) !== JSON.stringify(reports[1]))
      throw Error("Reported behavior unstable");
    const controls = checkPilotObservation(
      await run(observationPilotSpec(subject.source, pilotControls)),
      subject.source,
      config.image,
      pilotControls,
    );
    record.checks.push({ name: "documented controls", rows: controls });
    await persist();
    if (!controls.every((p) => p.passed))
      throw Error("Documented controls fail");
    if (reports[0].every((p) => p.passed))
      record.status = "ALREADY_SATISFIED_FOR_REPORT";
    else if (
      reports[0][0].status === "returned" &&
      reports[0][0].actual === "null"
    )
      record.status = "REPRODUCED";
    else throw Error("Observed failure differs from reported failure");
    // Reproduction only: a separate qualified repair workflow is required before inference.
    record.repairAdmission = false;
  } catch {
    record.status = options.signal?.aborted ? "CANCELLED" : "ERROR";
    record.error =
      "Intake stopped; preserve execution evidence. No model or repair was dispatched.";
  } finally {
    record.completedAt = new Date().toISOString();
    await persist();
  }
  return record;
}
export function recomputeIntakeCheck(r: any) {
  const p = auditIntakeControls(),
    expected = intakeControlCase(r.name),
    assessment = assessDlvReport(expected.report);
  if (
    r.format !== "repolab-dlv-intake-check/v1" ||
    r.studyDigest !== p.digest ||
    r.subject !== expected.subject ||
    r.report !== expected.report ||
    !z.uuid().safeParse(r.id).success ||
    r.inferenceCalls !== 0 ||
    r.repairAdmission !== false ||
    !Number.isFinite(Date.parse(r.completedAt)) ||
    !Number.isFinite(Date.parse(r.startedAt)) ||
    Date.parse(r.completedAt) < Date.parse(r.startedAt) ||
    JSON.stringify(r.assessment) !== JSON.stringify(assessment) ||
    r.provenance?.inference !== "none; deterministic report gate"
  )
    throw Error("Intake record identity mismatch");
  if (assessment.status !== "READY") {
    if (
      r.status !== assessment.status ||
      r.executions.length !== 0 ||
      r.operations.length !== 0 ||
      r.operationAttempts !== 0 ||
      r.provenance.execution !== "none" ||
      JSON.stringify(r.assessment) !== JSON.stringify(assessment)
    )
      throw Error("Missing facts dispatched or changed");
    return {
      status: assessment.status,
      matchesExpected: assessment.status === expected.expectedStatus,
      operations: 0,
      inferenceCalls: 0,
    };
  }
  const subject = intakeSubject(expected.subject);
  if (
    r.sourceHash !== sha256(subject.source) ||
    r.sourceOrigin !== subject.sourceOrigin ||
    r.originRunId !== subject.originRunId ||
    r.executions.length !== 4 ||
    r.operationAttempts !== 4 ||
    !z.uuid().safeParse(r.image).success ||
    !["nebius-sandbox", "simulation"].includes(r.provenance.execution)
  )
    throw Error("Intake source or operation scope changed");
  if (
    new Set(r.executions.map((e: Execution) => e.id)).size !== 4 ||
    new Set(r.executions.map((e: Execution) => e.operationId)).size !== 4
  )
    throw Error("Reused intake evidence");
  const baseline = checkPilotBaseline(r.executions[0], subject.source, r.image);
  const first = checkPilotObservation(
    r.executions[1],
    subject.source,
    r.image,
    pilotCore,
  );
  const second = checkPilotObservation(
    r.executions[2],
    subject.source,
    r.image,
    pilotCore,
  );
  const controls = checkPilotObservation(
    r.executions[3],
    subject.source,
    r.image,
    pilotControls,
  );
  if (
    !baseline.passed ||
    JSON.stringify(first) !== JSON.stringify(second) ||
    !controls.every((p) => p.passed)
  )
    throw Error("Intake gates failed");
  const status = first.every((p) => p.passed)
    ? "ALREADY_SATISFIED_FOR_REPORT"
    : first[0].status === "returned" && first[0].actual === "null"
      ? "REPRODUCED"
      : "ERROR";
  if (r.status !== status)
    throw Error("Intake status not supported by observations");
  return {
    status,
    matchesExpected: status === expected.expectedStatus,
    operations: 4,
    inferenceCalls: 0,
  };
}
export function summarizeIntakeControls(records: any[]) {
  const p = auditIntakeControls();
  if (
    records.length !== p.schedule.length ||
    records.some((r, i) => r.name !== p.schedule[i])
  )
    throw Error("Incomplete or reordered control schedule");
  const cases = records.map((r) => ({
    name: r.name,
    ...recomputeIntakeCheck(r),
    provenance: r.provenance,
  }));
  const executions = records.flatMap((r) => r.executions);
  if (
    executions.length !== p.maxOperations ||
    new Set(executions.map((e) => e.id)).size !== p.maxOperations ||
    new Set(executions.map((e) => e.operationId)).size !== p.maxOperations ||
    new Set(records.slice(1).map((r) => r.image)).size !== 1 ||
    new Set(records.slice(1).map((r) => r.scope)).size !== 1 ||
    new Set(records.slice(1).map((r) => r.provenance.execution)).size !== 1
  )
    throw Error("Reused or mixed control evidence");
  return {
    format: "repolab-dlv-intake-summary/v1",
    studyDigest: p.digest,
    scope: p.scope,
    passed: cases.every((c) => c.matchesExpected),
    cases,
    operations: executions.length,
    inferenceCalls: 0,
    provenance: {
      inference: "none; deterministic report gate",
      execution: records[1].provenance.execution,
    },
    limitations: [
      "Same exposed dlv development task; no new bug or held-out claim",
      "Fixed report adapter and reviewed source subjects only; generic intake remains closed",
      "Upstream tests use the frozen CJS adapter; historical build pipeline untested",
      "Reproduction alone does not admit a model or repair",
    ],
  };
}

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { auditCommonStudy } from "./study-protocol-v8.ts";
import {
  commonTask,
  commonSuites,
  checkCommonContract,
  missingControlAssessment,
} from "./study-adapters-v6.ts";
import { assembleCommonPatch, admissionFeedback } from "./study-policy-v5.ts";
import {
  typeDiagnostics,
  typeAwareCandidateFeedback,
} from "./study-guidance-v8.ts";
import { checkBoundGate, replayCommonGate } from "./study-binding-v7.ts";

function sameJson(a: unknown, b: unknown): boolean {
  const ordered = (x: any): any =>
    Array.isArray(x)
      ? x.map(ordered)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, ordered(x[k])]),
          )
        : x;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}

export async function recomputeCommonSlot(r: any, allowSimulation = false) {
  const p = auditCommonStudy(),
    t = commonTask(r.task);
  if (
    r.format !== "repolab-common-study-run/v8" ||
    r.studyDigest !== p.digest ||
    !z.uuid().safeParse(r.id).success ||
    !p.schedule.some((s) => s.task === r.task && s.arm === r.arm) ||
    r.repetition !== 1 ||
    r.candidates.length > 2 ||
    r.requests > 3 ||
    r.operationAttempts > 32 ||
    !Number.isFinite(Date.parse(r.startedAt)) ||
    (r.completedAt !== undefined &&
      (!Number.isFinite(Date.parse(r.completedAt)) ||
        Date.parse(r.completedAt) < Date.parse(r.startedAt)))
  )
    throw Error("Slot identity or bounds invalid");
  const simulation =
    r.provenance.execution === "simulation" ||
    r.provenance.inference === "simulation";
  if (simulation && !allowSimulation)
    throw Error("Simulation cannot establish actual study results");
  if (
    !["none", "simulation", "nebius-sandbox"].includes(
      r.provenance.execution,
    ) ||
    !["none", "simulation", "nebius"].includes(r.provenance.inference)
  )
    throw Error("Unknown provenance");
  const error = !r.completedAt || ["ERROR", "CANCELLED"].includes(r.status);
  const sourceMap = new Map([[sha256(t.source), t.source]]);
  for (const c of r.candidates) {
    if (c.source === null && c.feedback !== undefined) {
      let rejection: unknown;
      try {
        const source = assembleCommonPatch(t.id, t.source, t.path, c.proposal);
        if (source === t.source || sourceMap.has(sha256(source)))
          throw Error("Unchanged or repeated candidate");
      } catch (e) {
        rejection = e;
      }
      if (
        !rejection ||
        !sameJson(c.feedback, admissionFeedback(t.id, rejection))
      )
        throw Error("Admission feedback differs from unchanged policy");
    }
    if (c.source !== null) {
      const assembled = assembleCommonPatch(t.id, t.source, t.path, c.proposal);
      if (
        assembled !== c.source ||
        sha256(assembled) !== c.sourceHash ||
        assembled === t.source ||
        sourceMap.has(c.sourceHash)
      )
        throw Error("Candidate assembly changed");
      if (!sameJson(c.typeDiagnostics, typeDiagnostics(t.id, c.proposal.after)))
        throw Error("Type diagnostics changed");
      sourceMap.set(c.sourceHash, c.source);
    }
  }
  const seen = new Set(),
    ids = new Set();
  let attempts = 0;
  for (const g of r.gates) {
    checkBoundGate(t, sourceMap.get(g.sourceHash)!, g);
    if (!sourceMap.has(g.sourceHash)) throw Error("Unregistered gate source");
    for (const trace of g.trace) {
      attempts++;
      if (seen.has(trace.execution.operationId) || ids.has(trace.execution.id))
        throw Error("Reused execution");
      seen.add(trace.execution.operationId);
      ids.add(trace.execution.id);
    }
    if (g.result && !simulation)
      await replayCommonGate(t, sourceMap.get(g.sourceHash)!, g, r);
  }
  if (!simulation && !error && attempts !== r.operationAttempts)
    throw Error("Operation receipt count differs");
  if (t.kind !== "bug") {
    if (
      r.requests !== 0 ||
      r.usage.length ||
      r.candidates.length ||
      r.accepted ||
      r.decision !== null ||
      r.provenance.inference !== "none"
    )
      throw Error("Control dispatched inference or repair");
    if (error)
      return {
        task: r.task,
        arm: r.arm,
        kind: t.kind,
        attempted: true,
        qualified: false,
        accepted: false,
        correct: null,
        status: r.status,
        unknown: true,
      };
    const correct =
      t.kind === "missing-facts"
        ? r.gates.length === 0 &&
          r.operations.length === 0 &&
          r.operationAttempts === 0 &&
          JSON.stringify(r.assessment) ===
            JSON.stringify(missingControlAssessment()) &&
          r.assessment.status === "NEEDS_FACTS"
        : r.gates.length === 1 &&
          r.gates[0].suite === "already-correct" &&
          r.gates[0].sourceHash === sha256(t.source) &&
          r.gates[0].result.passed === true;
    const status =
      t.kind === "missing-facts"
        ? "NEEDS_FACTS"
        : correct
          ? "ALREADY_SATISFIED_FOR_REPORT"
          : "CONTROL_ERROR";
    if (
      r.status !== status ||
      r.correct !== correct ||
      r.qualified !== correct ||
      (t.kind === "already-correct" &&
        (r.gates.length !== 1 || r.gates[0].suite !== "already-correct")) ||
      (!simulation && t.kind === "already-correct" && r.operationAttempts !== 4)
    )
      throw Error("Control decision differs from evidence");
    return {
      task: r.task,
      arm: r.arm,
      kind: t.kind,
      attempted: true,
      qualified: correct,
      accepted: false,
      correct,
      status,
      unknown: false,
    };
  }
  const initial = r.gates.slice(0, 3);
  const qualified =
    initial.length === 3 &&
    JSON.stringify(initial.map((g: any) => g.suite)) ===
      JSON.stringify(["baseline", "core", "core"]) &&
    initial.every((g: any) => g.sourceHash === sha256(t.source)) &&
    initial[0].result?.passed === true &&
    initial[1].result?.passed === false &&
    initial[2].result?.passed === false &&
    JSON.stringify(initial[1].result.rows) ===
      JSON.stringify(initial[2].result.rows);
  if (error && !r.decision) {
    if (r.accepted) throw Error("Acceptance lacks immutable selection");
    return {
      task: r.task,
      arm: r.arm,
      kind: t.kind,
      attempted: true,
      qualified,
      accepted: false,
      correct: null,
      status: r.status,
      unknown: true,
    };
  }
  if (
    initial.length !== 3 ||
    JSON.stringify(initial.map((g: any) => g.suite)) !==
      JSON.stringify(["baseline", "core", "core"]) ||
    initial.some((g: any) => g.sourceHash !== sha256(t.source)) ||
    initial[0].result.passed !== true ||
    initial[1].result.passed !== false ||
    initial[2].result.passed !== false ||
    JSON.stringify(initial[1].result.rows) !==
      JSON.stringify(initial[2].result.rows) ||
    r.qualified !== true
  )
    throw Error("Original qualification differs");
  if (r.arm !== "A") checkCommonContract(t, r.contract);
  let cursor = 3;
  for (const c of r.candidates) {
    if (c.source === null) {
      if (c.accepted || c.gateIndexes.length)
        throw Error("Rejected proposal executed");
      continue;
    }
    const suites = commonSuites(r.arm, t.challenge.length > 0);
    if (
      JSON.stringify(c.gateIndexes) !==
      JSON.stringify(suites.map((_, i) => cursor + i))
    )
      throw Error("Candidate gate order changed");
    const gates = c.gateIndexes.map((i: number) => r.gates[i]);
    if (
      gates.some(
        (g: any, i: number) =>
          !g || g.suite !== suites[i] || g.sourceHash !== c.sourceHash,
      )
    )
      throw Error("Candidate acceptance recipe changed");
    const accepted = gates.every((g: any) => g.result.passed === true);
    if (c.accepted !== accepted) throw Error("Candidate verdict forged");
    if (!sameJson(c.feedback, typeAwareCandidateFeedback(t, c.proposal, gates)))
      throw Error("Public failure feedback changed");
    cursor += suites.length;
    if (accepted && c !== r.candidates.at(-1))
      throw Error("Proposal after acceptance");
  }
  const selected = r.candidates.find((c: any) => c.accepted),
    accepted = Boolean(selected);
  const bytes = await readFile(r.decisionPath, "utf8");
  if (
    sha256(bytes) !== r.decisionHash ||
    JSON.stringify(JSON.parse(bytes)) !== JSON.stringify(r.decision) ||
    r.decision.runId !== r.id ||
    r.decision.studyDigest !== p.digest ||
    r.decision.task !== t.id ||
    r.decision.arm !== r.arm ||
    r.decision.accepted !== accepted ||
    r.decision.source !== (selected?.source ?? null) ||
    r.decision.sourceHash !== (selected?.sourceHash ?? null) ||
    !Number.isFinite(Date.parse(r.independentOpenedAt)) ||
    Date.parse(r.independentOpenedAt) < Date.parse(r.decision.at) ||
    Date.parse(r.independentOpenedAt) > Date.parse(r.completedAt)
  )
    throw Error("Immutable selection changed");
  if (error)
    return {
      task: r.task,
      arm: r.arm,
      kind: t.kind,
      attempted: true,
      qualified: true,
      accepted,
      correct: null,
      status: r.status,
      unknown: true,
    };
  const independent = r.gates[cursor];
  if (
    r.gates.length !== cursor + 1 ||
    independent.suite !== "independent" ||
    independent.sourceHash !== sha256(selected?.source ?? t.source)
  )
    throw Error("Independent evaluation changed");
  const correct = accepted && independent.result.passed === true;
  const status = accepted
    ? correct
      ? "ACCEPTED_INDEPENDENTLY_CORRECT"
      : "ACCEPTED_INDEPENDENTLY_INCORRECT"
    : "ABSTAINED";
  if (
    r.status !== status ||
    r.accepted !== accepted ||
    r.correct !== correct ||
    r.selectionIntact !== true
  )
    throw Error("Saved outcome differs from raw gates");
  if (
    !simulation &&
    (r.provenance.inference !== "nebius" ||
      r.requests !== r.usage.length ||
      r.requests !== r.responses.length ||
      r.usageComplete !== true)
  )
    throw Error("Successful slot lacks complete inference receipts");
  if (!simulation) {
    const expected = [
      ...(r.arm !== "A" ? [r.contract] : []),
      ...r.candidates.map((c: any) => c.proposal),
    ];
    if (r.responses.length !== expected.length)
      throw Error("Inference receipt count changed");
    r.responses.forEach((response: any, i: number) => {
      const u = r.usage[i],
        choice = response.choices[0];
      if (
        response.model !== p.model ||
        u.model !== p.model ||
        choice.finishReason !== "stop" ||
        !sameJson(JSON.parse(choice.content), expected[i]) ||
        u.inputTokens !== response.usage.prompt_tokens ||
        u.outputTokens !== response.usage.completion_tokens ||
        u.costUsd !==
          (u.inputTokens * p.rates.input + u.outputTokens * p.rates.output) /
            1e6
      )
        throw Error("Inference content or accounting changed");
    });
  }
  return {
    task: r.task,
    arm: r.arm,
    kind: t.kind,
    attempted: true,
    qualified: true,
    accepted,
    correct,
    status,
    unknown: false,
  };
}
export async function commonStudyMetrics(
  records: any[],
  allowSimulation = false,
) {
  const p = auditCommonStudy(),
    keys = new Set(),
    executionIds = new Set(),
    operationIds = new Set();
  const rows: (Awaited<ReturnType<typeof recomputeCommonSlot>> & {
    origin: string;
  })[] = [];
  for (const r of records) {
    const key = r.task + "/" + r.arm;
    if (keys.has(key)) throw Error("Duplicate scheduled slot");
    keys.add(key);
    for (const g of r.gates)
      for (const trace of g.trace) {
        if (
          executionIds.has(trace.execution.id) ||
          operationIds.has(trace.execution.operationId)
        )
          throw Error("Operation reused across slots");
        executionIds.add(trace.execution.id);
        operationIds.add(trace.execution.operationId);
      }
    rows.push({
      ...(await recomputeCommonSlot(r, allowSimulation)),
      origin: commonTask(r.task).origin,
    });
  }
  const arms = (["C"] as const).map((arm) => {
    const selected = rows.filter((r) => r.arm === arm),
      bugs = selected.filter((r) => r.kind === "bug"),
      controls = selected.filter((r) => r.kind !== "bug");
    const accepted = bugs.filter((r) => r.accepted),
      known = accepted.filter((r) => r.correct !== null);
    return {
      arm,
      plannedTasks: 1,
      attemptedTasks: selected.length,
      notRun: 1 - selected.length,
      qualifiedBugs: bugs.filter((r) => r.qualified).length,
      acceptedRepairs: accepted.length,
      correctRepairs: known.filter((r) => r.correct).length,
      incorrectAcceptances: known.filter((r) => !r.correct).length,
      acceptedUnknown: accepted.filter((r) => r.correct === null).length,
      controlCorrect: controls.filter((r) => r.correct).length,
      unknownOutcomes: selected.filter((r) => r.unknown).length,
      correctTaskOutcomes: selected.filter((r) => r.correct).length,
      acceptancePrecision:
        accepted.length === 0 || accepted.some((r) => r.correct === null)
          ? null
          : known.filter((r) => r.correct).length / accepted.length,
    };
  });
  return {
    format: "repolab-common-study-metrics/v8",
    digest: p.digest,
    scope: p.scope,
    arms,
    rows,
    actualOperations: operationIds.size,
    estimatedInferenceUsd: records.reduce(
      (n, r) => n + r.usage.reduce((m: number, u: any) => m + u.costUsd, 0),
      0,
    ),
    provenance: allowSimulation
      ? "simulation allowed; never actual comparison evidence"
      : "raw actual/none receipts replayed",
    limitations: [
      "Focused exposed-development revision; no A/B comparison or causal superiority claim",
      "Authored/public/exposed tasks; no external hidden benchmark",
      "Previously attempted tasks; no untouched-task or new independent benchmark claim",
    ],
  };
}

import type { StudyRecord } from "./study-runner-v2.ts";
import { studySchedule } from "./study-tasks.ts";
import { sha256 } from "../evidence/hash.ts";
import { auditStudy } from "./study-protocol-v2.ts";
import { studyOracle } from "./study-oracle.ts";
import { studyTask } from "./study-tasks.ts";
import { observationSpec, checkedObservation } from "./study-execution.ts";
/** Task-level denominators; missing or invalid evaluation never counts as correct. */
export function studyMetrics(records: StudyRecord[]) {
  const protocol = auditStudy(),
    keys = new Set<string>();
  for (const r of records) {
    const key = r.task + "/" + r.arm;
    if (
      keys.has(key) ||
      r.studyDigest !== protocol.digest ||
      !studySchedule.some((s) => s.task === r.task && s.arm === r.arm) ||
      r.repetition !== 1 ||
      !r.completedAt
    )
      throw Error("Duplicate, foreign or unfinished study slot");
    keys.add(key);
    if (r.accepted) {
      const d = r.decision?.payload,
        selected = r.candidates.find((c) => c.sourceHash === d?.sourceHash);
      if (
        !d?.accepted ||
        !selected?.accepted ||
        !selected.gates.every((g) => g.passed) ||
        selected.source !== d.source ||
        sha256(selected.source) !== d.sourceHash
      )
        throw Error("Acceptance claim lacks selected gate evidence");
    }
    if (r.independent) {
      const selected = r.decision?.payload.source ?? studyTask(r.task).source,
        oracle = studyOracle(r.task),
        spec = observationSpec(
          r.task,
          studyTask(r.task).path,
          selected,
          oracle.cases,
        ),
        execution = r.executions.at(-1);
      if (!execution) throw Error("Independent execution absent");
      const checked = checkedObservation(
        execution,
        spec,
        execution.image!,
        oracle.cases,
      );
      if (
        r.independent.valid !== checked.valid ||
        r.independent.sourceHash !== sha256(selected) ||
        r.independent.total !== oracle.cases.length ||
        r.independent.passed !==
          (checked.valid ? checked.rows.filter((p) => p.passed).length : null)
      )
        throw Error("Independent observation summary changed");
    }
    if (
      r.correct === true &&
      (!r.accepted ||
        !r.selectionIntact ||
        !r.independent?.valid ||
        r.independent.passed !== r.independent.total ||
        !r.decision ||
        sha256(JSON.stringify(r.decision.payload, null, 2) + "\n") !==
          r.decision.sha256 ||
        r.independent.sourceHash !== r.decision.payload.sourceHash)
    )
      throw Error("Correctness claim lacks selected independent evidence");
  }
  const arms = (["A", "B", "C"] as const).map((arm) => {
    const rows = records.filter((r) => r.arm === arm),
      qualified = rows.filter((r) => r.qualified),
      accepted = rows.filter((r) => r.accepted),
      correct = rows.filter((r) => r.correct === true),
      incorrect = accepted.filter((r) => r.correct === false),
      unknown = accepted.filter((r) => r.correct === null),
      costs = rows
        .filter((r) => r.usageComplete)
        .map((r) => r.estimatedInferenceUsd),
      times = rows
        .map((r) => Date.parse(r.completedAt!) - Date.parse(r.startedAt))
        .sort((a, b) => a - b);
    return {
      arm,
      planned: 3,
      attempted: rows.length,
      qualified: qualified.length,
      correctRepairs: correct.length,
      allAttemptedRate: rows.length ? correct.length / rows.length : null,
      qualifiedRate: qualified.length
        ? correct.length / qualified.length
        : null,
      accepted: accepted.length,
      acceptedPrecision: accepted.length
        ? correct.length / accepted.length
        : null,
      incorrectAcceptance: incorrect.length,
      unknownAcceptedEvaluation: unknown.length,
      abstentions: rows.filter((r) => r.status === "ABSTAINED").length,
      clarifications: rows.filter((r) => r.status === "NEEDS_CLARIFICATION")
        .length,
      invalidContracts: rows.filter(
        (r) =>
          r.contractOutcome?.kind === "INVALID_OUTPUT" ||
          r.contractOutcome?.kind === "UNGROUNDED",
      ).length,
      errors: rows.filter((r) => /ERROR|CANCELLED/.test(r.status)).length,
      knownConfiguredEstimateUsd: costs.reduce((a, b) => a + b, 0),
      uncertainAccounting: rows.filter((r) => !r.usageComplete).length,
      inferenceCalls: rows.reduce((n, r) => n + r.requests, 0),
      medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
      rangeMs: times.length ? [times[0], times.at(-1)] : null,
    };
  });
  return {
    format: "repolab-development-study-results/v2",
    studyDigest: protocol.digest,
    scope: protocol.scope,
    status:
      records.length === 9
        ? "COMPLETED_DEVELOPMENT_PILOT"
        : "PARTIAL_WITH_UNATTEMPTED_SLOTS",
    provenance: {
      inference: records.length
        ? [...new Set(records.map((r) => r.provenance.inference))]
        : ["none"],
      execution: records.length
        ? [...new Set(records.map((r) => r.provenance.execution))]
        : ["none"],
    },
    arms,
    paired: protocol.schedule
      .filter((s) => s.arm === "A")
      .map(({ task }) => ({
        task,
        outcomes: (["A", "B", "C"] as const).map((arm) => {
          const r = records.find((r) => r.task === task && r.arm === arm);
          return {
            arm,
            id: r?.id ?? null,
            status: r?.status ?? "UNATTEMPTED",
            accepted: r?.accepted ?? false,
            correct: r?.correct ?? null,
          };
        }),
      })),
    limitations: [
      "Three already-exposed development tasks; no held-out accuracy or significance claim",
      "Two constructed modules and one historical bug, one repetition each",
      "Same source safety and isolation across arms; no unrestricted baseline",
      "Configured inference estimates exclude sandbox costs; unresolved accounting remains separate",
    ],
  };
}

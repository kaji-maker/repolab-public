import { z } from "zod";
import type { Execution, Gate } from "../contracts/index.ts";
import { inspectObservations } from "./observations.ts";
import type { ExpectedObservation } from "./observations.ts";

const ResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      passed: z.boolean(),
      expected: z.union([z.string(), z.number().int().nonnegative()]),
      actual: z.unknown().optional(),
      assertion: z.boolean().optional(),
      error: z.string().optional(),
    }),
  ),
});

export function checkExecution(
  execution: Execution,
  expected: readonly ExpectedObservation[],
  mode: "pass" | "reproduce",
  sourceHash: string,
  testHash: string,
): Gate {
  const intact =
    execution.sourceHash === sourceHash && execution.testHash === testHash;
  const observed = inspectObservations(execution, expected);
  const outcome =
    observed.valid &&
    (mode === "pass"
      ? observed.rows.every((r) => r.passed)
      : observed.rows.some((r) => !r.passed));
  return {
    name:
      mode === "pass"
        ? "Expected tests pass"
        : "Original reproduces by comparison",
    passed: intact && outcome,
    detail: !intact
      ? "Source or test digest changed"
      : !observed.valid
        ? observed.error!
        : !outcome
          ? "Observed values do not satisfy controller expectations"
          : `${observed.rows.length} controller comparisons; observation process exit ${execution.exitCode}`,
  };
}

/** Legacy replay/display only. Never used to admit a new verified candidate. */
export function checkLegacyExecution(
  execution: Execution,
  expectedIds: string[],
  mode: "pass" | "reproduce",
  sourceHash: string,
  testHash: string,
): Gate {
  const intact =
    execution.sourceHash === sourceHash && execution.testHash === testHash;
  const complete =
    !execution.timedOut &&
    !execution.truncated &&
    !execution.signal &&
    execution.exitCode !== null;
  let results: z.infer<typeof ResultSchema>["results"] = [];
  try {
    results = ResultSchema.parse(JSON.parse(execution.stdout.trim())).results;
  } catch {
    /* No result is a failed evidence gate. */
  }
  const ids = results.map((result) => result.id);
  const collected =
    ids.length === expectedIds.length &&
    new Set(ids).size === ids.length &&
    expectedIds.every((id) => ids.includes(id));
  const outcome =
    mode === "pass"
      ? execution.exitCode === 0 &&
        results.every((r) => r.passed && r.actual === r.expected)
      : execution.exitCode === 1 &&
        results.some((r) => !r.passed && r.assertion === true) &&
        results.every((r) => r.passed || r.assertion === true);
  const passed = intact && complete && collected && outcome;
  return {
    name:
      mode === "pass"
        ? "Expected tests pass"
        : "Original reproduces by assertion",
    passed,
    detail: !intact
      ? "Source or test digest changed"
      : !complete
        ? "Execution evidence incomplete"
        : !collected
          ? "Required test identities missing or duplicated"
          : !outcome
            ? "Observed result does not satisfy the test gate"
            : `${ids.length} recorded assertions; exit ${execution.exitCode}`,
  };
}

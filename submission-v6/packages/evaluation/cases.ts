import type { Execution } from "../contracts/index.ts";
import type { TestProbe } from "../controller/tests.ts";
import { checkExecution } from "../controller/gates.ts";
import { compileTests } from "../controller/tests.ts";
import { sha256 } from "../evidence/hash.ts";
import { TrustedFixtureExecutor } from "../execution/local.ts";

export type EvaluationCase = TestProbe & {
  origin: "reported" | "independent" | "baseline";
  rationale: string;
};
interface EvaluationRow {
  caseId: string;
  origin: EvaluationCase["origin"];
  verdict: "PASS" | "ASSERTION_FAILURE" | "ENVIRONMENT_ERROR";
  execution: Execution;
}

// Reviewed modules only. Reference cases and sources never enter the proposer.
export async function evaluateSources(
  cases: EvaluationCase[],
  sources: { id: string; source: string }[],
) {
  const executor = new TrustedFixtureExecutor();
  const results = [];
  for (const variant of sources) {
    const rows: EvaluationRow[] = [];
    for (const item of cases) {
      const { origin, rationale: _, ...probe } = item;
      const tests = compileTests([probe]);
      const execution = await executor.execute(variant.source, tests);
      const args = [sha256(variant.source), sha256(tests)] as const;
      const passes = checkExecution(execution, [probe], "pass", ...args);
      const fails = checkExecution(execution, [probe], "reproduce", ...args);
      rows.push({
        caseId: item.id,
        origin,
        execution,
        verdict: passes.passed
          ? "PASS"
          : fails.passed
            ? "ASSERTION_FAILURE"
            : "ENVIRONMENT_ERROR",
      });
    }
    results.push({
      id: variant.id,
      sourceHash: sha256(variant.source),
      passed: rows.filter((row) => row.verdict === "PASS").length,
      assertionFailures: rows.filter(
        (row) => row.verdict === "ASSERTION_FAILURE",
      ).length,
      environmentErrors: rows.filter(
        (row) => row.verdict === "ENVIRONMENT_ERROR",
      ).length,
      total: rows.length,
      rows,
    });
  }
  return results;
}

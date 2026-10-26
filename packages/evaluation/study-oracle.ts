// Oracle data is used for qualification or AFTER immutable source selection only.
import { readFileSync } from "node:fs";
import { getProfile } from "../profiles/index.ts";
import { getClsxEvaluationPlan } from "./clsx.ts";
import { clsxSnapshot } from "../repositories/repair-artifacts.ts";
import { compileTests } from "../controller/tests.ts";
import type { StudyTaskId } from "./study-tasks.ts";
import type { TestProbe } from "../controller/tests.ts";
export function studyOracle(id: StudyTaskId) {
  if (id === "clsx-object-push") {
    const p = getClsxEvaluationPlan(clsxSnapshot());
    return {
      tests: p.tests,
      cases: p.cases.map(({ id, args, expected }) => ({
        id,
        args,
        expected,
      })) as TestProbe[],
      reference: p.variants.find((v) => v.id === "reference")!.source,
      weak: p.variants.find((v) => v.id === "boolean-push-only")!.source,
    };
  }
  const p = getProfile(id),
    cases = JSON.parse(
      readFileSync(`evaluation/${id}/cases.json`, "utf8"),
    ).cases.map(
      ({ origin: _, rationale: __, ...row }: any) => row,
    ) as TestProbe[];
  return {
    tests: compileTests(cases),
    cases,
    reference: p.referenceSource,
    weak: p.incompleteSource,
  };
}

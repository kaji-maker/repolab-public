import { getQualificationPlan } from "./qualification.ts";
import { compileTests } from "../controller/tests.ts";

/** Keep source provenance in qualification evidence, outside the input harness. */
export function compileOriginalControls(snapshot: unknown) {
  return compileTests(
    getQualificationPlan(snapshot).baselineControls.map(
      ({ source: _, ...probe }) => probe,
    ),
  );
}

import { getProfile } from "../profiles/index.ts";
import { getClsxRepairPlan } from "../repositories/clsx-repair.ts";
import { getQualificationPlan } from "../repositories/qualification.ts";
import { clsxSnapshot } from "../repositories/repair-artifacts.ts";
import { compileOriginalControls } from "../repositories/original-controls.ts";
import { compileTests } from "../controller/tests.ts";
import type { TestProbe } from "../controller/tests.ts";
export const studyTaskIds = [
  "booking-timezone",
  "checkout-quantity",
  "clsx-object-push",
] as const;
export type StudyTaskId = (typeof studyTaskIds)[number];
export type Arm = "A" | "B" | "C";
/** Proposer-visible data contains originals and public baseline information only. */
export function studyTask(id: StudyTaskId) {
  if (id === "clsx-object-push") {
    const snapshot = clsxSnapshot(),
      repair = getClsxRepairPlan(snapshot),
      q = getQualificationPlan(snapshot);
    return {
      id,
      path: "src/index.js",
      source: repair.source,
      report: repair.report,
      group: "historical" as const,
      baseline: q.baselineControls.map(
        ({ source: _, ...p }) => p,
      ) as TestProbe[],
      baselineTests: compileOriginalControls(snapshot),
      repository: repair.repository,
    };
  }
  const p = getProfile(id),
    baseline = p.baselineProbes as TestProbe[];
  return {
    id,
    path: p.path,
    source: p.originalSource,
    report: p.exampleReport,
    group: "constructed" as const,
    baseline,
    baselineTests: compileTests(baseline),
    repository: null,
  };
}
export function acceptanceSuites(arm: Arm, challenges: boolean) {
  return arm === "A"
    ? ["baseline"]
    : arm === "B"
      ? ["baseline", "core"]
      : [
          "baseline",
          "core",
          ...(challenges ? ["challenge"] : []),
          "fresh-core",
          "fresh-baseline",
        ];
}
// Precommitted Latin rotation, not changed in response to outcomes.
export const studySchedule = studyTaskIds.flatMap((task, i) =>
  (["A", "B", "C"] as Arm[]).map((_, j) => ({
    task,
    arm: (["A", "B", "C"] as Arm[])[(i + j) % 3],
    repetition: 1,
  })),
);

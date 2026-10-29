import type { ModuleAdmissionError } from "../repositories/module-admission-v1.ts";

export interface CandidateGateSteps {
  staticAdmission(): unknown;
  stage(): Promise<void>;
  load(): Promise<void>;
  public(repeat: "A" | "B"): Promise<void>;
  native(repeat: "A" | "B"): Promise<void>;
  select(): Promise<void>;
}
/** Shared control flow for new workflows. Every callback must validate its complete evidence. */
export async function runCandidateGates(
  steps: CandidateGateSteps,
  signal: AbortSignal,
) {
  const completed: string[] = [];
  let phase = "static";
  const step = async (label: string, fn: () => unknown) => {
    signal.throwIfAborted();
    phase = label;
    await fn();
    signal.throwIfAborted();
    completed.push(label);
  };
  try {
    await step("static", () => steps.staticAdmission());
    await step("stage", () => steps.stage());
    await step("load", () => steps.load());
    for (const repeat of ["A", "B"] as const) {
      await step("public-" + repeat, () => steps.public(repeat));
      await step("native-" + repeat, () => steps.native(repeat));
    }
    await step("selection", () => steps.select());
    return { status: "GATES_PASSED" as const, completed };
  } catch (error) {
    return {
      status: "REJECTED" as const,
      phase,
      completed,
      kind:
        typeof (error as ModuleAdmissionError)?.kind === "string"
          ? (error as ModuleAdmissionError).kind
          : signal.aborted
            ? "cancelled"
            : "gate_failed",
    };
  }
}

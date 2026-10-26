import { readFileSync } from "node:fs";
import { sha256 } from "../evidence/hash.ts";
import { evaluateCommon, evaluateAlreadyCorrect } from "./study-adapters-v6.ts";
import type { CommonTask, CommonSuite } from "./study-adapters-v6.ts";
import type { StudyRemote } from "./study-execution.ts";
import { checkPilotExecution } from "./github-pilot-v2.ts";

type Suite = CommonSuite | "already-correct";
type Environment = { image: string; treeDigest?: string | null };

/** The prospective freeze also audits every transitive historical adapter asset. */
function binding(t: CommonTask, source: string, suite: Suite) {
  return {
    format: "repolab-validation-binding/v7",
    adapterHash: sha256(
      readFileSync("packages/evaluation/study-adapters-v6.ts", "utf8"),
    ),
    task: t.id,
    suite,
    sourceHash: sha256(source),
  };
}
export function createBoundGate(t: CommonTask, source: string, suite: Suite) {
  return {
    suite,
    sourceHash: sha256(source),
    binding: binding(t, source, suite),
    trace: [] as any[],
  };
}
export function checkBoundGate(t: CommonTask, source: string, gate: any) {
  if (
    typeof source !== "string" ||
    gate.sourceHash !== sha256(source) ||
    JSON.stringify(gate.binding) !==
      JSON.stringify(binding(t, source, gate.suite))
  )
    throw Error("Validation binding changed");
}

/** Execution and raw receipt replay call this same evaluator, with the same adapter. */
export async function evaluateBoundGate(
  t: CommonTask,
  source: string,
  suite: Suite,
  environment: Environment,
  run: StudyRemote,
) {
  return suite === "already-correct"
    ? evaluateAlreadyCorrect(environment.image, run)
    : evaluateCommon(
        t,
        source,
        suite,
        environment.image,
        run,
        environment.treeDigest ?? undefined,
      );
}
export async function replayCommonGate(
  t: CommonTask,
  source: string,
  gate: any,
  environment: Environment,
) {
  checkBoundGate(t, source, gate);
  let i = 0;
  const run: StudyRemote = async (image, spec) => {
    const saved = gate.trace[i++];
    if (
      !saved ||
      saved.image !== image ||
      JSON.stringify(saved.spec) !== JSON.stringify(spec)
    )
      throw Error("Replay recipe changed");
    checkPilotExecution(saved.execution, spec, image);
    return { execution: saved.execution, resultImage: saved.resultImage };
  };
  const out = await evaluateBoundGate(t, source, gate.suite, environment, run);
  if (
    i !== gate.trace.length ||
    JSON.stringify(out) !== JSON.stringify(gate.result)
  )
    throw Error("Stored gate differs from raw execution");
  return out;
}

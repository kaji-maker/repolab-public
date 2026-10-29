import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RepositorySandbox } from "../execution/repository-sandbox.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import { compileTests } from "../controller/tests.ts";
import type { TestProbe } from "../controller/tests.ts";
import { inspectObservations } from "../controller/observations.ts";
import { sha256 } from "../evidence/hash.ts";
import type { Execution } from "../contracts/index.ts";
import { clsxSnapshot } from "../repositories/repair-artifacts.ts";
import {
  getCandidatePlan,
  checkCandidateStage,
  checkCandidateControls,
  checkCandidateBaseline,
} from "../repositories/candidate.ts";
import type { StudyTaskId } from "./study-tasks.ts";
export type StudyRunSpec = Parameters<RepositorySandbox["run"]>[0];
export type StudyRemote = (
  image: string,
  spec: StudyRunSpec,
  signal?: AbortSignal,
) => Promise<{ execution: Execution; resultImage: string | null }>;
export function studyRemote(
  config: SandboxConfig,
  save: (op: unknown) => Promise<void>,
): StudyRemote {
  return (image, spec, signal) =>
    new RepositorySandbox({ ...config, image }, save).run(spec, signal);
}
export function observationSpec(
  id: StudyTaskId,
  path: string,
  source: string,
  probes: TestProbe[],
) {
  const tests = compileTests(probes);
  return {
    phase: "observations" as const,
    sourceHash: sha256(source),
    testHash: sha256(tests),
    files: [
      { path: "/tmp/repolab/" + path, content: source },
      { path: "/tmp/repolab/test.mjs", content: tests },
    ],
  };
}
export function checkedObservation(
  out: Execution,
  spec: StudyRunSpec,
  image: string,
  probes: TestProbe[],
) {
  if (
    out.provider !== "nebius-sandbox" ||
    out.image !== image ||
    out.runtimeVersion !== "v24.18.0" ||
    !z.uuid().safeParse(out.operationId).success ||
    out.sourceHash !== spec.sourceHash ||
    out.testHash !== spec.testHash
  )
    return { valid: false, rows: [], error: "Observation provenance mismatch" };
  return inspectObservations(out, probes);
}
/** Fixed protected upstream recipe, shared identically across A/B/C. */
export async function stageStudyCandidate(
  source: string,
  treeDigest: string,
  image: string,
  run: StudyRemote,
  signal?: AbortSignal,
) {
  const plan = getCandidatePlan(clsxSnapshot(), source),
    fs = readFileSync(
      "repositories/clsx-baseline/candidate-controls.mjs",
      "utf8",
    ),
    stage = readFileSync(
      "repositories/clsx-baseline/candidate-stage.mjs",
      "utf8",
    ).replace(
      "/*REPOLAB_CANDIDATE_STAGE_CONFIG*/ null",
      JSON.stringify({
        treeDigest,
        files: plan.files.map(({ path, sha256 }) => ({ path, sha256 })),
      }),
    );
  const staged = await run(
    image,
    {
      phase: "candidate-stage",
      sourceHash: plan.sourceHash,
      testHash: sha256(stage),
      files: [
        ...plan.files.map((f) => ({
          path: "/tmp/repolab/upstream/" + f.path,
          content: f.content,
        })),
        { path: "/opt/repolab/candidate-stage.mjs", content: stage },
        { path: "/opt/repolab/candidate-runner.mjs", content: plan.runner },
        { path: "/opt/repolab/candidate-controls.mjs", content: fs },
      ],
    },
    signal,
  );
  const stageGate = checkCandidateStage(
    plan,
    treeDigest,
    staged.execution,
    image,
    sha256(stage),
    staged.resultImage,
  );
  const candidateImage = staged.resultImage!,
    controls = await run(
      candidateImage,
      {
        phase: "candidate-controls",
        files: [],
        sourceHash: plan.sourceHash,
        testHash: sha256(fs),
      },
      signal,
    ),
    controlGate = checkCandidateControls(
      source,
      controls.execution,
      candidateImage,
      sha256(fs),
    );
  const baseline = async () => {
    const out = await run(
      candidateImage,
      {
        phase: "candidate-baseline",
        files: [],
        sourceHash: plan.sourceHash,
        testHash: plan.runnerHash,
      },
      signal,
    );
    return checkCandidateBaseline(
      clsxSnapshot(),
      source,
      out.execution,
      candidateImage,
    );
  };
  return { gates: [stageGate, controlGate], baseline, image: candidateImage };
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IntakeSchema, PatchSchema } from "../contracts/index.ts";
import type {
  Intake,
  Proposer,
  Executor,
  Run,
  RunStatus,
  Execution,
  Gate,
} from "../contracts/index.ts";
import type { ExpectedObservation } from "./observations.ts";
import { getProfile } from "../profiles/index.ts";
import { sha256 } from "../evidence/hash.ts";
import { compileTests } from "./tests.ts";
import { checkExecution } from "./gates.ts";
import { groundContract } from "../providers/fixture.ts";
import { BudgetError, ProviderError } from "../providers/nebius.ts";
import { SandboxError } from "../execution/nebius.ts";
import { clsxExecutionBlocker } from "../repositories/clsx-contract.ts";

export function createRun(
  input: Intake,
  proposer: Proposer,
  executor: Executor,
): Run {
  input = IntakeSchema.parse(input);
  const profile = getProfile(input.profile);
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    intake: IntakeSchema.parse(input),
    status: "INTAKE",
    verificationProtocol: "controller-observations/v1",
    provenance: {
      inference: proposer.provenance,
      execution: executor.provider,
      model: proposer.model,
      rates: proposer.rates,
    },
    source: profile.originalSource,
    sourceHash: sha256(profile.originalSource),
    events: [],
    candidates: [],
    usage: [],
    limitations: [
      "One purpose-built JavaScript module; arbitrary repositories are not supported yet.",
      "Passing these tests establishes behavior only for the tested examples.",
      "Controller comparisons rely on bounded observations from supported pure functions; they do not prove resistance to every hostile program.",
      "Challenge expectations come from the report, not an independent hidden benchmark.",
      ...(proposer.provenance === "fixture"
        ? [
            "Offline fixture proposals are reviewed examples, not model-generated repairs.",
          ]
        : []),
      ...(proposer.provenance === "nebius" &&
      executor.provider === "trusted-fixture"
        ? [
            "Live inference can propose a patch; generated source is not executed without a verified isolated provider.",
          ]
        : []),
    ],
  };
}

export async function executeRun(
  run: Run,
  proposer: Proposer,
  executor: Executor,
  options: {
    signal?: AbortSignal;
    onUpdate?: (run: Run) => void | Promise<void>;
  } = {},
): Promise<Run> {
  const signal = options.signal;
  const executionIds = new Set<string>(),
    operationIds = new Set<string>();
  const provenanceGates = new WeakMap<Execution, Gate>();
  let environment: { runtimeVersion?: string; image?: string } | undefined;
  const execute = async (
    source: string,
    tests: string,
    abort?: AbortSignal,
  ) => {
    const execution = await executor.execute(source, tests, abort);
    const isolated = executor.provider === "nebius-sandbox";
    const passed =
      execution.provider === executor.provider &&
      z.uuid().safeParse(execution.id).success &&
      !executionIds.has(execution.id) &&
      !!execution.runtimeVersion?.match(/^v24\.\d+\.\d+$/) &&
      (!isolated ||
        (z.uuid().safeParse(execution.operationId).success &&
          z.uuid().safeParse(execution.image).success &&
          !operationIds.has(execution.operationId!))) &&
      (!environment ||
        (environment.runtimeVersion === execution.runtimeVersion &&
          environment.image === execution.image));
    executionIds.add(execution.id);
    if (execution.operationId) operationIds.add(execution.operationId);
    environment ??= {
      runtimeVersion: execution.runtimeVersion,
      image: execution.image,
    };
    provenanceGates.set(execution, {
      name: "Fresh execution provenance",
      passed,
      detail: passed
        ? "Distinct execution in the recorded provider/runtime/image"
        : "Execution identity reused or provider/runtime/image evidence differs",
    });
    return execution;
  };
  const checkObserved = (
    execution: Execution,
    expected: readonly ExpectedObservation[],
    mode: "pass" | "reproduce",
    sourceHash: string,
    testHash: string,
  ): Gate => {
    const provenance = provenanceGates.get(execution)!;
    return provenance.passed
      ? checkExecution(execution, expected, mode, sourceHash, testHash)
      : provenance;
  };
  const emit = async (status: RunStatus, message: string) => {
    run.status = status;
    run.updatedAt = new Date().toISOString();
    run.events.push({
      sequence: run.events.length + 1,
      at: run.updatedAt,
      status,
      message,
    });
    run.usage.push(...proposer.takeUsage());
    await options.onUpdate?.(run);
  };
  const finish = async (status: RunStatus, message: string) => {
    await emit(status, message);
    return run;
  };
  try {
    if (signal?.aborted)
      return await finish("CANCELLED", "Cancelled before work began.");
    if (run.intake.profile === "clsx-object-push") {
      run.error = clsxExecutionBlocker;
      return await finish("ENVIRONMENT_ERROR", clsxExecutionBlocker);
    }
    if (
      run.intake.mode !==
      (proposer.provenance === "fixture" ? "fixture" : "live")
    )
      throw new Error("Inference provenance does not match the requested mode");
    if (proposer.profile && proposer.profile !== run.intake.profile)
      throw new Error(
        "Proposer does not match the requested repository profile",
      );
    const { baselineProbes, path } = structuredClone(
      getProfile(run.intake.profile),
    );
    await emit(
      "PREPARING",
      "Extracting behavior with a source for every expectation.",
    );
    const extracted = await proposer.extract(run.intake.report, signal);
    if (!extracted.contract) {
      run.clarification =
        extracted.clarification ??
        "Provide explicit examples of expected behavior.";
      return await finish("NEEDS_CLARIFICATION", run.clarification);
    }
    run.proposedContract = extracted.contract;
    try {
      run.contract = groundContract(
        run.intake.report,
        extracted.contract,
        run.intake.profile,
      );
    } catch {
      run.clarification =
        "Each expectation must match a distinct, explicit example from the report.";
      return await finish("NEEDS_CLARIFICATION", run.clarification);
    }
    // Select and freeze the core before any candidate exists. Other report
    // examples become challenge tests, not invented expected results.
    const [core, ...challenges] = run.contract.expectations;
    const project = (probe: typeof core) => {
      const { sourceQuote: _, ...data } = probe;
      return data;
    };
    const coreSource = compileTests([project(core)]);
    const baselineSource = compileTests(baselineProbes);
    await emit(
      "REPRODUCING",
      "Running the existing baseline and the reported failure on original source.",
    );
    const baseline = await execute(run.source, baselineSource, signal);
    run.baseline = {
      probes: baselineProbes,
      expectationsHash: sha256(JSON.stringify(baselineProbes)),
      source: baselineSource,
      hash: sha256(baselineSource),
      execution: baseline,
    };
    if (
      !checkObserved(
        baseline,
        baselineProbes,
        "pass",
        run.sourceHash,
        sha256(baselineSource),
      ).passed
    )
      return await finish(
        "ENVIRONMENT_ERROR",
        "The original baseline did not pass.",
      );
    const before: Execution[] = [];
    // Preserve unsuccessful original attempts too. The CORE_FROZEN phase is
    // emitted only after two relevant mismatches have actually been confirmed.
    run.frozen = {
      source: coreSource,
      hash: sha256(coreSource),
      before,
      expectationsHash: sha256(JSON.stringify([project(core)])),
    };
    for (let repeat = 0; repeat < 2; repeat++) {
      const execution = await execute(run.source, coreSource, signal);
      before.push(execution);
      if (
        !checkObserved(
          execution,
          [core],
          "reproduce",
          run.sourceHash,
          sha256(coreSource),
        ).passed
      )
        return await finish(
          "COULD_NOT_REPRODUCE",
          "The reported assertion did not fail consistently on original source.",
        );
    }
    if (challenges.length) {
      const source = compileTests(challenges.map(project));
      run.challenge = {
        expectationsHash: sha256(JSON.stringify(challenges.map(project))),
        source,
        hash: sha256(source),
        before: await execute(run.source, source, signal),
      };
      const control = run.challenge.before;
      const expected = challenges;
      if (
        !checkObserved(
          control,
          expected,
          "pass",
          run.sourceHash,
          run.challenge.hash,
        ).passed &&
        !checkObserved(
          control,
          expected,
          "reproduce",
          run.sourceHash,
          run.challenge.hash,
        ).passed
      )
        return await finish(
          "ENVIRONMENT_ERROR",
          "Challenge controls were incomplete or raised non-assertion errors.",
        );
    }
    await emit(
      "CORE_FROZEN",
      "Core test bytes frozen; two fresh executions reproduced the assertion failure.",
    );
    for (let attempt = 1; attempt <= 2; attempt++) {
      await emit("REPAIRING", `Requesting candidate ${attempt} of 2.`);
      const prior = run.candidates.at(-1);
      const patch = PatchSchema.parse(
        await proposer.repair(
          {
            source: run.source,
            contract: structuredClone(run.contract),
            tests: coreSource,
            failure: before[0].stdout,
            attempt,
            ...(prior
              ? {
                  previous: JSON.stringify({
                    source: prior.patch.content,
                    gates: prior.gates,
                    executions: prior.executions,
                  }),
                }
              : {}),
          },
          signal,
        ),
      );
      const candidate = {
        id: `candidate-${attempt}`,
        patch,
        sourceHash: sha256(patch.content),
        executions: {},
        gates: [],
        accepted: false,
      } as Run["candidates"][number];
      run.candidates.push(candidate);
      candidate.gates.push({
        name: "source-only patch",
        passed:
          patch.path === path &&
          candidate.sourceHash !== run.sourceHash &&
          !run.candidates
            .slice(0, -1)
            .some((c) => c.sourceHash === candidate.sourceHash),
        detail:
          "Patch changes the allowed module and is distinct from previous candidates.",
      });
      if (!candidate.gates[0].passed) continue;
      if (
        proposer.provenance === "nebius" &&
        executor.provider !== "nebius-sandbox"
      ) {
        candidate.gates.push({
          name: "isolated verification",
          passed: false,
          detail:
            "Proposed patch was not executed. Configure a verified isolated provider to evaluate it.",
        });
        return await finish(
          "REPRODUCED_ONLY",
          "Original bug reproduced; NVIDIA proposed a patch. Candidate verification awaits isolated execution.",
        );
      }
      await emit(
        "CHALLENGING",
        `Testing candidate ${attempt} against frozen assertions and report challenge examples.`,
      );
      const suites = [
        { name: "core", source: coreSource, expected: [core] },
        ...(run.challenge
          ? [
              {
                name: "challenge",
                source: run.challenge.source,
                expected: challenges,
              },
            ]
          : []),
        {
          name: "baseline",
          source: baselineSource,
          expected: baselineProbes,
        },
      ];
      for (const suite of suites) {
        const execution = await execute(patch.content, suite.source, signal);
        candidate.executions[suite.name] = execution;
        candidate.gates.push({
          ...checkObserved(
            execution,
            suite.expected,
            "pass",
            candidate.sourceHash,
            sha256(suite.source),
          ),
          name: suite.name,
        });
      }
      if (!candidate.gates.every((g) => g.passed)) {
        await emit(
          "REPAIRING",
          `Candidate ${attempt} rejected; failed evidence remains in the pack.`,
        );
        continue;
      }
      await emit(
        "VERIFYING",
        "Repeating the frozen core on a fresh execution.",
      );
      const verification = await execute(patch.content, coreSource, signal);
      candidate.executions.verification = verification;
      candidate.gates.push({
        ...checkObserved(
          verification,
          [core],
          "pass",
          candidate.sourceHash,
          run.frozen.hash,
        ),
        name: "fresh verification",
      });
      candidate.accepted = candidate.gates.every((g) => g.passed);
      if (candidate.accepted) {
        await emit(
          "PACKAGING",
          "Packaging original failures, rejected candidates, hashes and verification.",
        );
        return await finish(
          "VERIFIED_FOR_TESTED_SCENARIOS",
          "The candidate passed every completed suite and fresh core verification.",
        );
      }
    }
    return await finish(
      "PATCH_REJECTED",
      "Both repair attempts were rejected. The frozen reproducer is still available.",
    );
  } catch (error) {
    run.error =
      error instanceof ProviderError ||
      error instanceof BudgetError ||
      error instanceof SandboxError
        ? error.message
        : "Execution failed; check local configuration and provider access.";
    return await finish(
      signal?.aborted
        ? "CANCELLED"
        : error instanceof BudgetError
          ? "BUDGET_EXHAUSTED"
          : error instanceof ProviderError
            ? "PROVIDER_ERROR"
            : "ENVIRONMENT_ERROR",
      run.error,
    );
  }
}

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { auditEvaluationProtocol } from "../evaluation/protocol.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { RepositorySandbox } from "../execution/repository-sandbox.ts";
import { configFromEnv, NebiusProposer } from "../providers/nebius.ts";
import { groundContract } from "../providers/fixture.ts";
import type { Store } from "../storage/store.ts";
import { sha256 } from "../evidence/hash.ts";
import { compileTests } from "../controller/tests.ts";
import { requestPolicyParameters } from "../providers/request-policy.ts";
import { ClsxContractSchema, PatchSchema } from "../contracts/index.ts";
import type { Execution, Usage, Patch, Gate } from "../contracts/index.ts";
import { getClsxRepairPlan } from "../repositories/clsx-repair.ts";
import { getQualificationPlan } from "../repositories/qualification.ts";
import { compileOriginalControls } from "../repositories/original-controls.ts";
import { admitClsxPilot } from "../repositories/admission.ts";
import { checkCandidateSource } from "../repositories/candidate-policy.ts";
import {
  getCandidatePlan,
  checkCandidateBaseline,
  checkCandidateObservations,
  checkCandidateStage,
  checkCandidateControls,
} from "../repositories/candidate.ts";

import { acquireRepairLease } from "./repair-lease.ts";
interface CandidateRecord {
  attempt: number;
  patch: Patch;
  sourceHash: string;
  gates: Gate[];
  executions: Execution[];
  accepted: boolean;
  stagedImage?: string;
}

export interface RepairServiceOptions {
  store: Store;
  id?: string;
  signal?: AbortSignal;
  onUpdate?: (record: Record<string, any>) => void | Promise<void>;
  entrypoint?: "cli" | "api";
  evidenceDirectory?: string;
}

/** Fixed development workflow shared by CLI and local API; never executes source locally. */
export async function runClsxRepair(options: RepairServiceOptions) {
  const directory =
    options.evidenceDirectory ?? join(process.cwd(), ".repolab/repositories");
  const id = z.uuid().parse(options.id ?? randomUUID());
  const path = join(directory, `clsx-repair-${id}.json`);
  let release: (() => Promise<void>) | undefined;
  try {
    async function save(file: string, value: unknown) {
      const temp = file + "." + randomUUID();
      await writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, file);
    }
    const signal = options.signal ?? new AbortController().signal;
    const record: Record<string, any> = {
      format: "repolab-clsx-development-pilot/v1",
      id,
      startedAt: new Date().toISOString(),
      entrypoint: options.entrypoint ?? "cli",
      controllerPid: process.pid,
      status: "ADMITTING",
      profile: "clsx-object-push",
      split: "development",
      comparisonWorkflow: false,
      provenance: {
        inference: "nebius; NVIDIA model",
        execution: "nebius-sandbox",
      },
      inferenceCapUsd: 0.1,
      maxCandidates: 2,
      maxInferenceCalls: 6,
      qualifiedBugWorkflowsAttempted: 0,
      allAttemptsIncludingSetupFailures: 1,
      candidates: [] as CandidateRecord[],
      usage: [] as Usage[],
      inferenceRequestsAttempted: 0,
      modelResponses: [] as unknown[],
      providerDiagnostics: [] as unknown[],
      inferenceReservations: [] as { id: string; at: string }[],
      originalExecutions: [] as Execution[],
      operations: [] as unknown[],
      limitations: [
        "One exposed historical development task; no held-out/generalization or A/B comparison claim",
        "Independent cases were opened during prior development qualification; excluded from model messages and repair feedback",
        "Dedicated fixed-task CLI/API workflow; imported packs and generic clsx controller admission remain blocked",
        "Inference cost uses configured estimates; sandbox provider cost units are not USD",
      ],
    };
    let provider: NebiusProposer | undefined;
    const store = options.store;
    let executionCount = 0;
    let ledgerBefore: number | undefined;
    let account: string | undefined;
    const persist = async () => {
      await save(path, record);
      await options.onUpdate?.(record);
    };
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await persist();
      signal.throwIfAborted();
      release = await acquireRepairLease(directory, id);
      const protocol = auditEvaluationProtocol();
      if (protocol.version < 4)
        throw Error(
          "Candidate execution requires a candidate execution freeze (v4 or later)",
        );
      const config = sandboxConfigFromEnv();
      const snapshot = JSON.parse(
        await readFile("fixtures/clsx-upstream/original-snapshot.json", "utf8"),
      );
      const admission = admitClsxPilot(snapshot, config);
      const repair = getClsxRepairPlan(snapshot);
      const qualification = getQualificationPlan(snapshot);
      const inference = configFromEnv();
      if (
        inference.model !== protocol.comparison.model ||
        inference.inputRate !== protocol.comparison.ratesUsdPerMillion.input ||
        inference.outputRate !== protocol.comparison.ratesUsdPerMillion.output
      )
        throw Error("Inference settings differ from frozen pilot");
      const developmentCap = Number(
        process.env.REPOLAB_DEVELOPMENT_BUDGET_USD ?? 4,
      );
      if (
        !Number.isFinite(developmentCap) ||
        developmentCap <= 0 ||
        developmentCap > 4
      )
        throw Error(
          "Pilot requires the existing bounded development allocation",
        );
      record.protocolDigest = protocol.digest;
      record.admission = admission;
      record.model = inference.model;
      record.requestPolicy = "nemotron-low-effort-v1";
      record.requestParameters = {
        max_tokens: 4096,
        ...requestPolicyParameters(record.requestPolicy, inference.model),
      };
      if (
        JSON.stringify(record.requestParameters) !==
        JSON.stringify(protocol.comparison.parameters)
      )
        throw Error("Request policy differs from the frozen pilot");
      record.rates = {
        input: inference.inputRate,
        output: inference.outputRate,
      };
      record.snapshotDigest = repair.snapshotDigest;
      record.originalSourceHash = repair.sourceHash;
      record.report = repair.report;
      record.reportHash = repair.reportHash;
      record.modelContextHash = repair.modelContextHash;
      record.runtimeVersion = "v24.18.0";
      record.dependencyImage = config.image;
      const remote = (image = config.image) =>
        new RepositorySandbox({ ...config, image }, async (operation) => {
          record.operations.push(structuredClone(operation));
          await persist();
        });
      const run = async (
        image: string,
        spec: Parameters<RepositorySandbox["run"]>[0],
      ) => {
        if (++executionCount > 24)
          throw Error("Pilot sandbox execution cap reached");
        record.executionCount = executionCount;
        await persist();
        return remote(image).run(spec, signal);
      };
      const observe = async (
        source: string,
        tests: string,
        expected: Parameters<typeof checkCandidateObservations>[2],
      ) => {
        const out = await run(config.image, {
          phase: "observations",
          sourceHash: sha256(source),
          testHash: sha256(tests),
          files: [
            { path: "/tmp/repolab/src/index.js", content: source },
            { path: "/tmp/repolab/test.mjs", content: tests },
          ],
        });
        const result = checkCandidateObservations(
          source,
          tests,
          expected,
          out.execution,
          config.image,
        );
        return { execution: out.execution, result };
      };
      if (
        store.hasUnsettledCharges() ||
        store.totalSpent() + 0.1 > developmentCap
      )
        throw Error("Ledger or development allocation blocks repair");
      // Reconfirm controls before inference. These expectations come from unchanged original tests.
      record.status = "QUALIFYING_ORIGINAL";
      await persist();
      const controlsTests = compileOriginalControls(snapshot);
      const controls = await observe(
        repair.source,
        controlsTests,
        qualification.baselineControls,
      );
      record.originalExecutions.push(controls.execution);
      record.originalControls = controls.result;
      await persist();
      if (!controls.result.valid || controls.result.rows.some((r) => !r.passed))
        throw Error("Original behavior controls no longer pass");
      // Exactly one workflow is attempted once isolation/preparation admission is established.
      record.qualifiedBugWorkflowsAttempted = 1;
      record.status = "EXTRACTING_CONTRACT";
      await persist();
      account = sha256(inference.apiKey);
      ledgerBefore = store.spent(account);
      provider = new NebiusProposer({
        ...inference,
        requestPolicy: "nemotron-low-effort-v1",
        fetch: async (url, init) => {
          record.inferenceRequestsAttempted++;
          await persist();
          return fetch(url, init);
        },
        onCompletion: async (completion) => {
          record.modelResponses.push({
            at: new Date().toISOString(),
            ...completion,
          });
          await persist();
        },
        onDiagnostic: async (diagnostic) => {
          if (diagnostic.reservationId)
            store!.recordDiagnostic(diagnostic.reservationId, diagnostic);
          record.providerDiagnostics.push(diagnostic);
          await persist();
        },
        profile: "clsx-object-push",
        budgetUsd: 0.1,
        reserve: (amount) => {
          const charge = store!.reserve(account!, amount, developmentCap);
          record.inferenceReservations.push({
            id: charge,
            at: new Date().toISOString(),
          });
          return charge;
        },
        settle: (charge, amount) => store!.settle(charge, amount),
      });
      const model = await provider.extract(repair.report, signal);
      record.usage.push(...provider.takeUsage());
      record.proposedContract = model;
      await persist();
      if (!model.contract) {
        record.status = "NEEDS_CLARIFICATION";
        record.clarification = model.clarification;
        throw Error("Model did not supply a grounded contract");
      }
      const contract = ClsxContractSchema.parse(
        groundContract(repair.report, model.contract, "clsx-object-push"),
      );
      const tests = compileTests(
        contract.expectations.map(({ sourceQuote: _, ...p }) => p),
      );
      record.contract = contract;
      record.core = {
        tests,
        hash: sha256(tests),
        expectationsHash: sha256(JSON.stringify(contract.expectations)),
        frozenAt: new Date().toISOString(),
      };
      await persist();
      const originals = [];
      for (let i = 0; i < 2; i++) {
        const observed = await observe(
          repair.source,
          tests,
          contract.expectations,
        );
        originals.push(observed);
        record.originalExecutions.push(observed.execution);
        await persist();
      }
      const ids = new Set(
        record.originalExecutions.map((e: Execution) => e.operationId),
      );
      if (
        ids.size !== 3 ||
        originals.some(
          (o) => !o.result.valid || !o.result.rows.some((r) => !r.passed),
        ) ||
        JSON.stringify(originals[0].result.rows) !==
          JSON.stringify(originals[1].result.rows)
      )
        throw Error(
          "Original failure did not reproduce twice in fresh environments",
        );
      record.originalReproduction = originals.map((o) => o.result);
      let feedback =
        "The pinned original source reproducibly fails these report-derived observations: " +
        JSON.stringify(originals[0].result.rows);
      let previous: string | undefined;
      let selected: CandidateRecord | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        record.status = "REPAIRING";
        await persist();
        const patch = PatchSchema.extend({
          path: z.literal("src/index.js"),
        }).parse(
          await provider.repair(
            {
              source: repair.source,
              contract,
              tests,
              failure: feedback.slice(0, 4000),
              attempt,
              ...(previous ? { previous } : {}),
              repository: repair.repository,
            },
            signal,
          ),
        );
        record.usage.push(...provider.takeUsage());
        previous = patch.content;
        const candidate: CandidateRecord = {
          attempt,
          patch,
          sourceHash: sha256(patch.content),
          gates: [],
          executions: [],
          accepted: false,
        };
        record.candidates.push(candidate);
        await persist();
        try {
          candidate.gates.push(checkCandidateSource(patch.content));
        } catch {
          candidate.gates.push({
            name: "Candidate pure-source admission",
            passed: false,
            detail: "Proposal uses syntax outside the bounded pure clsx subset",
          });
          feedback =
            "The previous candidate was rejected before execution because it uses syntax outside the bounded pure clsx subset. Use function declarations, variables, loops, if, return, scalar operators, indexed reads, and Array.isArray only; no imports, ambient calls, property writes or prototype access.";
          await persist();
          continue;
        }
        const plan = getCandidatePlan(snapshot, patch.content);
        const template = await readFile(
          "repositories/clsx-baseline/candidate-stage.mjs",
          "utf8",
        );
        const stage = template.replace(
          "/*REPOLAB_CANDIDATE_STAGE_CONFIG*/ null",
          JSON.stringify({
            treeDigest: admission.dependency.treeDigest,
            files: plan.files.map(({ path, sha256 }) => ({ path, sha256 })),
          }),
        );
        const controlsSource = await readFile(
          "repositories/clsx-baseline/candidate-controls.mjs",
          "utf8",
        );
        record.status = "STAGING_CANDIDATE";
        await persist();
        const staged = await run(config.image, {
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
            {
              path: "/opt/repolab/candidate-controls.mjs",
              content: controlsSource,
            },
          ],
        });
        candidate.executions.push(staged.execution);
        candidate.stagedImage = staged.resultImage!;
        candidate.gates.push(
          checkCandidateStage(
            plan,
            admission.dependency.treeDigest,
            staged.execution,
            config.image,
            sha256(stage),
            staged.resultImage,
          ),
        );
        await persist();
        const fsControls = await run(staged.resultImage!, {
          phase: "candidate-controls",
          files: [],
          sourceHash: plan.sourceHash,
          testHash: sha256(controlsSource),
        });
        candidate.executions.push(fsControls.execution);
        candidate.gates.push(
          checkCandidateControls(
            patch.content,
            fsControls.execution,
            staged.resultImage!,
            sha256(controlsSource),
          ),
        );
        await persist();
        const upstream = await run(staged.resultImage!, {
          phase: "candidate-baseline",
          files: [],
          sourceHash: plan.sourceHash,
          testHash: plan.runnerHash,
        });
        candidate.executions.push(upstream.execution);
        candidate.gates.push(
          checkCandidateBaseline(
            snapshot,
            patch.content,
            upstream.execution,
            staged.resultImage!,
          ),
        );
        await persist();
        const core = await observe(patch.content, tests, contract.expectations);
        candidate.executions.push(core.execution);
        candidate.gates.push({
          name: "Frozen report-derived core",
          passed: core.result.valid && core.result.rows.every((r) => r.passed),
          detail: core.result.valid
            ? JSON.stringify(core.result.rows)
            : "Report observation process incomplete",
        });
        const preserved = await observe(
          patch.content,
          controlsTests,
          qualification.baselineControls,
        );
        candidate.executions.push(preserved.execution);
        candidate.gates.push({
          name: "Original behavioral controls",
          passed:
            preserved.result.valid &&
            preserved.result.rows.every((r) => r.passed),
          detail: "Eight expectations from the unchanged upstream tests",
        });
        await persist();
        if (candidate.gates.every((g) => g.passed)) {
          record.status = "FRESH_VERIFICATION";
          await persist();
          const freshCore = await observe(
            patch.content,
            tests,
            contract.expectations,
          );
          const freshUpstream = await run(staged.resultImage!, {
            phase: "candidate-baseline",
            files: [],
            sourceHash: plan.sourceHash,
            testHash: plan.runnerHash,
          });
          candidate.executions.push(
            freshCore.execution,
            freshUpstream.execution,
          );
          candidate.gates.push(
            {
              name: "Fresh frozen core",
              passed:
                freshCore.result.valid &&
                freshCore.result.rows.every((r) => r.passed) &&
                JSON.stringify(core.result.rows) ===
                  JSON.stringify(freshCore.result.rows),
              detail:
                "Report-derived observations repeated in a fresh disposable operation",
            },
            checkCandidateBaseline(
              snapshot,
              patch.content,
              freshUpstream.execution,
              staged.resultImage!,
            ),
          );
          candidate.gates.push({
            name: "Fresh execution identities",
            passed:
              new Set(candidate.executions.map((e) => e.operationId)).size ===
                candidate.executions.length &&
              new Set(candidate.executions.map((e) => e.id)).size ===
                candidate.executions.length,
            detail: "Distinct provider operations and execution records",
          });
          candidate.accepted = candidate.gates.every((g) => g.passed);
          if (candidate.accepted) selected = candidate;
        }
        await persist();
        if (selected) break;
        feedback =
          "Previous candidate failed report-derived or unchanged upstream acceptance gates: " +
          candidate.gates
            .filter((g) => !g.passed)
            .map((g) => g.name + ": " + g.detail)
            .join("; ");
      }
      // Immutable pre-evaluation selection, including abstention. No repair calls after this.
      const decision = {
        format: "repolab-clsx-pilot-decision/v1",
        runId: id,
        protocolDigest: protocol.digest,
        certificateDigest: admission.certificateDigest,
        at: new Date().toISOString(),
        accepted: !!selected,
        attempt: selected?.attempt ?? null,
        sourceHash: selected?.sourceHash ?? null,
        source: selected?.patch.content ?? null,
        coreHash: record.core.hash,
        expectationsHash: record.core.expectationsHash,
        candidateHashes: record.candidates.map(
          (c: CandidateRecord) => c.sourceHash,
        ),
      };
      const decisionPath = path + ".decision.json";
      const decisionBytes = JSON.stringify(decision, null, 2) + "\n";
      await writeFile(decisionPath, decisionBytes, { mode: 0o600, flag: "wx" });
      record.decision = {
        path: decisionPath,
        sha256: sha256(decisionBytes),
        ...decision,
      };
      record.status = "INDEPENDENT_EVALUATION";
      record.independentOpenedAt = new Date().toISOString();
      await persist();
      // The independent evaluator/reference remain outside all model messages and feedback.
      const { getClsxEvaluationPlan } = await import("../evaluation/clsx.ts");
      const evaluation = getClsxEvaluationPlan(snapshot);
      const evaluatedSource = selected?.patch.content ?? repair.source;
      const evaluated = await observe(
        evaluatedSource,
        evaluation.tests,
        evaluation.cases,
      );
      record.independent = {
        selected: !!selected,
        sourceHash: sha256(evaluatedSource),
        caseFileHash: evaluation.caseFileHash,
        testHash: evaluation.testHash,
        execution: evaluated.execution,
        ...evaluated.result,
        total: evaluation.cases.length,
        passed: evaluated.result.valid
          ? evaluated.result.rows.filter((r) => r.passed).length
          : null,
      };
      const intact = (await readFile(decisionPath, "utf8")) === decisionBytes;
      record.selectionIntegrity = intact;
      record.success =
        !!selected &&
        intact &&
        evaluated.result.valid &&
        evaluated.result.rows.every((r) => r.passed);
      record.status = record.success
        ? "VERIFIED_FOR_TESTED_SCENARIOS"
        : selected
          ? "INDEPENDENT_EVALUATION_FAILED"
          : "PATCH_REJECTED";
      record.repairSuccess = {
        numerator: record.success ? 1 : 0,
        denominator: 1,
      };
    } catch {
      // Provider errors may contain arbitrary text. Retain safe stage, usage and raw
      // operation evidence rather than copying secrets or remote exceptions.
      record.failedStage = record.status;
      if (!["NEEDS_CLARIFICATION"].includes(record.status))
        record.status = signal.aborted ? "CANCELLED" : "PILOT_ERROR";
      record.error =
        "Pilot stopped; inspect retained stage, candidate, usage and operation evidence. No automatic workflow retry.";
      record.success = false;
      record.repairSuccess = {
        numerator: 0,
        denominator: record.qualifiedBugWorkflowsAttempted,
      };
    } finally {
      if (provider) record.usage.push(...provider.takeUsage());
      record.inferenceCalls = record.usage.length;
      record.usageComplete =
        record.inferenceRequestsAttempted === record.inferenceCalls;
      record.estimatedInferenceUsd = record.usage.reduce(
        (sum: number, u: Usage) => sum + u.costUsd,
        0,
      );
      if (store && account) {
        record.ledgerBeforeUsd = ledgerBefore;
        record.ledgerAfterUsd = store.spent(account);
      }
      record.completedAt = new Date().toISOString();
      await persist();
    }
    return record;
  } finally {
    await release?.();
  }
}

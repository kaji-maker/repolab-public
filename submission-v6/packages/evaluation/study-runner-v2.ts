import { readFileSync } from "node:fs";
import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import {
  NebiusProposer,
  configFromEnv,
  BudgetError,
  ProviderError,
} from "../providers/nebius.ts";
import { PatchSchema } from "../contracts/index.ts";
import type {
  BehaviorContract,
  Execution,
  Gate,
  Usage,
} from "../contracts/index.ts";
import { extractExplicitContract } from "../providers/fixture.ts";
import { Store } from "../storage/store.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import { sandboxScope } from "../execution/readiness.ts";
import { admitClsxPilot } from "../repositories/admission.ts";
import { clsxSnapshot } from "../repositories/repair-artifacts.ts";
import { acquireRepairLease } from "../repositories/repair-lease.ts";
import { compileTests } from "../controller/tests.ts";
import type { TestProbe } from "../controller/tests.ts";
import { auditStudy } from "./study-protocol-v2.ts";
import { studyTask, acceptanceSuites } from "./study-tasks.ts";
import type { StudyTaskId, Arm } from "./study-tasks.ts";
import {
  checkStudySource,
  SourceAdmissionError,
  repairSystem,
} from "./study-policy-v2.ts";
import {
  extractGroundedContract,
  ContractAdmissionError,
} from "./study-contract-v2.ts";
import {
  studyRemote,
  observationSpec,
  checkedObservation,
  stageStudyCandidate,
} from "./study-execution.ts";
import type { StudyRemote } from "./study-execution.ts";

export interface StudyRecord {
  format: "repolab-study-run/v2";
  id: string;
  studyDigest: string;
  task: StudyTaskId;
  arm: Arm;
  repetition: 1;
  startedAt: string;
  completedAt?: string;
  qualified: boolean;
  status: string;
  failedStage?: string;
  provenance: {
    inference: "nebius" | "simulation" | "none";
    execution: "nebius-sandbox" | "simulation" | "none";
  };
  candidates: {
    attempt: number;
    source: string;
    sourceHash: string;
    gates: Gate[];
    accepted: boolean;
  }[];
  executions: Execution[];
  operations: unknown[];
  modelResponses: unknown[];
  diagnostics: unknown[];
  reservations: string[];
  usage: Usage[];
  requests: number;
  operationAttempts: number;
  decision?: { path: string; sha256: string; payload: any };
  independentOpenedAt?: string;
  independent?: {
    valid: boolean;
    passed: number | null;
    total: number;
    sourceHash: string;
  };
  selectionIntact?: boolean;
  accepted: boolean;
  correct: boolean | null;
  usageComplete: boolean;
  estimatedInferenceUsd: number;
  error?: string;
  contractOutcome?: {
    kind: "GROUNDED" | "NEEDS_FACTS" | "INVALID_OUTPUT" | "UNGROUNDED";
    clarification?: string;
  };
}
type InferencePick = Pick<NebiusProposer, "structured" | "takeUsage">;
interface Options {
  directory: string;
  leaseDirectory?: string;
  signal?: AbortSignal;
  config?: SandboxConfig;
  remote?: StudyRemote;
  proposer?: InferencePick;
  store?: Store;
  admitted?: { dependency: { treeDigest: string } };
  qualificationPath?: string;
}
const strip = (probes: any[]) =>
  probes.map(({ sourceQuote: _, source: __, ...p }) => p) as TestProbe[];
export async function runStudySlot(
  taskId: StudyTaskId,
  arm: Arm,
  options: Options,
) {
  const protocol = auditStudy(),
    id = randomUUID(),
    signal = options.signal ?? new AbortController().signal;
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const path = join(options.directory, `${taskId}-${arm}.json`),
    record: StudyRecord = {
      format: "repolab-study-run/v2",
      id,
      studyDigest: protocol.digest,
      task: taskId,
      arm,
      repetition: 1,
      startedAt: new Date().toISOString(),
      qualified: false,
      status: "ADMITTING",
      provenance: { inference: "none", execution: "none" },
      candidates: [],
      executions: [],
      operations: [],
      modelResponses: [],
      diagnostics: [],
      reservations: [],
      usage: [],
      requests: 0,
      operationAttempts: 0,
      accepted: false,
      correct: null,
      usageComplete: true,
      estimatedInferenceUsd: 0,
    };
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  const persist = async () => {
    const temp = path + "." + randomUUID();
    await writeFile(temp, JSON.stringify(record, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path);
  };
  const store = options.store ?? new Store(".repolab/state.sqlite");
  let release: (() => Promise<void>) | undefined,
    provider: InferencePick | undefined;
  try {
    signal.throwIfAborted();
    release = await acquireRepairLease(
      options.leaseDirectory ?? ".repolab/repositories",
      id,
    );
    const config = options.config ?? sandboxConfigFromEnv(),
      admission = options.admitted ?? admitClsxPilot(clsxSnapshot(), config);
    if (!options.remote) {
      if (!options.qualificationPath)
        throw Error("Study qualification required");
      await validateQualification(
        JSON.parse(await readFile(options.qualificationPath, "utf8")),
        config,
      );
    }
    const rawRemote =
        options.remote ??
        studyRemote(config, async (op) => {
          record.operations.push(structuredClone(op));
          await persist();
        }),
      seen = new Set<string>(),
      executionIds = new Set<string>();
    const run: StudyRemote = async (image, spec) => {
      signal.throwIfAborted();
      if (++record.operationAttempts > protocol.maxOperations)
        throw Error("Operation cap reached");
      await persist();
      const out = await rawRemote(image, spec, signal);
      record.executions.push(out.execution);
      record.provenance.execution = options.remote
        ? "simulation"
        : "nebius-sandbox";
      await persist();
      const e = out.execution;
      if (
        e.provider !== "nebius-sandbox" ||
        e.image !== image ||
        e.runtimeVersion !== "v24.18.0" ||
        !z.uuid().safeParse(e.id).success ||
        !z.uuid().safeParse(e.operationId).success ||
        seen.has(e.operationId!) ||
        executionIds.has(e.id) ||
        e.sourceHash !== spec.sourceHash ||
        e.testHash !== spec.testHash
      )
        throw Error("Execution identity/runtime mismatch");
      seen.add(e.operationId!);
      executionIds.add(e.id);
      return out;
    };
    const task = studyTask(taskId),
      observe = async (source: string, probes: TestProbe[]) => {
        const spec = observationSpec(taskId, task.path, source, probes),
          out = await run(config.image, spec);
        return checkedObservation(out.execution, spec, config.image, probes);
      };
    record.status = "QUALIFYING_ORIGINAL";
    await persist();
    const original = await observe(task.source, task.baseline);
    if (!original.valid || !original.rows.every((r) => r.passed))
      throw Error("Original baseline fails");
    record.qualified = true;
    if (store.hasUnsettledCharges() || store.totalSpent() + 0.1 > 4)
      throw Error("Ledger or development budget blocks inference");
    const inference = configFromEnv();
    if (
      !options.proposer &&
      (inference.model !== protocol.model ||
        inference.inputRate !== protocol.rates.input ||
        inference.outputRate !== protocol.rates.output)
    )
      throw Error("Inference differs from frozen settings");
    const account = sha256(inference.apiKey);
    provider =
      options.proposer ??
      new NebiusProposer({
        ...inference,
        profile: taskId,
        budgetUsd: 0.1,
        requestPolicy: "nemotron-low-effort-v1",
        fetch: async (url, init) => {
          record.requests++;
          record.provenance.inference = "nebius";
          await persist();
          return fetch(url, init);
        },
        reserve: (amount) => {
          const reservation = store.reserve(account, amount, 4);
          record.reservations.push(reservation);
          return reservation;
        },
        settle: (charge, amount) => store.settle(charge, amount),
        onCompletion: async (completion) => {
          record.modelResponses.push(structuredClone(completion));
          await persist();
        },
        onDiagnostic: async (diagnostic) => {
          if (diagnostic.reservationId)
            store.recordDiagnostic(diagnostic.reservationId, diagnostic);
          record.diagnostics.push(diagnostic);
          await persist();
        },
      });
    if (options.proposer) record.provenance.inference = "simulation";
    let contract: BehaviorContract | undefined,
      core: TestProbe[] = [],
      challenges: TestProbe[] = [],
      failure = "",
      previous: string | undefined;
    if (arm !== "A") {
      record.status = "EXTRACTING";
      await persist();
      const result = await extractGroundedContract(
        provider,
        taskId,
        task.report,
        signal,
      );
      record.usage.push(...provider.takeUsage());
      await persist();
      if (result.kind === "NEEDS_FACTS") {
        record.contractOutcome = result;
        record.status = "NEEDS_CLARIFICATION";
        return record;
      }
      contract = result.contract;
      record.contractOutcome = { kind: "GROUNDED" };
      core = strip(contract.expectations.slice(0, 1));
      challenges = strip(contract.expectations.slice(1));
      const tests = compileTests(core);
      await writeFile(
        path + ".core.json",
        JSON.stringify(
          {
            tests,
            sha256: sha256(tests),
            expectations: core,
            frozenAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      record.status = "REPRODUCING";
      await persist();
      const before = [];
      for (let i = 0; i < 2; i++) before.push(await observe(task.source, core));
      if (
        before.some((r) => !r.valid || !r.rows.some((p) => !p.passed)) ||
        JSON.stringify(before[0].rows) !== JSON.stringify(before[1].rows)
      ) {
        record.status = "COULD_NOT_REPRODUCE";
        return record;
      }
      failure = JSON.stringify(before[0].rows);
      if (arm === "C" && challenges.length) {
        const out = await observe(task.source, challenges);
        if (!out.valid) throw Error("Challenge setup fails");
      }
    }
    let selected: StudyRecord["candidates"][number] | undefined;
    for (let attempt = 1; attempt <= protocol.maxCandidates; attempt++) {
      record.status = "REPAIRING";
      await persist();
      const context = {
        source: task.source,
        report: task.report,
        path: task.path,
        originalBaseline: task.baseline,
        repository: task.repository,
        ...(arm !== "A"
          ? { contract, tests: compileTests(core), failure }
          : {}),
        ...(previous ? { previous, feedback: failure } : {}),
        attempt,
      };
      const patch = await provider.structured(
        "study_repair",
        repairSystem,
        JSON.stringify(context),
        PatchSchema.extend({ path: z.literal(task.path) }),
        signal,
      );
      record.usage.push(...provider.takeUsage());
      const candidate = {
        attempt,
        source: patch.content,
        sourceHash: sha256(patch.content),
        gates: [] as Gate[],
        accepted: false,
      };
      record.candidates.push(candidate);
      previous = patch.content;
      await persist();
      try {
        candidate.gates.push(checkStudySource(taskId, patch.content));
      } catch (error) {
        if (!(error instanceof SourceAdmissionError)) throw error;
        candidate.gates.push({
          name: "Common pure-source safety",
          passed: false,
          detail: JSON.stringify(error.diagnostic()),
        });
        failure = `Source admission ${error.kind}/${error.code}: ${error.message} No candidate behavior was executed. Return complete valid source inside the declared subset.`;
        await persist();
        continue;
      }
      candidate.gates.push({
        name: "Distinct source-only candidate",
        passed:
          candidate.sourceHash !== sha256(task.source) &&
          !record.candidates
            .slice(0, -1)
            .some((c) => c.sourceHash === candidate.sourceHash),
        detail: "Original source and candidate hashes are distinct",
      });
      if (!candidate.gates.at(-1)!.passed) {
        failure =
          "Proposal did not change original source or repeated a prior candidate.";
        await persist();
        continue;
      }
      record.status = "VERIFYING";
      await persist();
      const protectedCandidate =
        taskId === "clsx-object-push"
          ? await stageStudyCandidate(
              patch.content,
              admission.dependency.treeDigest,
              config.image,
              run,
              signal,
            )
          : undefined;
      if (protectedCandidate) candidate.gates.push(...protectedCandidate.gates);
      for (const suite of acceptanceSuites(arm, challenges.length > 0)) {
        if (
          (suite === "baseline" || suite === "fresh-baseline") &&
          protectedCandidate
        )
          candidate.gates.push({
            ...(await protectedCandidate.baseline()),
            name: suite,
          });
        else {
          const probes = suite.includes("baseline")
            ? task.baseline
            : suite === "challenge"
              ? challenges
              : core;
          const out = await observe(patch.content, probes);
          candidate.gates.push({
            name: suite,
            passed: out.valid && out.rows.every((r) => r.passed),
            detail: out.valid
              ? JSON.stringify(out.rows)
              : "Incomplete observations",
          });
        }
      }
      candidate.accepted = candidate.gates.every((g) => g.passed);
      await persist();
      if (candidate.accepted) {
        selected = candidate;
        break;
      }
      failure = candidate.gates
        .filter((g) => !g.passed)
        .map((g) => g.name + ": " + g.detail)
        .join("; ")
        .slice(0, 4000);
    }
    record.accepted = Boolean(selected);
    const payload = {
      format: "repolab-study-selection/v2",
      runId: id,
      studyDigest: protocol.digest,
      task: taskId,
      arm,
      at: new Date().toISOString(),
      accepted: record.accepted,
      source: selected?.source ?? null,
      sourceHash: selected?.sourceHash ?? null,
      candidateHashes: record.candidates.map((c) => c.sourceHash),
    };
    const decisionPath = path + ".decision.json",
      bytes = JSON.stringify(payload, null, 2) + "\n";
    await writeFile(decisionPath, bytes, { mode: 0o600, flag: "wx" });
    record.decision = { path: decisionPath, sha256: sha256(bytes), payload };
    record.status = "INDEPENDENT_EVALUATION";
    record.independentOpenedAt = new Date().toISOString();
    await persist();
    const { studyOracle } = await import("./study-oracle.ts"),
      oracle = studyOracle(taskId),
      evaluated = selected?.source ?? task.source,
      out = await observe(evaluated, oracle.cases);
    record.selectionIntact = (await readFile(decisionPath, "utf8")) === bytes;
    record.independent = {
      valid: out.valid,
      passed: out.valid ? out.rows.filter((r) => r.passed).length : null,
      total: oracle.cases.length,
      sourceHash: sha256(evaluated),
    };
    record.correct =
      record.accepted && record.selectionIntact && out.valid
        ? out.rows.every((r) => r.passed)
        : record.accepted
          ? null
          : false;
    record.status =
      !record.selectionIntact || !out.valid
        ? "EVALUATION_ERROR"
        : record.accepted
          ? record.correct
            ? "ACCEPTED_INDEPENDENTLY_CORRECT"
            : "ACCEPTED_INDEPENDENTLY_INCORRECT"
          : "ABSTAINED";
  } catch (error) {
    record.failedStage = record.status;
    if (error instanceof ContractAdmissionError)
      record.contractOutcome = { kind: error.code };
    else if (
      record.status === "EXTRACTING" &&
      (record.diagnostics.at(-1) as any)?.outcome === "invalid_output"
    )
      record.contractOutcome = { kind: "INVALID_OUTPUT" };
    record.status = signal.aborted
      ? "CANCELLED"
      : error instanceof BudgetError
        ? "BUDGET_ERROR"
        : error instanceof ContractAdmissionError
          ? "CONTRACT_ERROR"
          : error instanceof ProviderError
            ? "PROVIDER_ERROR"
            : "ENVIRONMENT_ERROR";
    record.error = "Stopped with prior evidence retained; no automatic retry.";
  } finally {
    if (provider) record.usage.push(...provider.takeUsage());
    record.usageComplete = options.proposer
      ? true
      : record.requests === record.usage.length;
    record.estimatedInferenceUsd = record.usage.reduce(
      (n, u) => n + u.costUsd,
      0,
    );
    record.completedAt = new Date().toISOString();
    await persist();
    await release?.();
    if (!options.store) store.close();
  }
  return record;
}

export async function prepareStudy(
  directory: string,
  signal = new AbortController().signal,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const protocol = auditStudy(),
    config = sandboxConfigFromEnv(),
    admission = admitClsxPilot(clsxSnapshot(), config),
    id = randomUUID(),
    release = await acquireRepairLease(".repolab/repositories", id);
  const record: any = {
    format: "repolab-study-qualification/v2",
    id,
    studyDigest: protocol.digest,
    scope: sandboxScope(config),
    verifiedAt: new Date().toISOString(),
    provenance: {
      inference: "none",
      execution: "nebius-sandbox; reviewed originals/references",
    },
    qualified: false,
    checks: [],
    operations: [],
  };
  const path = join(directory, `qualification-${id}.json`);
  const persist = () =>
    writeFile(path, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  try {
    await persist();
    const remote = studyRemote(config, async (op) => {
        record.operations.push(op);
        await persist();
      }),
      { studyOracle } = await import("./study-oracle.ts");
    for (const taskId of [
      "booking-timezone",
      "checkout-quantity",
      "clsx-object-push",
    ] as const) {
      const task = studyTask(taskId),
        oracle = studyOracle(taskId),
        contract = extractExplicitContract(task.report, taskId)!;
      for (const [variant, source, probes] of [
        ["original-baseline", task.source, task.baseline],
        ["original-report", task.source, strip(contract.expectations)],
        ["reference-evaluation", oracle.reference, oracle.cases],
        ["weak-evaluation", oracle.weak, oracle.cases],
      ] as const) {
        signal.throwIfAborted();
        const spec = observationSpec(taskId, task.path, source, probes),
          out = await remote(config.image, spec, signal),
          checked = checkedObservation(
            out.execution,
            spec,
            config.image,
            probes,
          );
        record.checks.push({
          task: taskId,
          variant,
          execution: out.execution,
          valid: checked.valid,
          rows: checked.rows,
        });
        await persist();
      }
    }
    record.qualified = true;
    record.completedAt = new Date().toISOString();
    await persist();
    await validateQualification(record, config);
    return { path, record };
  } catch {
    record.qualified = false;
    record.error =
      "Qualification failed; retain evidence and do not run inference";
    record.completedAt = new Date().toISOString();
    await persist();
    throw Error(record.error);
  } finally {
    await release();
  }
}
export async function validateQualification(
  record: any,
  config: SandboxConfig,
) {
  const protocol = auditStudy(),
    age = Date.now() - Date.parse(record.verifiedAt);
  if (
    record.format !== "repolab-study-qualification/v2" ||
    record.studyDigest !== protocol.digest ||
    record.scope !== sandboxScope(config) ||
    record.qualified !== true ||
    age < 0 ||
    age >= 86400000 ||
    record.checks?.length !== 12
  )
    throw Error("Qualification metadata mismatch");
  // Recompute validity from fixed local source/probe identities, never saved verdict flags.
  const ids = new Set<string>(),
    executionIds = new Set<string>(),
    { studyOracle } = await import("./study-oracle.ts");
  for (const taskId of [
    "booking-timezone",
    "checkout-quantity",
    "clsx-object-push",
  ] as const) {
    const task = studyTask(taskId),
      oracle = studyOracle(taskId),
      cases = oracle.cases;
    const checks = record.checks.filter((c: any) => c.task === taskId);
    if (
      checks.length !== 4 ||
      new Set(checks.map((c: any) => c.variant)).size !== 4
    )
      throw Error("Missing qualification variants");
    for (const c of checks) {
      const probes =
        c.variant === "original-baseline"
          ? task.baseline
          : c.variant === "original-report"
            ? strip(extractExplicitContract(task.report, taskId)!.expectations)
            : cases;
      // Reference/weak source hashes bind to the reviewed fixtures; function import is data only.
      const e = c.execution,
        spec = {
          phase: "observations" as const,
          files: [],
          sourceHash: e.sourceHash,
          testHash: sha256(compileTests(probes)),
        },
        r = checkedObservation(e, spec, config.image, probes);
      if (
        !r.valid ||
        ids.has(e.operationId) ||
        executionIds.has(e.id) ||
        !z.uuid().safeParse(e.id).success
      )
        throw Error("Qualification execution invalid");
      ids.add(e.operationId);
      executionIds.add(e.id);
      if (
        (c.variant === "original-baseline" ||
          c.variant === "original-report") &&
        e.sourceHash !== sha256(task.source)
      )
        throw Error("Original qualification source differs");
      if (
        (c.variant === "reference-evaluation" &&
          e.sourceHash !== sha256(oracle.reference)) ||
        (c.variant === "weak-evaluation" &&
          e.sourceHash !== sha256(oracle.weak))
      )
        throw Error("Reviewed reference/weak identity differs");
      if (
        c.variant === "original-baseline" ||
        c.variant === "reference-evaluation"
      ) {
        if (!r.rows.every((p) => p.passed))
          throw Error("Baseline/reference did not pass");
      } else if (
        !r.rows.some((p) => !p.passed) ||
        (c.variant === "weak-evaluation" && !r.rows[0].passed)
      )
        throw Error("Failure/weak control did not fail as qualified");
    }
  }
}

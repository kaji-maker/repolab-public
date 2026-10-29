import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { FreshPreactSandbox } from "../execution/preact-repair-v1.ts";
import type { NativeRemote } from "../execution/preact-replay-v1.ts";
import {
  REPAIR_FREEZE as PREACT_TRIAL_FREEZE,
  auditFreshPreact as auditTrialFreeze,
} from "./preact-repair-protocol-v1.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";
import { z } from "zod";

import {
  ADMISSION_PARENT,
  admissionRequest,
  parseAdmissionReceipt,
  validateAdmissionUpload,
} from "../execution/preact-admission-v5.ts";
import {
  trialInput,
  trialPatch,
  rejectedTrialReceipt,
} from "../execution/preact-trial-v10.ts";
import { admissionObservations } from "../evaluation/preact-admission-v5.ts";
import {
  shaNative,
  checkedNativeSuite,
  nativeIntegrity,
  nativeTypeCounts,
} from "../evaluation/preact-native-v5.ts";
import {
  auditTrialFreeze as auditPreviousFreeze,
  trialSettings,
  trialContext,
  trialSystem,
  trialProposalSchema,
  trialModelRequest,
  candidateStages,
  validateTrialModelRequest,
  assertTrialNoCredentials,
  validateThinkingQualificationRawHashes,
} from "../evaluation/preact-trial-v10.ts";
import {
  auditOwnedSources as auditCompiledOwnedSources,
  validateOwnershipRecord as validateCompiledOwnershipRecord,
} from "../repositories/preact-ownership-v1.ts";
import {
  admitGeneratedPreactEdit as admitPreactEdit,
  generationAdmissionFeedback as preactAdmissionFeedback,
  generationBodyDiagnostics as preactBodyDiagnostics,
  compileGeneratedProposal,
} from "../repositories/preact-generation-v2.ts";
import { acquireRepairLease } from "../repositories/repair-lease.ts";
import { configFromEnv } from "../providers/nebius.ts";
import { NebiusThinkingProposer as NebiusProposer } from "../providers/nebius-thinking-v1.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { sandboxScope } from "../execution/readiness.ts";
import { preactNativeFeedback } from "../repositories/preact-diagnostics-v2.ts";
import { Store } from "../storage/store.ts";
import { preactPublicFeedback } from "../repositories/preact-public-feedback-v1.ts";

const auditOwnedSources = (value: unknown, files: unknown, hash: string) =>
  auditCompiledOwnedSources(compileGeneratedProposal(value), files, hash);
const validateOwnershipRecord = (
  value: unknown,
  files: unknown,
  hash: string,
  record: unknown,
) =>
  validateCompiledOwnershipRecord(
    compileGeneratedProposal(value),
    files,
    hash,
    record,
  );

export const REPAIR_ROOT = ".repolab/native-preact-repairs";
export interface FreshRepairOptions {
  id?: string;
  root?: string;
  signal?: AbortSignal;
  entrypoint?: "api" | "cli" | "simulation";
  simulation?: {
    fetch: typeof fetch;
    remote: (
      directory: string,
      variant: string,
      proposal: unknown,
    ) => NativeRemote;
  };
}
function qualifiedThinkingRequest() {
  // Public qualification is pinned by the inherited v10 freeze. No historical
  // private receipts or previous model answers enter a fresh repair request.
  auditPreviousFreeze();
  return JSON.parse(
    readFileSync(
      "evaluation/preact-thinking-schema-v1-results-summary.json",
      "utf8",
    ),
  ).result;
}
function auditPreactAdmissionRun() {
  return JSON.parse(
    readFileSync("evaluation/preact-admission-v5-results-summary.json", "utf8"),
  );
}
function auditNativeRun() {
  return JSON.parse(
    readFileSync("evaluation/preact-native-v5-results-summary.json", "utf8"),
  );
}
export function createFreshPreactSession(
  directory: string,
  options: FreshRepairOptions = {},
) {
  const signal = options.signal ?? new AbortController().signal;
  const simulation = options.simulation;
  const id = z.uuid().parse(options.id ?? directory.split("repair-").at(-1));
  if (
    simulation &&
    (options.entrypoint !== "simulation" ||
      !options.root ||
      resolve(options.root).startsWith(resolve(".repolab")))
  )
    throw Error("Simulation hooks require an explicit isolated test directory");
  class NativeRejection extends Error {
    feedback: unknown;
    constructor(feedback: unknown) {
      super("Candidate native gate rejected");
      this.feedback = feedback;
    }
  }
  const read = (name: string) =>
    (() => {
      if (!/^[A-Za-z0-9-]+$/.test(name))
        throw Error("Invalid evidence record name");
      const path = join(directory, name + ".json");
      const st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 8_000_000)
        throw Error("Invalid private evidence file");
      const value = JSON.parse(readFileSync(path, "utf8"));
      assertNativeNoSecrets(value);
      return value;
    })();
  async function save(name: string, value: unknown, exclusive = false) {
    assertNativeNoSecrets(value);
    await writeFile(
      join(directory, name + ".json"),
      JSON.stringify(value, null, 2) + "\n",
      {
        mode: 0o600,
        ...(exclusive ? { flag: "wx" } : {}),
      },
    );
  }
  function validateTrialGate(stage: string, guest: any) {
    if (stage === "integrity") return nativeIntegrity(guest);
    if (stage.startsWith("mocha"))
      return checkedNativeSuite(guest.mocha, "mocha");
    if (stage.startsWith("browser"))
      return checkedNativeSuite(guest.browser, "browser");
    if (stage === "types") return nativeTypeCounts(guest.commands[0].stdout);
    if (stage.startsWith("public"))
      return admissionObservations(guest.observations, "public");
    if (stage.startsWith("independent"))
      return admissionObservations(guest.observations, "independent");
    return null;
  }
  function oldArtifacts() {
    const files: { path: string; sha256: string }[] = [];
    const walk = (p: string) => {
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const path = join(p, e.name);
        if (e.isDirectory()) walk(path);
        else if (e.isFile() && path.endsWith(".json"))
          files.push({ path, sha256: shaNative(readFileSync(path)) });
      }
    };
    for (const e of readdirSync(".repolab", { withFileTypes: true }))
      if (
        e.isDirectory() &&
        /^preact-(native|admission|trial)-v\d+$/.test(e.name)
      )
        walk(join(".repolab", e.name));
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  function checkOldArtifacts(files: { path: string; sha256: string }[]) {
    if (
      !files.length ||
      files.some((f) => shaNative(readFileSync(f.path)) !== f.sha256)
    )
      throw Error("Prior Preact evidence changed");
  }
  function requireTrialSelectionGates(
    stages: string[],
    publicA: unknown,
    publicB: unknown,
  ) {
    if (JSON.stringify(stages) !== JSON.stringify(candidateStages))
      throw Error("Selection requires all fixed native/public stages");
    const a = admissionObservations(publicA, "public"),
      b = admissionObservations(publicB, "public");
    if (
      a.passed !== a.total ||
      b.passed !== b.total ||
      JSON.stringify(a.rows) !== JSON.stringify(b.rows)
    )
      throw Error(
        "Selection requires two matching passing public observations",
      );
  }
  function summary(r: any) {
    return {
      id,
      simulated: !!simulation,
      format: "repolab-native-preact-repair-result/v1",
      freeze: r.freeze,
      status: r.status,
      verified: !simulation && r.status === "ACCEPTED_INDEPENDENTLY_CORRECT",
      startedAt: r.startedAt,
      completedAt: r.completedAt ?? null,
      error: r.error ?? null,
      executionUncertain: r.executionUncertain ?? false,
      entrypoint: r.entrypoint,

      taskId: trialSettings.taskId,
      provenance: r.provenance,
      requestPolicy: trialSettings.requestPolicy,
      comparisonScope: trialSettings.comparisonScope,
      reasoningChannels: r.requests.map((attempt: number) =>
        existsSync(join(directory, "completion-" + attempt + ".json"))
          ? (read("completion-" + attempt).choices[0].reasoning ?? null)
          : null,
      ),
      selected: 3,
      qualified: 1,
      modelAttempted: r.requests.length ? 1 : 0,
      unsupported: ["facebook__docusaurus-8927", "vuejs__core-11899"],
      candidates: r.attempts.map((a: any) => ({
        attempt: a.attempt,
        status: a.status,
        sourceHash: a.sourceHash ?? null,
        feedback: a.feedback ?? null,
        bodyDiagnostics: a.bodyDiagnostics ?? null,
        plan: a.proposal?.plan ?? null,
        ownership: a.ownership ?? null,
        program: a.proposal?.program ?? null,
      })),
      accepted: r.selection?.accepted ?? false,
      independentlyCorrect: r.correct ?? null,
      public: r.public ?? null,
      independent: r.independent ?? null,
      native: r.native ?? null,
      requests: r.requests.length,
      operations: r.operations.length,
      operationIds: r.operations
        .map((op: any) => read(op.name).id)
        .filter(Boolean),
      estimatedInferenceUsd: r.usage.reduce(
        (n: number, u: any) => n + u.costUsd,
        0,
      ),
      usageComplete: r.requests.length === r.usage.length,
      priorArtifacts: r.priorArtifacts.length,
      limitations: [
        "Required ownership/declaration/call scaffolding is developer-supplied; model instruction programs determine bounded control flow and actions.",
        "One scoped public Preact feature request; not hidden benchmark accuracy.",
        "Two selected repositories remain unsupported; no selected task is removed.",
        "Independent lifecycle checks are developer-authored and withheld from repair context.",
        "Same-project cached original image; separate-project portability is untested.",
        "Fresh repair uses the original qualified scoped profile; no hidden-task or cross-project accuracy claim.",
        "Native browser 11 original skips and TypeScript 2 pending cases remain disclosed.",
      ],
    };
  }

  /** Offline replay: reconstruct requests, source, uploads, native/public gates and selection before evaluation. */
  function auditPreactTrialRun() {
    auditTrialFreeze();
    const compatibility = qualifiedThinkingRequest();
    if (
      compatibility.status !== "QUALIFIED_THINKING_REQUEST" ||
      compatibility.qualification.schemaHash !==
        shaNative(
          JSON.stringify(
            trialModelRequest(trialContext(1)).response_format.json_schema
              .schema,
          ),
        )
    )
      throw Error("Exact nested schema compatibility unavailable");
    const qualified = auditPreactAdmissionRun(),
      parent = auditNativeRun();
    if (
      parent.protectedImage !== ADMISSION_PARENT ||
      qualified.status !== "QUALIFIED_SCOPED_ADMISSION"
    )
      throw Error("Preact trial qualification unavailable");
    const r = read("journal"),
      started = read("STARTED");
    if (
      !simulation &&
      (r.simulated ||
        r.provenance.inference !== "nebius" ||
        r.provenance.execution !== "nebius-sandbox")
    )
      throw Error("Fresh inference/execution provenance changed");
    if (
      r.id !== id ||
      started.id !== id ||
      r.format !== "repolab-native-preact-repair-journal/v1"
    )
      throw Error("Fresh run identity changed");
    if (
      r.freeze !== PREACT_TRIAL_FREEZE ||
      started.freeze !== r.freeze ||
      started.parent !== ADMISSION_PARENT
    )
      throw Error("Trial start binding changed");
    if (
      !r.attempts.length ||
      r.attempts.length > 3 ||
      r.attempts.some((a: any, i: number) => a.attempt !== i + 1) ||
      JSON.stringify(r.requests) !==
        JSON.stringify(r.attempts.map((a: any) => a.attempt))
    )
      throw Error("Fresh attempt slots changed");
    const expectedOperations = [
      { variant: "original", stage: "public-A", name: "original-public-A" },
      { variant: "original", stage: "public-B", name: "original-public-B" },
      ...r.attempts.flatMap((a: any) =>
        (a.stages ?? []).map((stage: string) => ({
          variant: "candidate-" + a.attempt,
          stage,
          name: "candidate-" + a.attempt + "-" + stage,
        })),
      ),
      ...(r.selection?.accepted
        ? ["independent-A", "independent-B"].map((stage) => ({
            variant: r.selection.variant,
            stage,
            name: r.selection.variant + "-" + stage,
          }))
        : []),
    ];
    if (
      JSON.stringify(
        r.operations.map((op: any) => ({
          variant: op.variant,
          stage: op.stage,
          name: op.name,
        })),
      ) !== JSON.stringify(expectedOperations)
    )
      throw Error("Fresh operation recipe/order changed");
    checkOldArtifacts(r.priorArtifacts);
    if (
      started.priorArtifactsHash !== shaNative(JSON.stringify(r.priorArtifacts))
    )
      throw Error("Prior artifact inventory changed");
    const historicalIds = JSON.parse(
      readFileSync("evaluation/preact-trial-v10-results-summary.json", "utf8"),
    ).result.operationIds;
    const ids = new Set([
      ...qualified.operationIds,
      ...parent.operationIds,
      ...historicalIds,
    ]);
    let lastTime = Date.parse(r.startedAt);
    const time = (value: string) => {
      if (
        typeof value !== "string" ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value
      )
        throw Error("Invalid evidence timestamp");
      return Date.parse(value);
    };
    time(r.startedAt);
    time(r.completedAt);
    const sourceHashes = new Set([trialInput(null).sourceHash]);
    const results: Record<
      string,
      ReturnType<typeof parseAdmissionReceipt>
    > = {};
    const images: Record<string, string> = { original: ADMISSION_PARENT };
    let independentSeen = false,
      selectedSeen = false;
    for (const op of r.operations) {
      const candidate = r.attempts.find(
        (a: any) => "candidate-" + a.attempt === op.variant,
      );
      const proposal =
        op.variant === "original"
          ? null
          : read("proposal-" + candidate?.attempt);
      const input = trialInput(proposal),
        raw = read(op.name),
        descriptors = read("uploads-" + op.variant);
      if (
        raw.variant !== op.variant ||
        raw.stage !== op.stage ||
        raw.sourceHash !== input.sourceHash ||
        raw.inference !==
          (op.variant === "original" ? "none (reviewed original)" : "nebius") ||
        raw.execution !==
          (simulation
            ? "simulation; source was not executed"
            : op.variant === "original"
              ? "nebius-sandbox; reviewed original"
              : "nebius-sandbox; model-generated scoped candidate")
      )
        throw Error("Trial receipt provenance/source changed");
      if (
        time(raw.startedAt) < lastTime ||
        time(raw.completedAt) < time(raw.startedAt)
      )
        throw Error("Operation chronology changed");
      lastTime = time(raw.completedAt);
      if (lastTime > time(r.completedAt))
        throw Error("Operation followed run completion");
      if (ids.has(raw.id)) throw Error("Prior or trial operation reused");
      ids.add(raw.id);
      if (
        op.receiptHash !==
        shaNative(readFileSync(join(directory, op.name + ".json")))
      )
        throw Error("Raw receipt changed");
      const files: Record<string, unknown> = {};
      for (const [path, bytes] of Object.entries(
        op.variant === "original" || op.stage === "build" ? input.files : {},
      )) {
        const d = descriptors.files[path];
        files[path] = validateAdmissionUpload(
          d,
          read("upload-" + d.recordName),
          path,
          bytes as Buffer,
        );
      }
      if (op.stage.startsWith("independent")) {
        const selection = read("selection");
        if (
          !selectedSeen ||
          !selection.accepted ||
          selection.variant !== op.variant ||
          selection.sourceHash !== raw.sourceHash
        )
          throw Error(
            "Independent evaluation preceded frozen source selection",
          );
        const d = descriptors.independent;
        const upload = read("upload-" + d.recordName);
        if (
          time(upload.startedAt) < time(selection.at) ||
          time(upload.startedAt) > time(raw.startedAt)
        )
          throw Error("Independent upload preceded selection");
        files["/opt/repolab/native/independent.html"] = validateAdmissionUpload(
          d,
          upload,
          "/opt/repolab/native/independent.html",
          readFileSync("evaluation/preact-admission-independent-v4.html"),
        );
        independentSeen = true;
      }
      for (const d of Object.values(descriptors.files) as any[]) {
        if (
          time(read("upload-" + d.recordName).startedAt) > time(raw.startedAt)
        )
          throw Error("Execution preceded upload");
      }
      images[op.variant] ??= ADMISSION_PARENT;
      if (
        JSON.stringify(raw.request) !==
        JSON.stringify(admissionRequest(op.stage, images[op.variant], files))
      )
        throw Error("Trial execution recipe changed");
      let result: ReturnType<typeof parseAdmissionReceipt>;
      try {
        result = parseAdmissionReceipt(
          raw.latest,
          op.stage,
          raw.id,
          images[op.variant],
          input.sourceHash,
        );
      } catch (e) {
        if (op.variant === "original") throw e;
        const rejected = rejectedTrialReceipt(
          raw.latest,
          op.stage,
          raw.id,
          images[op.variant],
          input.sourceHash,
        );
        if (
          candidate?.status !== "NATIVE_REJECTED" ||
          candidate.stages.at(-1) !== op.stage ||
          JSON.stringify(candidate.feedback) !==
            JSON.stringify(
              preactNativeFeedback(
                rejected.feedback,
                compileGeneratedProposal(proposal),
              ),
            )
        )
          throw Error("Native rejection changed");
        continue;
      }
      results[op.name] = result;
      validateTrialGate(op.stage, result.guest);
      if (op.stage === "build")
        images[op.variant] = result.op.result_image_uuid!;
      if (
        op.stage === "public-B" &&
        op.variant !== "original" &&
        r.selection?.variant === op.variant
      )
        selectedSeen = true;
    }
    const originalA = admissionObservations(
      results["original-public-A"].guest.observations,
      "public",
    );
    const originalB = admissionObservations(
      results["original-public-B"].guest.observations,
      "public",
    );
    if (
      JSON.stringify(originalA) !== JSON.stringify(originalB) ||
      JSON.stringify(originalA.failed) !== JSON.stringify(["returned-cleanup"])
    )
      throw Error("Original feature reproduction changed");
    for (const a of r.attempts) {
      const prompt = read("prompt-" + a.attempt);
      const previous =
        a.attempt === 1
          ? null
          : (() => {
              const p = r.attempts[a.attempt - 2];
              return {
                proposal: p.proposal ?? null,
                feedback: p.feedback ?? null,
              };
            })();
      if (
        JSON.stringify(prompt.context) !==
        JSON.stringify(trialContext(a.attempt, previous))
      )
        throw Error("Repair context/feedback changed");
      const request = read("request-" + a.attempt);
      validateTrialModelRequest(request.body, prompt.context);
      if (request.requestHash !== shaNative(JSON.stringify(request.body)))
        throw Error("Request hash changed");
      const completion = read("completion-" + a.attempt),
        diagnostic = read("diagnostic-" + a.attempt);
      if (
        diagnostic.requestHash !== request.requestHash ||
        diagnostic.accounting !== "settled" ||
        diagnostic.outcome !== "completed" ||
        diagnostic.httpStatus !== 200 ||
        diagnostic.finishReason !== "stop" ||
        completion.choices[0].finishReason !== "stop" ||
        completion.model !== trialSettings.model
      )
        throw Error("Inference receipt incomplete or changed");
      if (
        time(diagnostic.startedAt) <
          (a.attempt === 1
            ? time(read("original-public-B").completedAt)
            : time(read("completion-" + (a.attempt - 1)).receivedAt)) ||
        time(diagnostic.startedAt) > time(completion.receivedAt) ||
        Date.parse(completion.receivedAt) > Date.parse(r.selection.at)
      )
        throw Error("Inference completion followed selection/evaluation");
      const candidateOps = r.operations.filter(
        (op: any) => op.variant === "candidate-" + a.attempt,
      );
      if (
        candidateOps.some(
          (op: any) =>
            time(read(op.name).startedAt) < time(completion.receivedAt),
        )
      )
        throw Error("Candidate execution preceded model completion");
      if (a.attempt > 1) {
        const priorOps = r.operations.filter(
          (op: any) => op.variant === "candidate-" + (a.attempt - 1),
        );
        if (
          priorOps.some(
            (op: any) =>
              time(read(op.name).completedAt) > time(diagnostic.startedAt),
          )
        )
          throw Error("Feedback preceded completed observation");
      }
      const proposal = trialProposalSchema.parse(
        JSON.parse(completion.choices[0].content),
      );
      if (
        JSON.stringify(proposal) !==
          JSON.stringify(read("proposal-" + a.attempt)) ||
        JSON.stringify(proposal) !== JSON.stringify(a.proposal)
      )
        throw Error("Stored candidate differs from actual model output");
      if (
        JSON.stringify(a.bodyDiagnostics) !==
        JSON.stringify(preactBodyDiagnostics(proposal))
      )
        throw Error("Stored body diagnostics changed");
      let admitted: ReturnType<typeof admitPreactEdit> | undefined,
        feedback: unknown = null;
      try {
        admitted = admitPreactEdit(proposal);
        if (sourceHashes.has(admitted.sourceHash))
          throw Error("Unchanged or repeated scoped candidate");
      } catch (e) {
        feedback = preactAdmissionFeedback(
          proposal,
          e instanceof Error ? e.message : "Proposal not admitted",
        );
      }
      if (feedback) {
        if (
          a.status !== "ADMISSION_REJECTED" ||
          JSON.stringify(a.feedback) !== JSON.stringify(feedback) ||
          a.stages.length
        )
          throw Error("Admission rejection changed");
      } else {
        sourceHashes.add(admitted!.sourceHash);
        if (a.sourceHash !== admitted!.sourceHash)
          throw Error("Candidate source binding changed");
        const ownership = auditOwnedSources(
          proposal,
          admitted!.files,
          admitted!.sourceHash,
        );
        if (
          JSON.stringify(a.ownership) !== JSON.stringify(ownership) ||
          JSON.stringify(read("ownership-" + a.attempt)) !==
            JSON.stringify(ownership)
        )
          throw Error("Ownership record changed");
        if (
          JSON.stringify(read("source-" + a.attempt)) !==
            JSON.stringify(admitted) ||
          readFileSync(
            join(directory, "candidate-" + a.attempt + ".patch"),
            "utf8",
          ) !== trialPatch(proposal)
        )
          throw Error("Exported source/patch changed");
        const expectedStages = r.operations
          .filter(
            (op: any) =>
              op.variant === "candidate-" + a.attempt &&
              !op.stage.startsWith("independent"),
          )
          .map((op: any) => op.stage);
        if (
          JSON.stringify(a.stages) !== JSON.stringify(expectedStages) ||
          JSON.stringify(a.stages) !==
            JSON.stringify(candidateStages.slice(0, a.stages.length))
        )
          throw Error("Candidate fixed stage order changed");
        const failedPublic = a.stages.find(
          (s: string) =>
            s.startsWith("public") &&
            results["candidate-" + a.attempt + "-" + s] &&
            admissionObservations(
              results["candidate-" + a.attempt + "-" + s].guest.observations,
              "public",
            ).failed.length,
        );
        if (a.status === "NATIVE_REJECTED") {
          if (
            !a.stages.length ||
            results["candidate-" + a.attempt + "-" + a.stages.at(-1)] ||
            failedPublic
          )
            throw Error(
              "Native rejection includes an earlier public failure or no failed receipt",
            );
        } else if (failedPublic) {
          const result = results["candidate-" + a.attempt + "-" + failedPublic];
          feedback = preactPublicFeedback(
            result.op,
            failedPublic,
            result.op.uuid,
            result.op.image_uuid,
            admitted!.sourceHash,
          );
          if (
            a.status !== "PUBLIC_REJECTED" ||
            a.stages.at(-1) !== failedPublic ||
            JSON.stringify(a.feedback) !== JSON.stringify(feedback)
          )
            throw Error("Public rejection/feedback changed");
        } else {
          requireTrialSelectionGates(
            a.stages,
            results["candidate-" + a.attempt + "-public-A"].guest.observations,
            results["candidate-" + a.attempt + "-public-B"].guest.observations,
          );
          if (a.status !== "SELECTED")
            throw Error("Passing candidate not selected");
        }
      }
      const u = r.usage[a.attempt - 1];
      const cost =
        (completion.usage.prompt_tokens * trialSettings.rates.input +
          completion.usage.completion_tokens * trialSettings.rates.output) /
        1000000;
      if (
        !u ||
        u.id !== completion.id ||
        u.inputTokens !== completion.usage.prompt_tokens ||
        u.outputTokens !== completion.usage.completion_tokens ||
        u.costUsd !== cost ||
        diagnostic.usage.inputTokens !== u.inputTokens ||
        diagnostic.usage.outputTokens !== u.outputTokens ||
        diagnostic.usage.costUsd !== cost
      )
        throw Error("Returned usage does not match settled inference records");
    }
    time(read("selection").at);
    if (time(read("selection").at) > time(r.completedAt))
      throw Error("Selection followed run completion");
    const selection = read("selection"),
      winner = r.attempts.find((a: any) => a.status === "SELECTED");
    if (
      JSON.stringify(r.selection) !== JSON.stringify(selection) ||
      r.selectionHash !==
        shaNative(readFileSync(join(directory, "selection.json"))) ||
      selection.freeze !== PREACT_TRIAL_FREEZE ||
      selection.accepted !== !!winner ||
      selection.sourceHash !== (winner?.sourceHash ?? null) ||
      selection.variant !== (winner ? "candidate-" + winner.attempt : null) ||
      selection.ownershipHash !==
        (winner
          ? shaNative(
              readFileSync(
                join(directory, "ownership-" + winner.attempt + ".json"),
              ),
            )
          : null) ||
      r.requests.length !== r.attempts.length ||
      r.usage.length !== r.requests.length
    )
      throw Error("Trial selection/accounting changed");
    if (winner) {
      if (r.attempts.at(-1) !== winner || !independentSeen)
        throw Error("Inference after selected candidate or missing evaluation");
      const variant = selection.variant;
      const gateHashes = candidateStages.map((s) =>
        shaNative(readFileSync(join(directory, variant + "-" + s + ".json"))),
      );
      if (JSON.stringify(gateHashes) !== JSON.stringify(selection.gateHashes))
        throw Error("Selection receipt bindings changed");
      if (
        Date.parse(read(variant + "-public-B").completedAt) >
        Date.parse(selection.at)
      )
        throw Error("Selection preceded public completion");
      const a = admissionObservations(
          results[variant + "-independent-A"].guest.observations,
          "independent",
        ),
        b = admissionObservations(
          results[variant + "-independent-B"].guest.observations,
          "independent",
        );
      if (JSON.stringify(a) !== JSON.stringify(b))
        throw Error("Independent repeated observations changed");
      const correct = a.passed === a.total;
      if (
        r.correct !== correct ||
        JSON.stringify(r.independent) !== JSON.stringify(a) ||
        r.status !==
          (correct
            ? "ACCEPTED_INDEPENDENTLY_CORRECT"
            : "ACCEPTED_INDEPENDENTLY_INCORRECT")
      )
        throw Error("Independent verdict changed");
      const publicGate = admissionObservations(
        results[variant + "-public-A"].guest.observations,
        "public",
      );
      const native = {
        mocha: checkedNativeSuite(
          results[variant + "-mocha-A"].guest.mocha,
          "mocha",
        ),
        browser: checkedNativeSuite(
          results[variant + "-browser-A"].guest.browser,
          "browser",
        ),
        types: nativeTypeCounts(
          results[variant + "-types"].guest.commands[0].stdout,
        ),
      };
      if (
        JSON.stringify(r.public) !== JSON.stringify(publicGate) ||
        JSON.stringify(r.native) !== JSON.stringify(native)
      )
        throw Error("Reported native/public evidence changed");
    } else if (
      independentSeen ||
      r.attempts.length !== 3 ||
      r.status !== "ABSTAINED" ||
      r.correct !== false
    )
      throw Error("Abstention changed");
    if (r.requests.length > 3 || r.operations.length > 34)
      throw Error("Fixed trial slots exceeded");
    assertTrialNoCredentials(r);
    return summary(r);
  }

  async function runTrial() {
    auditTrialFreeze();
    if (existsSync(join(directory, "STARTED.json")))
      throw Error("Preact trial already started; no frozen-slot retry");
    const compatibility = qualifiedThinkingRequest();
    if (
      compatibility.status !== "QUALIFIED_THINKING_REQUEST" ||
      compatibility.qualification.schemaHash !==
        shaNative(
          JSON.stringify(
            trialModelRequest(trialContext(1)).response_format.json_schema
              .schema,
          ),
        )
    )
      throw Error("Exact nested schema compatibility unavailable");
    const qualification = auditPreactAdmissionRun();
    if (
      qualification.status !== "QUALIFIED_SCOPED_ADMISSION" ||
      auditNativeRun().protectedImage !== ADMISSION_PARENT
    )
      throw Error("Qualified parent unavailable");
    const cfg = simulation
        ? {
            apiKey: "synthetic-test-key",
            model: trialSettings.model,
            baseUrl: trialSettings.baseUrl,
            inputRate: trialSettings.rates.input,
            outputRate: trialSettings.rates.output,
            budgetUsd: Number.MAX_SAFE_INTEGER,
          }
        : configFromEnv(),
      sandbox = simulation
        ? {
            ...sandboxConfigFromEnv(),
            token: "synthetic-test-token",
            project: "synthetic-project",
            coverageConfirmed: true,
          }
        : sandboxConfigFromEnv();
    if (
      cfg.model !== trialSettings.model ||
      cfg.baseUrl !== trialSettings.baseUrl ||
      cfg.inputRate !== trialSettings.rates.input ||
      cfg.outputRate !== trialSettings.rates.output ||
      !cfg.apiKey ||
      !sandbox.token ||
      !sandbox.project ||
      !sandbox.coverageConfirmed
    )
      throw Error("Frozen provider configuration unavailable");
    const store = new Store(
      simulation
        ? join(options.root!, "ledger.sqlite")
        : ".repolab/state.sqlite",
    );
    if (store.hasUnsettledCharges()) {
      store.close();
      throw Error(
        "Resolve uncertain/pending inference charges before dispatch",
      );
    }
    const releases: (() => Promise<void>)[] = [];
    let provider: NebiusProposer | undefined,
      activeAttempt = 0;
    const r: any = {
      format: "repolab-native-preact-repair-journal/v1",
      id,
      controllerPid: process.pid,
      simulated: !!simulation,
      entrypoint: options.entrypoint ?? "cli",
      freeze: PREACT_TRIAL_FREEZE,
      status: "PREPARING",
      startedAt: new Date().toISOString(),
      provenance: {
        inference: "none (not yet dispatched)",
        execution: "none (not yet dispatched)",
        model: cfg.model,
      },
      requests: [],
      attempts: [],
      operations: [],
      usage: [],
      priorArtifacts: oldArtifacts(),
      correct: null,
    };
    const persist = () => save("journal", r);
    try {
      signal.throwIfAborted();
      releases.push(
        await acquireRepairLease(simulation ? options.root! : ".repolab", id),
      );
      releases.push(
        await acquireRepairLease(
          simulation
            ? join(options.root!, "repositories")
            : ".repolab/repositories",
          id,
        ),
      );
      if (store.hasUnsettledCharges())
        throw Error(
          "Resolve uncertain/pending inference charges before dispatch",
        );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const start = await open(join(directory, "STARTED.json"), "wx", 0o600);
      await start.writeFile(
        JSON.stringify({
          id,
          freeze: PREACT_TRIAL_FREEZE,
          parent: ADMISSION_PARENT,
          scope: sandboxScope(sandbox),
          at: r.startedAt,
          priorArtifactsHash: shaNative(JSON.stringify(r.priorArtifacts)),
        }),
      );
      await start.close();
      await persist();
      const images: Record<string, string> = { original: ADMISSION_PARENT },
        clients = new Map<string, NativeRemote>(),
        descriptors: Record<string, any> = {};
      const stage = async (
        variant: string,
        proposal: unknown,
        name: string,
      ) => {
        signal.throwIfAborted();
        auditTrialFreeze();
        if (r.operations.length >= trialSettings.maxOperations)
          throw Error("Trial execution slots exhausted");
        let client = clients.get(variant);
        if (!client) {
          client = simulation
            ? simulation.remote(directory, variant, proposal)
            : new FreshPreactSandbox(
                directory,
                variant,
                proposal,
                sandbox,
                signal,
              );
          clients.set(variant, client);
        }
        const input = trialInput(proposal);
        let d = descriptors[variant];
        if (!d) {
          d = { files: {} };
          let i = 0;
          for (const [path, bytes] of Object.entries(input.files)) {
            const recordName = variant + "-" + i++;
            d.files[path] = {
              recordName,
              handle: await client.upload(path, bytes, recordName),
            };
          }
          descriptors[variant] = d;
        }
        const files: Record<string, unknown> =
          variant === "original" || name === "build"
            ? Object.fromEntries(
                Object.entries(d.files).map(([path, v]: [string, any]) => [
                  path,
                  v.handle,
                ]),
              )
            : {};
        if (name.startsWith("independent")) {
          if (
            !r.selection?.accepted ||
            r.selection.variant !== variant ||
            r.selectionHash !==
              shaNative(readFileSync(join(directory, "selection.json")))
          )
            throw Error("Independent stage requires immutable selected source");
          if (!d.independent) {
            const recordName = variant + "-independent";
            d.independent = {
              recordName,
              handle: await client.upload(
                "/opt/repolab/native/independent.html",
                readFileSync("evaluation/preact-admission-independent-v4.html"),
                recordName,
              ),
            };
          }
          files["/opt/repolab/native/independent.html"] = d.independent.handle;
        }
        await save("uploads-" + variant, d);
        images[variant] ??= ADMISSION_PARENT;
        const opName = variant + "-" + name;
        console.log(
          JSON.stringify({ variant, stage: name, status: "STARTING" }),
        );
        let result: ReturnType<typeof parseAdmissionReceipt>;
        try {
          result = await client.run(
            variant,
            name,
            images[variant],
            input.sourceHash,
            files,
          );
        } catch (e) {
          if (
            !signal.aborted &&
            variant !== "original" &&
            existsSync(join(directory, opName + ".json"))
          ) {
            const raw = read(opName);
            let rejected: ReturnType<typeof rejectedTrialReceipt> | undefined;
            try {
              rejected = rejectedTrialReceipt(
                raw.latest,
                name,
                raw.id,
                images[variant],
                input.sourceHash,
              );
            } catch {}
            if (rejected) throw new NativeRejection(rejected.feedback);
          }
          throw e;
        } finally {
          if (existsSync(join(directory, opName + ".json")))
            r.operations.push({
              variant,
              stage: name,
              name: opName,
              receiptHash: shaNative(
                readFileSync(join(directory, opName + ".json")),
              ),
            });
          r.provenance.execution = simulation
            ? "simulation; source was not executed"
            : "nebius-sandbox";
          await persist();
        }
        signal.throwIfAborted();
        if (name === "build") images[variant] = result.op.result_image_uuid!;
        const gate = validateTrialGate(name, result.guest);
        console.log(
          JSON.stringify({
            variant,
            stage: name,
            status: "COMPLETED",
            operationId: result.op.uuid,
          }),
        );
        return { result, gate };
      };
      r.status = "REPRODUCING";
      await persist();
      const originalA = await stage("original", null, "public-A"),
        originalB = await stage("original", null, "public-B");
      if (
        JSON.stringify(originalA.gate) !== JSON.stringify(originalB.gate) ||
        JSON.stringify((originalA.gate as any).failed) !==
          JSON.stringify(["returned-cleanup"])
      )
        throw Error("Original feature is not repeatably absent");
      r.original = originalA.gate;
      await persist();
      let selected: any = null;
      const seen = new Set([trialInput(null).sourceHash]);
      provider = new NebiusProposer({
        ...cfg,
        budgetUsd: Number.MAX_SAFE_INTEGER,
        reserve: (amount) => {
          if (store.hasUnsettledCharges())
            throw Error(
              "Resolve uncertain/pending inference charges before dispatch",
            );
          return store.reserve(
            shaNative(cfg.apiKey),
            amount,
            Number.MAX_SAFE_INTEGER,
          );
        },
        settle: (id, cost) => store.settle(id, cost),
        fetch: async (url, init) => {
          signal.throwIfAborted();
          if (r.requests.length >= trialSettings.maxCalls || r.selection)
            throw Error("Trial inference slots closed");
          const body = JSON.parse(String(init?.body)),
            prompt = read("prompt-" + activeAttempt);
          validateTrialModelRequest(body, prompt.context);
          const request = {
            body,
            requestHash: shaNative(String(init?.body)),
            attempt: activeAttempt,
          };
          await save("request-" + activeAttempt, request, true);
          r.requests.push(activeAttempt);
          r.provenance.inference = simulation
            ? "simulation; synthetic completion"
            : "nebius";
          await persist();
          return (simulation?.fetch ?? fetch)(url, init);
        },
        onCompletion: async (c) => {
          assertTrialNoCredentials(c);
          await save(
            "completion-" + activeAttempt,
            { ...c, receivedAt: new Date().toISOString() },
            true,
          );
        },
        onDiagnostic: async (d) => {
          assertTrialNoCredentials(d);
          if (d.reservationId) store.recordDiagnostic(d.reservationId, d);
          await save("diagnostic-" + activeAttempt, d, true);
        },
      });
      for (let attempt = 1; attempt <= trialSettings.maxCandidates; attempt++) {
        signal.throwIfAborted();
        activeAttempt = attempt;
        r.status = "REPAIRING";
        const previous = r.attempts.length
          ? {
              proposal: r.attempts.at(-1).proposal ?? null,
              feedback: r.attempts.at(-1).feedback ?? null,
            }
          : null;
        const context = trialContext(attempt, previous);
        await save("prompt-" + attempt, { context }, true);
        const a: any = { attempt, status: "INFERRING", stages: [] };
        r.attempts.push(a);
        await persist();
        const proposal = await provider.structured(
          "preact_repair_v10",
          trialSystem,
          JSON.stringify(context),
          trialProposalSchema,
          signal,
        );
        r.usage.push(...provider.takeUsage());
        signal.throwIfAborted();
        a.proposal = proposal;
        a.bodyDiagnostics = preactBodyDiagnostics(proposal);
        await save("proposal-" + attempt, proposal, true);
        await persist();
        let admitted: ReturnType<typeof admitPreactEdit>;
        try {
          admitted = admitPreactEdit(proposal);
          if (seen.has(admitted.sourceHash))
            throw Error("Unchanged or repeated scoped candidate");
          a.sourceHash = admitted.sourceHash;
          seen.add(admitted.sourceHash);
        } catch (e) {
          a.status = "ADMISSION_REJECTED";
          a.feedback = preactAdmissionFeedback(
            proposal,
            e instanceof Error ? e.message : "Proposal not admitted",
          );
          await persist();
          continue;
        }
        await save("source-" + attempt, admitted, true);
        a.ownership = auditOwnedSources(
          proposal,
          admitted.files,
          admitted.sourceHash,
        );
        await save("ownership-" + attempt, a.ownership, true);
        await writeFile(
          join(directory, "candidate-" + attempt + ".patch"),
          trialPatch(proposal),
          { flag: "wx", mode: 0o600 },
        );
        a.status = "VERIFYING";
        r.status = "VERIFYING_PUBLIC";
        await persist();
        const variant = "candidate-" + attempt,
          gates: Record<string, any> = {};
        for (const s of candidateStages) {
          let gate: Awaited<ReturnType<typeof stage>>;
          try {
            gate = await stage(variant, proposal, s);
          } catch (e) {
            if (e instanceof NativeRejection) {
              a.stages.push(s);
              a.status = "NATIVE_REJECTED";
              a.feedback = preactNativeFeedback(
                e.feedback,
                compileGeneratedProposal(proposal),
              );
              await persist();
              break;
            }
            throw e;
          }
          a.stages.push(s);
          gates[s] = gate;
          if (s.startsWith("public") && (gate.gate as any).failed.length) {
            a.status = "PUBLIC_REJECTED";
            a.feedback = preactPublicFeedback(
              gate.result.op,
              s,
              gate.result.op.uuid,
              gate.result.op.image_uuid,
              admitted.sourceHash,
            );
            await persist();
            break;
          }
          await persist();
        }
        if (a.status === "PUBLIC_REJECTED" || a.status === "NATIVE_REJECTED")
          continue;
        requireTrialSelectionGates(
          a.stages,
          gates["public-A"].result.guest.observations,
          gates["public-B"].result.guest.observations,
        );
        const staged = read("source-" + attempt);
        if (JSON.stringify(staged) !== JSON.stringify(admitted))
          throw Error("Staged source changed before selection");
        const ownership = validateOwnershipRecord(
          proposal,
          staged.files,
          staged.sourceHash,
          read("ownership-" + attempt),
        );
        if (JSON.stringify(a.ownership) !== JSON.stringify(ownership))
          throw Error("Ownership record changed before selection");
        a.status = "SELECTED";
        selected = a;
        r.public = gates["public-A"].gate;
        r.native = {
          mocha: gates["mocha-A"].gate,
          browser: gates["browser-A"].gate,
          types: gates.types.gate,
        };
        await persist();
        break;
      }
      const variant = selected ? "candidate-" + selected.attempt : null;
      r.selection = {
        format: "repolab-native-preact-repair-selection/v1",
        freeze: PREACT_TRIAL_FREEZE,
        at: new Date().toISOString(),
        accepted: !!selected,
        variant,
        sourceHash: selected?.sourceHash ?? null,
        ownershipHash: selected
          ? shaNative(
              readFileSync(
                join(directory, "ownership-" + selected.attempt + ".json"),
              ),
            )
          : null,
        gateHashes: variant
          ? candidateStages.map((s) =>
              shaNative(
                readFileSync(join(directory, variant + "-" + s + ".json")),
              ),
            )
          : [],
      };
      await save("selection", r.selection, true);
      r.selectionHash = shaNative(
        readFileSync(join(directory, "selection.json")),
      );
      await persist();
      if (selected) {
        r.status = "INDEPENDENT_EVALUATION";
        await persist();
        const a = await stage(variant!, selected.proposal, "independent-A"),
          b = await stage(variant!, selected.proposal, "independent-B");
        if (JSON.stringify(a.gate) !== JSON.stringify(b.gate))
          throw Error("Independent repeated observations changed");
        r.independent = a.gate;
        r.correct = (a.gate as any).passed === (a.gate as any).total;
        r.status = r.correct
          ? "ACCEPTED_INDEPENDENTLY_CORRECT"
          : "ACCEPTED_INDEPENDENTLY_INCORRECT";
      } else {
        r.status = "ABSTAINED";
        r.correct = false;
      }
      r.completedAt = new Date().toISOString();
      await persist();
      checkOldArtifacts(r.priorArtifacts);
      const result = auditPreactTrialRun();
      await save("result", result, true);
      return result;
    } catch (e) {
      if (existsSync(join(directory, "STARTED.json"))) {
        r.failedStage = r.status;
        r.status = signal.aborted ? "CANCELLED" : "ERROR";
        let reason =
          e instanceof Error
            ? e.message.slice(0, 1800)
            : "Fresh repair stopped; retained evidence requires review";
        try {
          assertNativeNoSecrets(reason);
        } catch {
          reason = "Fresh repair stopped; retained evidence requires review";
        }
        r.error = signal.aborted
          ? "Cancellation requested; no automatic retry"
          : reason;
        r.executionUncertain = r.operations.some((op: any) => {
          const raw = read(op.name);
          return raw.submissionUnconfirmed || raw.cancellation;
        });
        if (provider) r.usage.push(...provider.takeUsage());
        r.completedAt = new Date().toISOString();
        await persist();
        await save("failure", summary(r), true);
      }
      if (existsSync(join(directory, "STARTED.json"))) return summary(r);
      throw e;
    } finally {
      if (!r.executionUncertain)
        for (const release of releases.reverse()) await release();
      store.close();
    }
  }

  return {
    run: runTrial,
    audit: auditPreactTrialRun,
    readJournal: () => read("journal"),
  };
}
export async function runFreshPreact(options: FreshRepairOptions = {}) {
  const id = z.uuid().parse(options.id ?? randomUUID());
  const directory = join(options.root ?? REPAIR_ROOT, "repair-" + id);
  return createFreshPreactSession(directory, { ...options, id }).run();
}

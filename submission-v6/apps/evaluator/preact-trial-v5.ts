import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { auditPreactAdmissionRun } from "./preact-admission-v5.ts";
import { auditNativeRun } from "./preact-native-v5.ts";
import { auditPreactTrialRun as auditPreviousTrialRun } from "./preact-trial-v4.ts";
import {
  ADMISSION_PARENT,
  admissionRequest,
  parseAdmissionReceipt,
  validateAdmissionUpload,
} from "../../packages/execution/preact-admission-v5.ts";
import {
  PreactTrialSandbox,
  trialInput,
  trialPatch,
  rejectedTrialReceipt,
} from "../../packages/execution/preact-trial-v5.ts";
import { admissionObservations } from "../../packages/evaluation/preact-admission-v5.ts";
import {
  shaNative,
  checkedNativeSuite,
  nativeIntegrity,
  nativeTypeCounts,
} from "../../packages/evaluation/preact-native-v5.ts";
import {
  auditTrialFreeze,
  PREACT_TRIAL_FREEZE,
  trialSettings,
  trialContext,
  trialSystem,
  trialProposalSchema,
  candidateStages,
  validateTrialModelRequest,
  assertTrialNoCredentials,
} from "../../packages/evaluation/preact-trial-v5.ts";
import {
  admitPlannedPreactEdit as admitPreactEdit,
  plannedAdmissionFeedback as preactAdmissionFeedback,
} from "../../packages/repositories/preact-planning-v1.ts";
import { acquireRepairLease } from "../../packages/repositories/repair-lease.ts";
import {
  NebiusProposer,
  configFromEnv,
} from "../../packages/providers/nebius.ts";
import { sandboxConfigFromEnv } from "../../packages/execution/nebius.ts";
import { sandboxScope } from "../../packages/execution/readiness.ts";
import {
  preactBodyDiagnostics,
  preactNativeFeedback,
} from "../../packages/repositories/preact-diagnostics-v2.ts";
import { Store } from "../../packages/storage/store.ts";
import { preactPublicFeedback } from "../../packages/repositories/preact-public-feedback-v1.ts";

const directory = ".repolab/preact-trial-v5/run";
class NativeRejection extends Error {
  feedback: unknown;
  constructor(feedback: unknown) {
    super("Candidate native gate rejected");
    this.feedback = feedback;
  }
}
const read = (name: string) =>
  JSON.parse(readFileSync(join(directory, name + ".json"), "utf8"));
async function save(name: string, value: unknown, exclusive = false) {
  assertTrialNoCredentials(value);
  await writeFile(
    join(directory, name + ".json"),
    JSON.stringify(value, null, 2) + "\n",
    {
      mode: 0o600,
      ...(exclusive ? { flag: "wx" } : {}),
    },
  );
}
export function validateTrialGate(stage: string, guest: any) {
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
export function requireTrialSelectionGates(
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
    throw Error("Selection requires two matching passing public observations");
}
function summary(r: any) {
  return {
    format: "repolab-preact-trial-result/v5",
    freeze: r.freeze,
    status: r.status,
    taskId: trialSettings.taskId,
    provenance: r.provenance,
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
      "One scoped public Preact feature request; not hidden benchmark accuracy.",
      "Two selected repositories remain unsupported; no selected task is removed.",
      "Independent lifecycle checks are developer-authored and withheld from repair context.",
      "Same-project cached original image; separate-project portability is untested.",
      "Framework model workflow is CLI-only; API/UI Preact repair remains unqualified.",
      "Native browser 11 original skips and TypeScript 2 pending cases remain disclosed.",
    ],
  };
}

/** Offline replay: reconstruct requests, source, uploads, native/public gates and selection before evaluation. */
export function auditPreactTrialRun() {
  auditTrialFreeze();
  const previous = auditPreviousTrialRun();
  if (
    previous.freeze !== trialSettings.previousCompletedFreeze ||
    previous.status !== "ABSTAINED"
  )
    throw Error("Previous completed trial changed");
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
    r.freeze !== PREACT_TRIAL_FREEZE ||
    started.freeze !== r.freeze ||
    started.parent !== ADMISSION_PARENT
  )
    throw Error("Trial start binding changed");
  checkOldArtifacts(r.priorArtifacts);
  if (
    started.priorArtifactsHash !== shaNative(JSON.stringify(r.priorArtifacts))
  )
    throw Error("Prior artifact inventory changed");
  const ids = new Set([...qualified.operationIds, ...parent.operationIds]);
  const sourceHashes = new Set([trialInput(null).sourceHash]);
  const results: Record<string, ReturnType<typeof parseAdmissionReceipt>> = {};
  const images: Record<string, string> = { original: ADMISSION_PARENT };
  let independentSeen = false,
    selectedSeen = false;
  for (const op of r.operations) {
    const candidate = r.attempts.find(
      (a: any) => "candidate-" + a.attempt === op.variant,
    );
    const proposal =
      op.variant === "original" ? null : read("proposal-" + candidate?.attempt);
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
        (op.variant === "original"
          ? "nebius-sandbox; reviewed original"
          : "nebius-sandbox; model-generated scoped candidate")
    )
      throw Error("Trial receipt provenance/source changed");
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
        throw Error("Independent evaluation preceded frozen source selection");
      const d = descriptors.independent;
      const upload = read("upload-" + d.recordName);
      if (Date.parse(upload.startedAt) < Date.parse(selection.at))
        throw Error("Independent upload preceded selection");
      files["/opt/repolab/native/independent.html"] = validateAdmissionUpload(
        d,
        upload,
        "/opt/repolab/native/independent.html",
        readFileSync("evaluation/preact-admission-independent-v4.html"),
      );
      independentSeen = true;
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
          JSON.stringify(preactNativeFeedback(rejected.feedback, proposal))
      )
        throw Error("Native rejection changed");
      continue;
    }
    results[op.name] = result;
    validateTrialGate(op.stage, result.guest);
    if (op.stage === "build") images[op.variant] = result.op.result_image_uuid!;
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
      Date.parse(diagnostic.startedAt) > Date.parse(completion.receivedAt) ||
      Date.parse(completion.receivedAt) > Date.parse(r.selection.at)
    )
      throw Error("Inference completion followed selection/evaluation");
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
      JSON.stringify(preactBodyDiagnostics(proposal.applyRefBody))
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
  const previous = auditPreviousTrialRun();
  if (
    previous.freeze !== trialSettings.previousCompletedFreeze ||
    previous.status !== "ABSTAINED"
  )
    throw Error("Previous completed trial changed");
  const qualification = auditPreactAdmissionRun();
  if (
    qualification.status !== "QUALIFIED_SCOPED_ADMISSION" ||
    auditNativeRun().protectedImage !== ADMISSION_PARENT
  )
    throw Error("Qualified parent unavailable");
  const cfg = configFromEnv(),
    sandbox = sandboxConfigFromEnv();
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
  const store = new Store(".repolab/state.sqlite");
  if (store.hasUnsettledCharges()) {
    store.close();
    throw Error("Resolve uncertain/pending inference charges before dispatch");
  }
  const releases: (() => Promise<void>)[] = [];
  let provider: NebiusProposer | undefined,
    activeAttempt = 0;
  const r: any = {
    format: "repolab-preact-trial-journal/v5",
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
    releases.push(await acquireRepairLease(".repolab", "preact-trial-v5"));
    releases.push(
      await acquireRepairLease(".repolab/repositories", "preact-trial-v5"),
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const start = await open(join(directory, "STARTED.json"), "wx", 0o600);
    await start.writeFile(
      JSON.stringify({
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
      clients = new Map<string, PreactTrialSandbox>(),
      descriptors: Record<string, any> = {};
    const stage = async (variant: string, proposal: unknown, name: string) => {
      auditTrialFreeze();
      if (r.operations.length >= trialSettings.maxOperations)
        throw Error("Trial execution slots exhausted");
      let client = clients.get(variant);
      if (!client) {
        client = new PreactTrialSandbox(directory, variant, proposal);
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
      console.log(JSON.stringify({ variant, stage: name, status: "STARTING" }));
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
        r.provenance.execution = "nebius-sandbox";
        await persist();
      }
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
      requestPolicy: "nemotron-low-effort-v1",
      reserve: (amount) =>
        store.reserve(shaNative(cfg.apiKey), amount, Number.MAX_SAFE_INTEGER),
      settle: (id, cost) => store.settle(id, cost),
      fetch: async (url, init) => {
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
        r.provenance.inference = "nebius";
        await persist();
        return fetch(url, init);
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
        "preact_repair_v5",
        trialSystem,
        JSON.stringify(context),
        trialProposalSchema,
      );
      r.usage.push(...provider.takeUsage());
      a.proposal = proposal;
      a.bodyDiagnostics = preactBodyDiagnostics(proposal.applyRefBody);
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
            a.feedback = preactNativeFeedback(e.feedback, proposal);
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
      format: "repolab-preact-trial-selection/v5",
      freeze: PREACT_TRIAL_FREEZE,
      at: new Date().toISOString(),
      accepted: !!selected,
      variant,
      sourceHash: selected?.sourceHash ?? null,
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
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    if (existsSync(join(directory, "STARTED.json"))) {
      r.failedStage = r.status;
      r.status = "ERROR";
      r.error = e instanceof Error ? e.message : "Trial failed";
      if (provider) r.usage.push(...provider.takeUsage());
      r.completedAt = new Date().toISOString();
      await persist();
      await save("failure", summary(r), true);
    }
    throw e;
  } finally {
    for (const release of releases.reverse()) await release();
    store.close();
  }
}
async function main() {
  const action = process.argv[2] ?? "plan";
  auditTrialFreeze();
  if (action === "plan") {
    console.log(
      JSON.stringify(
        {
          freeze: PREACT_TRIAL_FREEZE,
          settings: trialSettings,
          contextHash: shaNative(JSON.stringify(trialContext(1))),
          inference: "none (planning)",
          execution: "none (planning)",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === "audit") {
    console.log(JSON.stringify(auditPreactTrialRun(), null, 2));
    return;
  }
  if (action !== "run") throw Error("Use plan, run or audit");
  await runTrial();
}
if (process.argv[1]?.endsWith("apps/evaluator/preact-trial-v5.ts"))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "Trial failed");
    process.exitCode = 1;
  });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  writeFile,
  rename,
  readFile,
  lstat,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  auditPreactProduct,
  PRODUCT_FREEZE,
} from "./preact-product-protocol-v1.ts";
import {
  readNativePreactPack,
  assertNativeNoSecrets,
} from "./preact-pack-v1.ts";
import {
  NativeReplaySandbox,
  replayInput,
} from "../execution/preact-replay-v1.ts";
import type { NativeRemote } from "../execution/preact-replay-v1.ts";
import {
  ADMISSION_PARENT,
  admissionRequest,
  parseAdmissionReceipt,
  validateAdmissionUpload,
} from "../execution/preact-admission-v5.ts";
import { candidateStages } from "../evaluation/preact-trial-v10.ts";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  validateTrialGate,
  requireTrialSelectionGates,
} from "../../apps/evaluator/preact-trial-v10.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import { sandboxScope } from "../execution/readiness.ts";
import { acquireRepairLease } from "./repair-lease.ts";
export const nativeReplayRecipe = [
  { variant: "original", stage: "public-A" },
  { variant: "original", stage: "public-B" },
  ...candidateStages.map((stage) => ({ variant: "selected", stage })),
  { variant: "selected", stage: "independent-A" },
  { variant: "selected", stage: "independent-B" },
] as const;
const ROOT = ".repolab/native-preact";
export interface NativeReplayOptions {
  id?: string;
  directory?: string;
  entrypoint?: "api" | "cli";
  signal?: AbortSignal;
  config?: SandboxConfig;
  remote?: (
    directory: string,
    variant: "original" | "selected",
    proposal: unknown,
    config: SandboxConfig,
    signal: AbortSignal,
  ) => NativeRemote;
  admitSimulation?: () => void;
}
export function nativeReplayReadiness() {
  const c = sandboxConfigFromEnv();
  return {
    available: !!(
      c.token &&
      c.project &&
      c.coverageConfirmed &&
      c.baseUrl === "https://api.tokenfactory.nebius.com/sandboxes/"
    ),
    reason:
      "Requires your qualified Preact dependency image in the configured Sandbox project; replay uses zero inference",
    scope:
      "same-project cached qualified native image; separate-project preparation untested",
  };
}
async function save(path: string, value: unknown, exclusive = false) {
  assertNativeNoSecrets(value);
  if (exclusive)
    return writeFile(path, JSON.stringify(value) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  const temp = path + "." + randomUUID();
  await writeFile(temp, JSON.stringify(value) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temp, path);
}
const read = (dir: string, name: string) =>
  JSON.parse(readFileSync(join(dir, name + ".json"), "utf8"));
export function auditNativeReplay(
  record: any,
  dir: string,
  allowSimulation = false,
) {
  auditPreactProduct();
  const pack = readNativePreactPack(record.pack),
    simulation =
      record.provenance?.execution === "simulation; source was not executed";
  if (
    record.freeze !== PRODUCT_FREEZE ||
    record.packDigest !== pack.digest ||
    record.sourceHash !== pack.source.sha256 ||
    record.inferenceCalls !== 0 ||
    record.estimatedInferenceUsd !== 0 ||
    record.provenance?.inference !== "none (native pack replay)" ||
    (!simulation && record.provenance.execution !== "nebius-sandbox") ||
    (simulation && !allowSimulation)
  )
    throw Error("Replay identity/provenance changed");
  if (
    record.stages.length !== nativeReplayRecipe.length ||
    record.executionCount !== 14
  )
    throw Error("Replay stages incomplete");
  const priorIds: string[] = JSON.parse(
    readFileSync("evaluation/preact-trial-v10-results-summary.json", "utf8"),
  ).result.operationIds;
  const ids = new Set(),
    images: Record<string, string> = {
      original: ADMISSION_PARENT,
      selected: ADMISSION_PARENT,
    },
    gates: Record<string, any> = {};
  const inputs = {
    original: replayInput(null),
    selected: replayInput(pack.proposal),
  };
  z.iso.datetime().parse(record.startedAt);
  z.iso.datetime().parse(record.completedAt);
  z.iso.datetime().parse(record.independentOpenedAt);
  let priorEnd = Date.parse(record.startedAt);
  let decisionSeen = false;
  for (const [i, step] of nativeReplayRecipe.entries()) {
    const g = record.stages[i],
      raw = read(dir, g.name),
      input = inputs[step.variant as "original" | "selected"],
      d = read(dir, "uploads-" + step.variant),
      files: Record<string, unknown> = {};
    if (
      g.variant !== step.variant ||
      g.stage !== step.stage ||
      g.name !== step.variant + "-" + step.stage ||
      g.receiptHash !== shaNative(readFileSync(join(dir, g.name + ".json"))) ||
      raw.variant !== g.variant ||
      raw.stage !== g.stage ||
      raw.sourceHash !== input.sourceHash ||
      raw.inference !== "none (native pack replay)" ||
      raw.execution !==
        (simulation
          ? "simulation; source was not executed"
          : step.variant === "original"
            ? "nebius-sandbox; reviewed original"
            : "nebius-sandbox; replay of selected model-generated scoped candidate") ||
      ids.has(raw.id) ||
      priorIds.includes(raw.id)
    )
      throw Error("Replay receipt order/source/identity changed");
    z.iso.datetime().parse(raw.startedAt);
    z.iso.datetime().parse(raw.completedAt);
    if (
      Date.parse(raw.startedAt) < priorEnd ||
      Date.parse(raw.completedAt) < Date.parse(raw.startedAt) ||
      Date.parse(raw.completedAt) > Date.parse(record.completedAt)
    )
      throw Error("Replay operation chronology changed");
    priorEnd = Date.parse(raw.completedAt);
    ids.add(raw.id);
    for (const [path, bytes] of Object.entries(
      step.variant === "original" || step.stage === "build" ? input.files : {},
    )) {
      const v = d.files[path];
      files[path] = validateAdmissionUpload(
        v,
        read(dir, "upload-" + v.recordName),
        path,
        bytes,
      );
    }
    if (step.stage.startsWith("independent")) {
      const selected = read(dir, "selection");
      z.iso.datetime().parse(selected.at);
      if (
        !decisionSeen ||
        !selected.accepted ||
        selected.sourceHash !== pack.source.sha256 ||
        selected.freeze !== PRODUCT_FREEZE ||
        record.selectionHash !==
          shaNative(readFileSync(join(dir, "selection.json"))) ||
        Date.parse(selected.at) > Date.parse(raw.startedAt)
      )
        throw Error("Independent verification preceded immutable selection");
      const v = d.independent,
        upload = read(dir, "upload-" + v.recordName);
      files["/opt/repolab/native/independent.html"] = validateAdmissionUpload(
        v,
        upload,
        "/opt/repolab/native/independent.html",
        readFileSync("evaluation/preact-admission-independent-v4.html"),
      );
      z.iso.datetime().parse(upload.startedAt);
      if (Date.parse(upload.startedAt) < Date.parse(selected.at))
        throw Error("Independent upload preceded selection");
    }
    if (
      JSON.stringify(raw.request) !==
      JSON.stringify(admissionRequest(step.stage, images[step.variant], files))
    )
      throw Error("Replay request/recipe changed");
    const parsed = parseAdmissionReceipt(
        raw.latest,
        step.stage,
        raw.id,
        images[step.variant],
        input.sourceHash,
      ),
      gate: any = validateTrialGate(step.stage, parsed.guest);
    if (step.stage === "build") images.selected = parsed.op.result_image_uuid!;
    if (JSON.stringify(g.result) !== JSON.stringify(gate))
      throw Error("Replay stored verdict changed");
    gates[g.name] = gate;
    if (
      step.variant === "original" &&
      JSON.stringify(gate.failed) !== JSON.stringify(["returned-cleanup"])
    )
      throw Error("Original feature absence changed");
    if (
      step.variant === "selected" &&
      (step.stage.startsWith("public") ||
        step.stage.startsWith("independent")) &&
      gate.passed !== gate.total
    )
      throw Error("Selected replay behavior failed");
    if (step.stage === "public-B" && step.variant === "selected") {
      requireTrialSelectionGates(
        [...candidateStages],
        gates["selected-public-A"].rows,
        gates["selected-public-B"].rows,
      );
      const selection = read(dir, "selection");
      z.iso.datetime().parse(selection.at);
      if (
        JSON.stringify(selection.gateHashes) !==
          JSON.stringify(
            record.stages.slice(2, 12).map((g: any) => g.receiptHash),
          ) ||
        Date.parse(raw.completedAt) > Date.parse(selection.at)
      )
        throw Error("Selection receipt binding changed");
      decisionSeen = true;
    }
  }
  if (
    ids.size !== 14 ||
    JSON.stringify(gates["original-public-A"]) !==
      JSON.stringify(gates["original-public-B"]) ||
    JSON.stringify(gates["selected-independent-A"]) !==
      JSON.stringify(gates["selected-independent-B"])
  )
    throw Error("Replay freshness/repeats changed");
  if (
    !record.success ||
    record.status !==
      (simulation
        ? "SIMULATED_REPLAY_FOR_TESTED_SCENARIOS"
        : "VERIFIED_REPLAY_FOR_TESTED_SCENARIOS")
  )
    throw Error("Replay status changed");
  assertNativeNoSecrets(record);
  return {
    verified: !simulation,
    simulated: simulation,
    executionCount: 14,
    independent: gates["selected-independent-A"],
    native: {
      mocha: gates["selected-mocha-A"],
      browser: gates["selected-browser-A"],
      types: gates["selected-types"],
    },
  };
}
export async function replayNativePreact(
  input: unknown,
  options: NativeReplayOptions = {},
) {
  const id = z.uuid().parse(options.id ?? randomUUID()),
    dir = join(options.directory ?? ROOT, "replay-" + id),
    signal = options.signal ?? new AbortController().signal;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Invalid native evidence directory");
  const r: any = {
    format: "repolab-preact-replay/v1",
    id,
    controllerPid: process.pid,
    entrypoint: options.entrypoint ?? "cli",
    freeze: PRODUCT_FREEZE,
    status: "ADMITTING",
    startedAt: new Date().toISOString(),
    success: false,
    inferenceCalls: 0,
    estimatedInferenceUsd: 0,
    executionCount: 0,
    stages: [],
    provenance: {
      inference: "none (native pack replay)",
      execution: options.remote
        ? "simulation; source was not executed"
        : "nebius-sandbox",
    },
  };
  const path = join(dir, "journal.json");
  await save(path, r, true);
  const persist = () => save(path, r);
  const releases: (() => Promise<void>)[] = [];
  try {
    signal.throwIfAborted();
    auditPreactProduct();
    const pack = readNativePreactPack(input),
      cfg = options.config ?? sandboxConfigFromEnv();
    Object.assign(r, {
      configurationScope: sandboxScope(cfg),
      pack,
      packDigest: pack.digest,
      sourceHash: pack.source.sha256,
    });
    const leaseRoot = options.remote ? (options.directory ?? ROOT) : ".repolab";
    releases.push(await acquireRepairLease(leaseRoot, id));
    releases.push(
      await acquireRepairLease(join(leaseRoot, "repositories"), id),
    );
    if (options.remote) {
      if (!options.admitSimulation)
        throw Error("Explicit simulation admission required");
      options.admitSimulation();
    } else if (options.admitSimulation || !nativeReplayReadiness().available)
      throw Error("Native Sandbox configuration unavailable");
    const inputs = {
      original: replayInput(null),
      selected: replayInput(pack.proposal),
    };
    const clients = new Map<string, NativeRemote>(),
      descriptors: Record<string, any> = {},
      images: Record<string, string> = {
        original: ADMISSION_PARENT,
        selected: ADMISSION_PARENT,
      },
      seen = new Set();
    for (const step of nativeReplayRecipe) {
      signal.throwIfAborted();
      const variant = step.variant as "original" | "selected",
        proposal = variant === "original" ? null : pack.proposal,
        source = inputs[variant];
      if (step.stage === "independent-A") {
        requireTrialSelectionGates(
          r.stages.slice(2).map((g: any) => g.stage),
          r.stages[8].result.rows,
          r.stages[11].result.rows,
        );
        const selection = {
          freeze: PRODUCT_FREEZE,
          accepted: true,
          sourceHash: pack.source.sha256,
          at: new Date().toISOString(),
          gateHashes: r.stages.slice(2).map((g: any) => g.receiptHash),
        };
        await save(join(dir, "selection.json"), selection, true);
        r.selectionHash = shaNative(readFileSync(join(dir, "selection.json")));
        r.independentOpenedAt = new Date().toISOString();
        await persist();
      }
      r.status =
        variant === "original"
          ? "REPRODUCING"
          : step.stage.startsWith("independent")
            ? "EVALUATING"
            : "VERIFYING";
      await persist();
      let client = clients.get(variant);
      if (!client) {
        client = options.remote
          ? options.remote(dir, variant, proposal, cfg, signal)
          : new NativeReplaySandbox(dir, variant, proposal, cfg, signal);
        clients.set(variant, client);
      }
      let d = descriptors[variant];
      if (!d) {
        d = { files: {} };
        for (const [index, [path, bytes]] of Object.entries(
          source.files,
        ).entries()) {
          signal.throwIfAborted();
          const recordName = variant + "-" + index;
          d.files[path] = {
            recordName,
            handle: await client.upload(path, bytes, recordName),
          };
        }
        descriptors[variant] = d;
      }
      const files: Record<string, unknown> =
        variant === "original" || step.stage === "build"
          ? Object.fromEntries(
              Object.entries(d.files).map(([p, v]: [string, any]) => [
                p,
                v.handle,
              ]),
            )
          : {};
      if (step.stage.startsWith("independent")) {
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
      await save(join(dir, "uploads-" + variant + ".json"), d);
      if (++r.executionCount > 14)
        throw Error("Native replay operation slots exhausted");
      await persist();
      const name = variant + "-" + step.stage;
      const parsed = await client.run(
        variant,
        step.stage,
        images[variant],
        source.sourceHash,
        files,
      );
      if (seen.has(parsed.op.uuid))
        throw Error("Reused native replay operation");
      seen.add(parsed.op.uuid);
      const result: any = validateTrialGate(step.stage, parsed.guest);
      r.stages.push({
        variant,
        stage: step.stage,
        name,
        receiptHash: shaNative(readFileSync(join(dir, name + ".json"))),
        result,
      });
      await persist();
      if (step.stage === "build")
        images.selected = parsed.op.result_image_uuid!;
      if (
        variant === "original" &&
        JSON.stringify(result.failed) !== JSON.stringify(["returned-cleanup"])
      )
        throw Error("Original feature absence changed");
      if (
        variant === "selected" &&
        (step.stage.startsWith("public") ||
          step.stage.startsWith("independent")) &&
        result.passed !== result.total
      )
        throw Error("Selected replay behavior failed");
    }
    r.success = true;
    r.status = options.remote
      ? "SIMULATED_REPLAY_FOR_TESTED_SCENARIOS"
      : "VERIFIED_REPLAY_FOR_TESTED_SCENARIOS";
    r.completedAt = new Date().toISOString();
    auditNativeReplay(r, dir, !!options.remote);
  } catch {
    r.failedStage = r.status;
    r.success = false;
    r.status = signal.aborted ? "CANCELLED" : "REPLAY_FAILED";
    r.error = "Replay stopped; partial evidence retained. No automatic retry.";
  } finally {
    r.completedAt ??= new Date().toISOString();
    await persist();
    for (const release of releases.reverse()) await release();
  }
  return r;
}
export function nativeReplayReview(record: any, dir: string) {
  let status = record.status,
    verified = false,
    simulated = false;
  if (
    [
      "VERIFIED_REPLAY_FOR_TESTED_SCENARIOS",
      "SIMULATED_REPLAY_FOR_TESTED_SCENARIOS",
    ].includes(status)
  ) {
    try {
      const proof = auditNativeReplay(
        record,
        dir,
        status.startsWith("SIMULATED"),
      );
      verified = proof.verified;
      simulated = proof.simulated;
    } catch {
      status = "INVALID_REPLAY_EVIDENCE";
    }
  }
  const review = {
    id: z.uuid().parse(record.id),
    status,
    verified,
    simulated,
    sourceHash: record.sourceHash ?? null,
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? null,
    executionCount: record.executionCount,
    inferenceCalls: 0,
    provenance: {
      inference: "none (native pack replay)",
      execution: record.provenance?.execution ?? "none",
    },
    gates: (record.stages ?? []).map((g: any) => ({
      name: g.name,
      passed:
        status === "INVALID_REPLAY_EVIDENCE"
          ? null
          : g.result?.total !== undefined
            ? g.variant === "original"
              ? JSON.stringify(g.result.failed) ===
                JSON.stringify(["returned-cleanup"])
              : g.result.passed === g.result.total
            : true,
      cases: g.result?.passed ?? null,
      skipped: g.result?.skipped ?? g.result?.pending ?? null,
    })),
    error: record.error
      ? "Replay stopped; partial evidence retained"
      : status === "INVALID_REPLAY_EVIDENCE"
        ? "Saved evidence failed validation"
        : null,
  };
  assertNativeNoSecrets(review);
  return review;
}
export class NativePreactHistory {
  directory: string;
  constructor(directory = ROOT) {
    this.directory = directory;
  }
  async get(id: string) {
    try {
      z.uuid().parse(id);
      const dir = join(this.directory, "replay-" + id),
        p = join(dir, "journal.json"),
        s = await lstat(p);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 2000000) return null;
      const r = JSON.parse(await readFile(p, "utf8"));
      if (r.id !== id || r.format !== "repolab-preact-replay/v1") return null;
      return nativeReplayReview(r, dir);
    } catch {
      return null;
    }
  }
  async list() {
    let names: string[] = [];
    try {
      names = await readdir(this.directory);
    } catch {}
    const out = [];
    for (const name of names
      .filter((n) => /^replay-[a-f0-9-]{36}$/.test(n))
      .slice(-50)) {
      const r = await this.get(name.slice(7));
      if (r) out.push(r);
    }
    return out
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  }
  async recover() {
    let names: string[] = [];
    try {
      names = await readdir(this.directory);
    } catch {}
    for (const name of names.filter((n) => /^replay-[a-f0-9-]{36}$/.test(n))) {
      const path = join(this.directory, name, "journal.json"),
        s = await lstat(path);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 2000000) continue;
      const r = JSON.parse(await readFile(path, "utf8"));
      if (r.completedAt) continue;
      if (Number.isSafeInteger(r.controllerPid) && r.controllerPid > 0) {
        try {
          process.kill(r.controllerPid, 0);
          continue;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") continue;
        }
      }
      r.status = "INTERRUPTED";
      r.success = false;
      r.completedAt = new Date().toISOString();
      r.error =
        "Controller stopped; inspect retained operations and leases before explicit recovery. No automatic retry.";
      await save(path, r);
    }
  }
}

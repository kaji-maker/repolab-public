import { acquireRecoveryLease } from "./recovery-lease-v1.ts";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile, rename, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { SandboxConfig } from "./nebius.ts";
import { FreshPreactSandbox } from "./preact-terminal-time-v1.ts";
import { admissionRequest } from "./preact-admission-v5.ts";
import { trialInput } from "./preact-trial-v10.ts";
import { shaNative as crossSha } from "../evaluation/preact-native-v5.ts";
import type { NativeRemote } from "./preact-replay-v1.ts";

const terminal = new Set(["SUCCESS", "FAILED", "CANCELLED"]);
const active = new Set(["PENDING", "ASSIGNED", "EXECUTING"]);
async function atomic(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** New opt-in transport; historical frozen transports and receipts stay unchanged. */
export class GuardedFreshPreactSandbox {
  readonly execution: "nebius-sandbox" | "simulation; source was not executed";
  private remote: NativeRemote;
  private variant: string;
  private sourceHash: string;
  private directory: string;
  private config: SandboxConfig;
  private signal: AbortSignal;
  private fetcher: typeof fetch;
  constructor(
    directory: string,
    variant: string,
    proposal: unknown,
    config: SandboxConfig,
    signal: AbortSignal,
    simulation?: { remote: NativeRemote; fetch: typeof fetch },
  ) {
    this.directory = directory;
    this.config = config;
    this.signal = signal;
    this.variant = variant;
    this.sourceHash = trialInput(proposal).sourceHash;
    if (
      !/^(original|candidate-[1-3])$/.test(variant) ||
      (variant === "original") !== (proposal === null)
    )
      throw Error("Variant/source mismatch");
    this.fetcher = simulation?.fetch ?? fetch;
    this.remote =
      simulation?.remote ??
      new FreshPreactSandbox(directory, variant, proposal, config, signal);
    this.execution = simulation
      ? "simulation; source was not executed"
      : "nebius-sandbox";
  }
  private paths(name: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(name)) throw Error("Invalid operation name");
    return {
      journal: join(this.directory, "guard-" + name + ".json"),
      lock: join(this.directory, "active-execution.json"),
      raw: join(this.directory, name + ".json"),
    };
  }
  private checkRequest(
    request: ReturnType<typeof admissionRequest>,
    stage: string,
  ) {
    if (
      !isDeepStrictEqual(
        request,
        admissionRequest(stage, request.image, request.files),
      )
    )
      throw Error("Closed product execution request required");
    if (
      !this.config.token ||
      !this.config.project ||
      !this.config.coverageConfirmed ||
      this.config.baseUrl !== "https://api.tokenfactory.nebius.com/sandboxes/"
    )
      throw Error("Qualified Sandbox configuration required");
    for (const value of [this.config.token, this.config.project])
      if (value && JSON.stringify(request).includes(value))
        throw Error("Credential in execution input");
  }
  private isTerminal(raw: any, journal: any) {
    const execution =
      this.execution === "nebius-sandbox"
        ? this.variant === "original"
          ? "nebius-sandbox; reviewed original"
          : "nebius-sandbox; model-generated scoped candidate"
        : this.execution;
    return (
      raw?.execution === execution &&
      raw.variant === this.variant &&
      raw.sourceHash === this.sourceHash &&
      raw.stage === journal.stage &&
      isDeepStrictEqual(raw.request, journal.request) &&
      raw.id === journal.operationId &&
      raw.latest?.uuid === journal.operationId &&
      raw.latest?.image_uuid === journal.request.image &&
      terminal.has(raw.latest?.status)
    );
  }
  private async release(lock: string, owner: any) {
    if (!isDeepStrictEqual(JSON.parse(await readFile(lock, "utf8")), owner))
      throw Error("Execution lease identity changed");
    await unlink(lock);
  }
  async upload(path: string, bytes: Buffer, name: string) {
    this.signal.throwIfAborted();
    if (existsSync(join(this.directory, "active-execution.json")))
      throw Error("Execution recovery required before upload");
    for (const value of [this.config.token, this.config.project])
      if (value && bytes.includes(Buffer.from(value)))
        throw Error("Credential in upload input");
    return this.remote.upload(path, bytes, name);
  }
  async run(
    variant: string,
    stage: string,
    image: string,
    sourceHash: string,
    files: Record<string, unknown>,
  ) {
    this.signal.throwIfAborted();
    if (variant !== this.variant || sourceHash !== this.sourceHash)
      throw Error("Candidate identity changed");
    const name = variant + "-" + stage;
    const request = admissionRequest(stage, image, files);
    this.checkRequest(request, stage);
    const p = this.paths(name),
      requestSha256 = crossSha(JSON.stringify(request));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (existsSync(p.journal) || existsSync(p.raw))
      throw Error("Execution slot already used");
    const owner = { name, requestSha256, id: randomUUID() };
    await writeFile(p.lock, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    const journal: any = {
      format: "repolab-preact-execution-guard/v1",
      variant,
      stage,
      sourceHash,
      owner,
      request,
      requestSha256,
      execution: this.execution,
      state: "DISPATCHING",
      startedAt: new Date().toISOString(),
    };
    // A crash between lock creation and journaling fails closed and needs explicit recovery.
    await writeFile(p.journal, JSON.stringify(journal), {
      flag: "wx",
      mode: 0o600,
    });
    try {
      const result = await this.remote.run(
        variant,
        stage,
        image,
        sourceHash,
        files,
      );
      const raw = read(p.raw);
      journal.operationId = raw.id;
      if (!this.isTerminal(raw, journal))
        throw Error("Unrecognized operation state");
      journal.state = "TERMINAL";
      journal.terminalStatus = raw.latest.status;
      journal.rawSha256 = crossSha(readFileSync(p.raw));
      await atomic(p.journal, journal);
      await this.release(p.lock, owner);
      return result;
    } catch (error) {
      const raw = existsSync(p.raw) ? read(p.raw) : null;
      journal.operationId = raw?.id ?? null;
      journal.state = this.isTerminal(raw, journal) ? "TERMINAL" : "UNKNOWN";
      journal.terminalStatus =
        journal.state === "TERMINAL" ? raw.latest.status : null;
      journal.rawSha256 = raw ? crossSha(readFileSync(p.raw)) : null;
      // Persist only a stable classification; transport exceptions may contain sensitive strings.
      journal.failure = "execution_failed";
      await atomic(p.journal, journal);
      if (journal.state === "TERMINAL") await this.release(p.lock, owner);
      throw error;
    }
  }
  /** Read-only reconciliation. Never creates/resubmits/cancels an operation or rewrites its raw receipt. */
  async recover(name: string) {
    const lock = join(this.directory, "recovery-active.sqlite");
    const release = await acquireRecoveryLease(lock);
    try {
      return await this.reconcile(name);
    } finally {
      await release();
    }
  }
  private async reconcile(name: string) {
    this.signal.throwIfAborted();
    const p = this.paths(name),
      journal = read(p.journal),
      owner = read(p.lock);
    if (
      journal.format !== "repolab-preact-execution-guard/v1" ||
      journal.variant !== this.variant ||
      journal.sourceHash !== this.sourceHash ||
      name !== this.variant + "-" + journal.stage ||
      owner.name !== name ||
      journal.execution !== this.execution ||
      !isDeepStrictEqual(owner, journal.owner) ||
      journal.requestSha256 !== owner.requestSha256 ||
      crossSha(JSON.stringify(journal.request)) !== journal.requestSha256 ||
      (journal.rawSha256 && crossSha(readFileSync(p.raw)) !== journal.rawSha256)
    )
      throw Error("Recovery evidence identity changed");
    this.checkRequest(journal.request, journal.stage);
    if (!journal.operationId && existsSync(p.raw)) {
      const raw = read(p.raw);
      if (
        raw.variant !== this.variant ||
        raw.stage !== journal.stage ||
        raw.sourceHash !== this.sourceHash ||
        raw.execution !==
          (this.execution === "nebius-sandbox"
            ? this.variant === "original"
              ? "nebius-sandbox; reviewed original"
              : "nebius-sandbox; model-generated scoped candidate"
            : this.execution) ||
        !isDeepStrictEqual(raw.request, journal.request)
      )
        throw Error("Recovery raw request changed");
      journal.operationId = z.uuid().parse(raw.id);
      journal.rawSha256 = crossSha(readFileSync(p.raw));
    }
    // A lost POST response has no operation ID. Never guess an ID or resubmit it.
    const id = z.uuid().parse(journal.operationId);
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.signal.throwIfAborted();
      try {
        response = await this.fetcher(
          new URL("v1/operations/" + id, this.config.baseUrl),
          {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.any([this.signal, AbortSignal.timeout(60000)]),
            headers: {
              Authorization: "Bearer " + this.config.token,
              Project: this.config.project,
            },
          },
        );
      } catch {
        if (attempt === 2 || this.signal.aborted)
          throw Error("Recovery transport unavailable");
        else continue;
      }
      break;
    }
    if (!response?.ok) throw Error("Recovery HTTP rejected");
    const operation = await response.json();
    const path = join(
      this.directory,
      "recovery-" + name + "-" + randomUUID() + ".json",
    );
    // Save observations before comparison; never turn recovery alone into behavioral verification.
    await writeFile(
      path,
      JSON.stringify({
        execution: this.execution,
        at: new Date().toISOString(),
        operation,
      }),
      { flag: "wx", mode: 0o600 },
    );
    if (
      operation.uuid !== id ||
      operation.image_uuid !== journal.request.image ||
      (!terminal.has(operation.status) && !active.has(operation.status))
    )
      throw Error("Recovery operation identity/state changed");
    if (!terminal.has(operation.status))
      return { state: "UNKNOWN", operation, path };
    journal.state = "TERMINAL";
    journal.terminalStatus = operation.status;
    journal.recoveryPath = path;
    journal.recoverySha256 = crossSha(readFileSync(path));
    await atomic(p.journal, journal);
    await this.release(p.lock, owner);
    return { state: "TERMINAL", operation, path };
  }
}

import { acquireRecoveryLease } from "../execution/recovery-lease-v1.ts";
import { existsSync, readFileSync, lstatSync, readdirSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { GuardedFreshPreactSandbox } from "../execution/guarded-preact-sandbox-v1.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import type { SandboxConfig } from "../execution/nebius.ts";
import type { NativeRemote } from "../execution/preact-replay-v1.ts";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import { REPAIR_ROOT } from "./preact-repair-v3.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";

function read(path: string) {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 8_000_000)
    throw Error("Invalid recovery evidence");
  const value = JSON.parse(readFileSync(path, "utf8"));
  assertNativeNoSecrets(value);
  return value;
}
/** Reconciles execution only. Never resumes a repair, submits compute or grants patch access. */
export async function recoverFreshPreactExecution(
  id: string,
  signal: AbortSignal,
  options?: {
    root: string;
    leaseRoot: string;
    config: SandboxConfig;
    simulation: { remote: NativeRemote; fetch: typeof fetch };
  },
) {
  z.uuid().parse(id);
  if (options && resolve(options.root).startsWith(resolve(".repolab")))
    throw Error("Simulation recovery requires isolated test state");
  const directory = join(options?.root ?? REPAIR_ROOT, "repair-" + id);
  const ds = lstatSync(directory);
  if (!ds.isDirectory() || ds.isSymbolicLink())
    throw Error("Invalid recovery directory");
  const lock = join(directory, "workflow-recovery.sqlite");
  const releaseRecovery = await acquireRecoveryLease(lock);
  try {
    const journal = read(join(directory, "journal.json"));
    if (
      journal.id !== id ||
      journal.format !== "repolab-native-preact-repair-journal/v3" ||
      !!journal.simulated !== !!options ||
      !["ERROR", "CANCELLED", "INTERRUPTED"].includes(journal.status)
    )
      throw Error("Only a stopped guarded workflow can be reconciled");
    if (journal.controllerPid !== process.pid) {
      let stopped = false;
      try {
        process.kill(journal.controllerPid, 0);
      } catch (e) {
        stopped = (e as NodeJS.ErrnoException).code === "ESRCH";
      }
      if (!stopped)
        throw Error(
          "Workflow controller is still active or liveness is unknown",
        );
    }
    const binding = read(join(directory, "workflow-leases.json"));
    const roots = [
      options?.leaseRoot ?? ".repolab",
      join(options?.leaseRoot ?? ".repolab", "repositories"),
    ];
    if (
      binding.id !== id ||
      binding.controllerPid !== journal.controllerPid ||
      binding.leases?.length !== 2
    )
      throw Error("Workflow lease binding changed");
    for (let i = 0; i < 2; i++) {
      const b = binding.leases[i];
      const owner = JSON.parse(b.bytes);
      if (
        resolve(b.root) !== resolve(roots[i]) ||
        owner.runId !== id ||
        owner.pid !== journal.controllerPid ||
        (existsSync(join(roots[i], "clsx-repair.lock")) &&
          readFileSync(join(roots[i], "clsx-repair.lock"), "utf8") !== b.bytes)
      )
        throw Error("Workflow lease ownership changed");
    }
    const activePath = join(directory, "active-execution.json");
    if (existsSync(activePath)) {
      const owner = read(activePath);
      if (!/^(original|candidate-[1-3])-[a-zA-Z-]+$/.test(owner.name))
        throw Error("Invalid guarded operation name");
      const guard = read(join(directory, "guard-" + owner.name + ".json"));
      const proposal =
        guard.variant === "original"
          ? null
          : read(join(directory, "proposal-" + guard.variant.at(-1) + ".json"));
      const sdk = new GuardedFreshPreactSandbox(
        directory,
        guard.variant,
        proposal,
        options?.config ?? sandboxConfigFromEnv(),
        signal,
        options?.simulation,
      );
      const recovered = await sdk.recover(owner.name);
      if (recovered.state !== "TERMINAL")
        return { state: "UNKNOWN", verified: false, behaviorVerified: false };
    }
    // Also covers a restart after terminal reconciliation but before shared lease release.
    const guards = auditTerminalGuards(directory);
    signal.throwIfAborted();
    const result = {
      format: "repolab-preact-execution-recovery/v1",
      id,
      state: "TERMINAL",
      verified: false,
      behaviorVerified: false,
      at: new Date().toISOString(),
      execution: journal.provenance.execution,
      inference: "none (read-only recovery)",
      journalSha256: shaNative(readFileSync(join(directory, "journal.json"))),
      guardHashes: guards,
    };
    const resultPath = join(directory, "execution-recovery.json");
    if (!existsSync(resultPath))
      await writeFile(resultPath, JSON.stringify(result) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    else auditFreshPreactRecovery(directory, id);
    // Validate both before removing either. A partial release is restartable, never a compute retry.
    for (let i = 0; i < 2; i++) {
      const path = join(roots[i], "clsx-repair.lock");
      if (
        existsSync(path) &&
        readFileSync(path, "utf8") !== binding.leases[i].bytes
      )
        throw Error("Workflow lease changed");
    }
    for (const root of roots) {
      const path = join(root, "clsx-repair.lock");
      if (existsSync(path)) await unlink(path);
    }
    return result;
  } finally {
    await releaseRecovery();
  }
}

function auditTerminalGuards(directory: string) {
  const guards = readdirSync(directory)
    .filter((p) => /^guard-.*\.json$/.test(p))
    .sort();
  for (const name of guards) {
    const guard = read(join(directory, name));
    const rawPath = join(directory, name.replace(/^guard-/, "")),
      raw = read(rawPath);
    if (
      guard.format !== "repolab-preact-execution-guard/v1" ||
      name !== "guard-" + guard.variant + "-" + guard.stage + ".json" ||
      guard.state !== "TERMINAL" ||
      !["SUCCESS", "FAILED", "CANCELLED"].includes(guard.terminalStatus) ||
      guard.rawSha256 !== shaNative(readFileSync(rawPath)) ||
      guard.operationId !== raw.id ||
      guard.sourceHash !== raw.sourceHash ||
      guard.variant !== raw.variant ||
      guard.stage !== raw.stage ||
      JSON.stringify(guard.request) !== JSON.stringify(raw.request) ||
      guard.requestSha256 !== shaNative(JSON.stringify(guard.request)) ||
      guard.owner?.requestSha256 !== guard.requestSha256
    )
      throw Error("Unresolved or altered guarded evidence");
    let operation = raw.latest;
    if (guard.recoveryPath) {
      const path = resolve(guard.recoveryPath);
      if (
        !path.startsWith(resolve(directory) + "/") ||
        guard.recoverySha256 !== shaNative(readFileSync(path))
      )
        throw Error("Recovery observation changed");
      operation = read(path).operation;
    }
    if (
      operation?.uuid !== guard.operationId ||
      operation.image_uuid !== guard.request.image ||
      operation.status !== guard.terminalStatus
    )
      throw Error("Recovery operation binding changed");
  }
  return guards.map((path) => ({
    path,
    sha256: shaNative(readFileSync(join(directory, path))),
  }));
}
export function auditFreshPreactRecovery(directory: string, id: string) {
  const result = read(join(directory, "execution-recovery.json"));
  if (
    result.format !== "repolab-preact-execution-recovery/v1" ||
    result.id !== id ||
    result.state !== "TERMINAL" ||
    result.verified !== false ||
    result.behaviorVerified !== false ||
    existsSync(join(directory, "active-execution.json")) ||
    result.journalSha256 !==
      shaNative(readFileSync(join(directory, "journal.json"))) ||
    JSON.stringify(result.guardHashes) !==
      JSON.stringify(auditTerminalGuards(directory))
  )
    throw Error("Execution recovery evidence changed");
  return result;
}

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Store } from "../storage/store.ts";
import { configFromEnv } from "../providers/nebius.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { trialSettings } from "../evaluation/preact-reliability-v2.ts";
import { auditFreshPreact } from "./preact-repair-protocol-v2.ts";
import { createFreshPreactSession, REPAIR_ROOT } from "./preact-repair-v2.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";

export function freshPreactReadiness() {
  let reason =
    "Qualified full-thinking inference and native Sandbox configuration ready";
  try {
    auditFreshPreact();
    const cfg = configFromEnv(),
      sb = sandboxConfigFromEnv();
    if (
      !cfg.apiKey ||
      cfg.model !== trialSettings.model ||
      cfg.baseUrl !== trialSettings.baseUrl ||
      cfg.inputRate !== trialSettings.rates.input ||
      cfg.outputRate !== trialSettings.rates.output ||
      !sb.token ||
      !sb.project ||
      !sb.coverageConfirmed ||
      sb.baseUrl !== "https://api.tokenfactory.nebius.com/sandboxes/"
    )
      throw Error(
        "Configure the qualified Nebius model, rates, Sandbox token and project locally",
      );
    const ledger = new Store(".repolab/state.sqlite");
    try {
      if (ledger.hasUnsettledCharges())
        throw Error(
          "Reconcile pending or uncertain inference charges before dispatch",
        );
    } finally {
      ledger.close();
    }
    if (
      [
        ".repolab/clsx-repair.lock",
        ".repolab/repositories/clsx-repair.lock",
      ].some(existsSync)
    )
      throw Error(
        "Another workflow or unresolved execution lease blocks dispatch",
      );
    return { available: true, reason };
  } catch (e) {
    if (e instanceof Error && !e.message.includes("credential"))
      reason = e.message;
    else reason = "Qualified local configuration unavailable";
    assertNativeNoSecrets(reason);
    return { available: false, reason };
  }
}
const completed = new Set([
  "ACCEPTED_INDEPENDENTLY_CORRECT",
  "ACCEPTED_INDEPENDENTLY_INCORRECT",
  "ABSTAINED",
  "ERROR",
  "CANCELLED",
  "INTERRUPTED",
  "INVALID_REPAIR_EVIDENCE",
]);
export function freshPreactReview(r: any, directory: string) {
  let verified = false,
    status = r.status,
    invalid = false;
  if (
    [
      "ACCEPTED_INDEPENDENTLY_CORRECT",
      "ACCEPTED_INDEPENDENTLY_INCORRECT",
      "ABSTAINED",
    ].includes(status)
  ) {
    try {
      const result = createFreshPreactSession(directory, { id: r.id }).audit();
      verified = result.verified;
    } catch {
      status = "INVALID_REPAIR_EVIDENCE";
      invalid = true;
    }
  }
  const result = {
    id: r.id,
    freeze: r.freeze,
    status,
    verified,
    simulated: !!r.simulated,
    startedAt: r.startedAt,
    completedAt: r.completedAt ?? null,
    active: !completed.has(status),
    failedStage: r.failedStage ?? null,
    error: invalid ? "Raw evidence audit failed" : (r.error ?? null),
    executionUncertain: !!r.executionUncertain,
    inferenceCalls: r.requests?.length ?? 0,
    executionCount: r.operations?.length ?? 0,
    estimatedInferenceUsd: (r.usage ?? []).reduce(
      (n: number, u: any) => n + u.costUsd,
      0,
    ),
    usageComplete: r.requests?.length === r.usage?.length,
    provenance: r.provenance,
    sourceHash: invalid ? null : (r.selection?.sourceHash ?? null),
    accepted: !invalid && !!r.selection?.accepted,
    candidates: (r.attempts ?? []).map((a: any) => ({
      attempt: a.attempt,
      status: a.status,
      sourceHash: a.sourceHash ?? null,
      stages: a.stages ?? [],
      feedback: a.feedback
        ? {
            kind: a.feedback.kind ?? null,
            stage: a.feedback.stage ?? null,
            reason: a.feedback.reason ?? null,
          }
        : null,
    })),
    native: invalid
      ? null
      : r.native
        ? {
            mocha: {
              passed: r.native.mocha.passed,
              total: r.native.mocha.cases.length,
            },
            browser: {
              passed: r.native.browser.passed,
              total: r.native.browser.cases.length,
              skipped: r.native.browser.skipped,
            },
            types: r.native.types,
          }
        : null,
    public: invalid
      ? null
      : r.public
        ? {
            passed: r.public.passed,
            total: r.public.total,
            failed: r.public.failed,
          }
        : null,
    independent: invalid
      ? null
      : r.independent
        ? {
            passed: r.independent.passed,
            total: r.independent.total,
            failed: r.independent.failed,
          }
        : null,
    latestStage: r.operations?.at(-1)?.stage ?? null,
    operationIds: (r.operations ?? [])
      .map((op: any) => {
        try {
          return (
            JSON.parse(readFileSync(join(directory, op.name + ".json"), "utf8"))
              .id ?? null
          );
        } catch {
          return null;
        }
      })
      .filter(Boolean),
    patchAvailable: verified,
    scope:
      "One exposed Preact ref-cleanup feature; developer-supplied scaffolding, same-project cached native image; browser 11 original skips and types 2 pending",
  };
  assertNativeNoSecrets(result);
  return result;
}
export class FreshPreactHistory {
  private root: string;
  constructor(root = REPAIR_ROOT) {
    this.root = root;
  }
  private directory(id: string) {
    return join(this.root, "repair-" + z.uuid().parse(id));
  }
  private read(id: string) {
    const directory = this.directory(id),
      path = join(directory, "journal.json");
    if (!existsSync(path)) return null;
    const ds = lstatSync(directory),
      st = lstatSync(path);
    if (
      !ds.isDirectory() ||
      ds.isSymbolicLink() ||
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.size > 2_000_000
    )
      throw Error("Invalid saved repair entry");
    const r = JSON.parse(readFileSync(path, "utf8"));
    if (r.id !== id || r.format !== "repolab-native-preact-repair-journal/v2")
      throw Error("Saved repair identity changed");
    assertNativeNoSecrets(r);
    return { r, directory };
  }
  async get(id: string) {
    const entry = this.read(id);
    return entry ? freshPreactReview(entry.r, entry.directory) : null;
  }
  async list() {
    if (!existsSync(this.root)) return [];
    const records = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      const id = entry.name.replace(/^repair-/, "");
      if (!entry.isDirectory() || !z.uuid().safeParse(id).success) continue;
      try {
        const r = await this.get(id);
        if (r) records.push(r);
      } catch {
        /* Invalid entries cannot acquire a verified badge. */
      }
    }
    return records
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  }
  async patch(id: string) {
    const entry = this.read(id);
    if (!entry || !freshPreactReview(entry.r, entry.directory).verified)
      throw Error("Patch requires audited independent correctness");
    const attempt = entry.r.attempts.find(
      (a: any) => a.status === "SELECTED",
    ).attempt;
    const patch = readFileSync(
      join(entry.directory, "candidate-" + attempt + ".patch"),
      "utf8",
    );
    assertNativeNoSecrets(patch);
    return patch;
  }
  async recover() {
    if (!existsSync(this.root)) return;
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      const id = entry.name.replace(/^repair-/, "");
      if (!entry.isDirectory() || !z.uuid().safeParse(id).success) continue;
      const saved = this.read(id);
      if (!saved || completed.has(saved.r.status)) continue;
      try {
        process.kill(saved.r.controllerPid, 0);
        continue;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") continue;
      }
      saved.r.failedStage = saved.r.status;
      saved.r.status = "INTERRUPTED";
      saved.r.completedAt = new Date().toISOString();
      saved.r.error =
        "Controller interrupted; evidence and leases retained; no automatic retry";
      await writeFile(
        join(saved.directory, "journal.json"),
        JSON.stringify(saved.r, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
  }
}

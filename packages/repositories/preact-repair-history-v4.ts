import { auditFreshPreactRecovery } from "./preact-repair-recovery-v1.ts";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createFreshPreactSession, REPAIR_ROOT } from "./preact-repair-v4.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";
import { digest, regularBytes } from "../evaluation/live-release-v1.ts";

const sourceFreezePath = ".repolab/live-release-v2/freeze.json";
const sourceFreezeSha = "5f8fb8a2d2c355a0cb457db1530bb3e528cad8f07b68f76812a9063fd7b95cfd";

export function unresolvedGuardedPreactExecution(root = REPAIR_ROOT) {
  if (!existsSync(root)) return false;
  return readdirSync(root, { withFileTypes: true }).some(
    (entry) =>
      /^repair-[0-9a-f-]+$/.test(entry.name) &&
      (entry.isSymbolicLink() ||
        existsSync(join(root, entry.name, "active-execution.json"))),
  );
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
  const unresolved = existsSync(join(directory, "active-execution.json"));
  let recovered = false;
  if (existsSync(join(directory, "execution-recovery.json"))) {
    try {
      auditFreshPreactRecovery(directory, r.id);
      recovered = true;
    } catch {
      /* stays unresolved */
    }
  }
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
      verified = result.verified && !unresolved && !r.executionUncertain;
    } catch {
      status = "INVALID_REPAIR_EVIDENCE";
      invalid = true;
    }
  }
  // Dispatch is journaled before the workflow's completed-operation list advances.
  const operations = new Map<string, any>(
    (r.operations ?? []).map((op: any) => [op.name, op]),
  );
  for (const file of readdirSync(directory).filter((name) =>
    /^guard-(original|candidate-[1-3])-[a-zA-Z-]+\.json$/.test(name),
  )) {
    const name = file.slice(6, -5);
    if (!operations.has(name)) {
      const guard = JSON.parse(readFileSync(join(directory, file), "utf8"));
      operations.set(name, { name, stage: guard.stage });
    }
  }
  const observedOperations = [...operations.values()];
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
    executionUncertain: unresolved || (!!r.executionUncertain && !recovered),
    recovery: recovered
      ? "Execution reconciled; repair remains unverified"
      : null,
    inferenceCalls: r.requests?.length ?? 0,
    executionCount: observedOperations.length,
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
    latestStage: observedOperations.at(-1)?.stage ?? null,
    operationIds: observedOperations
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
  private cache = new Map<string, { key: string; value: ReturnType<typeof freshPreactReview> & { patchSha256: string | null } }>();
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
    if (lstatSync(this.root).isSymbolicLink()) throw Error("Invalid saved repair root");
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
    if (r.id !== id || r.format !== "repolab-native-preact-repair-journal/v4")
      throw Error("Saved repair identity changed");
    assertNativeNoSecrets(r);
    return { r, directory };
  }
  private identity(entry: { r: any; directory: string }) {
    // Cache only while every raw file and every input consulted by replay keeps its bytes.
    // A source-only checkout has no private release freeze and uses uncached replay.
    if (!existsSync(sourceFreezePath)) return null;
    const freezeBytes = regularBytes(sourceFreezePath);
    if (digest(freezeBytes) !== sourceFreezeSha) throw Error("Source freeze identity changed");
    const paths = new Set<string>([
      ...Object.keys(JSON.parse(freezeBytes.toString()).assets),
      ...(entry.r.priorArtifacts ?? []).map((a: any) => a.path),
    ]);
    const raw = readdirSync(entry.directory).sort().map(name => {
      const path = join(entry.directory, name), st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink()) throw Error("Invalid raw evidence file");
      return [name, digest(readFileSync(path))];
    });
    return digest(JSON.stringify({ inputs: [...paths].sort().map(path => [path, digest(regularBytes(path))]), raw }));
  }
  async get(id: string) {
    const entry = this.read(id);
    if (!entry) return null;
    const key = this.identity(entry), cached = this.cache.get(id);
    if (key && cached?.key === key) return structuredClone(cached.value);
    const value = freshPreactReview(entry.r, entry.directory);
    const chosen = value.candidates.find((a: any) => a.status === "SELECTED");
    const patchSha256 = value.verified ? digest(readFileSync(join(entry.directory, "candidate-" + chosen!.attempt + ".patch"))) : null;
    if (key && this.identity(entry) !== key) throw Error("Evidence changed during review");
    const projected = { ...value, patchSha256 };
    if (key) this.cache.set(id, { key, value: projected });
    return structuredClone(projected);
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
    const view = await this.get(id);
    if (!entry || !view?.verified)
      throw Error("Patch requires audited independent correctness");
    const attempt = entry.r.attempts.find(
      (a: any) => a.status === "SELECTED",
    ).attempt;
    const patch = readFileSync(
      join(entry.directory, "candidate-" + attempt + ".patch"),
      "utf8",
    );
    assertNativeNoSecrets(patch);
    if (digest(patch) !== view.patchSha256) throw Error("Selected patch bytes changed");
    return patch;
  }
}

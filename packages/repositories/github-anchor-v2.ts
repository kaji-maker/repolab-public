import { readFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { assertSourceSyntax } from "./source-syntax-v1.ts";
import {
  CrossRepoSandbox,
  crossSha,
  parseCrossReceipt,
} from "../execution/cross-repo-sandbox-v1.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { acquireRepairLease } from "./repair-lease.ts";
import { saveCross, checkCrossObservations } from "./fresh-pilot-v4.ts";
import {
  githubAnchorTask as originalTask,
  githubAnchorRequest,
  githubExpressionAnchors,
  githubGuestConfig,
  githubSandboxRequest,
  githubControls,
  uvuNativeSignature,
} from "./github-anchor-v1.ts";
import {
  auditGithubAnchors,
  githubAnchorSettings,
  GITHUB_ANCHOR_FREEZE,
} from "./github-anchor-protocol-v2.ts";
export const GITHUB_ANCHOR_ROOT = ".repolab/github-anchor-v2";
export function githubAnchorTask(name: string) {
  return {
    ...originalTask(name),
    runtime: { ...githubAnchorSettings.nativeRuntime },
  };
}
export function parseGithubRuntimeReceipt(raw: any, config: any) {
  if (
    JSON.stringify(config.runtime) !==
    JSON.stringify(githubAnchorSettings.nativeRuntime)
  )
    throw Error("Pinned GitHub native runtime required");
  const proof = parseCrossReceipt(raw, config),
    stream = raw.latest.metadata.result.stdout,
    version = JSON.parse(
      Buffer.from(
        stream.value,
        stream.encoding === "base64" ? "base64" : "utf8",
      ).toString(),
    ).executionRuntimeVersion;
  if (
    config.phase === "observations"
      ? !/^v24\./.test(version)
      : version !== "v12.22.12"
  )
    throw Error("GitHub execution runtime differs from phase policy");
  return { ...proof, executionRuntimeVersion: version };
}
/** Preparation only: no provider client, no inference, no candidate source. */
export async function qualifyGithubAnchors(name: string, signal: AbortSignal) {
  auditGithubAnchors();
  const m = githubAnchorTask(name),
    directory = join(GITHUB_ANCHOR_ROOT, name),
    path = join(directory, "result.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (existsSync(path))
    throw Error("Qualification slot already used; no automatic retry");
  const r: any = {
    format: "repolab-github-anchor-qualification/v2",
    freeze: GITHUB_ANCHOR_FREEZE,
    id: randomUUID(),
    task: name,
    status: "STARTED",
    startedAt: new Date().toISOString(),
    inferenceCalls: 0,
    executionCount: 0,
    operations: [],
    provenance: {
      inference: "none",
      execution: "nebius-sandbox; unchanged pinned public GitHub source",
    },
    repairStatus: "NOT_ATTEMPTED",
    independentOpened: false,
  };
  await saveCross(path, r, true);
  const releases: (() => Promise<void>)[] = [];
  const persist = () => saveCross(path, r);
  try {
    try {
      r.contextAdmission = {
        status: "ADMITTED",
        completeBodyBytes: githubAnchorRequest(m, '"\\'.repeat(900), 2).bytes,
        expressionAnchors: githubExpressionAnchors(m).length,
        limit: githubAnchorSettings.requestBytes,
      };
    } catch (e) {
      r.contextAdmission = {
        status: "BLOCKED_CONTEXT",
        error: e instanceof Error ? e.message : "Context rejected",
      };
    }
    await persist();
    releases.push(await acquireRepairLease(".repolab", r.id));
    releases.push(await acquireRepairLease(".repolab/repositories", r.id));
    const remote = new CrossRepoSandbox(
      directory,
      sandboxConfigFromEnv(),
      signal,
    );
    const run = async (
      label: string,
      image: string,
      phase: string,
      cases: any[] = [],
    ) => {
      auditGithubAnchors();
      signal.throwIfAborted();
      if (++r.executionCount > 6)
        throw Error("Qualification operation slots exhausted");
      r.status = label;
      await persist();
      const c = githubGuestConfig(m, phase, r.generatedHashes);
      c.cases = cases;
      await saveCross(join(directory, label + "-config.json"), c, true);
      const inputs: Record<string, Buffer> = {
        "config.json": Buffer.from(JSON.stringify(c)),
      };
      if (phase === "dependencies")
        Object.assign(inputs, {
          "original.tar.gz": readFileSync(m.base + "/original.tar.gz"),
          "driver.cjs": readFileSync(
            "repositories/github-anchor-v2/driver.cjs",
          ),
          "child.cjs": readFileSync("repositories/cross-repo-v1/child.cjs"),
        });
      const files: Record<string, unknown> = {};
      for (const [p, b] of Object.entries(inputs))
        files["/opt/repolab/cross/" + p] = await remote.upload(
          b,
          label + "-" + p.replace(/\./g, "-"),
          p === "config.json" ? "0400" : "0444",
        );
      const raw = await remote.run(
          label,
          githubSandboxRequest(image, files, phase),
        ),
        proof = parseGithubRuntimeReceipt(raw, c);
      if (
        phase === "observations" &&
        (proof.guest.isolation?.denied !== 4 ||
          proof.guest.isolation?.temporaryOutputWritable !== true)
      )
        throw Error("GitHub Unix isolation controls failed");
      if (r.operations.some((o: any) => o.id === proof.id))
        throw Error("Duplicate operation ID");
      r.operations.push({
        label,
        id: proof.id,
        receiptSha256: crossSha(readFileSync(join(directory, label + ".json"))),
        configSha256: crossSha(
          readFileSync(join(directory, label + "-config.json")),
        ),
        executionRuntimeVersion: proof.executionRuntimeVersion,
      });
      await persist();
      return proof;
    };
    const deps = await run(
      "q-dependencies",
      sandboxConfigFromEnv().image,
      "dependencies",
    );
    if (!deps.image) throw Error("Original dependency image absent");
    r.dependencyImage = deps.image;
    r.dependencyLockSha256 = deps.guest.lockSha256;
    const stage = await run("q-stage", deps.image, "stage");
    assertSourceSyntax(stage.guest, githubGuestConfig(m, "stage"));
    if (!stage.image) throw Error("Original built image absent");
    r.originalImage = stage.image;
    r.generatedHashes = stage.guest.generatedHashes;
    r.nativeSignature = uvuNativeSignature(
      (await run("q-native", r.originalImage, "native")).guest.native,
    );
    const a = await run("q-public-A", r.originalImage, "observations", m.cases),
      b = await run("q-public-B", r.originalImage, "observations", m.cases);
    for (const proof of [a, b]) {
      checkCrossObservations(proof.guest, m.cases, true);
      for (const row of proof.guest.rows)
        if (
          m.cases.find((c: any) => c.id === row.id)?.kind === "control" &&
          !row.passed
        )
          throw Error("Original ordinary public control failed");
    }
    if (JSON.stringify(a.guest) !== JSON.stringify(b.guest))
      throw Error("Original GitHub delta did not repeat");
    r.originalPublic = a.guest;
    const controls = await run(
      "q-controls",
      r.originalImage,
      "observations",
      githubControls(m),
    );
    if (
      JSON.stringify(controls.guest.rows.map((v: any) => v.passed)) !==
      JSON.stringify([true, true, true, true, false, false])
    )
      throw Error("GitHub false-pass controls failed");
    r.controls = controls.guest;
    r.status = "QUALIFIED_ORIGINAL";
  } catch (e) {
    r.failedPhase = r.status;
    r.status = "ORIGINAL_QUALIFICATION_FAILED";
    r.error = e instanceof Error ? e.message : "Qualification failed";
  } finally {
    const { readdir } = await import("node:fs/promises");
    r.executionUncertain = false;
    for (const file of await readdir(directory)) {
      if (!/^q-.*\.json$/.test(file) || file.endsWith("-config.json")) continue;
      const raw = JSON.parse(readFileSync(join(directory, file), "utf8"));
      if (raw.executionUncertain || raw.submissionUnconfirmed)
        r.executionUncertain = true;
    }
    r.completedAt = new Date().toISOString();
    await persist();
    if (!r.executionUncertain)
      for (const release of releases.reverse()) await release();
  }
  return r;
}

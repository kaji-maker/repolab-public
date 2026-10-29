import { readFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CrossRepoSandbox,
  crossSha,
} from "../execution/cross-repo-sandbox-v1.ts";
import {
  NebiusFormatProposer,
  StructuredResponseError,
} from "../providers/nebius-format-v1.ts";
import { configFromEnv } from "../providers/nebius.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { Store } from "../storage/store.ts";
import { acquireRepairLease } from "./repair-lease.ts";
import {
  saveCross,
  crossSourceHash,
  checkCrossObservations,
} from "./fresh-pilot-v4.ts";
import { assertSourceSyntax } from "./source-syntax-v1.ts";
import {
  githubAnchorTask,
  parseGithubRuntimeReceipt,
  GITHUB_ANCHOR_ROOT as QUALIFICATION_ROOT,
} from "./github-anchor-v2.ts";
import {
  githubGuestConfig,
  githubSandboxRequest,
  githubControls,
  uvuNativeSignature,
  githubAnchorRequest,
  compileGithubAnchors,
  GITHUB_ANCHOR_SYSTEM,
} from "./github-anchor-v1.ts";
import {
  auditGithubRepairProtocol,
  githubRepairSettings,
  GITHUB_REPAIR_FREEZE,
} from "./github-anchor-protocol-v3.ts";
export const GITHUB_REPAIR_ROOT = ".repolab/github-anchor-v3";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function githubRepairConfig(
  m: any,
  sources: Record<string, string>,
  phase: string,
  cases: any[] = [],
  generatedHashes: Record<string, string> = {},
) {
  if (Object.keys(sources).sort().join() !== [...m.sourcePaths].sort().join())
    throw Error("Candidate source inventory changed");
  const overrides = Object.fromEntries(
    Object.entries(sources)
      .filter(([p, s]) => s !== m.sources[p])
      .map(([p, s]) => [p, crossSha(s)]),
  );
  return {
    ...githubGuestConfig(m, phase, generatedHashes),
    sourceHash: crossSourceHash(m, sources),
    overrides,
    candidateFiles: Object.fromEntries(
      Object.keys(overrides).map((p) => [p, sources[p]]),
    ),
    cases,
  };
}
export function assertGithubIsolation(proof: any, c: any) {
  if (
    c.phase === "observations" &&
    (proof.guest.isolation?.denied !== 4 ||
      proof.guest.isolation?.temporaryOutputWritable !== true)
  )
    throw Error("GitHub Unix isolation controls failed");
}
export function loadGithubQualification(
  name: string,
  reader = (path: string) => readFileSync(path),
) {
  const baseline = githubRepairSettings.baselines.find((v) => v.task === name);
  if (!baseline) throw Error("Task outside frozen GitHub sample");
  const directory = join(QUALIFICATION_ROOT, name),
    bytes = reader(join(directory, "result.json"));
  if (crossSha(bytes) !== baseline.resultSha256)
    throw Error("Qualified original evidence changed");
  const q = JSON.parse(bytes.toString()),
    m = githubAnchorTask(name);
  if (
    q.status !== "QUALIFIED_ORIGINAL" ||
    q.freeze !== githubRepairSettings.parentFreeze ||
    q.executionUncertain ||
    q.independentOpened ||
    q.inferenceCalls !== 0 ||
    q.operations.length !== 6
  )
    throw Error("Qualified original required");
  const ids = new Set<string>();
  for (const [i, label] of [
    "q-dependencies",
    "q-stage",
    "q-native",
    "q-public-A",
    "q-public-B",
    "q-controls",
  ].entries()) {
    const o = q.operations[i],
      rawBytes = reader(join(directory, label + ".json")),
      configBytes = reader(join(directory, label + "-config.json"));
    if (
      o.label !== label ||
      crossSha(rawBytes) !== o.receiptSha256 ||
      crossSha(configBytes) !== o.configSha256
    )
      throw Error("Qualification receipt binding changed");
    const raw = JSON.parse(rawBytes.toString()),
      c = JSON.parse(configBytes.toString()),
      proof = parseGithubRuntimeReceipt(raw, c);
    if (
      proof.id !== o.id ||
      ids.has(proof.id) ||
      c.taskId !== m.id ||
      c.sourceHash !== crossSourceHash(m, m.sources) ||
      Object.keys(c.overrides).length ||
      Object.keys(c.candidateFiles).length
    )
      throw Error("Qualification identity changed");
    ids.add(proof.id);
    assertGithubIsolation(proof, c);
    if (
      i === 0 &&
      (proof.image !== q.dependencyImage ||
        proof.guest.lockSha256 !== q.dependencyLockSha256)
    )
      throw Error("Dependency image changed");
    if (i === 1) {
      assertSourceSyntax(proof.guest, c);
      if (
        raw.request.image !== q.dependencyImage ||
        proof.image !== q.originalImage ||
        JSON.stringify(proof.guest.generatedHashes) !==
          JSON.stringify(q.generatedHashes)
      )
        throw Error("Original image changed");
    }
    if (i >= 2 && raw.request.image !== q.originalImage)
      throw Error("Qualification image chain changed");
    if (
      i === 2 &&
      JSON.stringify(uvuNativeSignature(proof.guest.native)) !==
        JSON.stringify(q.nativeSignature)
    )
      throw Error("Native baseline changed");
    if (i === 3 || i === 4) {
      if (JSON.stringify(c.cases) !== JSON.stringify(m.cases))
        throw Error("Original public contract changed");
      checkCrossObservations(proof.guest, m.cases, true);
      if (
        JSON.stringify(proof.guest) !== JSON.stringify(q.originalPublic) ||
        proof.guest.rows.some(
          (v: any) =>
            m.cases.find((c: any) => c.id === v.id)?.kind === "control" &&
            !v.passed,
        )
      )
        throw Error("Original public baseline changed");
    }
    if (
      i === 5 &&
      (JSON.stringify(c.cases) !== JSON.stringify(githubControls(m)) ||
        JSON.stringify(proof.guest.rows.map((v: any) => v.passed)) !==
          JSON.stringify([true, true, true, true, false, false]))
    )
      throw Error("Original controls changed");
  }
  return q;
}
/** Independent bytes are opened only after durable selection and both native/public repeats. */
export function openGithubIndependent(
  name: string,
  selection: any,
  operations: any[],
  reader = read,
) {
  if (
    !githubRepairSettings.tasks.includes(name) ||
    !selection ||
    !/^[a-f0-9]{64}$/.test(selection.sourceHash) ||
    !Number.isInteger(selection.attempt) ||
    selection.attempt < 1 ||
    selection.attempt > githubRepairSettings.maxCandidates
  )
    throw Error("Durable selection required before independent evaluation");
  const prefix = "c" + selection.attempt;
  for (const label of [
    prefix + "-stage",
    ...["A", "B"].flatMap((repeat) => [
      prefix + "-public-" + repeat,
      prefix + "-native-" + repeat,
    ]),
  ]) {
    const matches = operations.filter((o) => o.label === label);
    if (
      matches.length !== 1 ||
      !selection.operationHashes?.includes(matches[0].receiptSha256)
    )
      throw Error("Repeated native/public selection evidence required");
  }
  return reader(
    "repositories/github-anchor-v1/" + name + "/independent-cases.json",
  );
}

export async function repairGithubAnchors(name: string, signal: AbortSignal) {
  auditGithubRepairProtocol();
  const m = githubAnchorTask(name),
    directory = join(GITHUB_REPAIR_ROOT, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "result.json");
  if (existsSync(path))
    throw Error("Study slot already used; no automatic retry");
  const r: any = {
    format: "repolab-github-anchor-repair/v3",
    freeze: GITHUB_REPAIR_FREEZE,
    id: randomUUID(),
    task: name,
    candidates: [],
    scope: githubRepairSettings.scope,
    startedAt: new Date().toISOString(),
    status: "STARTED",
    inferenceCalls: 0,
    executionCount: 0,
    operations: [],
    provenance: {
      inference: "none",
      execution:
        "nebius-sandbox; pinned public GitHub source and model-generated expression replacements",
    },
  };
  await saveCross(path, r, true);
  const persist = () => saveCross(path, r),
    releases: (() => Promise<void>)[] = [];
  let store: Store | undefined;
  try {
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
      sources: Record<string, string>,
      phase: string,
      cases: any[] = [],
    ) => {
      auditGithubRepairProtocol();
      signal.throwIfAborted();
      if (++r.executionCount > githubRepairSettings.operationsPerTask)
        throw Error("GitHub repair operation slots exhausted");
      r.status = label;
      await persist();
      const c = githubRepairConfig(
        m,
        sources,
        phase,
        cases,
        r.generatedHashes ?? {},
      );
      await saveCross(join(directory, label + "-config.json"), c, true);
      const inputs: Record<string, Buffer> = {
        "config.json": Buffer.from(JSON.stringify(c)),
      };
      const uploads: Record<string, unknown> = {};
      for (const [p, b] of Object.entries(inputs))
        uploads["/opt/repolab/cross/" + p] = await remote.upload(
          b,
          label + "-" + p.replace(/\./g, "-"),
          p === "config.json" ? "0400" : "0444",
        );
      const raw = await remote.run(
          label,
          githubSandboxRequest(image, uploads, phase),
        ),
        proof = parseGithubRuntimeReceipt(raw, c);
      assertGithubIsolation(proof, c);
      if (r.operations.some((o: any) => o.id === proof.id))
        throw Error("Reused operation ID");
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
    {
      // Re-audit every original before dispatching any task in the fixed sample.
      for (const task of githubRepairSettings.tasks)
        loadGithubQualification(task);
      const qp = join(QUALIFICATION_ROOT, name, "result.json"),
        q = loadGithubQualification(name);
      r.qualificationSha256 = crossSha(readFileSync(qp));
      r.originalImage = q.originalImage;
      r.generatedHashes = q.generatedHashes;
      const config = configFromEnv();
      if (
        config.model !== githubRepairSettings.model ||
        config.inputRate !== 0.3 ||
        config.outputRate !== 0.9
      )
        throw Error("Frozen model and rates required");
      store = new Store(".repolab/state.sqlite");
      if (store.hasUnsettledCharges())
        throw Error("Unsettled inference charge blocks study");
      let attempt = 0,
        request: ReturnType<typeof githubAnchorRequest>;
      const provider = new NebiusFormatProposer({
        ...config,
        mode: "full-thinking",
        budgetUsd: Number.MAX_SAFE_INTEGER,
        reserve: (amount) => {
          if (store!.hasUnsettledCharges())
            throw Error("Unsettled inference charge");
          return store!.reserve(
            crossSha(config.apiKey),
            amount,
            Number.MAX_SAFE_INTEGER,
          );
        },
        settle: (id, cost) => store!.settle(id, cost),
        fetch: async (url, init) => {
          if (
            ++r.inferenceCalls > githubRepairSettings.maxCandidates ||
            r.selection
          )
            throw Error("GitHub inference slots closed");
          if (String(init?.body) !== JSON.stringify(request.body))
            throw Error("GitHub request identity changed");
          r.provenance.inference = "nebius";
          await saveCross(
            join(directory, "request-" + attempt + ".json"),
            {
              at: new Date().toISOString(),
              body: request.body,
              sha256: crossSha(String(init?.body)),
            },
            true,
          );
          await persist();
          return fetch(url, init);
        },
        onCompletion: (c) =>
          saveCross(
            join(directory, "completion-" + attempt + ".json"),
            c,
            true,
          ),
        onDiagnostic: async (d) => {
          if (d.reservationId) store!.recordDiagnostic(d.reservationId, d);
          await saveCross(
            join(directory, "diagnostic-" + attempt + ".json"),
            d,
            true,
          );
        },
      });
      let feedback = JSON.stringify({
          total: q.originalPublic.total,
          passed: q.originalPublic.passed,
          failed: q.originalPublic.rows.filter((v: any) => !v.passed),
        }),
        selected: any = null,
        source = m.sources;
      const seen = new Set([crossSourceHash(m, m.sources)]);
      for (
        attempt = 1;
        attempt <= githubRepairSettings.maxCandidates;
        attempt++
      ) {
        request = githubAnchorRequest(m, feedback, attempt);
        const plan = await provider.structured(
            "plan_github_anchor_repair",
            GITHUB_ANCHOR_SYSTEM,
            request.prompt,
            request.schema,
            signal,
          ),
          candidate: any = { attempt, status: "PROPOSED", plan };
        r.candidates.push(candidate);
        await persist();
        try {
          const admitted = compileGithubAnchors(m, plan);
          if (seen.has(admitted.sourceHash))
            throw Error("Unchanged or duplicate GitHub candidate");
          seen.add(admitted.sourceHash);
          source = admitted.files;
          await saveCross(
            join(directory, "candidate-" + attempt + ".json"),
            admitted,
            true,
          );
          candidate.sourceHash = admitted.sourceHash;
          candidate.sourceFiles = Object.fromEntries(
            Object.entries(source).map(([p, s]) => [p, crossSha(s as string)]),
          );
          r.generatedHashes = q.generatedHashes;
          const stage = await run(
            "c" + attempt + "-stage",
            q.originalImage,
            source,
            "stage",
          );
          assertSourceSyntax(
            stage.guest,
            githubRepairConfig(m, source, "stage"),
          );
          if (!stage.image) throw Error("GitHub candidate image absent");
          candidate.image = stage.image;
          r.generatedHashes = stage.guest.generatedHashes;
          candidate.generatedHashes = stage.guest.generatedHashes;
          for (const repeat of ["A", "B"]) {
            const behavior = await run(
              "c" + attempt + "-public-" + repeat,
              candidate.image,
              source,
              "observations",
              m.cases,
            );
            checkCrossObservations(behavior.guest, m.cases);
            const native = await run(
              "c" + attempt + "-native-" + repeat,
              candidate.image,
              source,
              "native",
            );
            if (
              JSON.stringify(uvuNativeSignature(native.guest.native)) !==
              JSON.stringify(q.nativeSignature)
            )
              throw Error("Native GitHub inventory changed");
          }
          candidate.status = "SELECTED";
          r.selection = {
            attempt,
            sourceHash: admitted.sourceHash,
            at: new Date().toISOString(),
            operationHashes: r.operations.map((o: any) => o.receiptSha256),
          };
          await saveCross(join(directory, "selection.json"), r.selection, true);
          await persist();
          selected = candidate;
          break;
        } catch (error) {
          candidate.status = "REJECTED";
          candidate.error =
            error instanceof Error
              ? error.message
              : "GitHub candidate rejected";
          feedback = candidate.error;
          let uncertain = false;
          const rawPath = join(directory, r.status + ".json");
          if (existsSync(rawPath)) {
            const raw = read(rawPath);
            uncertain = !!(raw.executionUncertain || raw.submissionUnconfirmed);
            const stream = raw.latest?.metadata?.result?.stdout;
            if (stream)
              feedback +=
                "\n" +
                Buffer.from(
                  stream.value,
                  stream.encoding === "base64" ? "base64" : "utf8",
                )
                  .toString("utf8")
                  .slice(-1300);
          }
          await persist();
          if (
            uncertain ||
            signal.aborted ||
            /transport|polling|HTTP|submission/i.test(candidate.error)
          )
            throw error;
        }
      }
      if (!selected) {
        r.status = "ABSTAINED_NO_SELECTION";
        return r;
      }
      r.independentOpenedAt = new Date().toISOString();
      await persist();
      const cases = openGithubIndependent(name, r.selection, r.operations),
        a = await run(
          "independent-A",
          selected.image,
          source,
          "observations",
          cases,
        ),
        b = await run(
          "independent-B",
          selected.image,
          source,
          "observations",
          cases,
        );
      r.independent = [a.guest, b.guest];
      await persist();
      try {
        checkCrossObservations(a.guest, cases);
        checkCrossObservations(b.guest, cases);
        if (JSON.stringify(a.guest) !== JSON.stringify(b.guest))
          throw Error("Independent GitHub outcomes differed");
        r.status = "VERIFIED_GITHUB_REPAIR";
      } catch {
        r.status = "SELECTED_INDEPENDENTLY_INCORRECT";
      }
    }
  } catch (error) {
    r.failedPhase = r.status;
    r.status = "GITHUB_REPAIR_FAILED";
    r.error = error instanceof Error ? error.message : "Study slot failed";
    r.failureKind =
      error instanceof StructuredResponseError
        ? error.kind
        : "admission_or_execution";
  } finally {
    const { readdir } = await import("node:fs/promises");
    r.executionUncertain = false;
    for (const name of await readdir(directory)) {
      if (
        !/^(q-|c\d-|independent-).*\.json$/.test(name) ||
        name.endsWith("-config.json")
      )
        continue;
      const raw = read(join(directory, name));
      if (raw.executionUncertain || raw.submissionUnconfirmed)
        r.executionUncertain = true;
    }
    r.completedAt = new Date().toISOString();
    await persist();
    if (!r.executionUncertain)
      for (const release of releases.reverse()) await release();
    store?.close();
  }
  return r;
}

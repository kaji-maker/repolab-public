import { readFileSync, existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
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
  githubSandboxRequest,
  uvuNativeSignature,
  githubAnchorRequest,
  compileGithubAnchors,
  GITHUB_ANCHOR_SYSTEM,
} from "./github-anchor-v1.ts";
import {
  githubRepairConfig,
  assertGithubIsolation,
  loadGithubQualification,
} from "./github-anchor-v3.ts";
import {
  ModuleAdmissionError,
  staticSourceAdmission,
  moduleLoadCases,
  moduleLoadBaseline,
  assertModuleLoad,
} from "./module-admission-v1.ts";
import {
  auditGithubLoadProtocol,
  githubLoadSettings,
  GITHUB_LOAD_FREEZE,
} from "./github-anchor-protocol-v4.ts";
export const GITHUB_LOAD_ROOT = ".repolab/github-anchor-v4";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** Candidate operation order: static admission, stage, module load, then behavior. */
export const candidateLabels = (attempt: number) => [
  "c" + attempt + "-stage",
  "c" + attempt + "-load",
  ...["A", "B"].flatMap((repeat) => [
    "c" + attempt + "-public-" + repeat,
    "c" + attempt + "-native-" + repeat,
  ]),
];

/** Independent bytes open only after durable selection bound to load and both repeats. */
export function openGithubLoadIndependent(
  name: string,
  selection: any,
  operations: any[],
  reader = read,
) {
  if (
    !githubLoadSettings.tasks.includes(name) ||
    !selection ||
    !/^[a-f0-9]{64}$/.test(selection.sourceHash) ||
    !Number.isInteger(selection.attempt) ||
    selection.attempt < 1 ||
    selection.attempt > githubLoadSettings.maxCandidates ||
    selection.loadAdmission?.format !== "repolab-module-load-admission/v1" ||
    selection.staticAdmission?.format !== "repolab-static-source-admission/v1"
  )
    throw Error("Durable selection required before independent evaluation");
  for (const label of ["q-load", ...candidateLabels(selection.attempt)]) {
    const matches = operations.filter((o) => o.label === label);
    if (
      matches.length !== 1 ||
      !selection.operationHashes?.includes(matches[0].receiptSha256)
    )
      throw Error("Repeated load/native/public selection evidence required");
  }
  return reader(
    "repositories/github-anchor-v1/" + name + "/independent-cases.json",
  );
}

export function candidateFailureKind(error: unknown) {
  return error instanceof ModuleAdmissionError
    ? error.kind
    : error instanceof StructuredResponseError
      ? error.kind
      : "behavior_or_execution";
}

export async function repairGithubLoad(name: string, signal: AbortSignal) {
  auditGithubLoadProtocol();
  if (!githubLoadSettings.tasks.includes(name))
    throw Error("Task outside frozen V4 sample");
  const m = githubAnchorTask(name),
    directory = join(GITHUB_LOAD_ROOT, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "result.json");
  if (existsSync(path))
    throw Error("Study slot already used; no automatic retry");
  const r: any = {
    format: githubLoadSettings.format,
    freeze: GITHUB_LOAD_FREEZE,
    id: randomUUID(),
    task: name,
    candidates: [],
    scope: githubLoadSettings.scope,
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
      auditGithubLoadProtocol();
      signal.throwIfAborted();
      if (++r.executionCount > githubLoadSettings.operationsPerTask)
        throw Error("GitHub load operation slots exhausted");
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
      const uploads = {
        "/opt/repolab/cross/config.json": await remote.upload(
          Buffer.from(JSON.stringify(c)),
          label + "-config-json",
          "0400",
        ),
      };
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
    const q = loadGithubQualification(name);
    r.qualificationSha256 = crossSha(
      readFileSync(join(QUALIFICATION_ROOT, name, "result.json")),
    );
    r.originalImage = q.originalImage;
    r.generatedHashes = q.generatedHashes;
    r.originalStatic = staticSourceAdmission(m, m.sources);
    const config = configFromEnv();
    if (
      config.model !== githubLoadSettings.model ||
      config.inputRate !== 0.3 ||
      config.outputRate !== 0.9
    )
      throw Error("Frozen model and rates required");
    store = new Store(".repolab/state.sqlite");
    if (store.hasUnsettledCharges())
      throw Error("Unsettled inference charge blocks study");
    // Original-image load shape is observed before any inference.
    const baselineCases = moduleLoadCases(m),
      original = await run(
        "q-load",
        q.originalImage,
        m.sources,
        "observations",
        baselineCases,
      );
    r.loadBaseline = moduleLoadBaseline(
      original.guest,
      baselineCases,
      q.generatedHashes,
      original.executionRuntimeVersion,
    );
    await persist();
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
          ++r.inferenceCalls > githubLoadSettings.maxModelCalls ||
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
        saveCross(join(directory, "completion-" + attempt + ".json"), c, true),
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
    for (attempt = 1; attempt <= githubLoadSettings.maxCandidates; attempt++) {
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
        // Rejected here, a candidate consumes no Sandbox operation.
        candidate.staticAdmission = staticSourceAdmission(m, source);
        await persist();
        r.generatedHashes = q.generatedHashes;
        const [stageLabel, loadLabel] = candidateLabels(attempt);
        const stage = await run(stageLabel, q.originalImage, source, "stage");
        assertSourceSyntax(stage.guest, githubRepairConfig(m, source, "stage"));
        if (!stage.image) throw Error("GitHub candidate image absent");
        candidate.image = stage.image;
        r.generatedHashes = stage.guest.generatedHashes;
        candidate.generatedHashes = stage.guest.generatedHashes;
        const loadCases = moduleLoadCases(m, r.loadBaseline),
          load = await run(
            loadLabel,
            candidate.image,
            source,
            "observations",
            loadCases,
          );
        candidate.loadAdmission = assertModuleLoad(
          load.guest,
          loadCases,
          stage.guest.generatedHashes,
          load.executionRuntimeVersion,
        );
        await persist();
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
          staticAdmission: candidate.staticAdmission,
          loadAdmission: candidate.loadAdmission,
          at: new Date().toISOString(),
          operationHashes: r.operations.map((o: any) => o.receiptSha256),
        };
        await saveCross(join(directory, "selection.json"), r.selection, true);
        await persist();
        selected = candidate;
        break;
      } catch (error) {
        candidate.status = "REJECTED";
        candidate.failureKind = candidateFailureKind(error);
        candidate.error =
          error instanceof Error ? error.message : "GitHub candidate rejected";
        feedback = candidate.error;
        let uncertain = false;
        const rawPath = join(directory, r.status + ".json");
        if (r.status.startsWith("c" + attempt + "-") && existsSync(rawPath)) {
          const raw = read(rawPath);
          uncertain = !!(raw.executionUncertain || raw.submissionUnconfirmed);
          const stream = raw.latest?.metadata?.result?.stdout;
          if (stream && !(error instanceof ModuleAdmissionError))
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
    const cases = openGithubLoadIndependent(name, r.selection, r.operations),
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
  } catch (error) {
    r.failedPhase = r.status;
    r.status = "GITHUB_REPAIR_FAILED";
    r.error = error instanceof Error ? error.message : "Study slot failed";
    r.failureKind =
      error instanceof StructuredResponseError || error instanceof ModuleAdmissionError
        ? error.kind
        : "admission_or_execution";
  } finally {
    r.executionUncertain = false;
    for (const file of await readdir(directory)) {
      if (
        !/^(q-|c\d-|independent-).*\.json$/.test(file) ||
        file.endsWith("-config.json")
      )
        continue;
      const raw = read(join(directory, file));
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

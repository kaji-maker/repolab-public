import { readFileSync, existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compileLiteralIntent } from "./literal-intents-v1.ts";
import {
  serializerFixture,
  serializerGuestConfig,
  serializerRequest,
  assertSerializerProof,
} from "./serializer-study-v2.ts";
import {
  CrossRepoSandbox,
  crossSha,
} from "../execution/cross-repo-sandbox-v1.ts";
import { sandboxConfigFromEnv } from "../execution/nebius.ts";
import { parseDevelopmentReceipt } from "./cross-runtime-v2.ts";
import { freshNativeSignature } from "../execution/fresh-native-signature-v1.ts";
import {
  crossSourceHash,
  saveCross,
  checkCrossObservations,
} from "./fresh-pilot-v4.ts";
import { acquireRepairLease } from "./repair-lease.ts";
import {
  auditLiteralSerializer,
  LITERAL_FREEZE,
  literalSettings,
} from "./serializer-literal-protocol-v1.ts";
export const LITERAL_ROOT = ".repolab/serializer-literal-v1";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
export function literalBaseline(name: string) {
  if (!literalSettings.fixtures.includes(name))
    throw Error("Fixture outside literal selection");
  const b = read("evaluation/serializer-literal-v1-baselines.json").find(
      (v: any) => v.name === name,
    ),
    path = ".repolab/serializer-study-v2/" + name + "/qualify/result.json";
  if (!b || b.path !== path || crossSha(readFileSync(path)) !== b.sha256)
    throw Error("Original fixture qualification changed");
  const q = read(path);
  if (
    q.status !== "QUALIFIED_FIXTURE" ||
    q.executionUncertain ||
    q.freeze !== b.freeze ||
    q.originalImage !== b.originalImage ||
    JSON.stringify(q.nativeSignature) !== JSON.stringify(b.nativeSignature)
  )
    throw Error("Qualified original fixture required");
  return { ...b, record: q };
}
export function literalFixtureIntent(name: string) {
  if (!literalSettings.fixtures.includes(name))
    throw Error("Fixture outside literal selection");
  return read("repositories/serializer-literal-v1/" + name + "/intent.json");
}
export async function runLiteralSlot(name: string, signal: AbortSignal) {
  auditLiteralSerializer();
  const m = serializerFixture(name),
    baseline = literalBaseline(name),
    q = baseline.record,
    directory = join(LITERAL_ROOT, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "result.json");
  if (existsSync(path))
    throw Error("Literal fixture slot already used; no retry");
  const r: any = {
    format: "repolab-literal-fixture/v1",
    freeze: LITERAL_FREEZE,
    id: randomUUID(),
    fixture: name,
    scope: literalSettings.scope,
    status: "STARTED",
    startedAt: new Date().toISOString(),
    inferenceCalls: 0,
    executionCount: 0,
    operations: [],
    qualificationPath: baseline.path,
    qualificationSha256: baseline.sha256,
    originalImage: q.originalImage,
    provenance: {
      inference: "none; frozen controller-authored literal intent",
      execution: "nebius-sandbox; exposed development fixture",
      source: "deterministic literal compiler",
    },
  };
  await saveCross(path, r, true);
  const persist = () => saveCross(path, r),
    releases: (() => Promise<void>)[] = [];
  try {
    releases.push(await acquireRepairLease(".repolab", r.id));
    releases.push(await acquireRepairLease(".repolab/repositories", r.id));
    const intent = literalFixtureIntent(name),
      compiled = compileLiteralIntent(m.sources, intent);
    if (JSON.stringify(compiled.files) !== JSON.stringify(m.expectedSources))
      throw Error("Compiled bytes differ from frozen fixture intent");
    r.intent = intent;
    r.sourceHash = crossSourceHash(m, compiled.files);
    r.sourceFiles = Object.fromEntries(
      Object.entries(compiled.files).map(([p, s]) => [p, crossSha(s)]),
    );
    await persist();
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
      auditLiteralSerializer();
      signal.throwIfAborted();
      if (++r.executionCount > 5)
        throw Error("Literal fixture operation limit");
      r.status = label;
      await persist();
      const c = serializerGuestConfig(m, compiled.files, phase, cases);
      await saveCross(join(directory, label + "-config.json"), c, true);
      const bytes = Buffer.from(JSON.stringify(c)),
        file = await remote.upload(bytes, label + "-config-json", "0400"),
        raw = await remote.run(
          label,
          serializerRequest(
            image,
            { "/opt/repolab/cross/config.json": file },
            phase,
          ),
        ),
        proof = parseDevelopmentReceipt(raw, c);
      assertSerializerProof(proof, c);
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
    const stage = await run("candidate-stage", q.originalImage, "stage");
    if (!stage.image) throw Error("Compiled fixture image absent");
    r.candidateImage = stage.image;
    for (const repeat of ["A", "B"]) {
      const native = await run(
        "candidate-native-" + repeat,
        r.candidateImage,
        "native",
      );
      if (
        JSON.stringify(freshNativeSignature(native.guest.native, "tap")) !==
        JSON.stringify(q.nativeSignature)
      )
        throw Error("Original native fixture inventory changed");
      const observations = await run(
        "candidate-public-" + repeat,
        r.candidateImage,
        "observations",
        m.cases,
      );
      checkCrossObservations(observations.guest, m.cases);
    }
    r.status = "VERIFIED_DETERMINISTIC_FIXTURE";
  } catch (error) {
    r.status = "LITERAL_FIXTURE_FAILED";
    r.error = error instanceof Error ? error.message : "Literal fixture failed";
  } finally {
    r.executionUncertain = false;
    for (const n of await readdir(directory)) {
      if (!/^candidate-.*\.json$/.test(n) || n.endsWith("-config.json"))
        continue;
      const raw = read(join(directory, n));
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

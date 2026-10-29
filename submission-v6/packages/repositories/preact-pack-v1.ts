import { readFileSync } from "node:fs";
import { readFile, lstat, writeFile } from "node:fs/promises";
import { z } from "zod";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  programProposalSchema,
  admitGeneratedPreactEdit,
} from "./preact-generation-v2.ts";
import { preactRepairContext } from "./preact-admission-v5.ts";
import { trialPatch } from "../execution/preact-trial-v10.ts";
import { providerSecrets } from "./repair-view.ts";
import { auditPreactProduct } from "./preact-product-protocol-v1.ts";
export const SELECTED_PREACT_HASH =
  "b984dd0ab4e2c881495c546e9d4859178a6edc486dd2518823db08562b31dd49";
export const NATIVE_PACK_LIMIT = 1500000;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Payload = z.strictObject({
  format: z.literal("repolab-preact-pack/v1"),
  scope: z.literal("exposed-scoped-feature-request"),
  origin: z.strictObject({
    freeze: Hash,
    status: z.literal("ACCEPTED_INDEPENDENTLY_CORRECT"),
    model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
    inference: z.literal("nebius"),
    execution: z.literal("nebius-sandbox"),
  }),
  repository: z.strictObject({
    taskId: z.literal("preactjs__preact-4436"),
    repo: z.literal("preactjs/preact"),
    baseCommit: z.string(),
    problemStatement: z.string().max(20000),
  }),
  original: z.strictObject({
    archiveBase64: z.string().max(800000),
    archiveSha256: Hash,
    manifestJson: z.string().max(200000),
    license: z.string().max(10000),
  }),
  proposal: programProposalSchema,
  source: z.strictObject({
    sha256: Hash,
    files: z
      .array(
        z.strictObject({
          path: z.enum([
            "src/diff/index.js",
            "src/diff/children.js",
            "src/internal.d.ts",
          ]),
          content: z.string().max(100000),
          sha256: Hash,
        }),
      )
      .length(3),
  }),
  patch: z.strictObject({ content: z.string().max(200000), sha256: Hash }),
  publicObserver: z.strictObject({
    content: z.string().max(131072),
    sha256: Hash,
  }),
  independentInputsExported: z.literal(0),
});
const Pack = Payload.extend({ digest: Hash });
export type NativePreactPack = z.infer<typeof Pack>;
export function assertNativeNoSecrets(value: unknown) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (providerSecrets().some((k) => s.includes(k)))
    throw Error("Credential reflected; refusing native artifact");
}
function expectedPayload() {
  const r = JSON.parse(
    readFileSync("evaluation/preact-trial-v10-results-summary.json", "utf8"),
  ).result;
  if (
    r.status !== "ACCEPTED_INDEPENDENTLY_CORRECT" ||
    r.candidates.length !== 1 ||
    r.candidates[0].sourceHash !== SELECTED_PREACT_HASH
  )
    throw Error("Qualified selected feature unavailable");
  const proposal = programProposalSchema.parse({
    plan: r.candidates[0].plan,
    taskId: r.taskId,
    refUpdates: "transfer-cleanup",
    unmountContext: "vnode",
    cleanupType: true,
    program: r.candidates[0].program,
  });
  const admitted = admitGeneratedPreactEdit(proposal);
  if (admitted.sourceHash !== SELECTED_PREACT_HASH)
    throw Error("Selected source changed");
  const original = JSON.parse(
    readFileSync("fixtures/preact-native/original-manifest.json", "utf8"),
  );
  const archive = readFileSync("repositories/preact-native-v1/original.tar.gz");
  if (shaNative(archive) !== original.archiveSha256)
    throw Error("Original archive changed");
  const context = preactRepairContext(),
    patch = trialPatch(proposal),
    observer = readFileSync(
      "repositories/preact-admission-v3/public.html",
      "utf8",
    );
  return Payload.parse({
    format: "repolab-preact-pack/v1",
    scope: "exposed-scoped-feature-request",
    origin: {
      freeze: r.freeze,
      status: r.status,
      model: r.provenance.model,
      inference: "nebius",
      execution: "nebius-sandbox",
    },
    repository: {
      taskId: r.taskId,
      repo: context.repo,
      baseCommit: context.baseCommit,
      problemStatement: context.problemStatement,
    },
    original: {
      archiveBase64: archive.toString("base64"),
      archiveSha256: shaNative(archive),
      manifestJson: JSON.stringify(original),
      license: readFileSync("repositories/preact-native-v1/LICENSE", "utf8"),
    },
    proposal,
    source: {
      sha256: admitted.sourceHash,
      files: Object.entries(admitted.files).map(([path, content]) => ({
        path,
        content,
        sha256: shaNative(content),
      })),
    },
    patch: { content: patch, sha256: shaNative(patch) },
    publicObserver: { content: observer, sha256: shaNative(observer) },
    independentInputsExported: 0,
  });
}
export function exportNativePreactPack() {
  auditPreactProduct();
  const payload = expectedPayload(),
    p = { ...payload, digest: shaNative(JSON.stringify(payload)) };
  assertNativeNoSecrets(p);
  return p;
}
export function readNativePreactPack(value: unknown) {
  auditPreactProduct();
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > NATIVE_PACK_LIMIT)
    throw Error("Native pack exceeds limit");
  assertNativeNoSecrets(text);
  const p = Pack.parse(value),
    { digest, ...payload } = p;
  const expected = expectedPayload();
  if (
    shaNative(JSON.stringify(payload)) !== digest ||
    JSON.stringify(payload) !== JSON.stringify(expected)
  )
    throw Error(
      "Native pack does not match qualified original/selected inputs",
    );
  return p;
}
export async function readNativePreactFile(path: string) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > NATIVE_PACK_LIMIT)
    throw Error("Expected bounded regular native pack file");
  return readNativePreactPack(JSON.parse(await readFile(path, "utf8")));
}
export async function writeNativePreactPack(path: string) {
  const p = exportNativePreactPack();
  await writeFile(path, JSON.stringify(p) + "\n", { flag: "wx", mode: 0o600 });
  return p.digest;
}
function counts(r: any) {
  return {
    mocha: r.native?.mocha?.passed ?? null,
    browser: r.native?.browser?.passed ?? null,
    browserSkips: r.native?.browser?.skipped ?? null,
    types: r.native?.types?.passed ?? null,
    typePending: r.native?.types?.pending ?? null,
    public: r.public
      ? { passed: r.public.passed, total: r.public.total }
      : null,
    independent: r.independent
      ? {
          passed: r.independent.passed,
          total: r.independent.total,
          failed: r.independent.failed,
        }
      : null,
  };
}
export function nativeTrialReviews() {
  auditPreactProduct();
  const out = [];
  for (const version of [10, 9, 7, 6, 5, 4, 3, 2, 1]) {
    const input = JSON.parse(
      readFileSync(
        `evaluation/preact-trial-v${version}-results-summary.json`,
        "utf8",
      ),
    );
    const r = input.result ?? input;
    const selected = r.candidates?.find((a: any) => a.status === "SELECTED");
    const review = {
      version,
      status: r.status,
      verified: r.status === "ACCEPTED_INDEPENDENTLY_CORRECT",
      selected: !!r.accepted,
      sourceHash: selected?.sourceHash ?? null,
      requests: r.requests ?? r.modelCalls ?? null,
      operations: r.operations ?? null,
      estimatedInferenceUsd: r.estimatedInferenceUsd ?? null,
      counts: counts(r),
      candidates: (r.candidates ?? []).map((a: any) => ({
        attempt: a.attempt,
        status: a.status,
        stage: a.feedback?.stage ?? null,
        reason: a.feedback?.reason ?? a.feedback?.kind ?? null,
      })),
      provenance: r.provenance ?? {
        inference: "nebius",
        execution: "nebius-sandbox",
      },
    };
    assertNativeNoSecrets(review);
    out.push(review);
  }
  out.splice(2, 0, {
    version: 8,
    status: "NOT_RUN",
    verified: false,
    selected: false,
    sourceHash: null,
    requests: 0,
    operations: 0,
    estimatedInferenceUsd: 0,
    counts: counts({}),
    candidates: [
      {
        attempt: 0,
        status: "BUILD_PREFLIGHT_FAILED",
        stage: "typecheck",
        reason: "Extra SDK argument; exact unrun preparation retained",
      },
    ],
    provenance: { inference: "none", execution: "none" },
  });
  return out;
}

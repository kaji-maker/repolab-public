import { readFileSync } from "node:fs";
import { readFile, lstat, writeFile } from "node:fs/promises";
import { z } from "zod";
import { shaNative } from "../evaluation/preact-native-v5.ts";
import {
  programProposalSchema,
  admitGeneratedPreactEdit,
} from "./preact-generation-v3.ts";
import { preactRepairContext } from "./preact-admission-v5.ts";
import { trialPatch } from "../execution/preact-trial-v10.ts";
import { auditNativePackV3 as auditPreactProduct } from "./preact-pack-protocol-v3.ts";
export { assertNativeNoSecrets } from "./preact-pack-v1.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";
export const SELECTED_PREACT_HASH =
  "68c9000eec6e0ed71f140c8af231309064d1e7447414f00136cbb91b4e3eb0d3";
export const NATIVE_PACK_LIMIT = 1500000;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Payload = z.strictObject({
  format: z.literal("repolab-preact-pack/v3"),
  scope: z.literal("exposed-scoped-feature-request"),
  origin: z.strictObject({
    runId: z.literal("f8bfb85d-6766-4a9e-a762-e362d011559c"),
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
function expectedPayload() {
  const r = JSON.parse(
    readFileSync("evaluation/preact-selected-f8bfb85d.json", "utf8"),
  );
  if (
    r.status !== "ACCEPTED_INDEPENDENTLY_CORRECT" ||
    r.sourceHash !== SELECTED_PREACT_HASH ||
    r.runId !== "f8bfb85d-6766-4a9e-a762-e362d011559c"
  )
    throw Error("Qualified selected feature unavailable");
  const proposal = programProposalSchema.parse(r.proposal);
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
  if (shaNative(patch) !== r.patchSha256) throw Error("Selected patch changed");
  return Payload.parse({
    format: "repolab-preact-pack/v3",
    scope: "exposed-scoped-feature-request",
    origin: {
      runId: r.runId,
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

import { readFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import { commonTask } from "../evaluation/study-adapters-v6.ts";
import { assembleCommonPatch } from "../evaluation/study-policy-v5.ts";
import { pilotTask } from "../evaluation/github-pilot-v2.ts";
import { dsetTask } from "../evaluation/dset-qualification.ts";
import { mriTask } from "../evaluation/mri-qualification-v3.ts";
import { commonStudyMetrics as metrics5 } from "../evaluation/study-metrics-v5.ts";
import { commonStudyMetrics as metrics8 } from "../evaluation/study-metrics-v8.ts";
import { commonStudyMetrics as metrics9 } from "../evaluation/study-metrics-v9.ts";
import { providerSecrets } from "./repair-view.ts";
import { auditPortableProtocol } from "./portable-protocol.ts";

export const portableProfiles = [
  "dlv-null-path",
  "dset-decimal-path",
  "mri-zero-number",
] as const;
export type PortableProfile = (typeof portableProfiles)[number];
export const selectedOrigins = {
  "dlv-null-path": {
    version: 9,
    digest: "68b3990ecfe792dc6301e9935230438eb21a75d19ddbce7d27c376d424a108f5",
    runId: "ac3004ab-a31e-4410-b7d5-5f4b67a57892",
    sourceHash:
      "10d3e9404b1e93692469d14d08fb382c9799894425b367bfff46e35525bbeba7",
    assertions: 34,
    adapter:
      "reviewed ESM-to-CJS and TAP compatibility adapter; historical build not tested",
  },
  "dset-decimal-path": {
    version: 5,
    digest: "41487293885b9230c0583c26fcda0b30d809c1f50f7adb955c0dc882dae18785",
    runId: "6666cbc3-5e4f-46b7-8264-59f741c46761",
    sourceHash:
      "60f28be1439b8543ae034e3a73a3d861ff0a927b92dbdf0433c256762050722d",
    assertions: 13,
    adapter:
      "reviewed ESM-to-CJS and TAP compatibility adapter; historical build not tested",
  },
  "mri-zero-number": {
    version: 8,
    digest: "4e1512b8c09a6acde9d7e77d280bc65a79c76cf1842db435707debb2a36f9e47",
    runId: "0aa3db81-2410-4a57-aaa1-404fc6d1f0d9",
    sourceHash:
      "5e359a746fc8948c791e617d3653b3c93fe0399b03f70af486149641d56dfeb7",
    assertions: 49,
    adapter:
      "native CJS and reviewed TAP compatibility adapter; historical build not tested",
  },
} as const;
export function portableSnapshot(profile: PortableProfile) {
  return profile === "dlv-null-path"
    ? pilotTask().snapshot
    : profile === "dset-decimal-path"
      ? dsetTask().snapshot
      : mriTask().snapshot;
}
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().max(524288);
const Origin = z.strictObject({
  version: z.number().int(),
  digest: Hash,
  runId: z.uuid(),
  sourceHash: Hash,
  model: z.literal("nvidia/nemotron-3-super-120b-a12b"),
  inference: z.literal("recorded-controller-origin-not-provider-authenticated"),
  selectedAt: z.iso.datetime(),
  independentOpenedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  calls: z.number().int().min(1).max(3),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedInferenceUsd: z.number().nonnegative(),
});
const Payload = z.strictObject({
  format: z.literal("repolab-selected-repository-pack/v1"),
  profile: z.enum(portableProfiles),
  scope: z.literal("exposed-historical-development-selection"),
  origin: Origin,
  original: z.unknown(),
  originalHash: Hash,
  report: Text,
  reportHash: Hash,
  publicCore: z.unknown(),
  publicChallenges: z.unknown(),
  proposal: z.unknown(),
  source: z.strictObject({
    path: z.enum(["index.js", "src/index.js", "lib/index.js"]),
    content: Text,
    sha256: Hash,
  }),
  patch: z.strictObject({ content: Text, sha256: Hash }),
  adapter: Text,
});
const Schema = Payload.extend({ digest: Hash });
export type PortablePack = z.infer<typeof Schema>;

/** Applicable byte-only diff, including missing final newlines; never evaluates source. */
export function portableDiff(
  path: string,
  original: string,
  candidate: string,
) {
  if (!["index.js", "src/index.js", "lib/index.js"].includes(path))
    throw Error("Unsupported patch path");
  const lines = (s: string) => {
    const out = s.split("\n");
    if (s.endsWith("\n")) out.pop();
    return out;
  };
  const block = (s: string, prefix: string) =>
    lines(s)
      .map((x) => prefix + x + "\n")
      .join("") + (s.endsWith("\n") ? "" : "\\ No newline at end of file\n");
  return (
    "diff --git a/" +
    path +
    " b/" +
    path +
    "\n--- a/" +
    path +
    "\n+++ b/" +
    path +
    "\n@@ -1," +
    lines(original).length +
    " +1," +
    lines(candidate).length +
    " @@\n" +
    block(original, "-") +
    block(candidate, "+")
  );
}
export function readPortablePack(
  input: unknown,
  secrets = providerSecrets(),
): PortablePack {
  auditPortableProtocol();
  const bytes = typeof input === "string" ? input : JSON.stringify(input);
  if (typeof bytes !== "string" || Buffer.byteLength(bytes) > 524288)
    throw Error("Portable pack byte limit");
  if (secrets.some((s) => bytes.includes(s)))
    throw Error("Credentials are prohibited in portable packs");
  const pack = Schema.parse(
      typeof input === "string" ? JSON.parse(input) : input,
    ),
    { digest, ...payload } = pack;
  if (sha256(JSON.stringify(payload)) !== digest)
    throw Error("Portable pack digest changed");
  const task = commonTask(pack.profile),
    approved = selectedOrigins[pack.profile],
    snapshot = portableSnapshot(pack.profile);
  if (
    pack.origin.version !== approved.version ||
    pack.origin.digest !== approved.digest ||
    pack.origin.runId !== approved.runId ||
    pack.origin.sourceHash !== approved.sourceHash ||
    pack.source.sha256 !== approved.sourceHash
  )
    throw Error("Unsupported selected origin");
  if (
    JSON.stringify(pack.original) !== JSON.stringify(snapshot) ||
    pack.originalHash !== sha256(JSON.stringify(snapshot)) ||
    pack.report !== task.report ||
    pack.reportHash !== sha256(task.report) ||
    JSON.stringify(pack.publicCore) !== JSON.stringify(task.core) ||
    JSON.stringify(pack.publicChallenges) !== JSON.stringify(task.challenge) ||
    pack.adapter !== approved.adapter
  )
    throw Error("Protected original/report/public input identity changed");
  const source = assembleCommonPatch(
    pack.profile,
    task.source,
    task.path,
    pack.proposal,
  );
  if (
    pack.source.path !== task.path ||
    pack.source.content !== source ||
    sha256(source) !== pack.source.sha256
  )
    throw Error("Selected source assembly changed");
  if (
    pack.patch.content !== portableDiff(task.path, task.source, source) ||
    pack.patch.sha256 !== sha256(pack.patch.content)
  )
    throw Error("Portable patch changed");
  if (
    Date.parse(pack.origin.selectedAt) >
      Date.parse(pack.origin.independentOpenedAt) ||
    Date.parse(pack.origin.independentOpenedAt) >
      Date.parse(pack.origin.completedAt)
  )
    throw Error("Selection chronology changed");
  const estimated =
    (pack.origin.inputTokens * 0.3 + pack.origin.outputTokens * 0.9) / 1e6;
  if (Math.abs(estimated - pack.origin.estimatedInferenceUsd) > 1e-10)
    throw Error("Origin usage estimate changed");
  return pack;
}
export async function readPortableFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 524288)
    throw Error("Invalid portable pack file");
  return readPortablePack(await readFile(path, "utf8"));
}
export async function exportPortableSelection(
  profile: PortableProfile,
  evidenceRoot = ".repolab/studies",
) {
  const approved = selectedOrigins[profile],
    file = evidenceRoot + "/" + approved.digest + "/" + profile + "-C.json";
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16_777_216)
    throw Error("Invalid selection record");
  const r = JSON.parse(await readFile(file, "utf8"));
  await (
    approved.version === 5
      ? metrics5
      : approved.version === 8
        ? metrics8
        : metrics9
  )([r]);
  const decisionBytes = await readFile(file + ".decision.json", "utf8");
  if (
    sha256(decisionBytes) !== r.decisionHash ||
    JSON.stringify(JSON.parse(decisionBytes)) !== JSON.stringify(r.decision) ||
    r.id !== approved.runId ||
    r.status !== "ACCEPTED_INDEPENDENTLY_CORRECT" ||
    !r.selectionIntact ||
    !r.usageComplete
  )
    throw Error("Complete selected origin evidence required");
  const c = r.candidates.find(
    (x: any) => x.accepted && x.sourceHash === approved.sourceHash,
  );
  if (!c) throw Error("Selected candidate missing");
  const task = commonTask(profile),
    original = portableSnapshot(profile),
    patch = portableDiff(task.path, task.source, c.source);
  const payload = {
    format: "repolab-selected-repository-pack/v1",
    profile,
    scope: "exposed-historical-development-selection",
    origin: {
      version: approved.version,
      digest: approved.digest,
      runId: r.id,
      sourceHash: c.sourceHash,
      model: "nvidia/nemotron-3-super-120b-a12b",
      inference: "recorded-controller-origin-not-provider-authenticated",
      selectedAt: r.decision.at,
      independentOpenedAt: r.independentOpenedAt,
      completedAt: r.completedAt,
      calls: r.requests,
      inputTokens: r.usage.reduce((n: number, u: any) => n + u.inputTokens, 0),
      outputTokens: r.usage.reduce(
        (n: number, u: any) => n + u.outputTokens,
        0,
      ),
      estimatedInferenceUsd: r.estimatedInferenceUsd,
    },
    original,
    originalHash: sha256(JSON.stringify(original)),
    report: task.report,
    reportHash: sha256(task.report),
    publicCore: task.core,
    publicChallenges: task.challenge,
    proposal: c.proposal,
    source: { path: task.path, content: c.source, sha256: c.sourceHash },
    patch: { content: patch, sha256: sha256(patch) },
    adapter: approved.adapter,
  };
  return readPortablePack({
    ...payload,
    digest: sha256(JSON.stringify(payload)),
  });
}
export async function portableCatalog() {
  return Promise.all(
    portableProfiles.map(async (profile) => {
      try {
        const pack = await exportPortableSelection(profile);
        return {
          profile,
          available: true,
          packDigest: pack.digest,
          sourceHash: pack.source.sha256,
          repository: portableSnapshot(profile).manifest.repository,
          upstreamAssertions: selectedOrigins[profile].assertions,
          publicCases: commonTask(profile).challenge.length,
          inference: "recorded NVIDIA/Nebius origin; no new inference",
          execution:
            "origin verified in Nebius Sandbox; fresh replay available separately",
          scope: pack.scope,
        };
      } catch {
        return {
          profile,
          available: false,
          reason: "Complete validated selection evidence is unavailable",
        };
      }
    }),
  );
}
export async function writePortableArtifacts(
  pack: PortablePack,
  directory: string,
) {
  pack = readPortablePack(pack);
  // A new directory makes output exclusive and avoids following existing destination links.
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    directory + "/repair-pack.json",
    JSON.stringify(pack, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(directory + "/repair.patch", pack.patch.content, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    directory + "/regression.json",
    JSON.stringify(
      {
        scope: "existing-public-report-and-compatibility-inputs",
        profile: pack.profile,
        report: pack.report,
        core: pack.publicCore,
        challenges: pack.publicChallenges,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}

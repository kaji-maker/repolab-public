import { createHash } from "node:crypto";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";

const oid = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const safePath = z
  .string()
  .min(1)
  .max(180)
  .refine(
    (path) =>
      /^[a-zA-Z0-9_.\/-]+$/.test(path) &&
      path
        .split("/")
        .every(
          (part) =>
            Boolean(part) &&
            ![".", "..", ".git", "node_modules"].includes(part) &&
            !/^\.env(?:\.|$)|^id_(?:rsa|ed25519)$|\.(?:pem|key)$/i.test(part),
        ),
    "Only relative source paths without secrets or dependency directories are allowed",
  );
const repository = z
  .string()
  .regex(
    /^https:\/\/github\.com\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/,
  )
  .refine(
    (url) => ![".", ".."].includes(url.split("/").at(-1)!),
    "Invalid repository name",
  );
const role = z.enum([
  "source",
  "baseline",
  "documentation",
  "metadata",
  "license",
]);
const fileSpec = z.strictObject({ path: safePath, role });

/** A preparation request is a selected file set, not a checkout or execution grant. */
export const RepositoryManifestSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    repository,
    commit: oid,
    issueUrl: z.string().url(),
    report: z.string().min(20).max(8000),
    expectedBehaviorRefs: z.array(z.string().url()).min(1).max(8),
    license: z.strictObject({
      spdx: z.enum([
        "MIT",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "ISC",
        "MPL-2.0",
      ]),
      path: safePath,
    }),
    files: z.array(fileSpec).min(2).max(12),
    editablePaths: z.array(safePath).min(1).max(4),
    baselineCommand: z.array(z.string().min(1).max(100)).min(1).max(12),
  })
  .superRefine((manifest, context) => {
    const issuePattern = new RegExp(
      `^${escapeRegex(manifest.repository)}/issues/[1-9][0-9]*$`,
    );
    if (!issuePattern.test(manifest.issueUrl))
      context.addIssue({
        code: "custom",
        message: "Issue must belong to the selected repository",
        path: ["issueUrl"],
      });
    if (
      new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate file paths",
        path: ["files"],
      });
    if (
      new Set(manifest.editablePaths).size !== manifest.editablePaths.length ||
      !manifest.editablePaths.every((path) =>
        manifest.files.some((f) => f.path === path && f.role === "source"),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Editable paths must be distinct selected source files",
        path: ["editablePaths"],
      });
    if (
      !manifest.files.some(
        (f) => f.path === manifest.license.path && f.role === "license",
      )
    )
      context.addIssue({
        code: "custom",
        message: "The license file must be selected",
        path: ["license"],
      });
    for (const [index, ref] of manifest.expectedBehaviorRefs.entries()) {
      const prefix = `${manifest.repository}/blob/${manifest.commit}/`;
      if (
        ref !== manifest.issueUrl &&
        !(
          ref.startsWith(prefix) &&
          safePath.safeParse(ref.slice(prefix.length)).success
        )
      )
        context.addIssue({
          code: "custom",
          message:
            "Behavior references must be the issue or files pinned to the base commit",
          path: ["expectedBehaviorRefs", index],
        });
    }
  });
export type RepositoryManifest = z.infer<typeof RepositoryManifestSchema>;
const selectedFile = fileSpec.extend({
  gitBlobSha: oid,
  sha256: digest,
  bytes: z.number().int().min(0).max(32768),
  content: z.string().max(32768),
});
const SnapshotPayloadSchema = z.strictObject({
  version: z.literal(1),
  manifest: RepositoryManifestSchema,
  retrievedAt: z.string().datetime(),
  treeSha: oid,
  issue: z.strictObject({
    url: z.string().url(),
    number: z.number().int().positive(),
    title: z.string().min(1).max(1000),
    createdAt: z.string().datetime(),
  }),
  files: z.array(selectedFile).min(2).max(12),
  status: z.literal("PREPARED_NOT_EXECUTED"),
});
const SnapshotSchema = SnapshotPayloadSchema.extend({ digest });
export type RepositorySnapshot = z.infer<typeof SnapshotSchema>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export class RepositoryPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryPreparationError";
  }
}
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}
function payloadDigest(payload: z.infer<typeof SnapshotPayloadSchema>): string {
  // Fixed field order from strict schemas makes reordered JSON keys equivalent.
  return sha256(JSON.stringify(SnapshotPayloadSchema.parse(payload)));
}

/** Digests establish self-consistency, not trust in an artifact's author. */
export function readRepositorySnapshot(value: unknown): RepositorySnapshot {
  const snapshot = SnapshotSchema.parse(value);
  const { digest: recorded, ...payload } = snapshot;
  if (recorded !== payloadDigest(payload))
    throw new RepositoryPreparationError("Repository snapshot digest mismatch");
  const manifest = snapshot.manifest;
  if (
    snapshot.issue.url !== manifest.issueUrl ||
    snapshot.issue.number !== Number(manifest.issueUrl.split("/").at(-1))
  )
    throw new RepositoryPreparationError("Issue provenance mismatch");
  if (snapshot.files.length !== manifest.files.length)
    throw new RepositoryPreparationError("Selected file set mismatch");
  let total = 0;
  for (const [index, file] of snapshot.files.entries()) {
    const spec = manifest.files[index];
    const bytes = Buffer.from(file.content, "utf8");
    total += bytes.byteLength;
    if (
      file.path !== spec.path ||
      file.role !== spec.role ||
      bytes.byteLength !== file.bytes ||
      sha256(file.content) !== file.sha256 ||
      gitBlobSha(bytes) !== file.gitBlobSha
    )
      throw new RepositoryPreparationError("Selected file integrity mismatch");
  }
  if (total > 131072)
    throw new RepositoryPreparationError("Selected source exceeds 128 KiB");
  if (
    !snapshot.files
      .find((f) => f.path === manifest.license.path)
      ?.content.trim()
  )
    throw new RepositoryPreparationError("License file is empty");
  return snapshot;
}

async function boundedJson(
  response: Response,
  limit: number,
): Promise<unknown> {
  if (!response.body)
    throw new RepositoryPreparationError("GitHub response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit)
        throw new RepositoryPreparationError(
          "GitHub response exceeds preparation limits",
        );
      chunks.push(next.value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof RepositoryPreparationError) throw error;
    throw new RepositoryPreparationError(
      "GitHub returned invalid JSON or encoding",
    );
  } finally {
    reader.releaseLock();
  }
}

/** Public, unauthenticated, read-only GitHub calls. Never installs or runs upstream code. */
export async function prepareRepository(
  input: unknown,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RepositorySnapshot> {
  const manifest = RepositoryManifestSchema.parse(input);
  const slug = manifest.repository.slice("https://github.com/".length);
  const request = options.fetch ?? fetch;
  const totalSignal = AbortSignal.timeout(60000);
  let calls = 0;
  const get = async (path: string, limit = 131072): Promise<unknown> => {
    if (++calls > 17)
      throw new RepositoryPreparationError("GitHub request limit exceeded");
    try {
      const response = await request(
        `https://api.github.com/repos/${slug}${path}`,
        {
          method: "GET",
          redirect: "error",
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ReproLab-repository-preparation",
          },
          signal: AbortSignal.any([
            totalSignal,
            AbortSignal.timeout(15000),
            ...(options.signal ? [options.signal] : []),
          ]),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new RepositoryPreparationError(
          response.status === 403 || response.status === 429
            ? "GitHub rate limit or public access restriction; retry later"
            : `GitHub repository read failed (HTTP ${response.status})`,
        );
      }
      return await boundedJson(response, limit);
    } catch (error) {
      if (error instanceof RepositoryPreparationError) throw error;
      throw new RepositoryPreparationError(
        "GitHub read failed or timed out; no upstream code was executed",
      );
    }
  };
  const metadata = z
    .object({ private: z.literal(false), full_name: z.string() })
    .parse(await get(""));
  if (metadata.full_name.toLowerCase() !== slug.toLowerCase())
    throw new RepositoryPreparationError("Repository identity mismatch");
  const commit = z
    .object({ sha: oid, tree: z.object({ sha: oid }) })
    .parse(await get(`/git/commits/${manifest.commit}`));
  if (commit.sha !== manifest.commit)
    throw new RepositoryPreparationError("Pinned commit mismatch");
  const tree = z
    .object({
      sha: oid,
      truncated: z.literal(false),
      tree: z
        .array(
          z.object({
            path: z.string(),
            type: z.string(),
            mode: z.string(),
            sha: oid,
            size: z.number().int().nonnegative().optional(),
          }),
        )
        .max(10000),
    })
    .parse(await get(`/git/trees/${commit.tree.sha}?recursive=1`, 1048576));
  if (tree.sha !== commit.tree.sha)
    throw new RepositoryPreparationError("Pinned tree mismatch");
  const issueNumber = Number(manifest.issueUrl.split("/").at(-1));
  const issue = z
    .object({
      html_url: z.string(),
      number: z.number().int(),
      title: z.string().min(1).max(1000),
      created_at: z.string().datetime(),
      pull_request: z.unknown().optional(),
    })
    .parse(await get(`/issues/${issueNumber}`));
  if (
    issue.html_url !== manifest.issueUrl ||
    issue.number !== issueNumber ||
    issue.pull_request !== undefined
  )
    throw new RepositoryPreparationError(
      "Expected an issue belonging to the selected repository",
    );
  // Resolution comments and the issue body are deliberately excluded; use a reviewed report.
  const entries = manifest.files.map((spec) => {
    const matches = tree.tree.filter((entry) => entry.path === spec.path);
    const entry = matches[0];
    if (
      matches.length !== 1 ||
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode) ||
      entry.size === undefined
    )
      throw new RepositoryPreparationError(
        "Selected path is missing or is not a regular Git file",
      );
    if (entry.size > 32768)
      throw new RepositoryPreparationError("Selected file exceeds 32 KiB");
    return { spec, entry };
  });
  if (entries.reduce((sum, item) => sum + item.entry.size!, 0) > 131072)
    throw new RepositoryPreparationError("Selected source exceeds 128 KiB");
  const files: z.infer<typeof selectedFile>[] = [];
  for (const { spec, entry } of entries) {
    const blob = z
      .object({
        sha: oid,
        size: z.number().int().nonnegative().max(32768),
        encoding: z.literal("base64"),
        content: z.string().max(50000),
      })
      .parse(await get(`/git/blobs/${entry.sha}`, 65536));
    const encoded = blob.content.replace(/[\r\n]/g, "");
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      )
    )
      throw new RepositoryPreparationError("Invalid Git blob encoding");
    const bytes = Buffer.from(encoded, "base64");
    if (
      blob.sha !== entry.sha ||
      blob.size !== entry.size ||
      bytes.byteLength !== blob.size ||
      gitBlobSha(bytes) !== entry.sha
    )
      throw new RepositoryPreparationError("Git blob hash or size mismatch");
    let content: string;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new RepositoryPreparationError(
        "Only UTF-8 text files can be prepared",
      );
    }
    if (content.includes("\0"))
      throw new RepositoryPreparationError("Binary source cannot be prepared");
    files.push({
      ...spec,
      gitBlobSha: entry.sha,
      sha256: sha256(content),
      bytes: bytes.byteLength,
      content,
    });
  }
  const payload = SnapshotPayloadSchema.parse({
    version: 1,
    manifest,
    retrievedAt: new Date().toISOString(),
    treeSha: tree.sha,
    issue: {
      url: issue.html_url,
      number: issue.number,
      title: issue.title,
      createdAt: issue.created_at,
    },
    files,
    status: "PREPARED_NOT_EXECUTED",
  });
  return readRepositorySnapshot({ ...payload, digest: payloadDigest(payload) });
}

export function repositorySummary(snapshot: RepositorySnapshot) {
  return {
    id: snapshot.manifest.id,
    status: snapshot.status,
    repository: snapshot.manifest.repository,
    commit: snapshot.manifest.commit,
    issue: snapshot.issue.url,
    digest: snapshot.digest,
    files: snapshot.files.map(({ path, role, bytes, sha256 }) => ({
      path,
      role,
      bytes,
      sha256,
    })),
    declaredLicense: snapshot.manifest.license.spdx,
    nextGates: [
      "Review license and source",
      "Verify isolated environment and unchanged baseline suite",
      "Reproduce original failure",
      "Qualify an independent reference and evaluator",
    ],
    inferenceCalls: 0,
    upstreamExecutions: 0,
  };
}

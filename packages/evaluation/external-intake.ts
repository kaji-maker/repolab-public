import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { auditPortableProtocol } from "../repositories/portable-protocol.ts";
import { providerSecrets } from "../repositories/repair-view.ts";

const externalManifestDigest = "2ada74c6196b7cd3515ac1a19ed79b81aded6389b1c85d1984610ffe39f636d1";
export const externalAssets = [
  "packages/evaluation/external-intake.ts",
  "apps/evaluator/external-intake.ts",
  "scripts/external-select.py",
  "tests/external-intake.test.ts",
  "evaluation/EXTERNAL_INTAKE_V1.md",
  "evaluation/external-selection-v1.json",
  "evaluation/external-selected-v1.json",
  "evaluation/external-source-inventory-v1.json",
  "evaluation/reviewer-bootstrap-v1.json",
  "evaluation/portable-packs-v1.json",
] as const;
const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const Row = z
  .object({
    instance_id: z.string().regex(/^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+$/),
    repo: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    base_commit: z.string().regex(/^[a-f0-9]{40}$/),
    problem_statement: z.string().min(1).max(131072),
    version: z.string().min(1).max(64),
  })
  .strict();
export type ExternalTask = z.infer<typeof Row>;
const SelectedRow = Row.extend({
  selectionRank: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const Selected = z
  .object({
    format: z.literal("repolab-external-selected/v1"),
    selectionPolicyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    eligiblePoolSize: z.number().int().min(3),
    selected: z.array(SelectedRow).length(3),
    selectionOrder: z.array(z.string()).length(3),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function externalAssetBytes(path: string) {
  const bytes = readFileSync(path);
  return path === externalAssets[0]
    ? Buffer.from(
        bytes
          .toString("utf8")
          .replace(externalManifestDigest, "__EXTERNAL_MANIFEST_DIGEST__"),
      )
    : bytes;
}

export function auditExternalIntake(reader = externalAssetBytes) {
  const protocol = JSON.parse(
    readFileSync("evaluation/external-intake-v1.json", "utf8"),
  );
  const { digest, ...payload } = protocol;
  if (
    digest !== externalManifestDigest ||
    sha(JSON.stringify(payload)) !== digest ||
    protocol.format !== "repolab-external-intake/v1" ||
    protocol.parentDigest !== auditPortableProtocol().digest ||
    protocol.inferenceCalls !== 0 ||
    protocol.execution !== "data-only; no source execution" ||
    protocol.assets.length !== externalAssets.length ||
    protocol.assets.some(
      (a: any, i: number) =>
        a.path !== externalAssets[i] || sha(reader(a.path)) !== a.sha256,
    )
  )
    throw Error("External intake freeze changed");
  const selection = Selected.parse(
    JSON.parse(reader("evaluation/external-selected-v1.json").toString("utf8")),
  );
  const { digest: selectionDigest, ...selectionPayload } = selection;
  if (
    sha(JSON.stringify(selectionPayload)) !== selectionDigest ||
    selectionDigest !== protocol.selectionDigest
  )
    throw Error("External selection changed");
  const policy = JSON.parse(
    reader("evaluation/external-selection-v1.json").toString("utf8"),
  );
  const { digest: policyDigest, ...policyPayload } = policy;
  if (
    sha(JSON.stringify(policyPayload)) !== policyDigest ||
    selection.selectionPolicyDigest !== policyDigest
  )
    throw Error("Selection policy changed");
  if (
    new Set(selection.selected.map((t) => t.repo)).size !== 3 ||
    JSON.stringify(selection.selectionOrder) !==
      JSON.stringify(selection.selected.map((t) => t.instance_id)) ||
    selection.selected.some(
      (t, i) =>
        !policy.eligibleRepositories.includes(t.repo) ||
        !t.instance_id.startsWith(t.repo.replace("/", "__") + "-") ||
        t.selectionRank !== sha(policy.seed + "\n" + t.instance_id) ||
        (i > 0 && t.selectionRank < selection.selected[i - 1].selectionRank),
    )
  )
    throw Error("External task order or identity changed");
  return { protocol, selection };
}

export function readExternalTask(
  input: unknown,
  secrets = providerSecrets(),
): ExternalTask {
  const { selection } = auditExternalIntake();
  const bytes = JSON.stringify(input);
  if (
    !bytes ||
    Buffer.byteLength(bytes) > 196608 ||
    secrets.some((s) => bytes.includes(s))
  )
    throw Error("Unsafe external task input");
  const task = Row.parse(input);
  const original = selection.selected.find(
    (t) => t.instance_id === task.instance_id,
  );
  if (!original) throw Error("Task is not prospectively selected");
  const { selectionRank: _, ...approved } = original;
  if (JSON.stringify(task) !== JSON.stringify(approved))
    throw Error("Selected issue or source identity changed");
  return task;
}

export function externalTasks(): ExternalTask[] {
  return auditExternalIntake().selection.selected.map(
    ({ selectionRank: _, ...t }) => readExternalTask(t),
  );
}

export function originalExternalContext(input: unknown) {
  const t = readExternalTask(input);
  return {
    taskId: t.instance_id,
    repository: t.repo,
    baseCommit: t.base_commit,
    bugReport: t.problem_statement,
  };
}

export function externalAdmission(input: unknown) {
  const t = readExternalTask(input);
  // The frozen benchmark identities have no native qualified adapter. A matching
  // language or old small-library success cannot authorize an unrelated task.
  return {
    taskId: t.instance_id,
    repository: t.repo,
    baseCommit: t.base_commit,
    status: "UNSUPPORTED_REPOSITORY_ADAPTER" as const,
    selected: true,
    supported: false,
    qualified: false,
    attempted: false,
    missing: [
      "native repository/dependency staging",
      "protected original build/test gate",
      "frozen report reproduction",
      "bounded source-edit policy",
      "separate evaluator and raw-receipt replay",
    ],
    inference: "none",
    execution: "none; data-only admission; no source execution",
  };
}

export function externalIntakeReport() {
  const { protocol, selection } = auditExternalIntake();
  const rows = externalTasks().map(externalAdmission);
  return {
    format: "repolab-external-admission/v1",
    digest: protocol.digest,
    selectionDigest: selection.digest,
    rows,
    counts: { selected: rows.length, supported: 0, qualified: 0, attempted: 0 },
    accuracy: null,
    resolved: null,
    scope:
      "externally curated public tasks, new to project; unsupported tasks retained; model accuracy unmeasured",
    inference: "none",
    execution: "none; static task admission only",
  };
}

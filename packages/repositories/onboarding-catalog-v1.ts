import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import {
  inspectPinnedRepository,
  onboardingSha,
  type SourcePin,
  type ReviewedOnboardingProfile,
} from "./onboarding-v1.ts";
import { auditOnboarding } from "./onboarding-protocol-v1.ts";
import { auditNativeRun } from "../../apps/evaluator/preact-native-v5.ts";
import { loadGithubQualification } from "./github-anchor-v3.ts";
import { auditExternalIntake } from "../evaluation/external-intake.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";
export function onboardingSubject(id: string) {
  auditOnboarding();
  const catalog = JSON.parse(
    readFileSync("evaluation/onboarding-catalog-v1.json", "utf8"),
  );
  const row = catalog.profiles.find((x: any) => x.id === id);
  if (!row) throw Error("Repository is outside reviewed onboarding catalog");
  const bytes = readFileSync(row.manifest);
  if (onboardingSha(bytes) !== row.manifestSha256)
    throw Error("Trusted source pin changed");
  const m = JSON.parse(bytes.toString());
  if ((m.baseCommit ?? m.commit) !== row.commit)
    throw Error("Commit pin changed");
  const pin: SourcePin = {
    repository: row.repository,
    commit: row.commit,
    archiveRoot: row.archiveRoot,
    archiveSha256: m.archiveSha256,
    files: Array.isArray(m.files)
      ? m.files
      : Object.entries(m.files).map(([path, info]) => ({
          path,
          ...(info as object),
        })),
  };
  const archive = readFileSync(row.archive),
    profile: ReviewedOnboardingProfile = row.profile;
  return { row, pin, archive, profile };
}
export function inspectOnboardingSubject(id: string) {
  const s = onboardingSubject(id);
  return inspectPinnedRepository(s.archive, s.pin, s.profile);
}
/** Private original receipts are independently bound by the prospective onboarding freeze. */
export function verifyOnboardingEvidence(
  id: string,
  reader?: (path: string) => Buffer,
) {
  auditOnboarding();
  const manifest = JSON.parse(
    readFileSync("evaluation/onboarding-evidence-v1.json", "utf8"),
  );
  const row = manifest.rows.find((r: any) => r.id === id);
  if (!row || !row.files.length)
    throw Error("Original evidence pins unavailable");
  const read =
    reader ??
    ((path: string) => {
      const actual = realpathSync(path),
        root = realpathSync(".repolab"),
        st = lstatSync(path);
      if (
        !actual.startsWith(root + sep) ||
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.size > 8_000_000
      )
        throw Error("Invalid original evidence file");
      return readFileSync(path);
    });
  for (const file of row.files)
    if (onboardingSha(read(file.path)) !== file.sha256)
      throw Error("Pinned original receipt changed");
  return {
    files: row.files.length,
    manifestSha256: onboardingSha(
      readFileSync("evaluation/onboarding-evidence-v1.json"),
    ),
  };
}
export function qualifyOnboardingSubject(id: string) {
  const inspection = inspectOnboardingSubject(id);
  if (!inspection.supported)
    throw Error("Unsupported source profile cannot qualify");
  const evidenceBinding = verifyOnboardingEvidence(id);
  let evidence: unknown;
  if (id === "preact") {
    const q = auditNativeRun();
    if (
      q.status !== "QUALIFIED_NATIVE_BASELINE" ||
      q.taskId !== "preactjs__preact-4436" ||
      q.inferenceCalls !== 0 ||
      q.runtime !== inspection.reviewedRuntime!.native
    )
      throw Error("Original native evidence unavailable");
    evidence = {
      source: "replayed original-only native v5 receipts",
      execution:
        "nebius-sandbox (historical receipts; no new source execution)",
      operationIds: q.operationIds,
      protectedImage: q.protectedImage,
      originalBuild: "PASS; original archive restored after build",
      native: {
        mocha: {
          passed: q.mocha.passed,
          skipped: q.mocha.skipped,
          caseDigest: q.mocha.caseDigest,
        },
        browser: {
          passed: q.browser.passed,
          skipped: q.browser.skipped,
          caseDigest: q.browser.caseDigest,
        },
        types: q.types,
      },
      originalReproduction:
        "same missing cleanup feature observed twice; ordinary controls pass",
      filesystemIntegrity:
        "11 original-input write/unlink/replace/rename/symlink denials; networking denied",
      qualificationRuntime: q.runtime,
    };
  } else if (id === "regexparam") {
    const q = loadGithubQualification("regexparam");
    if (q.status !== "QUALIFIED_ORIGINAL" || !q.dependencyLockSha256)
      throw Error("Original lock/qualification unavailable");
    evidence = {
      source: "replayed original-only GitHub v2 receipts",
      execution:
        "nebius-sandbox (historical receipts; no new source execution)",
      operationIds: q.operations.map((x: any) => x.id),
      originalImage: q.originalImage,
      originalBuild: "PASS; exact generated hashes bound",
      native: q.nativeSignature,
      dependencyLockSha256: q.dependencyLockSha256,
      originalReproduction:
        "same public report delta twice; ordinary controls pass",
      filesystemIntegrity:
        "write/private-read/child-process/credential and forged-success controls validated",
      limitations: [
        "Historical node --check admission is ineffective for ESM-syntax .js without type=module; it is not evidence of syntax/loadability.",
        "This onboarding gate grants no candidate repair or load admission.",
      ],
    };
  } else throw Error("Native evidence adapter unavailable");
  const result = {
    ...inspection,
    status: "REPLAY_QUALIFIED_ONBOARDING",
    qualified: true,
    repairAdmission: false,
    evidence,
    evidenceBinding,
    newInferenceCalls: 0,
    newSandboxOperations: 0,
  };
  assertNativeNoSecrets(result);
  return result;
}
export function onboardingReport() {
  const p = auditOnboarding(),
    { selection } = auditExternalIntake();
  const framework = selection.selected.map((task) => {
    if (task.instance_id === "preactjs__preact-4436")
      return {
        taskId: task.instance_id,
        selected: true,
        ...qualifyOnboardingSubject("preact"),
      };
    return {
      taskId: task.instance_id,
      repository: task.repo,
      commit: task.base_commit,
      selected: true,
      supported: false,
      qualified: false,
      repairAdmission: false,
      status: "UNSUPPORTED_REPOSITORY_PROFILE",
      reasons:
        task.repo === "vuejs/core"
          ? ["pnpm workspace and Vue native adapter remain unqualified"]
          : [
              "Yarn/Lerna workspace and Docusaurus native adapter remain unqualified",
            ],
      inference: "none",
      execution: "metadata only; no source execution",
    };
  });
  const developmentControls = [
    {
      taskId: "lukeed__regexparam-40",
      role: "exposed development intake control; not part of selected framework denominator",
      ...qualifyOnboardingSubject("regexparam"),
    },
  ];
  const report = {
    format: "repolab-onboarding-report/v1",
    freeze: p.digest,
    framework,
    frameworkCounts: {
      selected: framework.length,
      supported: framework.filter((x) => x.supported).length,
      qualified: framework.filter((x) => x.qualified).length,
      newModelAttempted: 0,
    },
    developmentControls,
    newInferenceCalls: 0,
    newSandboxOperations: 0,
    accuracy: null,
    repairAdmission: false,
    execution:
      "data-only archive inspection and offline replay of existing actual Sandbox receipts",
    scope:
      "Exact reviewed pinned adapters; arbitrary GitHub/native commands and automatic dependency execution remain closed",
  };
  assertNativeNoSecrets(report);
  return report;
}

import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { onboardingSha } from "./onboarding-v1.ts";
import { auditOnboarding } from "./onboarding-protocol-v1.ts";
import { qualifyOnboardingSubject } from "./onboarding-catalog-v1.ts";
import { auditExternalIntake } from "../evaluation/external-intake.ts";
import { assertNativeNoSecrets } from "./preact-pack-v1.ts";
import {
  inspectPinnedGitTreeFeasibility,
  type PinnedSourceInventoryRow,
  type TargetSubpackageSpec,
} from "./framework-feasibility-v1.ts";

export const FRAMEWORK_FEASIBILITY_FREEZE: string = "1abc6795d08f0e3e404a4bcdb811b3ea5bd31d0004d53743be77ab58d7b02a1f";

export const frameworkFeasibilitySettings = {
  format: "repolab-framework-feasibility-protocol/v1",
  maxModelCalls: 0,
  maxNewSandboxOperations: 0,
  primaryRemainingCandidate: "vuejs__core-11899",
  secondaryRemainingCandidate: "facebook__docusaurus-8927",
  frameworkDenominator: [
    "facebook__docusaurus-8927",
    "preactjs__preact-4436",
    "vuejs__core-11899",
  ],
  developmentControls: ["regexparam"],
  repairAdmission: false,
  inferenceReadyForRemainingCandidates: false,
};

export const frameworkFeasibilityAssets = [
  "packages/repositories/framework-feasibility-protocol-v1.ts",
  "packages/repositories/framework-feasibility-v1.ts",
  "apps/repositories/framework-feasibility-v1.ts",
  "tests/framework-feasibility-v1.test.ts",
  "evaluation/FRAMEWORK_FEASIBILITY_V1.md",
  "evaluation/framework-feasibility-evidence-v1.json",
  "evaluation/onboarding-v1.json",
  "evaluation/external-selected-v1.json",
  "evaluation/external-source-inventory-v1.json",
];

export function frameworkFeasibilityBytes(path: string) {
  const b = readFileSync(path);
  return path === frameworkFeasibilityAssets[0]
    ? Buffer.from(
        b
          .toString()
          .replace(
            FRAMEWORK_FEASIBILITY_FREEZE,
            "__FRAMEWORK_FEASIBILITY_FREEZE__",
          ),
      )
    : b;
}

export function auditFrameworkFeasibility(reader = frameworkFeasibilityBytes) {
  const onboarding = auditOnboarding();
  const external = auditExternalIntake();
  if (FRAMEWORK_FEASIBILITY_FREEZE === "__UNFROZEN__")
    throw Error("Framework feasibility protocol not frozen");
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/framework-feasibility-v1.json", "utf8"),
  );
  if (
    digest !== FRAMEWORK_FEASIBILITY_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(frameworkFeasibilitySettings) ||
    onboardingSha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== frameworkFeasibilityAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== frameworkFeasibilityAssets[i] ||
        a.sha256 !== onboardingSha(reader(a.path)),
    )
  )
    throw Error("Framework feasibility freeze changed");
  const evidenceManifest = JSON.parse(
    reader("evaluation/framework-feasibility-evidence-v1.json").toString("utf8"),
  );
  if (
    evidenceManifest.selectionDigest !== external.selection.digest ||
    evidenceManifest.onboardingFreeze !== onboarding.digest
  )
    throw Error("Framework feasibility upstream digest binding changed");
  return { digest, assets, ...settings };
}

function defaultPrivateReader(path: string) {
  const actual = realpathSync(path),
    root = realpathSync(".repolab"),
    st = lstatSync(path);
  if (
    !actual.startsWith(root + sep) ||
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.size > 8_000_000
  )
    throw Error("Invalid private metadata file");
  return readFileSync(path);
}

export function verifyFrameworkFeasibilityEvidence(
  id: string,
  reader: (path: string) => Buffer = defaultPrivateReader,
) {
  auditFrameworkFeasibility();
  const manifest = JSON.parse(
    readFileSync("evaluation/framework-feasibility-evidence-v1.json", "utf8"),
  );
  const subject = manifest.subjects.find(
    (s: any) => s.id === id || s.taskId === id,
  );
  if (!subject)
    throw Error("Repository is outside reviewed framework feasibility catalog");
  const records: Record<string, Buffer> = {};
  for (const [key, entry] of Object.entries(
    subject.files as Record<string, { path: string; sha256: string }>,
  )) {
    const bytes = reader(entry.path);
    if (onboardingSha(bytes) !== entry.sha256)
      throw Error("Pinned Git metadata receipt changed");
    records[key] = bytes;
  }
  return {
    subject,
    records,
    evidenceBinding: {
      files: Object.keys(subject.files).length,
      manifestSha256: onboardingSha(
        readFileSync("evaluation/framework-feasibility-evidence-v1.json"),
      ),
    },
  };
}

export function inspectFrameworkFeasibilitySubject(
  id: string,
  reader?: (path: string) => Buffer,
) {
  const { subject, records, evidenceBinding } =
    verifyFrameworkFeasibilityEvidence(id, reader);
  const inventory = JSON.parse(
    readFileSync("evaluation/external-source-inventory-v1.json", "utf8"),
  );
  const { digest: invDigest, ...invPayload } = inventory;
  if (
    onboardingSha(JSON.stringify(invPayload)) !== invDigest ||
    invDigest !==
      JSON.parse(
        readFileSync(
          "evaluation/framework-feasibility-evidence-v1.json",
          "utf8",
        ),
      ).sourceInventoryDigest
  )
    throw Error("External source inventory digest changed");
  const pin = inventory.rows.find(
    (r: PinnedSourceInventoryRow) => r.instance_id === subject.taskId,
  );
  if (!pin) throw Error("Source inventory row missing");
  const inspection = inspectPinnedGitTreeFeasibility(
    pin,
    subject.targetSubpackage as TargetSubpackageSpec,
    {
      commitBytes: records.commit,
      canonicalTreeBytes: records.canonicalTree,
      treeBytes: records.tree,
      packageBytes: records.package,
      originalContextBytes: records.originalContext,
      expectedContextSha256: subject.files.originalContext.sha256,
      localArchiveAvailable: false,
      subpackageBlobsAvailable: false,
      sandboxQualificationReceiptsAvailable: false,
    },
    subject.candidateRank,
  );
  return {
    ...inspection,
    evidenceBinding,
  };
}

export function frameworkFeasibilityReport() {
  const protocol = auditFrameworkFeasibility(),
    { selection } = auditExternalIntake(),
    vue = inspectFrameworkFeasibilitySubject("vue"),
    docusaurus = inspectFrameworkFeasibilitySubject("docusaurus");
  const framework = selection.selected.map((task) => {
    if (task.instance_id === "preactjs__preact-4436")
      return {
        taskId: task.instance_id,
        selected: true,
        ...qualifyOnboardingSubject("preact"),
      };
    if (task.instance_id === "vuejs__core-11899")
      return {
        selected: true,
        ...vue,
      };
    if (task.instance_id === "facebook__docusaurus-8927")
      return {
        selected: true,
        ...docusaurus,
      };
    throw Error("Unexpected selected framework task");
  });
  const developmentControls = [
    {
      taskId: "lukeed__regexparam-40",
      role: "exposed development intake control; not part of selected framework denominator",
      ...qualifyOnboardingSubject("regexparam"),
    },
  ];
  const report = {
    format: "repolab-framework-feasibility-report/v1",
    freeze: protocol.digest,
    onboardingFreeze: auditOnboarding().digest,
    selectionDigest: selection.digest,
    primaryRemainingCandidate: {
      taskId: vue.taskId,
      repository: vue.repository,
      commit: vue.commit,
      candidateRank: vue.candidateRank,
      treeArchiveCompatible: vue.treeFeasibility.treeArchiveCompatible,
      targetSubpackage: vue.targetSubpackage.directory,
      feasibilityVerdict: vue.feasibilityVerdict,
      blockerCodes: vue.blockers.map((b) => b.code),
      inferenceAuthorized: false,
      rationale:
        "Vue 3.5.4 passes all closed archive structural bounds (697 blobs, 5,691,178 uncompressed bytes, 0 symlinks/executables/unsafe paths) and isolates the scoped CSS @media/@container bug to packages/compiler-sfc, whereas Docusaurus fails archive structural admission (49.0 MB > 32 MB cap, 2 symlinks, 8 executables, 154 unsafe paths). Vue remains blocked before Sandbox or inference because no pinned Vue source archive/subpackage bundle, pnpm@9.10.0 catalog: workspace image, exact reviewed runtime receipt, or original vitest/reproduction receipts exist locally.",
    },
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
      "data-only Git tree/package feasibility inspection and offline replay of existing actual Sandbox receipts",
    scope:
      "Bounded supported scope retained (Preact + regexparam control); Vue and Docusaurus remain explicit unsupported rows in the 3-framework denominator until a pinned workspace archive, pnpm@9.10.0 offline image, unchanged native suites and repeated original failure reproduction qualify in Nebius Sandbox before any inference.",
  };
  assertNativeNoSecrets(report);
  return report;
}

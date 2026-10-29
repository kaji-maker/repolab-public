import { readFileSync } from "node:fs";
import { onboardingSha } from "./onboarding-v1.ts";
import { auditExternalIntake } from "../evaluation/external-intake.ts";
import { auditNativeFreeze } from "../evaluation/preact-native-v5.ts";
import { auditGithubRepairProtocol } from "./github-anchor-protocol-v3.ts";
export const ONBOARDING_FREEZE: string =
  "dec9caa0a75af2bc56147433edcae0545750ea455be7de3f8aefd01c1d10f074";
export const onboardingSettings = {
  format: "repolab-onboarding-qualification/v1",
  maxModelCalls: 0,
  maxNewSandboxOperations: 0,
  qualification:
    "data-only inspection and replay of original-only real Sandbox evidence",
  frameworkDenominator: [
    "facebook__docusaurus-8927",
    "preactjs__preact-4436",
    "vuejs__core-11899",
  ],
  developmentControls: ["regexparam"],
  repairAdmission: false,
};
export const onboardingAssets = [
  "packages/repositories/onboarding-protocol-v1.ts",
  "packages/repositories/onboarding-v1.ts",
  "packages/repositories/onboarding-catalog-v1.ts",
  "apps/repositories/onboarding-v1.ts",
  "tests/onboarding-v1.test.ts",
  "evaluation/ONBOARDING_V1.md",
  "evaluation/onboarding-catalog-v1.json",
  "evaluation/onboarding-evidence-v1.json",
  "fixtures/preact-native/original-manifest.json",
  "repositories/preact-native-v1/original.tar.gz",
  "repositories/github-anchor-v1/regexparam/manifest.json",
  "repositories/github-anchor-v1/regexparam/original.tar.gz",
  "evaluation/external-selected-v1.json",
  "evaluation/external-source-inventory-v1.json",
  "evaluation/preact-native-v5.json",
  "evaluation/github-anchor-v3.json",
];
export function onboardingBytes(path: string) {
  const b = readFileSync(path);
  return path === onboardingAssets[0]
    ? Buffer.from(
        b.toString().replace(ONBOARDING_FREEZE, "__ONBOARDING_FREEZE__"),
      )
    : b;
}
export function auditOnboarding(reader = onboardingBytes) {
  auditExternalIntake();
  auditNativeFreeze();
  auditGithubRepairProtocol();
  if (ONBOARDING_FREEZE === "__UNFROZEN__")
    throw Error("Onboarding protocol not frozen");
  const { digest, assets, ...settings } = JSON.parse(
    readFileSync("evaluation/onboarding-v1.json", "utf8"),
  );
  if (
    digest !== ONBOARDING_FREEZE ||
    JSON.stringify(settings) !== JSON.stringify(onboardingSettings) ||
    onboardingSha(JSON.stringify({ ...settings, assets })) !== digest ||
    assets.length !== onboardingAssets.length ||
    assets.some(
      (a: any, i: number) =>
        a.path !== onboardingAssets[i] ||
        a.sha256 !== onboardingSha(reader(a.path)),
    )
  )
    throw Error("Onboarding freeze changed");
  return { digest, assets, ...settings };
}

import { readFileSync } from "node:fs";
import { z } from "zod";
import { auditNativeFreeze, shaNative } from "./preact-native-v5.ts";
import { admitPreactEdit } from "../repositories/preact-admission-v3.ts";

export const ADMISSION_FREEZE = "ac021a27b27ccb21ca1764a6aad86b560e38621e8994ecc2f9746c187c2fb9d9";
export const admissionAssets = [
  "packages/evaluation/preact-admission-v3.ts",
  "packages/repositories/preact-admission-v3.ts",
  "packages/execution/preact-admission-v3.ts",
  "apps/evaluator/preact-admission-v3.ts",
  "tests/preact-admission-v3.test.ts",
  "evaluation/PREACT_ADMISSION_V3.md",
  "evaluation/preact-admission-reference-v2.json",
  "evaluation/preact-admission-weak-v2.json",
  "evaluation/preact-admission-independent-v3.html",
  "evaluation/preact-admission-v1.json",
  "evaluation/preact-admission-v2.json",
  "evaluation/preact-admission-v2-results-summary.json",
  "evaluation/preact-admission-v1-results-summary.json",
  "repositories/preact-admission-v3/public.html",
  "repositories/preact-admission-v1/guest.cjs",
  "repositories/preact-admission-v1/original/diff-index.js",
  "repositories/preact-admission-v1/original/diff-children.js",
  "repositories/preact-admission-v1/original/internal.d.ts",
];
export function admissionBytes(path: string) {
  const b = readFileSync(path);
  return path === admissionAssets[0]
    ? Buffer.from(
        b.toString("utf8").replace(ADMISSION_FREEZE, "__ADMISSION_FREEZE__"),
      )
    : b;
}
export function auditAdmission(reader = admissionBytes) {
  const p = JSON.parse(
    readFileSync("evaluation/preact-admission-v3.json", "utf8"),
  );
  const { digest, ...payload } = p;
  if (
    digest !== ADMISSION_FREEZE ||
    shaNative(JSON.stringify(payload)) !== digest ||
    p.parentDigest !== auditNativeFreeze().digest ||
    p.inferenceCalls !== 0 ||
    p.modelAdmission !== false ||
    p.assets.length !== admissionAssets.length ||
    p.assets.some(
      (a: { path: string; sha256: string }, i: number) =>
        a.path !== admissionAssets[i] || shaNative(reader(a.path)) !== a.sha256,
    )
  )
    throw Error("Preact admission freeze changed");
  return p;
}
export type FixtureVariant = "original" | "weak" | "reference";
export function admissionFixture(variant: FixtureVariant) {
  z.enum(["original", "weak", "reference"]).parse(variant);
  return variant === "original"
    ? null
    : admitPreactEdit(
        JSON.parse(
          readFileSync(
            "evaluation/preact-admission-" + variant + "-v2.json",
            "utf8",
          ),
        ),
      );
}
const expected = {
  public: [
    { id: "returned-cleanup", events: ["mount", "cleanup"] },
    { id: "legacy-callback", events: ["mount", "null"] },
    { id: "object-ref", events: ["INPUT", "cleared"] },
  ],
  independent: [
    { id: "stable-rerender", events: ["mount", "cleanup"] },
    {
      id: "replace-ref",
      events: ["a:mount", "a:cleanup", "b:mount", "b:cleanup"],
    },
    { id: "remove-ref", events: ["mount", "cleanup", "retained:INPUT"] },
    {
      id: "shared-callback",
      events: ["mount:left", "mount:right", "cleanup:left", "cleanup:right"],
    },
    {
      id: "remount",
      events: [
        "mount:first",
        "cleanup:first",
        "mount:second",
        "cleanup:second",
      ],
    },
    { id: "component-ref", events: ["instance:true", "cleanup"] },
    { id: "nonfunction-return", events: ["mount", "null"] },
    { id: "cleanup-error-boundary", events: ["mount", "error:cleanup marker"] },
    {
      id: "keyed-replacement",
      events: ["mount:old", "cleanup:old", "mount:new", "cleanup:new"],
    },
  ],
};
export function admissionObservations(
  value: unknown,
  scope: "public" | "independent",
) {
  const rows = z
    .array(
      z
        .object({
          id: z.string().min(1).max(80),
          events: z.array(z.string().max(100)).max(12),
          observedError: z.string().min(1).max(400).optional(),
        })
        .strict(),
    )
    .parse(value);
  if (
    JSON.stringify(rows.map((r) => r.id)) !==
    JSON.stringify(expected[scope].map((r) => r.id))
  )
    throw Error("Lifecycle observations missing, reordered or duplicated");
  return {
    total: rows.length,
    passed: rows.filter(
      (r, i) =>
        !r.observedError &&
        JSON.stringify(r.events) === JSON.stringify(expected[scope][i].events),
    ).length,
    failed: rows
      .filter(
        (r, i) =>
          !!r.observedError ||
          JSON.stringify(r.events) !==
            JSON.stringify(expected[scope][i].events),
      )
      .map((r) => r.id),
    rows,
  };
}
export function admissionPlan() {
  const original = ["public-A", "independent-A", "public-B", "independent-B"];
  const weak = [
    "build",
    "integrity",
    "lint",
    "mocha-A",
    "types",
    "browser-A",
    "public-A",
    "public-B",
    "independent-A",
    "independent-B",
  ];
  const reference = [
    "build",
    "integrity",
    "lint",
    "mocha-A",
    "types",
    "browser-A",
    "public-A",
    "mocha-B",
    "browser-B",
    "public-B",
    "independent-A",
    "independent-B",
  ];
  return [
    ...original.map((stage) => ({ variant: "original" as const, stage })),
    ...weak.map((stage) => ({ variant: "weak" as const, stage })),
    ...reference.map((stage) => ({ variant: "reference" as const, stage })),
  ];
}

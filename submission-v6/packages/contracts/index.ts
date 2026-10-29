import { z } from "zod";

export const ProbeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  instant: z.iso.datetime({ offset: true }),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Expected an IANA timezone"),
  expected: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceQuote: z.string().min(10).max(1000),
});
export const QuantityProbeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  quantity: z.number().int().min(0).max(1000).nullable(),
  unitPriceCents: z.number().int().min(0).max(1_000_000),
  expected: z.number().int().min(0).max(1_000_000_000),
  sourceQuote: z.string().min(10).max(1000),
});
export type ClsxJson =
  null | boolean | number | string | ClsxJson[] | { [key: string]: ClsxJson };
const JsonPrimitive = z.union([
  z.null(),
  z.boolean(),
  z.number().finite().min(-1_000_000).max(1_000_000),
  z.string().max(128),
]);
const JsonKey =
  /^(?!(?:__proto__|constructor|prototype)$)[^\u0000-\u001f]{0,64}$/;
let boundedJson: z.ZodType<ClsxJson> = JsonPrimitive;
for (let depth = 0; depth < 4; depth++) {
  boundedJson = z.union([
    JsonPrimitive,
    z.array(boundedJson).max(16),
    // Validate the raw keys before Zod's record parser can discard __proto__.
    z
      .unknown()
      .refine(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
          Object.keys(value).length <= 16 &&
          Object.keys(value).every((key) => JsonKey.test(key)),
        "Expected a bounded JSON object with safe keys",
      )
      .pipe(z.record(z.string().regex(JsonKey), boundedJson)),
  ]);
}
export const ClsxArgsSchema = z
  .array(boundedJson)
  .max(8)
  .refine(
    (args) => JSON.stringify(args).length <= 4000,
    "Arguments exceed the JSON budget",
  );
export const ClsxProbeSchema = z.strictObject({
  id: ProbeSchema.shape.id,
  args: ClsxArgsSchema,
  expected: z.string().max(4000),
  sourceQuote: ProbeSchema.shape.sourceQuote,
});
export type Probe =
  | z.infer<typeof ProbeSchema>
  | z.infer<typeof QuantityProbeSchema>
  | z.infer<typeof ClsxProbeSchema>;
type WithoutQuote<T> = T extends unknown ? Omit<T, "sourceQuote"> : never;
export type ProbeData = WithoutQuote<Probe>;

export const BookingContractSchema = z.strictObject({
  summary: z.string().min(1).max(1000),
  expectations: z.array(ProbeSchema).min(1).max(8),
});
export const QuantityContractSchema = z.strictObject({
  summary: z.string().min(1).max(1000),
  expectations: z.array(QuantityProbeSchema).min(1).max(8),
});
export const ClsxContractSchema = z.strictObject({
  summary: z.string().min(1).max(1000),
  expectations: z.array(ClsxProbeSchema).min(1).max(8),
});
export const ContractSchema = z.union([
  BookingContractSchema,
  QuantityContractSchema,
  ClsxContractSchema,
]);
export type BehaviorContract = z.infer<typeof ContractSchema>;

export const IntakeSchema = z.strictObject({
  profile: z.enum([
    "booking-timezone",
    "checkout-quantity",
    "clsx-object-push",
  ]),
  report: z.string().min(20).max(8000),
  mode: z.enum(["fixture", "live"]).default("fixture"),
});
export type Intake = z.infer<typeof IntakeSchema>;

export const PatchSchema = z.strictObject({
  path: z.enum(["src/bookings.mjs", "src/checkout.mjs", "src/index.js"]),
  content: z.string().min(20).max(16_000),
  explanation: z.string().min(1).max(1000),
});
export type Patch = z.infer<typeof PatchSchema>;

export const phases = [
  "INTAKE",
  "PREPARING",
  "REPRODUCING",
  "CORE_FROZEN",
  "REPAIRING",
  "CHALLENGING",
  "VERIFYING",
  "PACKAGING",
] as const;
export type Phase = (typeof phases)[number];
export type Outcome =
  | "VERIFIED_FOR_TESTED_SCENARIOS"
  | "REPRODUCED_ONLY"
  | "PATCH_REJECTED"
  | "COULD_NOT_REPRODUCE"
  | "NEEDS_CLARIFICATION"
  | "ENVIRONMENT_ERROR"
  | "PROVIDER_ERROR"
  | "BUDGET_EXHAUSTED"
  | "CANCELLED"
  | "INCONCLUSIVE";
export type RunStatus = Phase | Outcome;

export interface Usage {
  id: string;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}
export interface Execution {
  id: string;
  provider: "trusted-fixture" | "nebius-sandbox";
  sourceHash: string;
  testHash: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  operationId?: string;
  image?: string;
  providerCostRaw?: number;
  runtimeVersion?: string;
}
export interface Gate {
  name: string;
  passed: boolean;
  detail: string;
}
export interface Candidate {
  id: string;
  patch: Patch;
  sourceHash: string;
  executions: Record<string, Execution>;
  gates: Gate[];
  accepted: boolean;
}
export interface RunEvent {
  sequence: number;
  at: string;
  status: RunStatus;
  message: string;
}
export interface Run {
  verificationProtocol?: "controller-observations/v1";
  id: string;
  createdAt: string;
  updatedAt: string;
  intake: Intake;
  status: RunStatus;
  provenance: {
    inference: "fixture" | "nebius";
    execution: "trusted-fixture" | "nebius-sandbox";
    model: string;
    rates: { input: number; output: number } | null;
  };
  sourceHash: string;
  source: string;
  events: RunEvent[];
  contract?: BehaviorContract;
  proposedContract?: BehaviorContract;
  clarification?: string;
  frozen?: {
    source: string;
    hash: string;
    before: Execution[];
    expectationsHash?: string;
  };
  challenge?: {
    source: string;
    hash: string;
    before: Execution;
    expectationsHash?: string;
  };
  baseline?: {
    source: string;
    hash: string;
    execution: Execution;
    probes?: ProbeData[];
    expectationsHash?: string;
  };
  candidates: Candidate[];
  usage: Usage[];
  error?: string;
  limitations: string[];
  operations?: {
    id: string;
    state: string;
    sourceHash: string;
    testHash: string;
    image: string;
  }[];
}
export interface Proposer {
  profile?: Intake["profile"];
  provenance: Run["provenance"]["inference"];
  model: string;
  rates: { input: number; output: number } | null;
  extract(
    report: string,
    signal?: AbortSignal,
  ): Promise<{ contract: BehaviorContract | null; clarification?: string }>;
  repair(
    context: {
      source: string;
      contract: BehaviorContract;
      tests: string;
      failure: string;
      attempt: number;
      previous?: string;
      repository?: RepositoryRepairContext;
    },
    signal?: AbortSignal,
  ): Promise<Patch>;
  takeUsage(): Usage[];
}
export interface RepositoryRepairContext {
  repository: string;
  commit: string;
  files: { path: string; content: string; sha256: string }[];
}
export interface Executor {
  provider: Execution["provider"];
  execute(
    source: string,
    tests: string,
    signal?: AbortSignal,
  ): Promise<Execution>;
}

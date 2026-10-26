import { z } from "zod";
import {
  plannedProposalSchema,
  preactRecoveryReview,
} from "./preact-planning-v1.ts";
import {
  admitOwnedPreactEdit,
  ownedAdmissionFeedback,
} from "./preact-ownership-v1.ts";
import { preactBodyDiagnostics } from "./preact-diagnostics-v2.ts";

const conditions = {
  "ref-function": "typeof ref === 'function'",
  "result-function": "typeof result === 'function'",
  "cleanup-function": "typeof cleanup === 'function'",
  "cleanup-present": "cleanup",
  "value-null": "value == null",
  "value-not-null": "value != null",
  "null-with-cleanup": "value == null && cleanup",
} as const;
const actions = {
  "capture-result": "const result = ref(value);",
  "call-ref": "ref(value);",
  "call-cleanup": "cleanup();",
  "clear-cleanup": "refVNode._refCleanup = undefined;",
  "store-result": "refVNode._refCleanup = result;",
  "set-object": "ref.current = value;",
  return: "return;",
} as const;
export type NestedInstruction =
  | { kind: "action"; action: keyof typeof actions }
  | {
      kind: "if";
      condition: keyof typeof conditions;
      then: NestedInstruction[];
      else: NestedInstruction[];
    };
export const instructionSchema: z.ZodType<NestedInstruction> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("action"),
      action: z.enum(
        Object.keys(actions) as [
          keyof typeof actions,
          ...(keyof typeof actions)[],
        ],
      ),
    }),
    z.strictObject({
      kind: z.literal("if"),
      condition: z.enum(
        Object.keys(conditions) as [
          keyof typeof conditions,
          ...(keyof typeof conditions)[],
        ],
      ),
      then: z.array(instructionSchema).max(32),
      else: z.array(instructionSchema).max(32),
    }),
  ]),
);
export const programProposalSchema = plannedProposalSchema
  .omit({ applyRefBody: true })
  .extend({ program: z.array(instructionSchema).min(1).max(32) });
/** Bound plain tree data before recursive parsing. Shared/cyclic nodes are refused. */
function boundTree(value: unknown) {
  const program = (value as { program?: unknown })?.program;
  if (!Array.isArray(program)) throw Error("Nested program must be an array");
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (block: unknown, depth: number) => {
    if (depth > 8) throw Error("Nested program exceeds eight branch levels");
    if (!Array.isArray(block)) throw Error("Nested branch arms must be arrays");
    for (const item of block) {
      if (!item || typeof item !== "object")
        throw Error("Nested node must be an object");
      if (seen.has(item))
        throw Error("Nested program has repeated or cyclic nodes");
      seen.add(item);
      if (++nodes > 32) throw Error("Nested program exceeds 32 total nodes");
      if ((item as { kind?: unknown }).kind === "if") {
        visit((item as { then?: unknown }).then, depth + 1);
        visit((item as { else?: unknown }).else, depth + 1);
      }
    }
  };
  visit(program, 0);
}
/** Emit both arms as syntax, never evaluate conditions/actions on the controller. */
export function compileGeneratedProposal(value: unknown) {
  boundTree(value);
  const proposal = programProposalSchema.parse(value),
    lines = ["const cleanup = refVNode._refCleanup;"];
  let captureCount = 0,
    captureScope: number | null = null,
    scopeSequence = 0;
  const render = (
    block: NestedInstruction[],
    scopes: number[],
    path: string,
  ) => {
    for (const [i, node] of block.entries()) {
      const at = path + "[" + i + "]";
      const fail = (reason: string): never => {
        throw Error("Nested node " + at + ": " + reason);
      };
      const usesResult =
        node.kind === "if"
          ? node.condition === "result-function"
          : node.action === "store-result";
      if (
        usesResult &&
        (captureScope === null || !scopes.includes(captureScope))
      )
        fail("result is not bound in this block");
      if (node.kind === "if") {
        lines.push("if (" + conditions[node.condition] + ") {");
        render(node.then, [...scopes, ++scopeSequence], at + ".then");
        lines.push("} else {");
        render(node.else, [...scopes, ++scopeSequence], at + ".else");
        lines.push("}");
      } else {
        if (node.action === "capture-result") {
          if (++captureCount > 1)
            fail("result capture must appear at most once");
          captureScope = scopes.at(-1)!;
        }
        lines.push(actions[node.action]);
      }
    }
  };
  render(proposal.program, [0], "program");
  const applyRefBody = lines.join("\n");
  if (applyRefBody.length > 1800)
    throw Error("Compiled program exceeds body limit");
  const { program, ...metadata } = proposal;
  return { ...metadata, applyRefBody };
}
export function admitGeneratedPreactEdit(value: unknown) {
  return admitOwnedPreactEdit(compileGeneratedProposal(value));
}
export function generationBodyDiagnostics(value: unknown) {
  try {
    return preactBodyDiagnostics(compileGeneratedProposal(value).applyRefBody);
  } catch {
    return preactBodyDiagnostics(null);
  }
}
export function generationAdmissionFeedback(value: unknown, reason: string) {
  const proposal = programProposalSchema.parse(value);
  let compiled: ReturnType<typeof compileGeneratedProposal> | null = null;
  let actual: string | null = null;
  try {
    compiled = compileGeneratedProposal(proposal);
    admitOwnedPreactEdit(compiled);
  } catch (e) {
    actual = (e as Error).message;
  }
  if (
    (actual !== null && actual !== reason) ||
    (actual === null && reason !== "Unchanged or repeated scoped candidate")
  )
    throw Error("Generation feedback must match the authoritative rejection");
  if (compiled)
    return {
      ...ownedAdmissionFeedback(compiled, reason),
      generation: "deterministic compilation of actual model program",
    };
  return {
    kind: "admission",
    reason,
    stage: "compiler",
    correction:
      "Fix the indicated instruction: action nodes with action only, if nodes with condition/then/else arrays, result capture at most once and result use inside its declaring block. Cleanup is already bound once; do not declare it.",
    authority:
      "actual compiler rejection only; no automatic source correction or execution",
  };
}
export function generationRecoveryReview(previous: unknown) {
  if (previous === null) return null;
  const prior = z
    .strictObject({ proposal: z.unknown(), feedback: z.unknown() })
    .parse(previous);
  const kind = z
    .enum(["admission", "native", "public"])
    .parse((prior.feedback as { kind?: unknown })?.kind);
  if (kind === "admission") {
    const reason = z
      .string()
      .parse((prior.feedback as { reason?: unknown })?.reason);
    generationAdmissionFeedback(prior.proposal, reason);
    return {
      kind,
      reason,
      instruction:
        "Correct the actual rejected program or source requirement. Cleanup binding is compiler supplied; result capture is unique. Revise nested nodes, not only plan metadata.",
    };
  }
  return preactRecoveryReview({
    proposal: compileGeneratedProposal(prior.proposal),
    feedback: prior.feedback,
  });
}
export function preactGenerationGuidance() {
  return {
    origin:
      "unchanged admitted ref-body statements, calls and local initializer rules; developer-supplied nested syntax compiler",
    cleanupBinding:
      "The compiler supplies const cleanup = refVNode._refCleanup; once at the beginning.",
    actionShape: {
      kind: "action",
      action: "one of the listed actions; no condition, then or else fields",
    },
    branchShape: {
      kind: "if",
      condition: "one of the listed conditions",
      then: "array of nested nodes",
      else: "array of nested nodes; may be empty",
    },
    actions: Object.entries(actions).map(([action, source]) => ({
      action,
      source,
    })),
    conditions: Object.entries(conditions).map(([condition, source]) => ({
      condition,
      source,
    })),
    blocks:
      "Branch arms are nested arrays. Do not emit separate else/end markers. JSON/schema structure supplies balanced blocks.",
    resultBinding:
      "capture-result declares result from ref(value) at most once; choose its position inside a callable-ref branch. Use result only in that arm or its descendants.",
    scope:
      "The model controls nested conditions, instruction order, calls, writes and returns. Compiler output is not a correctness verdict; source admission and native/public gates remain required.",
    limits: {
      totalNodes: 32,
      branchDepth: 8,
      sourceCharacters: 1800,
      admittedAstNodes: 160,
    },
  };
}

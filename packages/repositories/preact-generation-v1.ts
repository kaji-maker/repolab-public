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
export const instructionSchema = z.strictObject({
  op: z.enum([
    "if",
    "else",
    "end",
    ...(Object.keys(actions) as (keyof typeof actions)[]),
  ]),
  condition: z.enum([
    "none",
    ...(Object.keys(conditions) as (keyof typeof conditions)[]),
  ]),
});
export const programProposalSchema = plannedProposalSchema
  .omit({ applyRefBody: true })
  .extend({
    program: z.array(instructionSchema).min(1).max(32),
  });
/** Emit syntax only. No interpreter/eval, reference lookup, rewriting or source execution. */
export function compileGeneratedProposal(value: unknown) {
  const proposal = programProposalSchema.parse(value);
  const lines = ["const cleanup = refVNode._refCleanup;"];
  const scopes = [0];
  const stack: { parent: number; elseSeen: boolean }[] = [];
  let scopeSequence = 0,
    captureCount = 0,
    captureScope: number | null = null;
  for (const [i, instruction] of proposal.program.entries()) {
    const fail = (reason: string): never => {
      throw Error("Program instruction " + i + ": " + reason);
    };
    const usesResult =
      instruction.op === "store-result" ||
      instruction.condition === "result-function";
    if (usesResult && (captureScope === null || !scopes.includes(captureScope)))
      fail("result is not bound in this block");
    if (instruction.op === "if") {
      if (instruction.condition === "none") fail("if requires a condition");
      if (stack.length >= 8) fail("block depth exceeds eight");
      lines.push(
        "if (" +
          conditions[instruction.condition as keyof typeof conditions] +
          ") {",
      );
      stack.push({ parent: scopes.at(-1)!, elseSeen: false });
      scopes.push(++scopeSequence);
    } else {
      if (instruction.condition !== "none")
        fail("only if may have a condition");
      if (instruction.op === "else") {
        const frame = stack.at(-1);
        if (!frame || frame.elseSeen) fail("else has no unmatched if");
        frame!.elseSeen = true;
        scopes.pop();
        scopes.push(++scopeSequence);
        lines.push("} else {");
      } else if (instruction.op === "end") {
        if (!stack.length) fail("end has no open block");
        stack.pop();
        scopes.pop();
        lines.push("}");
      } else {
        if (instruction.op === "capture-result") {
          if (++captureCount > 1)
            fail("result capture must appear at most once");
          captureScope = scopes.at(-1)!;
        }
        lines.push(actions[instruction.op as keyof typeof actions]);
      }
    }
  }
  if (stack.length) throw Error("Program has unclosed blocks");
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
      "Fix the indicated instruction: balanced if/else/end, condition only on if, result capture at most once and result use inside its declaring block. Cleanup is already bound once; do not declare it.",
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
        "Correct the actual rejected program or source requirement. Cleanup binding is compiler supplied; result capture is unique. Revise instructions, not only plan metadata.",
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
      "unchanged admitted ref-body statements, calls and local initializer rules; developer-supplied syntax compiler",
    cleanupBinding:
      "The compiler supplies const cleanup = refVNode._refCleanup; once at the beginning.",
    instructions: Object.keys(actions).map((op) => ({
      op,
      condition: "none",
      source: actions[op as keyof typeof actions],
    })),
    conditions: Object.entries(conditions).map(([condition, source]) => ({
      condition,
      source,
    })),
    blocks:
      "if opens a block with a condition; else changes its arm once; end closes it. else/end require condition none.",
    resultBinding:
      "capture-result declares result from ref(value) at most once; choose its position inside a callable-ref branch. Use result only in that block or its descendants.",
    scope:
      "The model controls instruction order, branches, calls, writes and returns. Compiler output is not a callback-correctness verdict; original admission and native/public gates remain required.",
    limits: {
      instructions: 32,
      blockDepth: 8,
      sourceCharacters: 1800,
      admittedAstNodes: 160,
    },
  };
}

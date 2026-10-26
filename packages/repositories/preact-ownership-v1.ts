import { z } from "zod";
import {
  admitPlannedPreactEdit,
  plannedAdmissionFeedback,
  plannedProposalSchema,
} from "./preact-planning-v1.ts";
import { preactRepairContext } from "./preact-admission-v5.ts";
import { preactBodyDiagnostics } from "./preact-diagnostics-v2.ts";
import { shaNative } from "../evaluation/preact-native-v5.ts";

const requirements = {
  refUpdates: "transfer-cleanup",
  unmountContext: "vnode",
} as const;
const reason = "Ownership macro contract incomplete";
function ownershipIssues(value: z.infer<typeof plannedProposalSchema>) {
  return Object.entries(requirements).flatMap(([field, required]) => {
    const actual = value[field as keyof typeof requirements];
    return actual === required ? [] : [{ field, actual, required }];
  });
}
/** The existing qualified macros are required scaffolding, not model-authored source. */
export function admitOwnedPreactEdit(value: unknown) {
  const assembled = admitPlannedPreactEdit(value);
  if (ownershipIssues(plannedProposalSchema.parse(value)).length)
    throw Error(reason);
  return assembled;
}
export function ownedAdmissionFeedback(value: unknown, rejection: string) {
  const proposal = plannedProposalSchema.parse(value);
  let actual: string | null = null;
  try {
    admitOwnedPreactEdit(proposal);
  } catch (e) {
    actual = (e as Error).message;
  }
  if (
    (actual !== null && actual !== rejection) ||
    (actual === null && rejection !== "Unchanged or repeated scoped candidate")
  )
    throw Error("Ownership feedback must match the authoritative rejection");
  if (rejection !== reason)
    return plannedAdmissionFeedback(proposal, rejection);
  return {
    kind: "admission",
    reason: rejection,
    ownershipIssues: ownershipIssues(proposal),
    bodyDiagnostics: preactBodyDiagnostics(proposal.applyRefBody),
    correction:
      "This feature trial requires transfer-cleanup ref updates and the vnode unmount owner. These existing qualified macros supply state ownership and old-owner routing; the candidate body still requires original native/public verification.",
    authority:
      "source-scaffolding requirement only; not a callback-body verdict",
  };
}
export function preactOwnershipGuidance() {
  const original = preactRepairContext();
  const updateQuote = "applyRef(oldVNode.ref, null, childVNode);";
  const unmountQuote = "applyRef(r, null, parentVNode);";
  if (
    !original.sourceSlots.refUpdates.includes(updateQuote) ||
    !original.sourceSlots.applyRef.includes(unmountQuote)
  )
    throw Error("Original ownership callsites changed");
  return {
    origin:
      "original ref update/unmount callsites and existing qualified scoped ownership macros; no evaluation inputs",
    originalCallsites: [
      {
        sourcePath: "src/diff/children.js",
        quote: updateQuote,
        fact: "The original call supplies childVNode as error context and has no explicit old cleanup owner.",
      },
      {
        sourcePath: "src/diff/index.js",
        quote: unmountQuote,
        fact: "The original unmount call supplies parent error context and has no explicit unmounted cleanup owner.",
      },
    ],
    requiredMacros: requirements,
    suppliedBehavior: [
      "Transfer per-VNode cleanup state to the current VNode when the callback stays the same; clear the prior owner after transfer.",
      "Route disposal of a changed or removed callback through applyRef with the old VNode as cleanup owner and existing error context.",
      "Use the unmounted VNode as cleanup owner while preserving its parent as error context.",
    ],
    scope:
      "Controller-supplied qualified ownership scaffolding; the model implements only the admitted callback body. Macro requirements do not prove that body is correct.",
  };
}
/** Exact bytes and hashes, never execution or an inferred lifecycle result. */
export function auditOwnedSources(
  value: unknown,
  files: unknown,
  sourceHash: string,
) {
  const expected = admitOwnedPreactEdit(value);
  const parsed = z
    .strictObject({
      "src/diff/index.js": z.string(),
      "src/diff/children.js": z.string(),
      "src/internal.d.ts": z.string(),
    })
    .parse(files);
  if (
    sourceHash !== expected.sourceHash ||
    Object.entries(expected.files).some(
      ([path, text]) => parsed[path as keyof typeof parsed] !== text,
    )
  )
    throw Error("Ownership source bytes/hash changed");
  const markers = [
    [
      "old-owner-routing",
      "src/diff/children.js",
      "applyRef(oldVNode.ref, null, childVNode, oldVNode);",
    ],
    [
      "state-transfer",
      "src/diff/children.js",
      "childVNode._refCleanup = oldVNode._refCleanup;",
    ],
    [
      "prior-owner-clear",
      "src/diff/children.js",
      "oldVNode._refCleanup = undefined;",
    ],
    [
      "removed-ref-disposal",
      "src/diff/children.js",
      "if ((childVNode.ref || oldVNode._refCleanup) && oldVNode.ref != childVNode.ref) {",
    ],
    [
      "unmount-owner",
      "src/diff/index.js",
      "applyRef(r, null, parentVNode, vnode);",
    ],
    [
      "separate-owner-parameter",
      "src/diff/index.js",
      "export function applyRef(ref, value, vnode, refVNode = vnode) {",
    ],
    [
      "optional-cleanup-type",
      "src/internal.d.ts",
      "_refCleanup?: (() => void) | undefined;",
    ],
  ];
  const checks = markers.map(([id, path, marker]) => {
    const matches =
      parsed[path as keyof typeof parsed].split(marker).length - 1;
    if (matches !== 1) throw Error("Qualified ownership marker changed");
    return { id, sourcePath: path, markerHash: shaNative(marker), matches };
  });
  return {
    format: "repolab-preact-ownership-record/v1",
    sourceHash,
    requiredMacros: requirements,
    sourceFiles: Object.entries(expected.files).map(([path, text]) => ({
      path,
      sha256: shaNative(text),
    })),
    checks,
    authority:
      "exact qualified ownership scaffolding only; callback body requires unchanged native/public gates",
    provenance: {
      inference: "none (controller source comparison)",
      execution: "none (static bytes and hashes)",
    },
  };
}
export function validateOwnershipRecord(
  value: unknown,
  files: unknown,
  sourceHash: string,
  record: unknown,
) {
  const expected = auditOwnedSources(value, files, sourceHash);
  if (JSON.stringify(record) !== JSON.stringify(expected))
    throw Error("Ownership record differs from exact assembled source");
  return expected;
}

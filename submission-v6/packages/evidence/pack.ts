import type { Run } from "../contracts/index.ts";
import { sha256 } from "./hash.ts";
import { validateCompiledTests } from "../controller/tests.ts";
import { compileTests } from "../controller/tests.ts";

export interface EvidencePack {
  format: "repolab-evidence/v1" | "repolab-evidence/v2";
  integrity: string;
  run: Run;
}

export function exportPack(run: Run): EvidencePack {
  const snapshot = structuredClone(run);
  return {
    format: run.verificationProtocol
      ? "repolab-evidence/v2"
      : "repolab-evidence/v1",
    integrity: sha256(JSON.stringify(snapshot)),
    run: snapshot,
  };
}

export function readPack(input: unknown): EvidencePack {
  if (!input || typeof input !== "object")
    throw new Error("Invalid evidence pack");
  const pack = input as EvidencePack;
  if (
    !["repolab-evidence/v1", "repolab-evidence/v2"].includes(pack.format) ||
    !pack.run ||
    pack.integrity !== sha256(JSON.stringify(pack.run))
  )
    throw new Error("Evidence pack integrity mismatch");
  const run = pack.run;
  if (run.intake.profile === "clsx-object-push")
    throw new Error(
      "clsx repair runs cannot be imported before repository qualification; use the offline repair-plan format",
    );
  const sourcePath =
    run.intake.profile === "checkout-quantity"
      ? "src/checkout.mjs"
      : "src/bookings.mjs";
  const current = pack.format === "repolab-evidence/v2";
  if (current !== (run.verificationProtocol === "controller-observations/v1"))
    throw new Error("Evidence version and verification protocol differ");
  if (run.sourceHash !== sha256(run.source))
    throw new Error("Original source digest mismatch");
  for (const suite of [run.frozen, run.challenge, run.baseline]) {
    if (!suite) continue;
    if (sha256(suite.source) !== suite.hash)
      throw new Error("Test digest mismatch");
    if (validateCompiledTests(suite.source, !current) !== sourcePath)
      throw new Error("Evidence harness does not match the repository profile");
  }
  if (current) {
    const project = ({
      sourceQuote: _,
      ...probe
    }: NonNullable<Run["contract"]>["expectations"][number]) => probe;
    const suites = [
      { suite: run.baseline, probes: run.baseline?.probes },
      {
        suite: run.frozen,
        probes: run.contract?.expectations.slice(0, 1).map(project),
      },
      {
        suite: run.challenge,
        probes: run.contract?.expectations.slice(1).map(project),
      },
    ];
    for (const { suite, probes } of suites)
      if (
        suite &&
        (!probes?.length ||
          compileTests(probes) !== suite.source ||
          suite.expectationsHash !== sha256(JSON.stringify(probes)))
      )
        throw new Error("Controller expectations do not match suite inputs");
  }
  for (const candidate of run.candidates) {
    if (candidate.patch.path !== sourcePath)
      throw new Error("Candidate path does not match the repository profile");
    if (candidate.sourceHash !== sha256(candidate.patch.content))
      throw new Error("Candidate digest mismatch");
  }
  return pack;
}

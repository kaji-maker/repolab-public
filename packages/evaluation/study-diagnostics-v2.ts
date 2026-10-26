import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../evidence/hash.ts";
import { auditStudy as auditPreviousStudy } from "./study-protocol.ts";
import { checkStudySource, SourceAdmissionError } from "./study-policy-v2.ts";

/** Retrospective static diagnosis of exposed v1 material; never executes sources. */
export async function diagnosePreviousStudy() {
  const p = auditPreviousStudy();
  const directory = join(".repolab/studies", p.digest);
  const candidates = [],
    extractionFailures = [];
  for (const { task, arm } of p.schedule) {
    const r = JSON.parse(
      await readFile(join(directory, `${task}-${arm}.json`), "utf8"),
    );
    if (
      r.studyDigest !== p.digest ||
      r.task !== task ||
      r.arm !== arm ||
      !r.completedAt
    )
      throw Error("Prior study identity mismatch");
    for (const c of r.candidates) {
      if (sha256(c.source) !== c.sourceHash)
        throw Error("Saved candidate changed");
      let admission;
      try {
        checkStudySource(task, c.source);
        admission = {
          kind: "ADMITTED",
          code: "PURE_SUBSET",
          detail:
            "Statically admitted; behavior not assessed by this diagnosis",
          offset: null,
        };
      } catch (error) {
        if (!(error instanceof SourceAdmissionError)) throw error;
        admission = error.diagnostic();
      }
      candidates.push({
        task,
        arm,
        runId: r.id,
        attempt: c.attempt,
        sourceHash: c.sourceHash,
        previouslyAccepted: c.accepted,
        admission,
      });
    }
    if (r.status === "NEEDS_CLARIFICATION") {
      const completion = r.modelResponses.at(-1)?.choices?.[0]?.content;
      const response =
        typeof completion === "string" ? JSON.parse(completion) : null;
      extractionFailures.push({
        task,
        arm,
        runId: r.id,
        emptyModelResult:
          response?.contract === null && response?.clarification === null,
        priorStatus: r.status,
      });
    }
  }
  return {
    format: "repolab-static-development-diagnosis/v2",
    previousStudyDigest: p.digest,
    candidates,
    extractionFailures,
    limitations: [
      "Already exposed development sources",
      "Admission diagnoses do not determine behavioral correctness",
      "Prior results and denominators remain unchanged",
    ],
    provenance: {
      inference: "none; existing saved model bytes inspected",
      execution: "none; static parsing only",
    },
  };
}

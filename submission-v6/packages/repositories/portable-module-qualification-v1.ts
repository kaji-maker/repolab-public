import { readFileSync, lstatSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  crossSha,
  parseCrossReceipt,
} from "../execution/cross-repo-sandbox-v1.ts";
import { parseGithubRuntimeReceipt } from "./github-anchor-v2.ts";
import { assessSyntax, assessLoad } from "./module-qualification-v1.ts";

/** Data-only review using a separately trusted manifest hash; no private state, credentials or dispatch. */
export function auditPortableModuleQualification(
  root: string,
  manifestSha256: string,
) {
  const base = resolve(root);
  const bytes = (path: string) => {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(path) ||
      path.split("/").includes("..") ||
      path.startsWith("/")
    )
      throw Error("Invalid portable evidence path");
    const full = resolve(base, path);
    if (!full.startsWith(base + sep))
      throw Error("Portable evidence escaped root");
    let cursor = base;
    for (const component of path.split("/")) {
      cursor = resolve(cursor, component);
      if (lstatSync(cursor).isSymbolicLink())
        throw Error("Portable evidence symlink");
    }
    return readFileSync(full);
  };
  const manifestBytes = bytes("evaluation/module-admission-portable-v1.json");
  if (
    !/^[a-f0-9]{64}$/.test(manifestSha256) ||
    crossSha(manifestBytes) !== manifestSha256
  )
    throw Error("Trusted portable manifest required");
  const manifest = JSON.parse(manifestBytes.toString());
  if (
    manifest.format !== "repolab-module-admission-portable/v1" ||
    !Array.isArray(manifest.files) ||
    new Set(manifest.files.map((f: any) => f.path)).size !==
      manifest.files.length
  )
    throw Error("Portable evidence manifest changed");
  const bound = new Map<string, Buffer>();
  for (const file of manifest.files) {
    if (file.path.startsWith(".repolab/"))
      throw Error("Portable review cannot depend on private state");
    const data = bytes(file.path);
    if (crossSha(data) !== file.sha256)
      throw Error("Portable evidence bytes changed: " + file.path);
    bound.set(file.path, data);
  }
  const read = (path: string) => {
    const data = bound.get(path);
    if (!data) throw Error("Missing bound portable evidence: " + path);
    return JSON.parse(data.toString());
  };
  const v4 = read("evaluation/github-anchor-v4.json"),
    protocol = read("evaluation/module-qualification-v1.json");
  const resultPath = "evaluation/module-admission-portable-v1/result.json",
    resultBytes = bound.get(resultPath)!;
  if (!resultBytes || crossSha(resultBytes) !== v4.qualification.resultSha256)
    throw Error("Qualification is not bound to frozen V4");
  const result = read(resultPath);
  if (
    result.status !== "QUALIFIED" ||
    result.freeze !== v4.qualification.freeze ||
    result.freeze !== protocol.digest ||
    result.executionUncertain ||
    result.inferenceCalls !== 0 ||
    result.executionCount !== 4 ||
    result.operations.length !== 4
  )
    throw Error("Qualified portable result required");
  const ids = new Set<string>(),
    outcomes: Record<string, unknown> = {};
  for (const [i, label] of protocol.operations.entries()) {
    const prefix = "evaluation/module-admission-portable-v1/" + label;
    const rawBytes = bound.get(prefix + ".json"),
      configBytes = bound.get(prefix + "-config.json"),
      step = result.operations[i];
    if (
      !rawBytes ||
      !configBytes ||
      step.label !== label ||
      step.receiptSha256 !== crossSha(rawBytes) ||
      step.configSha256 !== crossSha(configBytes)
    )
      throw Error("Portable receipt binding changed");
    const raw = JSON.parse(rawBytes.toString()),
      config = JSON.parse(configBytes.toString());
    if (
      raw.id !== step.id ||
      ids.has(raw.id) ||
      raw.request.networking?.enabled !== false
    )
      throw Error("Portable execution identity changed");
    ids.add(raw.id);
    const proof =
      label === "qual-syntax"
        ? parseCrossReceipt(raw, config)
        : parseGithubRuntimeReceipt(raw, config);
    outcomes[label] =
      label === "qual-syntax"
        ? assessSyntax(proof.guest, config)
        : assessLoad(
            label === "qual-load-original" ? "original" : "candidate",
            proof.guest,
            config.cases,
            config.generatedHashes,
            (proof as any).executionRuntimeVersion,
          );
  }
  return {
    status: "PASS",
    qualificationFreeze: protocol.digest,
    operationsReviewed: ids.size,
    filesReviewed: bound.size,
    outcomes,
    provenance: {
      inference: "none; offline evidence review",
      execution:
        "none; recorded Nebius Sandbox receipts assessed without running source",
    },
  };
}

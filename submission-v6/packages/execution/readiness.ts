import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "../evidence/hash.ts";
import type { SandboxConfig } from "./nebius.ts";
import { observationProtocol } from "../controller/observations.ts";

export const sandboxIsolationProtocol = "repolab-sandbox-isolation/v1";
const Isolation = z.object({
  protocol: z.literal(sandboxIsolationProtocol),
  image: z.uuid(),
  scope: z.string(),
  verifiedAt: z.iso.datetime(),
  checks: z.strictObject({
    node24: z.literal(true),
    nonRoot: z.literal(true),
    envAllowlist: z.literal(true),
    immutableInputs: z.literal(true),
    networkDisabled: z.literal(true),
    nodePermissions: z.literal(true),
    networkPositiveControl: z.literal(true),
    timeout: z.literal(true),
    cancellation: z.literal(true),
  }),
  executionIds: z.array(z.uuid()).length(5),
});
const Certificate = z.object({
  image: z.uuid(),
  scope: z.string(),
  verifiedAt: z.iso.datetime(),
  expiresAt: z.number().nullable(),
  checks: z.literal("original-fails-reference-passes"),
  executionIds: z.array(z.uuid()).length(2),
  isolation: Isolation,
});
export function sandboxScope(config: SandboxConfig) {
  return sha256(
    JSON.stringify([
      config.token,
      config.project,
      config.image,
      config.baseUrl,
      observationProtocol,
      sandboxIsolationProtocol,
    ]),
  );
}
function isolationMatches(
  config: SandboxConfig,
  isolation: z.infer<typeof Isolation>,
) {
  const age = Date.now() - Date.parse(isolation.verifiedAt);
  return (
    config.coverageConfirmed &&
    isolation.scope === sandboxScope(config) &&
    isolation.image === config.image &&
    age >= 0 &&
    age < 86_400_000 &&
    new Set(isolation.executionIds).size === 5
  );
}
export function readSandboxIsolation(
  config: SandboxConfig,
  path = ".repolab/sandbox-controls.json",
) {
  const isolation = Isolation.parse(JSON.parse(readFileSync(path, "utf8")));
  if (!isolationMatches(config, isolation))
    throw new Error(
      "Run fresh isolation controls for the current sandbox configuration",
    );
  return isolation;
}
export function sandboxReady(
  config: SandboxConfig,
  path = ".repolab/sandbox-capabilities.json",
): boolean {
  if (!config.coverageConfirmed) return false;
  try {
    const certificate = Certificate.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    const age = Date.now() - Date.parse(certificate.verifiedAt);
    return (
      certificate.scope === sandboxScope(config) &&
      certificate.image === config.image &&
      isolationMatches(config, certificate.isolation) &&
      new Set([
        ...certificate.executionIds,
        ...certificate.isolation.executionIds,
      ]).size === 7 &&
      age >= 0 &&
      age < 86_400_000 &&
      (certificate.expiresAt === null ||
        certificate.expiresAt * 1000 > Date.now() + 120_000)
    );
  } catch {
    return false;
  }
}

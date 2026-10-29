import { parseCrossReceipt } from "../execution/cross-repo-sandbox-v1.ts";

// rfdc's pinned CI explicitly includes Node 20. Other tasks keep their qualified Node 24 runtime.
export const RFDC_RUNTIME = {
  version: "v20.9.0",
  url: "https://nodejs.org/download/release/v20.9.0/node-v20.9.0-linux-x64.tar.gz",
  sha256: "f0919f092fbf74544438907fa083c21e76b2d7a4bc287f0607ada1553ef16f60",
  evidence: ".github/workflows/ci.yml: Node 20",
};
export function crossRuntime(name: string) {
  return name === "rfdc"
    ? RFDC_RUNTIME
    : { version: "controller-image-node24" };
}
export function parseDevelopmentReceipt(raw: any, config: any) {
  const proof = parseCrossReceipt(raw, config);
  const stream = raw.latest.metadata.result.stdout;
  const version = JSON.parse(
    Buffer.from(
      stream.value,
      stream.encoding === "base64" ? "base64" : "utf8",
    ).toString("utf8"),
  ).executionRuntimeVersion;
  if (
    config.runtime.version === RFDC_RUNTIME.version
      ? version !== RFDC_RUNTIME.version
      : !/^v24\./.test(version)
  )
    throw Error("Execution runtime differs from frozen policy");
  return { ...proof, executionRuntimeVersion: version };
}

import { parseCrossReceipt } from "../execution/cross-repo-sandbox-v1.ts";

// rfdc's pinned CI explicitly includes Node 22. Other tasks keep their qualified Node 24 runtime.
export const RFDC_RUNTIME = {
  version: "v22.15.0",
  url: "https://nodejs.org/download/release/v22.15.0/node-v22.15.0-linux-x64.tar.gz",
  sha256: "29d1c60c5b64ccdb0bc4e5495135e68e08a872e0ae91f45d9ec34fc135a17981",
  evidence: ".github/workflows/ci.yml: Node 22",
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

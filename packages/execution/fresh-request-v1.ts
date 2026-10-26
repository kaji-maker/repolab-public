import { crossRequest } from "./cross-repo-sandbox-v1.ts";

export function freshRequest(
  image: string,
  files: Record<string, unknown>,
  phase: string,
  nativeNetwork: boolean,
) {
  const request = crossRequest(image, files, phase);
  // minimist's unchanged npm test includes an online aud --production posttest.
  // Public and independent source observations always have networking disabled.
  if (phase === "native" && nativeNetwork) request.networking.enabled = true;
  return request;
}

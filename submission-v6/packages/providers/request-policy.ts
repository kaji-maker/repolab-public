import { z } from "zod";

export const RequestPolicySchema = z.enum([
  "provider-defaults-v1",
  "nemotron-low-effort-v1",
]);
export type RequestPolicy = z.infer<typeof RequestPolicySchema>;

/** Closed settings only; cannot override model, messages, output or spending caps. */
export function requestPolicyParameters(policy: unknown, model: string) {
  const parsed = RequestPolicySchema.parse(policy);
  if (parsed === "provider-defaults-v1") return {};
  if (model !== "nvidia/nemotron-3-super-120b-a12b")
    throw Error("This request policy requires the qualified Nemotron model");
  return {
    temperature: 1,
    top_p: 0.95,
    reasoning_effort: "low" as const,
    chat_template_kwargs: {
      enable_thinking: true,
      low_effort: true,
      force_nonempty_content: true,
    },
  };
}

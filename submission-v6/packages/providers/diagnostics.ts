import { z } from "zod";
import { createHash } from "node:crypto";

const RequestId = z
  .string()
  .regex(
    /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|(?:req|request|chatcmpl)[_-][A-Za-z0-9_-]{8,96})$/,
  );
const Codes = [
  "invalid_api_key",
  "authentication_error",
  "rate_limit_exceeded",
  "invalid_request_error",
  "model_not_found",
  "insufficient_quota",
  "unsupported_parameter",
  "context_length_exceeded",
  "server_error",
  "invalid_json_schema",
] as const;
const Params = [
  "response_format",
  "max_tokens",
  "model",
  "messages",
  "temperature",
  "top_p",
  "chat_template_kwargs",
] as const;
export const ProviderDiagnosticSchema = z.strictObject({
  format: z.literal("repolab-inference-diagnostic/v1"),
  attemptId: z.uuid(),
  reservationId: z.uuid().nullable(),
  startedAt: z.iso.datetime(),
  model: z.string().regex(/^nvidia\/[a-z0-9_.-]{1,100}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  durationMs: z.number().int().nonnegative(),
  outcome: z.enum([
    "transport_error",
    "http_error",
    "invalid_completion",
    "incomplete_output",
    "invalid_output",
    "completed",
  ]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  requestId: RequestId.nullable(),
  finishReason: z
    .enum(["stop", "length", "tool_calls", "content_filter", "unknown"])
    .nullable(),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      costUsd: z.number().finite().nonnegative(),
    })
    .nullable(),
  accounting: z.enum(["uncertain", "settled"]),
  error: z
    .strictObject({
      code: z.enum(Codes).nullable(),
      param: z.enum(Params).nullable(),
      bodyHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      truncated: z.boolean(),
      unavailable: z.boolean(),
    })
    .nullable(),
});
export type ProviderDiagnostic = z.infer<typeof ProviderDiagnosticSchema>;

export function safeRequestId(
  value: string | null,
  secret: string,
): string | null {
  return value && !value.includes(secret) && RequestId.safeParse(value).success
    ? value
    : null;
}

/** Remote error text is untrusted: retain only known codes/parameters and a hash.
 * Both bytes, chunks and wall time are bounded. Never retain headers or messages.
 */
export async function errorDetails(
  response: Response,
): Promise<NonNullable<ProviderDiagnostic["error"]>> {
  const reader = response.body?.getReader();
  if (!reader)
    return {
      code: null,
      param: null,
      bodyHash: null,
      truncated: false,
      unavailable: true,
    };
  const chunks: Uint8Array[] = [];
  let size = 0,
    truncated = false,
    unavailable = false;
  const deadline = Date.now() + 250;
  try {
    let done = false;
    for (let count = 0; count < 32 && !done; count++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          Math.max(0, deadline - Date.now()),
        );
      });
      const next = await Promise.race([reader.read(), timeout]).finally(() =>
        clearTimeout(timer),
      );
      if (!next) {
        unavailable = true;
        break;
      }
      if (next.done) {
        done = true;
        break;
      }
      const part = next.value.subarray(0, Math.max(0, 4096 - size));
      chunks.push(part);
      size += part.byteLength;
      if (size === 4096 || Date.now() >= deadline || count === 31)
        truncated = true;
      if (truncated) break;
    }
  } catch {
    unavailable = true;
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks);
  let code: (typeof Codes)[number] | null = null,
    param: (typeof Params)[number] | null = null;
  if (!truncated && !unavailable) {
    try {
      const body = JSON.parse(bytes.toString("utf8"));
      if (Codes.includes(body?.error?.code)) code = body.error.code;
      if (Params.includes(body?.error?.param)) param = body.error.param;
    } catch {
      /* No arbitrary server text is retained. */
    }
  }
  return {
    code,
    param,
    bodyHash: size ? createHash("sha256").update(bytes).digest("hex") : null,
    truncated,
    unavailable,
  };
}

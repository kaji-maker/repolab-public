import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Usage } from "../contracts/index.ts";
import { sha256 } from "../evidence/hash.ts";
import {
  ProviderDiagnosticSchema,
  errorDetails,
  safeRequestId,
} from "./diagnostics.ts";
import type { ProviderDiagnostic } from "./diagnostics.ts";
import { BudgetError, ProviderError } from "./nebius.ts";
import type { NebiusConfig } from "./nebius.ts";

export const FORMAT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
export const FORMAT_OUTPUT_TOKENS = 16384;
export const FORMAT_REQUEST_BYTES = 64_000;
export const FORMAT_POLICY = "nemotron-serializer-study-v1";
export const FormatModeSchema = z.enum(["full-thinking", "direct-json"]);
export type FormatMode = z.infer<typeof FormatModeSchema>;
export class StructuredResponseError extends ProviderError {
  kind:
    | "truncated"
    | "incomplete"
    | "empty_content"
    | "invalid_json"
    | "schema_mismatch"
    | "ambiguous_choices";
  constructor(kind: StructuredResponseError["kind"]) {
    super("Structured response rejected: " + kind);
    this.kind = kind;
  }
}
export function parseStructuredContent<T>(
  choices: FormatCompletion["choices"],
  schema: z.ZodType<T>,
): T {
  if (choices.length !== 1)
    throw new StructuredResponseError("ambiguous_choices");
  const choice = choices[0];
  if (choice.finishReason !== "stop")
    throw new StructuredResponseError(
      choice.finishReason === "length" ? "truncated" : "incomplete",
    );
  if (!choice.content?.trim())
    throw new StructuredResponseError("empty_content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(choice.content);
  } catch {
    throw new StructuredResponseError("invalid_json");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new StructuredResponseError("schema_mismatch");
  return result.data;
}
export function formatParameters(model: string, mode: FormatMode) {
  FormatModeSchema.parse(mode);
  if (model !== FORMAT_MODEL)
    throw Error("Thinking policy requires exact Nemotron model");
  return {
    temperature: 1,
    top_p: 0.95,
    chat_template_kwargs: {
      enable_thinking: mode === "full-thinking",
      force_nonempty_content: true,
    },
  };
}
export function formatRequest<T>(
  model: string,
  purpose: string,
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
  mode: FormatMode,
) {
  return {
    model: model,
    messages: [
      {
        role: "system",
        content:
          system +
          "\nReturn exactly one JSON object matching this schema. No prose or markdown.\n" +
          JSON.stringify(z.toJSONSchema(schema)),
      },
      { role: "user", content: prompt },
    ],
    max_tokens: FORMAT_OUTPUT_TOKENS,
    ...formatParameters(model, mode),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: purpose.replace(/[^a-z0-9_]/gi, "_"),
        strict: true,
        schema: z.toJSONSchema(schema),
      },
    },
  };
}
/** Metadata indicates an observed reasoning channel, not proof the server honored every flag. */
export function reasoningEvidence(value: string | null | undefined) {
  return {
    present: typeof value === "string" && value.length > 0,
    bytes: typeof value === "string" ? Buffer.byteLength(value) : 0,
    sha256:
      typeof value === "string" && value.length > 0 ? sha256(value) : null,
  };
}
export interface FormatCompletion {
  id: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  choices: {
    finishReason: string | null;
    content: string | null;
    reasoning: ReturnType<typeof reasoningEvidence>;
  }[];
}
export type FormatConfig = Omit<
  NebiusConfig,
  "profile" | "requestPolicy" | "onCompletion"
> & {
  mode: FormatMode;
  onCompletion?: (completion: FormatCompletion) => void | Promise<void>;
};
const FormatCompletionSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({
          content: z.string().nullable(),
          reasoning_content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }),
});

export class NebiusFormatProposer {
  provenance = "nebius" as const;
  model: string;
  rates: { input: number; output: number };
  private config: FormatConfig;
  private usage: Usage[] = [];
  private spent = 0;
  private calls = 0;
  private uncertain = false;

  constructor(config: FormatConfig) {
    if (!config.apiKey)
      throw new ProviderError("NEBIUS_API_KEY is not configured");
    const url = new URL(config.baseUrl);
    if (
      url.protocol !== "https:" ||
      ![
        "api.tokenfactory.nebius.com",
        "api.tokenfactory.us-central1.nebius.com",
      ].includes(url.hostname)
    )
      throw new ProviderError("Use an approved HTTPS Token Factory endpoint");
    if (config.model !== FORMAT_MODEL)
      throw new ProviderError("This release requires an NVIDIA model");
    if (
      ![config.inputRate, config.outputRate, config.budgetUsd].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    )
      throw new BudgetError(
        "Positive verified rate estimates and a budget are required",
      );
    this.config = { ...config, baseUrl: config.baseUrl.replace(/\/?$/, "/") };
    this.model = config.model;
    this.rates = { input: config.inputRate, output: config.outputRate };
    formatParameters(this.model, config.mode);
  }

  async structured<T>(
    purpose: string,
    system: string,
    prompt: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.uncertain)
      throw new BudgetError(
        "Previous provider charge is uncertain; reconcile usage before another call",
      );
    if (this.calls >= 6) throw new BudgetError("Model call limit reached");
    const maxOutput = FORMAT_OUTPUT_TOKENS;
    // Conservative byte bound includes the schema and envelope, not just report text.
    const body = formatRequest(
      this.model,
      purpose,
      system,
      prompt,
      schema,
      this.config.mode,
    );
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json) > FORMAT_REQUEST_BYTES)
      throw new BudgetError("Model request exceeds the context budget");
    const reservation =
      (Buffer.byteLength(json) * this.rates.input +
        maxOutput * this.rates.output) /
      1_000_000;
    if (this.spent + reservation > this.config.budgetUsd)
      throw new BudgetError("Inference reservation exceeds this run budget");
    this.calls++;
    const reservationId = this.config.reserve?.(reservation);
    const start = performance.now();
    const attemptId = randomUUID();
    const startedAt = new Date().toISOString();
    let httpStatus: number | null = null;
    let requestId: string | null = null;
    let finishReason: ProviderDiagnostic["finishReason"] = null;
    let usage: ProviderDiagnostic["usage"] = null;
    const diagnostic = async (
      outcome: ProviderDiagnostic["outcome"],
      error: ProviderDiagnostic["error"] = null,
    ) => {
      if (!this.config.onDiagnostic) return;
      const value = ProviderDiagnosticSchema.parse({
        format: "repolab-inference-diagnostic/v1",
        attemptId,
        reservationId: reservationId ?? null,
        startedAt,
        model: this.model,
        requestHash: sha256(json),
        durationMs: Math.round(performance.now() - start),
        outcome,
        httpStatus,
        requestId,
        finishReason,
        usage,
        accounting: usage ? "settled" : "uncertain",
        error,
      });
      try {
        await this.config.onDiagnostic(value);
      } catch {
        throw new ProviderError(
          "Sanitized diagnostic storage failed; the charge record is retained. No automatic retry was made.",
        );
      }
    };
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(
        new URL("chat/completions", this.config.baseUrl),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: json,
          signal: AbortSignal.any([
            AbortSignal.timeout(180_000),
            ...(signal ? [signal] : []),
          ]),
          redirect: "error",
        },
      );
    } catch {
      this.uncertain = true;
      if (reservationId) this.config.settle?.(reservationId, null);
      await diagnostic("transport_error");
      throw new ProviderError(
        "Token Factory response unavailable; charge may be uncertain. No automatic retry was made.",
      );
    }
    httpStatus = response.status;
    requestId = safeRequestId(
      response.headers.get("x-request-id") ??
        response.headers.get("request-id"),
      this.config.apiKey,
    );
    if (!response.ok) {
      this.uncertain = true;
      if (reservationId) this.config.settle?.(reservationId, null);
      await diagnostic("http_error", await errorDetails(response));
      throw new ProviderError(
        `Token Factory returned HTTP ${response.status}; reconcile usage before retrying`,
      );
    }
    let completion: z.infer<typeof FormatCompletionSchema>;
    try {
      completion = FormatCompletionSchema.parse(await response.json());
    } catch {
      this.uncertain = true;
      if (reservationId) this.config.settle?.(reservationId, null);
      await diagnostic("invalid_completion");
      throw new ProviderError(
        "Token Factory response or usage was incomplete; reconcile the charge before retrying",
      );
    }
    if (completion.model !== this.model) {
      this.uncertain = true;
      if (reservationId) this.config.settle?.(reservationId, null);
      await diagnostic("invalid_completion");
      throw new ProviderError(
        "Returned model differs from frozen thinking model; reconcile usage",
      );
    }
    const costUsd =
      (completion.usage.prompt_tokens * this.rates.input +
        completion.usage.completion_tokens * this.rates.output) /
      1_000_000;
    this.spent += costUsd;
    if (reservationId) this.config.settle?.(reservationId, costUsd);
    usage = {
      inputTokens: completion.usage.prompt_tokens,
      outputTokens: completion.usage.completion_tokens,
      costUsd,
    };
    this.usage.push({
      id: safeRequestId(completion.id, this.config.apiKey) ?? randomUUID(),
      model: this.model,
      purpose,
      inputTokens: completion.usage.prompt_tokens,
      outputTokens: completion.usage.completion_tokens,
      costUsd,
      durationMs: Math.round(performance.now() - start),
    });
    const choice = completion.choices[0];
    finishReason = ["stop", "length", "tool_calls", "content_filter"].includes(
      choice.finish_reason ?? "",
    )
      ? (choice.finish_reason as ProviderDiagnostic["finishReason"])
      : "unknown";
    if (JSON.stringify(completion).includes(this.config.apiKey)) {
      await diagnostic("invalid_output");
      throw new ProviderError(
        "Provider output reflected a credential; refusing to retain or execute it",
      );
    }
    await this.config.onCompletion?.({
      id: safeRequestId(completion.id, this.config.apiKey) ?? attemptId,
      model: this.model,
      usage: completion.usage,
      choices: completion.choices.map((c) => ({
        finishReason: c.finish_reason,
        content: c.message.content,
        reasoning: reasoningEvidence(c.message.reasoning_content),
      })),
    });
    let result: T;
    try {
      result = parseStructuredContent(
        completion.choices.map((c) => ({
          finishReason: c.finish_reason,
          content: c.message.content,
          reasoning: reasoningEvidence(c.message.reasoning_content),
        })),
        schema,
      );
    } catch (error) {
      await diagnostic(
        error instanceof StructuredResponseError &&
          ["truncated", "incomplete", "empty_content"].includes(error.kind)
          ? "incomplete_output"
          : "invalid_output",
      );
      throw error;
    }
    await diagnostic("completed");
    return result;
  }

  takeUsage(): Usage[] {
    return this.usage.splice(0);
  }
}

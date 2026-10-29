import { z } from "zod";
import { ClsxContractSchema } from "../contracts/index.ts";

export const clsxClarification =
  'Give a sourced JSON example: For clsx arguments ["stack",{"pop":true,"push":true}], the expected classes are "stack pop push". Arguments must be bounded JSON values; functions and undefined are outside this report profile.';
export const clsxExecutionBlocker =
  "clsx requires a passing unchanged upstream build/test baseline, independent reference qualification and certified isolated execution. The repair profile is prepared but cannot start runs yet.";
export const clsxPreparationSummary = {
  id: "clsx-object-push" as const,
  name: "clsx · truthy push key",
  enabled: false,
  fixtureAvailable: false,
  liveAvailable: false,
  reason: clsxExecutionBlocker,
};
export const clsxExampleReport = `Class names disappear when an object contains a truthy push property.
For clsx arguments ["stack",{"pop":true,"push":true}], the expected classes are "stack pop push"; the reported actual classes are "stack".
Expected inclusion follows the pinned documentation's truthy-object-key behavior.
Report: https://github.com/lukeed/clsx/issues/17
Documentation: https://github.com/lukeed/clsx/blob/af19571baaf00d73c8e7600cc0f0ede163b45bca/readme.md
This is a reviewed development report; the suggested implementation change is omitted.`;

/** JSON data only: report snippets are never interpreted as JavaScript. */
export function extractClsxContract(
  report: string,
): z.infer<typeof ClsxContractSchema> | null {
  const prefix = "For clsx arguments ",
    separator = ", the expected classes are ";
  const lines = report.split("\n").filter((line) => line.startsWith(prefix));
  if (!lines.length) return null;
  try {
    const expectations = lines.map((sourceQuote, index) => {
      // The separator may itself occur inside a JSON string argument.
      for (
        let split = sourceQuote.indexOf(separator, prefix.length);
        split >= 0;
        split = sourceQuote.indexOf(separator, split + separator.length)
      ) {
        const match = /^("(?:[^"\\]|\\.)*")(?:[.;].*)?$/.exec(
          sourceQuote.slice(split + separator.length),
        );
        if (!match) continue;
        try {
          return {
            id: `reported-case-${index + 1}`,
            args: JSON.parse(sourceQuote.slice(prefix.length, split)),
            expected: JSON.parse(match[1]),
            sourceQuote,
          };
        } catch {
          /* Continue past separators inside string values. */
        }
      }
      throw new Error("Missing JSON arguments or expected class string");
    });
    const contract = ClsxContractSchema.parse({
      summary:
        "Include truthy object keys and preserve the documented clsx class-string behavior.",
      expectations,
    });
    if (
      new Set(contract.expectations.map((probe) => JSON.stringify(probe.args)))
        .size !== contract.expectations.length
    )
      return null;
    return contract;
  } catch {
    return null;
  }
}

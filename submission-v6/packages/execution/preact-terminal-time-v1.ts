import { existsSync, lstatSync, readFileSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { FreshPreactSandbox as Parent } from "./preact-repair-v3.ts";
import { admissionRequest } from "./preact-admission-v5.ts";
import { trialInput } from "./preact-trial-v10.ts";

/** A terminal observation time is lifecycle evidence, never a passing guest verdict. */
export function terminalCompletionRecord(raw: any, expected: any, now: string) {
  if (!raw || Object.hasOwn(raw, "completedAt") || raw.submissionUnconfirmed || raw.cancellation)
    return null;
  if (typeof raw.startedAt !== "string" || !Number.isFinite(Date.parse(raw.startedAt)) ||
      new Date(raw.startedAt).toISOString() !== raw.startedAt ||
      !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now ||
      Date.parse(now) < Date.parse(raw.startedAt)) return null;
  if (raw.variant !== expected.variant || raw.stage !== expected.stage || raw.sourceHash !== expected.sourceHash ||
      !isDeepStrictEqual(raw.request, expected.request) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw.id ?? "") ||
      raw.latest?.uuid !== raw.id || raw.latest?.image_uuid !== expected.image ||
      raw.status !== raw.latest?.status || !["SUCCESS", "FAILED", "CANCELLED"].includes(raw.status)) return null;
  return { ...raw, completedAt: now };
}

/** New V4 engine component; never edits a pre-existing execution slot or historical run. */
export class FreshPreactSandbox extends Parent {
  private ownedDirectory: string;
  private ownedVariant: string;
  private ownedSourceHash: string;
  constructor(...args: ConstructorParameters<typeof Parent>) {
    super(...args); this.ownedDirectory = args[0]; this.ownedVariant = args[1];
    this.ownedSourceHash = trialInput(args[2]).sourceHash;
  }
  override async run(variant: string, stage: string, image: string, sourceHash: string, files: Record<string, unknown>) {
    if (variant !== this.ownedVariant || sourceHash !== this.ownedSourceHash) throw Error("Owned source identity changed");
    const dest = join(this.ownedDirectory, variant + "-" + stage + ".json");
    const previouslyPresent = existsSync(dest);
    try { return await super.run(variant, stage, image, sourceHash, files); }
    catch (error) {
      if (!previouslyPresent && variant === this.ownedVariant && existsSync(dest)) {
        const st = lstatSync(dest);
        if (st.isFile() && !st.isSymbolicLink() && st.size <= 8_000_000) {
          const original = readFileSync(dest), raw = JSON.parse(original.toString());
          const record = terminalCompletionRecord(raw,
            { variant, stage, image, sourceHash, request: admissionRequest(stage, image, files) }, new Date().toISOString());
          if (record) {
            const temp = dest + ".terminal-time-" + randomUUID();
            await writeFile(temp, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
            if (!readFileSync(dest).equals(original)) throw Error("Owned terminal record changed during persistence");
            await rename(temp, dest);
          }
        }
      }
      throw error;
    }
  }
}

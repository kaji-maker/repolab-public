import { readdir, lstat, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  repairSummary,
  providerSecrets,
  repairActiveStatuses,
} from "./repair-view.ts";
import { exportClsxPack } from "./repair-artifacts.ts";

export class RepairHistory {
  private directory: string;
  constructor(directory = ".repolab/repositories") {
    this.directory = directory;
  }
  private path(id: string) {
    return join(this.directory, `clsx-repair-${z.uuid().parse(id)}.json`);
  }
  private async read(id: string) {
    const path = this.path(id);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 5_000_000)
      throw Error("Invalid repair evidence file");
    const record = JSON.parse(await readFile(path, "utf8"));
    if (
      record.format !== "repolab-clsx-development-pilot/v1" ||
      record.id !== id ||
      record.profile !== "clsx-object-push" ||
      !Array.isArray(record.candidates)
    )
      throw Error("Invalid repair record");
    return record;
  }
  async get(id: string) {
    try {
      return repairSummary(await this.read(id), providerSecrets());
    } catch {
      return null;
    }
  }
  async artifacts(id: string) {
    const record = await this.read(id);
    const decisionPath = this.path(id) + ".decision.json";
    const info = await lstat(decisionPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 50000)
      throw Error("Invalid saved decision");
    return exportClsxPack(record, await readFile(decisionPath, "utf8"));
  }
  async list() {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch {
      return [];
    }
    const records = await Promise.all(
      files
        .filter((f) => /^clsx-repair-[0-9a-f-]{36}\.json$/.test(f))
        .map((f) => this.get(f.slice(12, -5))),
    );
    return records
      .filter((r) => r !== null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  }
  /** Preserve interrupted attempts; never rerun them or clear their ledger/lease. */
  async recover() {
    for (const review of await this.list()) {
      if (!repairActiveStatuses.has(review.status)) continue;
      const record = await this.read(review.id);
      if (
        record.entrypoint !== "api" ||
        !Number.isInteger(record.controllerPid)
      )
        continue;
      try {
        process.kill(record.controllerPid, 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
      }
      record.failedStage = record.status;
      record.status = "INCONCLUSIVE";
      record.success = false;
      record.completedAt = new Date().toISOString();
      record.error =
        "Service restarted before completion; no automatic retry. Reconcile the lease, operations and ledger explicitly.";
      const path = this.path(review.id),
        temp = path + "." + randomUUID();
      await writeFile(temp, JSON.stringify(record, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, path);
    }
  }
}

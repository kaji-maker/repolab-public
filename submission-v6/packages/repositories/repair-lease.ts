import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Exclusive across CLI/API processes. A stale lease requires explicit recovery. */
export async function acquireRepairLease(directory: string, runId: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "clsx-repair.lock");
  const bytes = JSON.stringify({ runId, pid: process.pid });
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
  } finally {
    await file.close();
  }
  return async () => {
    if ((await readFile(path, "utf8")) !== bytes)
      throw Error("Repair lease changed; explicit recovery required");
    await unlink(path);
  };
}

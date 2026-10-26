import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** A durable mutex for read-only recovery. SQL makes dead-owner takeover atomic across processes. */
export async function acquireRecoveryLease(path: string) {
  if (existsSync(path)) {
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink())
      throw Error("Invalid recovery mutex");
  }
  const nonce = randomUUID(),
    db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  try {
    db.exec(
      "PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS recovery_mutex (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, nonce TEXT NOT NULL)",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      const owner = db
        .prepare("SELECT pid, nonce FROM recovery_mutex WHERE id=1")
        .get();
      if (owner) {
        if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) < 1)
          throw Error("Invalid recovery mutex owner");
        let stopped = false;
        try {
          process.kill(Number(owner.pid), 0);
        } catch (e) {
          stopped = (e as NodeJS.ErrnoException).code === "ESRCH";
        }
        if (!stopped)
          throw Error("Recovery already active or owner liveness unknown");
      }
      db.prepare("INSERT OR REPLACE INTO recovery_mutex VALUES (1,?,?)").run(
        process.pid,
        nonce,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } finally {
    db.close();
  }
  return async () => {
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout=3000");
      const result = db
        .prepare("DELETE FROM recovery_mutex WHERE id=1 AND pid=? AND nonce=?")
        .run(process.pid, nonce);
      if (Number(result.changes) !== 1)
        throw Error("Recovery mutex ownership changed");
    } finally {
      db.close();
    }
  };
}

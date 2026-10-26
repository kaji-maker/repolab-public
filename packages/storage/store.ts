import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Run } from "../contracts/index.ts";
import { BudgetError } from "../providers/nebius.ts";
import { ProviderDiagnosticSchema } from "../providers/diagnostics.ts";
import {
  validateReconciliation,
  AttemptContextSchema,
} from "./reconciliation.ts";

// Private local state. Hosted storage will use a separate adapter.
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS charges (id TEXT PRIMARY KEY, account TEXT NOT NULL, reserved REAL NOT NULL,
        actual REAL, state TEXT NOT NULL CHECK(state IN ('pending','settled','uncertain')));
      CREATE TABLE IF NOT EXISTS charge_diagnostics (charge_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS charge_reconciliations (charge_id TEXT PRIMARY KEY, provider_record TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS diagnostics_no_update BEFORE UPDATE ON charge_diagnostics BEGIN SELECT RAISE(ABORT,'Diagnostics are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS diagnostics_no_delete BEFORE DELETE ON charge_diagnostics BEGIN SELECT RAISE(ABORT,'Diagnostics are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS reconciliations_no_update BEFORE UPDATE ON charge_reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliations are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS reconciliations_no_delete BEFORE DELETE ON charge_reconciliations BEGIN SELECT RAISE(ABORT,'Reconciliations are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS charges_no_delete BEFORE DELETE ON charges BEGIN SELECT RAISE(ABORT,'Reservations cannot be deleted'); END;
      CREATE TRIGGER IF NOT EXISTS charges_identity_fixed BEFORE UPDATE OF id,account,reserved ON charges BEGIN SELECT RAISE(ABORT,'Reservation identity is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS settled_charge_fixed BEFORE UPDATE ON charges WHEN OLD.state='settled' BEGIN SELECT RAISE(ABORT,'Settled charges are immutable'); END;`);
  }
  save(run: Run) {
    this.db
      .prepare(
        "INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(run.id, JSON.stringify(run));
  }
  get(id: string): Run | null {
    const row = this.db.prepare("SELECT payload FROM runs WHERE id=?").get(id);
    return row ? JSON.parse(String(row.payload)) : null;
  }
  list(): Run[] {
    return this.db
      .prepare("SELECT payload FROM runs ORDER BY rowid DESC LIMIT 30")
      .all()
      .map((row) => JSON.parse(String(row.payload)));
  }
  reserve(account: string, amount: number, limit: number): string {
    if (![amount, limit].every((n) => Number.isFinite(n) && n > 0))
      throw new BudgetError("Invalid budget reservation");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const unknown = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM charges WHERE state != 'settled'",
        )
        .get()!;
      if (Number(unknown.count))
        throw new BudgetError(
          "A previous charge is pending or uncertain; reconcile provider usage before more inference",
        );
      const total = this.totalSpent();
      if (total + amount > limit)
        throw new BudgetError(
          "Development inference budget exhausted; judging reserve is protected",
        );
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO charges VALUES (?,?,?,NULL,'pending')")
        .run(id, account, amount);
      this.db.exec("COMMIT");
      return id;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  settle(id: string, actual: number | null) {
    if (actual !== null && (!Number.isFinite(actual) || actual < 0))
      throw new BudgetError("Invalid usage charge");
    const result = this.db
      .prepare(
        "UPDATE charges SET actual=?, state=? WHERE id=? AND state='pending'",
      )
      .run(actual, actual === null ? "uncertain" : "settled", id);
    if (result.changes !== 1)
      throw new BudgetError(
        "Charge reservation was already finalized or is missing",
      );
  }
  spent(account: string): number {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN state='settled' THEN actual ELSE reserved END),0) AS amount FROM charges WHERE account=?",
        )
        .get(account)!.amount,
    );
  }
  hasUnsettledCharges(): boolean {
    return (
      Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM charges WHERE state != 'settled'",
          )
          .get()!.count,
      ) > 0
    );
  }
  totalSpent(): number {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN state='settled' THEN actual ELSE reserved END),0) AS amount FROM charges",
        )
        .get()!.amount,
    );
  }
  recordDiagnostic(id: string, input: unknown) {
    const value = ProviderDiagnosticSchema.parse(input);
    const charge = this.db
      .prepare("SELECT state FROM charges WHERE id=?")
      .get(id);
    if (
      !charge ||
      value.reservationId !== id ||
      charge.state !== value.accounting
    )
      throw new BudgetError(
        "Diagnostic does not match the finalized reservation",
      );
    this.db
      .prepare("INSERT INTO charge_diagnostics VALUES (?,?)")
      .run(id, JSON.stringify(value));
  }
  reconcile(input: unknown, evidence: Uint8Array, context: unknown) {
    const receipt = validateReconciliation(input, evidence, context);
    const attempt = AttemptContextSchema.parse(context);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const before = this.db
        .prepare("SELECT id,reserved,actual,state FROM charges WHERE id=?")
        .get(receipt.reservationId);
      if (!before || before.state !== "uncertain")
        throw new BudgetError(
          "Only an uncertain reservation can be reconciled",
        );
      const row = this.db
        .prepare("SELECT payload FROM charge_diagnostics WHERE charge_id=?")
        .get(receipt.reservationId);
      if (row) {
        const diagnostic = ProviderDiagnosticSchema.parse(
          JSON.parse(String(row.payload)),
        );
        if (
          diagnostic.model !== receipt.model ||
          (diagnostic.requestId !== null &&
            diagnostic.requestId !== receipt.requestId)
        )
          throw new BudgetError(
            "Receipt contradicts the retained provider diagnostic",
          );
      }
      const record = {
        format: "repolab-charge-reconciliation-event/v1",
        recordedAt: new Date().toISOString(),
        before,
        after: { state: "settled", actual: receipt.actualUsd },
        receipt,
        attempt,
        authority:
          receipt.source === "operator_confirmation"
            ? "operator-attested zero charge; not independently provider-verified"
            : "operator-reviewed provider evidence; hash verifies bytes, not issuer",
      };
      this.db
        .prepare("INSERT INTO charge_reconciliations VALUES (?,?,?)")
        .run(
          receipt.reservationId,
          receipt.providerRecordId,
          JSON.stringify(record),
        );
      const updated = this.db
        .prepare(
          "UPDATE charges SET actual=?,state='settled' WHERE id=? AND state='uncertain'",
        )
        .run(receipt.actualUsd, receipt.reservationId);
      if (updated.changes !== 1)
        throw new BudgetError("Reservation changed during reconciliation");
      this.db.exec("COMMIT");
      return record;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}

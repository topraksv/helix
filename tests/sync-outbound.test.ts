import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertOutboundRow, prepareOutboundBatch } from "../src/sync/outbound-validation";
import { SYNCED_TABLES, type SyncedTableName } from "../src/db/schema";

const base = {
  id: "0198b3f5-0e39-7b76-8f95-f7679d6b72b1",
  user_id: "0198b3f5-0e39-7b76-8f95-f7679d6b72b2",
  definition: JSON.stringify({ op: "income_minus_expense" }),
};
const policy = {
  allowedColumns: new Set(Object.keys(base)),
  booleanColumns: new Set<string>(),
};

describe("outbound row conversion", () => {
  it("parses and validates computed-column JSON", () => {
    expect(convertOutboundRow("computed_columns", base, policy)).toEqual({
      ok: true,
      row: { ...base, definition: { op: "income_minus_expense" } },
    });
  });

  it("quarantines corrupt inner JSON and unknown columns", () => {
    expect(convertOutboundRow("computed_columns", { ...base, definition: "{" }, policy)).toEqual({ ok: false, reason: "invalid_row" });
    expect(convertOutboundRow("computed_columns", { ...base, injected: true }, policy)).toEqual({ ok: false, reason: "invalid_row" });
  });

  it("rejects non-finite numeric payloads before PostgREST", () => {
    const numericPolicy = {
      allowedColumns: new Set(["id", "user_id", "fx_rate"]),
      booleanColumns: new Set<string>(),
    };
    expect(convertOutboundRow("transactions", { id: base.id, user_id: base.user_id, fx_rate: "NaN" }, numericPolicy)).toEqual({ ok: false, reason: "invalid_row" });
    expect(convertOutboundRow("transactions", { id: base.id, user_id: base.user_id, fx_rate: "32.5" }, numericPolicy)).toEqual({
      ok: true,
      row: { id: base.id, user_id: base.user_id, fx_rate: 32.5 },
    });
  });

  it("quarantines unsupported currencies before PostgREST", () => {
    const currencyPolicy = {
      allowedColumns: new Set(["id", "user_id", "currency"]),
      booleanColumns: new Set<string>(),
    };
    expect(convertOutboundRow("transactions", { id: base.id, user_id: base.user_id, currency: "NOT-A-CURRENCY" }, currencyPolicy))
      .toEqual({ ok: false, reason: "invalid_row" });
    expect(convertOutboundRow("transactions", { id: base.id, user_id: base.user_id, currency: "USD" }, currencyPolicy))
      .toEqual({ ok: true, row: { id: base.id, user_id: base.user_id, currency: "USD" } });
  });

  it("quarantines contradictory investment quotes before PostgREST", () => {
    const investment = {
      id: base.id,
      user_id: base.user_id,
      kind: "buy",
      operation_date: "2026-07-03",
      quantity: "2",
      unit_price_minor: 10_000,
      total_minor: 20_000,
      cost_basis_minor: 0,
      realized_profit_loss_minor: 0,
    };
    const investmentPolicy = {
      allowedColumns: new Set(Object.keys(investment)),
      booleanColumns: new Set<string>(),
    };
    expect(convertOutboundRow("investment_operations", investment, investmentPolicy)).toEqual({
      ok: true,
      row: investment,
    });
    expect(convertOutboundRow(
      "investment_operations",
      { ...investment, total_minor: 90_000 },
      investmentPolicy,
    )).toEqual({ ok: false, reason: "invalid_row" });
  });

  it("quarantines impossible or future investment dates before PostgREST", () => {
    const profile = {
      id: base.id,
      user_id: base.user_id,
      started_on: "2026-07-01",
      opening_cash_minor: 1_000,
    };
    const profilePolicy = {
      allowedColumns: new Set(Object.keys(profile)),
      booleanColumns: new Set<string>(),
    };
    expect(convertOutboundRow("investment_profiles", { ...profile, started_on: "2026-02-31" }, profilePolicy))
      .toEqual({ ok: false, reason: "invalid_row" });
    expect(convertOutboundRow("investment_profiles", { ...profile, started_on: "2099-01-01" }, profilePolicy))
      .toEqual({ ok: false, reason: "invalid_row" });

    const operation = {
      id: base.id,
      user_id: base.user_id,
      kind: "buy",
      operation_date: "2026-07-03",
      quantity: "2",
      unit_price_minor: 10_000,
      total_minor: 20_000,
      cost_basis_minor: 0,
      realized_profit_loss_minor: 0,
    };
    const operationPolicy = {
      allowedColumns: new Set(Object.keys(operation)),
      booleanColumns: new Set<string>(),
    };
    expect(convertOutboundRow("investment_operations", { ...operation, operation_date: "2026-02-31" }, operationPolicy))
      .toEqual({ ok: false, reason: "invalid_row" });
    expect(convertOutboundRow("investment_operations", { ...operation, operation_date: "2099-01-01" }, operationPolicy))
      .toEqual({ ok: false, reason: "invalid_row" });
  });

  it("pushes an offline investment journal in deterministic replay order", () => {
    const row = (id: string, kind: string, date: string) => ({
      id,
      user_id: base.user_id,
      kind,
      operation_date: date,
      quantity: "1",
      unit_price_minor: 10_000,
      total_minor: 10_000,
      cost_basis_minor: kind === "sell" ? 10_000 : 0,
      realized_profit_loss_minor: 0,
    });
    const events = [
      row("sale", "sell", "2026-07-03"),
      row("buy", "buy", "2026-07-03"),
      row("existing", "existing", "2026-07-03"),
    ].map((payload, index) => ({
      id: index + 1,
      row_id: payload.id,
      payload: JSON.stringify(payload),
    }));
    const batch = prepareOutboundBatch("investment_operations", events, base.user_id, {
      allowedColumns: new Set(Object.keys(row("x", "buy", "2026-07-01"))),
      booleanColumns: new Set<string>(),
    });

    expect(batch.rows.map((candidate) => candidate.id)).toEqual(["existing", "buy", "sale"]);
  });

  it("keeps a healthy row pushable when another row is quarantined", () => {
    const validId = "0198b3f5-0e39-7b76-8f95-f7679d6b72b3";
    const batch = prepareOutboundBatch(
      "computed_columns",
      [
        { id: 1, row_id: base.id, payload: JSON.stringify({ ...base, definition: "{" }) },
        { id: 2, row_id: validId, payload: JSON.stringify({ ...base, id: validId }) },
      ],
      base.user_id,
      policy,
    );

    expect(batch.rows).toHaveLength(1);
    expect(batch.pushedEvents.map((event) => event.row_id)).toEqual([validId]);
    expect(batch.rejected).toEqual([
      expect.objectContaining({ row_id: base.id, reason: "invalid_row" }),
    ]);
  });
});

/**
 * Push order is a real constraint, not a comment.
 *
 * `pushOutbox` uploads one table at a time in `SYNCED_TABLES` declaration
 * order, and Postgres enforces composite `(user_id, id)` foreign keys. A table
 * appended in the wrong position therefore does not fail a type check or a
 * local write — it fails in production, on the first push after a fresh
 * sign-in, with rows the client believes it has sent. The order is derived from
 * the migrations that actually define the constraints rather than restated by
 * hand, so adding a relation is enough to make this test speak.
 */
describe("push order satisfies the server's foreign keys", () => {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
  const CREATE_TABLE = /create table\s+(?:if not exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/g;
  const ALTER_TABLE = /alter table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/g;
  const REFERENCES = /references\s+(?:public\.)?"?(\w+)"?/g;

  function foreignKeys(): { child: string; parent: string }[] {
    const edges = new Map<string, { child: string; parent: string }>();
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(migrationsDir, file), "utf8").toLowerCase();
      for (const pattern of [CREATE_TABLE, ALTER_TABLE]) {
        pattern.lastIndex = 0;
        for (const statement of sql.matchAll(pattern)) {
          const child = statement[1]!;
          REFERENCES.lastIndex = 0;
          for (const reference of statement[2]!.matchAll(REFERENCES)) {
            edges.set(`${child}->${reference[1]}`, { child, parent: reference[1]! });
          }
        }
      }
    }
    return [...edges.values()];
  }

  it("declares every parent table before the tables that reference it", () => {
    const order = Object.keys(SYNCED_TABLES) as SyncedTableName[];
    const position = new Map(order.map((table, index) => [table as string, index]));
    const relations = foreignKeys().filter(
      (edge) => position.has(edge.child) && position.has(edge.parent),
    );
    // A parser that quietly stops matching would make this test vacuous.
    expect(relations.length).toBeGreaterThanOrEqual(15);
    for (const { child, parent } of relations) {
      expect(
        position.get(parent)!,
        `${parent} must be pushed before ${child}`,
      ).toBeLessThan(position.get(child)!);
    }
  });
});

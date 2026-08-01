import { parseDefinition } from "../domain/computed-columns";
import { isISODate, todayISO } from "../domain/dates";
import { isSupportedCurrency } from "../domain/fx-provider";
import { resolveInvestmentQuote } from "../domain/investments";
import type { SyncedTableName } from "../db/schema";
import {
  classifyOutboxBatch,
  type OutboxEvent,
  type ParsedOutboxEvent,
  type RejectedOutboxEvent,
} from "./merge-policy";

type OutboundConversion =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: "invalid_row" };

interface OutboundPolicy {
  allowedColumns: ReadonlySet<string>;
  booleanColumns: ReadonlySet<string>;
}

function finiteNumeric(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Validate and coerce one SQLite outbox snapshot before it can enter a
 * PostgREST batch. A single corrupt inner JSON/numeric field must be
 * quarantinable without making every later event retry forever.
 */
export function convertOutboundRow(
  table: SyncedTableName,
  row: Record<string, unknown>,
  policy: OutboundPolicy,
): OutboundConversion {
  if (Object.keys(row).some((column) => !policy.allowedColumns.has(column))) {
    return { ok: false, reason: "invalid_row" };
  }

  const out: Record<string, unknown> = { ...row };
  if ("currency" in out && !isSupportedCurrency(out.currency)) return { ok: false, reason: "invalid_row" };
  for (const column of policy.booleanColumns) {
    if (column in out && out[column] !== null) {
      if (![true, false, 0, 1].includes(out[column] as boolean | number)) {
        return { ok: false, reason: "invalid_row" };
      }
      out[column] = Boolean(out[column]);
    }
  }

  try {
    if (table === "computed_columns") {
      const raw = out.definition;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      parseDefinition(parsed);
      out.definition = parsed;
    }
  } catch {
    return { ok: false, reason: "invalid_row" };
  }

  if (table === "transactions" && out.fx_rate != null) {
    const rate = finiteNumeric(out.fx_rate);
    if (rate == null || rate <= 0) return { ok: false, reason: "invalid_row" };
    out.fx_rate = rate;
  }
  if (table === "fx_rates") {
    const rate = finiteNumeric(out.rate_try);
    if (rate == null || rate <= 0) return { ok: false, reason: "invalid_row" };
    out.rate_try = rate;
  }
  if (table === "investment_profiles") {
    if (
      !Number.isSafeInteger(out.opening_cash_minor)
      || Number(out.opening_cash_minor) < 0
      || typeof out.started_on !== "string"
      || !isISODate(out.started_on)
      || out.started_on > todayISO()
    ) return { ok: false, reason: "invalid_row" };
  }
  if (table === "investment_operations") {
    const positiveMoney = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
    if (
      !positiveMoney(out.total_minor)
      || !Number.isSafeInteger(out.cost_basis_minor)
      || Number(out.cost_basis_minor) < 0
      || !Number.isSafeInteger(out.realized_profit_loss_minor)
      || typeof out.operation_date !== "string"
      || !isISODate(out.operation_date)
      || out.operation_date > todayISO()
    ) return { ok: false, reason: "invalid_row" };
    if (out.quantity == null) {
      if (out.kind !== "contribution" || out.unit_price_minor != null) {
        return { ok: false, reason: "invalid_row" };
      }
    } else if (
      typeof out.quantity !== "string"
      || !/^[0-9]+(\.[0-9]{1,8})?$/.test(out.quantity)
      || !positiveMoney(out.unit_price_minor)
    ) return { ok: false, reason: "invalid_row" };
    if (out.quantity != null) {
      try {
        resolveInvestmentQuote({
          quantity: out.quantity as string,
          unitPriceMinor: Number(out.unit_price_minor),
          totalMinor: Number(out.total_minor),
        });
      } catch {
        return { ok: false, reason: "invalid_row" };
      }
    }
  }

  return { ok: true, row: out };
}

export function prepareOutboundBatch(
  table: SyncedTableName,
  events: OutboxEvent[],
  userId: string,
  policy: OutboundPolicy,
): {
  rows: Record<string, unknown>[];
  pushedEvents: ParsedOutboxEvent[];
  rejected: RejectedOutboxEvent[];
} {
  const classified = classifyOutboxBatch(events, userId);
  const rejected = [...classified.rejected];
  const pushedEvents: ParsedOutboxEvent[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const event of classified.latestByRow.values()) {
    const converted = convertOutboundRow(table, event.row, policy);
    if (!converted.ok) {
      rejected.push({ ...event, reason: converted.reason });
      continue;
    }
    pushedEvents.push(event);
    rows.push(converted.row);
  }
  if (table === "investment_operations") {
    const priority = (kind: unknown) =>
      kind === "existing" ? 0 : kind === "sell" ? 2 : 1;
    rows.sort((a, b) =>
      String(a.operation_date).localeCompare(String(b.operation_date))
      || priority(a.kind) - priority(b.kind)
      || String(a.id).localeCompare(String(b.id)),
    );
  }
  return { rows, pushedEvents, rejected };
}

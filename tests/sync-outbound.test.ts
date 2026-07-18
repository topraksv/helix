import { describe, expect, it } from "vitest";
import { convertOutboundRow, prepareOutboundBatch } from "../src/sync/outbound-validation";

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

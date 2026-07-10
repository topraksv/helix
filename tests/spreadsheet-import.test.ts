import { describe, expect, it } from "vitest";
import {
  parseFormulaLiterals,
  parseMonthLabel,
  parseSheet,
  parseSheetAmount,
  parseWorkbook,
  planImportCell,
  type CellData,
  type RawCell,
} from "../src/services/spreadsheet-import";
import * as XLSX from "xlsx";

// --- helpers ---------------------------------------------------------------
const c = (v: unknown, opts?: { f?: string; note?: string }): RawCell => ({
  v,
  f: opts?.f,
  c: opts?.note ? [{ t: opts.note }] : undefined,
});
const row = (...vals: (RawCell | unknown)[]): RawCell[] =>
  vals.map((x) => (x && typeof x === "object" && "v" in (x as object) ? (x as RawCell) : { v: x }));

const asSheet = (r: ReturnType<typeof parseSheet>) => {
  if (!("year" in r)) throw new Error(`expected parsed sheet, got: ${r.reason}`);
  return r;
};

// A vertical 2026-style block: months down column A, balance columns present.
const sheet2026 = (): RawCell[][] => [
  row("", "KK Taksitli Harcamalar", "Fatura ve Abonelikler", "Ek Gelirler", "Ay Başında Eldeki Para", "Güncel Bakiye"),
  row("2026 Ocak", 18822.92, 4424.03, 20480, 2004, 61825.28),
  row("2026 Şubat", 14050.48, 5907.27, 31091, 61825.28, 3500),
  row("2026 Mart", 19310.87, 5703.47, 16900, 3500, 1519.3),
];

describe("parseMonthLabel", () => {
  it("reads TR names, numeric and Date forms in either order", () => {
    expect(parseMonthLabel("Ocak 2025")).toBe("2025-01");
    expect(parseMonthLabel("2026 Aralık")).toBe("2026-12");
    expect(parseMonthLabel("Oca'25")).toBe("2025-01");
    expect(parseMonthLabel("2025-03")).toBe("2025-03");
    expect(parseMonthLabel("01.2024")).toBe("2024-01");
    expect(parseMonthLabel(new Date(2025, 4, 15))).toBe("2025-05");
    expect(parseMonthLabel("Güncel Bakiye")).toBeNull();
    expect(parseMonthLabel("")).toBeNull();
  });
});

describe("parseSheetAmount", () => {
  it("parses numbers and TR/EN text incl. negatives", () => {
    expect(parseSheetAmount(18822.92)).toBe(1882292);
    expect(parseSheetAmount("1.234,56")).toBe(123456);
    expect(parseSheetAmount("12.000")).toBe(1200000);
    expect(parseSheetAmount("-₺43.754,43")).toBe(-4375443);
    expect(parseSheetAmount("-")).toBeNull();
    expect(parseSheetAmount(null)).toBeNull();
  });
});

describe("parseFormulaLiterals", () => {
  it("splits pure literal sums, rejects references and functions", () => {
    expect(parseFormulaLiterals("500+300+700")).toEqual([50000, 30000, 70000]);
    expect(parseFormulaLiterals("=1200+8480")).toEqual([120000, 848000]);
    expect(parseFormulaLiterals("1000-250")).toEqual([100000, -25000]);
    expect(parseFormulaLiterals("6082.59+15840.6-C5")).toBeNull(); // cell ref
    expect(parseFormulaLiterals("SUM(A1:A3)")).toBeNull();
    expect(parseFormulaLiterals("1500")).toBeNull(); // single term, nothing to split
  });
});

describe("parseSheet — vertical block", () => {
  it("detects months, keeps item columns, skips balance columns", () => {
    const s = asSheet(parseSheet(sheet2026(), "Gelir-Gider 2026"));
    expect(s.year).toBe(2026);
    expect(s.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.columns.map((col) => col.label)).toEqual(["KK Taksitli Harcamalar", "Fatura ve Abonelikler", "Ek Gelirler"]);
    expect(s.columns[2].kindGuess).toBe("income"); // Ek Gelirler
    expect(s.skippedColumns).toEqual(["Ay Başında Eldeki Para", "Güncel Bakiye"]);
    expect(s.cells[0][0].valueMinor).toBe(1882292);
  });

  it("captures the earliest month's opening balance", () => {
    const s = asSheet(parseSheet(sheet2026(), "2026"));
    expect(s.openingBalance).toEqual({ month: "2026-01", minor: 200400 });
  });
});

describe("parseSheet — contiguous block", () => {
  it("stops at a blank row and ignores a trailing summary table", () => {
    const grid = [
      ...sheet2026(),
      row(), // blank separator
      row("Ay", "Maximum Gold", "WorldEko"),
      row("2026 Nisan", 11801.43, 4202.74),
      row("2026 Mayıs", 13897.22, 4202.74),
    ];
    const s = asSheet(parseSheet(grid, "2026"));
    expect(s.months).toEqual(["2026-01", "2026-02", "2026-03"]); // summary table excluded
    expect(s.columns.some((col) => col.label === "Maximum Gold")).toBe(false);
  });
});

describe("parseSheet — horizontal layout", () => {
  it("transposes months-as-columns into months-as-rows", () => {
    const grid = [
      row("", "Ocak 2025", "Şubat 2025"),
      row("KK Taksitli Harcamalar", 13501, 13235.2),
      row("Maaş", 82732, 83031.03),
    ];
    const s = asSheet(parseSheet(grid, "Gelir-Gider 2025"));
    expect(s.months).toEqual(["2025-01", "2025-02"]);
    expect(s.columns.map((col) => col.label)).toEqual(["KK Taksitli Harcamalar", "Maaş"]);
    expect(s.cells[0][0].valueMinor).toBe(1350100);
  });
});

describe("parseSheet — formula + comment breakdown", () => {
  it("splits a literal formula and pairs comment labels", () => {
    const grid = [
      row("", "Ek Gelirler"),
      row("2026 Ocak", c(20480, { f: "12000+8480", note: "Ocak Kira Geliri 12.000\nSigorta Gözlük Parası 8.480" })),
    ];
    const cell = asSheet(parseSheet(grid, "2026")).cells[0][0];
    expect(cell.valueMinor).toBe(2048000);
    expect(cell.formulaParts).toEqual([1200000, 848000]);
    expect(cell.commentParts).toEqual([
      { label: "Ocak Kira Geliri", amountMinor: 1200000 },
      { label: "Sigorta Gözlük Parası", amountMinor: 848000 },
    ]);
  });

  it("keeps a plain comment as free text when it has no amounts", () => {
    const grid = [
      row("", "Ek Giderler"),
      row("2026 Ocak", c(2216.76, { note: "beklenmedik masraf" })),
    ];
    const cell = asSheet(parseSheet(grid, "2026")).cells[0][0];
    expect(cell.comment).toBe("beklenmedik masraf");
    expect(cell.commentParts).toEqual([{ label: "beklenmedik masraf", amountMinor: null }]);
  });
});

describe("parseSheet — negatives", () => {
  it("keeps negative cell values", () => {
    const grid = [row("", "Güncel Fark"), row("2026 Temmuz", -43754.43)];
    const s = asSheet(parseSheet(grid, "2026"));
    expect(s.cells[0][0].valueMinor).toBe(-4375443);
  });
});

describe("parseSheet — failures", () => {
  it("reports sheets with no month axis", () => {
    const r = parseSheet([row("A", "B"), row("x", 1)], "Yatırım");
    expect("reason" in r).toBe(true);
  });
});

describe("planImportCell", () => {
  const cd = (over: Partial<CellData>): CellData => ({
    valueMinor: null,
    formulaParts: null,
    comment: null,
    commentParts: null,
    ...over,
  });

  it("skips empty and zero cells", () => {
    expect(planImportCell(cd({ valueMinor: null }))).toBeNull();
    expect(planImportCell(cd({ valueMinor: 0 }))).toBeNull();
  });

  it("splits a literal formula and labels parts from the comment", () => {
    const plan = planImportCell(
      cd({
        valueMinor: 2048000,
        formulaParts: [1200000, 848000],
        comment: "Kira 12.000\nGözlük 8.480",
        commentParts: [
          { label: "Kira", amountMinor: 1200000 },
          { label: "Gözlük", amountMinor: 848000 },
        ],
      }),
    );
    expect(plan).toEqual({
      items: [
        { amountMinor: 1200000, note: "Kira", isAggregate: false },
        { amountMinor: 848000, note: "Gözlük", isAggregate: false },
      ],
      cellNote: null,
    });
  });

  it("itemizes a formula without a comment, keeping any comment as a note", () => {
    const plan = planImportCell(cd({ valueMinor: 120000, formulaParts: [50000, 70000] }));
    expect(plan!.items.map((i) => i.amountMinor)).toEqual([50000, 70000]);
    expect(plan!.items.every((i) => i.note === null && !i.isAggregate)).toBe(true);
  });

  it("itemizes labeled comment amounts that reconcile to the value", () => {
    const plan = planImportCell(
      cd({ valueMinor: 30000, commentParts: [{ label: "A", amountMinor: 10000 }, { label: "B", amountMinor: 20000 }] }),
    );
    expect(plan!.items).toEqual([
      { amountMinor: 10000, note: "A", isAggregate: false },
      { amountMinor: 20000, note: "B", isAggregate: false },
    ]);
  });

  it("falls back to one aggregate row and parks a plain comment on the cell", () => {
    const plan = planImportCell(cd({ valueMinor: 221676, comment: "beklenmedik masraf" }));
    expect(plan).toEqual({
      items: [{ amountMinor: 221676, note: null, isAggregate: true }],
      cellNote: "beklenmedik masraf",
    });
  });
});

describe("parseWorkbook — multi-sheet, different columns per year", () => {
  it("parses each budget sheet and reports unparseable ones", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["", "KK Taksitli Harcamalar", "Fatura ve Abonelikler", "Maaş"],
        ["2026 Ocak", 18822.92, 4424.03, 136167],
      ]),
      "Gelir-Gider 2026",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Portföy", "Adet", "Değer"],
        ["Altın", 10, 50000],
      ]),
      "Yatırım",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["", "İnternet Abonelikleri", "Dijital Abonelikler", "Maaş"],
        ["2025 Ocak", 2128.1, 329.89, 82732],
      ]),
      "Gelir-Gider 2025",
    );

    const parsed = parseWorkbook(wb);
    expect(parsed.sheets.map((s) => s.sheetName)).toEqual(["Gelir-Gider 2026", "Gelir-Gider 2025"]);
    expect(parsed.unparsed.map((s) => s.sheetName)).toEqual(["Yatırım"]);

    const y2026 = parsed.sheets.find((s) => s.year === 2026)!;
    const y2025 = parsed.sheets.find((s) => s.year === 2025)!;
    // 2026 has no "İnternet Abonelikleri"; 2025 does — columns differ per year.
    expect(y2026.columns.some((col) => col.label === "İnternet Abonelikleri")).toBe(false);
    expect(y2025.columns.map((col) => col.label)).toContain("İnternet Abonelikleri");
  });
});

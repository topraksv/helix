import { describe, expect, it } from "vitest";
import {
  collectInstallmentPlans,
  extractDueDay,
  isInstallmentCell,
  parseFormulaLiterals,
  parseInstallmentComment,
  parseMonthLabel,
  parseSheet,
  parseSheetAmount,
  parseWorkbook,
  planImportCell,
  type CellData,
  type ParsedSheet,
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
    expect(parseMonthLabel("2025-13")).toBeNull();
    expect(parseMonthLabel("00.2025")).toBeNull();
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
    expect(parseSheetAmount(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(parseSheetAmount("1.000.000.000.000")).toBeNull(); // 1 trilyon üstü reddedilir
    expect(parseSheetAmount("1.000.000.000")).toBe(100_000_000_000); // 1 milyar TL artık kabul
    expect(parseSheetAmount("999.999.999,99")).toBe(99_999_999_999);
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
      row("Ay", "Kart A", "Kart B"),
      row("2026 Nisan", 11801.43, 4202.74),
      row("2026 Mayıs", 13897.22, 4202.74),
    ];
    const s = asSheet(parseSheet(grid, "2026"));
    expect(s.months).toEqual(["2026-01", "2026-02", "2026-03"]); // summary table excluded
    expect(s.columns.some((col) => col.label === "Kart A")).toBe(false);
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

// --- installment comment parsing (item 8) ----------------------------------
// Fictional template data — mirrors the comment SHAPE only, no real records.
describe("parseInstallmentComment", () => {
  it("splits a ═-banner card comment into per-item installments", () => {
    const comment = [
      "══════ Kart A ══════",
      "Robot Süpürge           2.777,67  3/9",
      "Spor Ayakkabı              828,36   1/3",
      "Gözlük                   1.766,67   1/6",
      "",
      "══════ Kart B ══════",
      "Lambader                   299,00   7/7",
      "Kışlık Mont              139,33   2/6",
      "",
      "══════ Kart C ══════",
      "Dizüstü Bilgisayar    16.000,00   3/3",
    ].join("\n");
    const notes = parseInstallmentComment(comment);
    expect(notes).toHaveLength(6);
    expect(notes[0]).toEqual({ card: "Kart A", name: "Robot Süpürge", monthlyMinor: 277767, paidNo: 3, total: 9 });
    expect(notes[4]).toEqual({ card: "Kart B", name: "Kışlık Mont", monthlyMinor: 13933, paidNo: 2, total: 6 });
    expect(notes[5]).toEqual({ card: "Kart C", name: "Dizüstü Bilgisayar", monthlyMinor: 1600000, paidNo: 3, total: 3 });
  });

  it("handles parenthesised counts and the dashed-banner (bank) style", () => {
    const comment = [
      "-------Banka X-----------",
      "Spor Mont              2.000,00   (5/9)",
      "Tişört                   192,50   (5/6)",
    ].join("\n");
    const notes = parseInstallmentComment(comment);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual({ card: "Banka X", name: "Spor Mont", monthlyMinor: 200000, paidNo: 5, total: 9 });
  });

  it("skips junk amounts, negatives, and non-installment lines", () => {
    const comment = [
      "══════ Kart A ══════",
      "Çeşitli   1324-66-81-172   1/6", // unparseable amount → skip
      "İade Çanta     -2.024,99   (2/2)", // negative → skip
      "Oyuncak               410,50   2/3", // valid
    ].join("\n");
    const notes = parseInstallmentComment(comment);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({ card: "Kart A", name: "Oyuncak", monthlyMinor: 41050, paidNo: 2, total: 3 });
  });

  it("returns nothing for a plain bill breakdown (no N/M lines)", () => {
    const comment = [
      "══════ Faturalar ══════",
      "Elektrik                                436,30",
      "Doğalgaz                           2.218,00",
      "  ├ Abonelik 1 (799,99)",
      "  └ Abonelik 2 (99,99)",
    ].join("\n");
    expect(parseInstallmentComment(comment)).toEqual([]);
  });

  it("strips the ℹ️ marker from an informational card banner", () => {
    const comment = ["══════ Aile Kartı ℹ️ ══════", "Spor Mont          2.000,00   (5/9)"].join("\n");
    expect(parseInstallmentComment(comment)[0].card).toBe("Aile Kartı");
  });
});

// --- due-day extraction from column headers (item 7) -----------------------
describe("extractDueDay", () => {
  it("pulls a trailing day off a bill column", () => {
    expect(extractDueDay("Elektrik 06")).toEqual({ label: "Elektrik", dueDay: 6 });
    expect(extractDueDay("Kira 11")).toEqual({ label: "Kira", dueDay: 11 });
    expect(extractDueDay("İnternet 22")).toEqual({ label: "İnternet", dueDay: 22 });
  });

  it("uses the later day of a range as the deadline", () => {
    expect(extractDueDay("KK Taksit 05-15")).toEqual({ label: "KK Taksit", dueDay: 15 });
    expect(extractDueDay("Youtube/Amazon/Spotify (15-20)")).toEqual({ label: "Youtube/Amazon/Spotify", dueDay: 20 });
  });

  it("leaves labels without a day (or an out-of-range number) untouched", () => {
    expect(extractDueDay("Ev Kredisi")).toEqual({ label: "Ev Kredisi", dueDay: null });
    expect(extractDueDay("Araba/ Ulaşım")).toEqual({ label: "Araba/ Ulaşım", dueDay: null });
    expect(extractDueDay("2024 Bütçe")).toEqual({ label: "2024 Bütçe", dueDay: null }); // 2024 > 31
  });
});

// --- installment plan collection across a workbook (item 8 wiring) ----------
// Fictional template data; asserts the dedup / start-month / merge rules that a
// real one-shot migration depends on.
const col = (label: string) => ({ label, kindGuess: "expense" as const, isInvestment: false, dueDay: null });
const cell = (comment: string | null): CellData => ({ valueMinor: 100, formulaParts: null, comment, commentParts: null });
/** One-taksit-column sheet: [month, comment] rows. */
const taksitSheet = (name: string, rows: [string, string | null][], label = "KK Taksitli Harcamalar"): ParsedSheet => ({
  sheetName: name,
  year: Number(rows[0][0].slice(0, 4)),
  months: rows.map((r) => r[0]),
  columns: [col(label)],
  cells: rows.map((r) => [cell(r[1])]),
  skippedColumns: [],
  openingBalance: null,
});

describe("collectInstallmentPlans", () => {
  it("dedupes a plan seen in every active month to ONE, with an invariant start", () => {
    const sheet = taksitSheet("2026", [
      ["2026-01", "══ Kart A ══\nRobot Süpürge  2.777,67  3/9"],
      ["2026-02", "══ Kart A ══\nRobot Süpürge  2.777,67  4/9"],
      ["2026-03", "══ Kart A ══\nRobot Süpürge  2.777,67  5/9"],
    ]);
    const plans = collectInstallmentPlans([sheet]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({
      card: "Kart A",
      name: "Robot Süpürge",
      monthlyMinor: 277767,
      total: 9,
      startMonth: "2025-11", // 2026-01 minus (3-1)
      columnLabel: "KK Taksitli Harcamalar",
    });
  });

  it("merges the same purchase tracked under a renamed card (first card wins)", () => {
    const older = taksitSheet("2025", [["2025-12", "-- Kart Eski --\nDizüstü  2.000,00  1/6"]]);
    const newer = taksitSheet("2026", [["2026-01", "══ Kart Yeni ══\nDizüstü  2.000,00  2/6"]]);
    // processed in workbook order → 2026 sheet first here
    const plans = collectInstallmentPlans([newer, older]);
    expect(plans).toHaveLength(1);
    expect(plans[0].card).toBe("Kart Yeni"); // first mention wins
    expect(plans[0].startMonth).toBe("2025-12");
  });

  it("keeps genuinely different purchases (name/amount/count/start) separate", () => {
    const sheet = taksitSheet("2026", [
      ["2026-01", "══ Kart A ══\nMobilya  500,00  1/3\nMobilya  900,00  1/3"], // same name, different amount
    ]);
    expect(collectInstallmentPlans([sheet])).toHaveLength(2);
  });

  it("excludes cards flagged informational", () => {
    const sheet = taksitSheet("2026", [
      ["2026-01", "══ Kart A ══\nÜrün  100,00  1/3\n══ Aile Kartı ══\nHediye  200,00  1/3"],
    ]);
    const plans = collectInstallmentPlans([sheet], { informationalCards: ["Aile Kartı"] });
    expect(plans).toHaveLength(1);
    expect(plans[0].card).toBe("Kart A");
  });

  it("skips excluded columns and non-selected years", () => {
    const sheet = taksitSheet("2026", [
      ["2025-06", "══ Kart A ══\nEski  100,00  1/3"],
      ["2026-06", "══ Kart A ══\nYeni  200,00  1/3"],
    ]);
    expect(collectInstallmentPlans([sheet], { excludedLabels: ["KK Taksitli Harcamalar"] })).toHaveLength(0);
    const only2026 = collectInstallmentPlans([sheet], { yearAllowed: (y) => y === 2026 });
    expect(only2026.map((p) => p.name)).toEqual(["Yeni"]);
  });

  it("ignores non-installment columns even if a comment looks similar", () => {
    const sheet: ParsedSheet = {
      ...taksitSheet("2026", [["2026-01", "══ Kart A ══\nFatura  100,00  1/3"]]),
      columns: [col("Faturalar")], // not a "…Taksitli…" column
    };
    expect(collectInstallmentPlans([sheet])).toHaveLength(0);
  });
});

describe("isInstallmentCell", () => {
  it("is true only for a taksit column whose comment has installment lines", () => {
    expect(isInstallmentCell("KK Taksitli Harcamalar", "══ Kart A ══\nÜrün  100,00  1/3")).toBe(true);
    expect(isInstallmentCell("Faturalar", "══ Kart A ══\nÜrün  100,00  1/3")).toBe(false); // wrong column
    expect(isInstallmentCell("KK Taksitli Harcamalar", "Elektrik 436,30")).toBe(false); // no N/M
    expect(isInstallmentCell("KK Taksitli Harcamalar", null)).toBe(false);
  });
});

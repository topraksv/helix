/**
 * How the Helix workbook's record sheets are written.
 *
 * The workbook has two halves and they are not the same kind of document.
 *
 * **Mali Tablo** is written as the import wizard's own month grid — months down
 * the first column, category names on the header row — because that is the one
 * shape the app can read back. It is built in `services/export-import.ts`
 * straight from a `GROUP BY` and needs no column table: a grid's columns are
 * the owner's own category names, not a schema.
 *
 * **Abonelikler** and **Yatırımlar** are records. The wizard parses neither —
 * a subscription is not a month grid — so they are written to be read by a
 * person and by Excel, and this file is their column table.
 *
 * That split is why there is no `read` here any more. There was one, and a
 * `readSheet` beside it, built for a flat transaction sheet that the importer
 * turned out to refuse; the round trip now goes through the wizard's grid
 * instead, and a two-way column table with nothing calling the second way was
 * a promise the tree could not keep.
 *
 * `.claude/rules/export-import-contract.md` states the standing rule: a new
 * user-facing field on a subscription or an investment is not finished until it
 * has a column here.
 */
import { neutralizeFormula } from "./workbook-format-guard";

export { neutralizeFormula, deneutralizeFormula } from "./workbook-format-guard";

/** Sheet names, in the language the file is read in. */
export const WORKBOOK_SHEETS = {
  /** Suffixed with the year: one sheet carries one year's grid. */
  ledger: "Mali Tablo",
  subscriptions: "Abonelikler",
  investments: "Yatırımlar",
} as const;

export type WorkbookSheetKey = keyof typeof WORKBOOK_SHEETS;

/**
 * A cell's value as the workbook carries it.
 *
 * Dates and money are written as TEXT in the app's own notation rather than as
 * Excel serial numbers and floats. A serial date is a number whose meaning
 * depends on the reader's locale and epoch, and a float is the wrong container
 * for money — the ledger is integer minor units everywhere else, and letting a
 * spreadsheet round-trip it through binary floating point is how ₺1.234,56
 * comes back as ₺1.234,5599999999999.
 */
export type WorkbookCell = string;

export interface WorkbookColumn<Row> {
  /** The heading a person sees. */
  header: string;
  /** How the value leaves the app. */
  write: (row: Row) => WorkbookCell;
  /**
   * What this column holds, in one line.
   *
   * Documentation rather than a string the app renders: `tests/workbook-format`
   * fails a column that carries none, so a field added here cannot arrive
   * undescribed, and the format is stated beside the code that implements it.
   */
  hint: string;
}

/* ----------------------------------------------------------------- shapes */

export interface SubscriptionRow {
  name: string;
  amountMinor: number;
  currency: string;
  amountMode: string;
  cycle: string;
  intervalMonths: number;
  billingDay: number;
  nextDueDate: string;
  trialEndDate: string;
  category: string;
  source: string;
  person: string;
  autoPay: boolean;
  isActive: boolean;
  websiteDomain: string;
  monthlyLoadMinor: number;
}

export interface InvestmentRow {
  product: string;
  assetType: string;
  marketCode: string;
  operationDate: string;
  kind: string;
  quantity: string;
  unitPriceMinor: number;
  totalMinor: number;
  note: string;
}

/* ------------------------------------------------------------------ cells */

/**
 * Money as text in the app's own notation, never as an Excel number.
 *
 * Thousands separators are omitted even though a reader would accept them: a
 * bare "1234,56" is unambiguous in every locale Excel might open the file in.
 */
export const writeMoney = (minor: number): string => (minor / 100).toFixed(2).replace(".", ",");

/** `GG.AA.YYYY`, because that is the form a Turkish spreadsheet is kept in. */
export const writeDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : "";
};

export const writeFlag = (value: boolean): string => (value ? "evet" : "");

/* ---------------------------------------------------------------- columns */

const money = <Row>(header: string, hint: string, get: (row: Row) => number): WorkbookColumn<Row> => ({
  header,
  hint,
  write: (row) => writeMoney(get(row)),
});

const date = <Row>(header: string, hint: string, get: (row: Row) => string): WorkbookColumn<Row> => ({
  header,
  hint,
  write: (row) => writeDate(get(row)),
});

/**
 * Free text, guarded against being read as a formula.
 *
 * A category called `=SUM(A1:A9)` is a spreadsheet's problem, not a ledger's,
 * and this file is opened in a spreadsheet.
 */
const text = <Row>(header: string, hint: string, get: (row: Row) => string): WorkbookColumn<Row> => ({
  header,
  hint,
  write: (row) => neutralizeFormula(get(row)),
});

const flag = <Row>(header: string, hint: string, get: (row: Row) => boolean): WorkbookColumn<Row> => ({
  header,
  hint,
  write: (row) => writeFlag(get(row)),
});

const whole = <Row>(header: string, hint: string, get: (row: Row) => number): WorkbookColumn<Row> => ({
  header,
  hint,
  write: (row) => String(get(row)),
});

/** A closed set written in the language the sheet is read in. */
const enumeration = <Row>(
  header: string,
  hint: string,
  get: (row: Row) => string,
  labels: Readonly<Record<string, string>>,
): WorkbookColumn<Row> => ({
  header,
  hint,
  write: (row) => labels[get(row)] ?? get(row),
});

export const AMOUNT_MODES = { fixed: "Sabit", variable: "Değişken" } as const;
export const SUBSCRIPTION_CYCLES = { monthly: "Aylık", yearly: "Yıllık", custom: "Özel" } as const;
export const ASSET_TYPES = {
  metal: "Metal",
  currency: "Döviz",
  equity: "Hisse",
  fund: "Fon",
  crypto: "Kripto",
  pension: "Emeklilik",
} as const;
export const OPERATION_KINDS = {
  existing: "Mevcut",
  buy: "Alış",
  sell: "Satış",
  contribution: "Katkı",
} as const;

export const SUBSCRIPTION_COLUMNS: WorkbookColumn<SubscriptionRow>[] = [
  text("Abonelik", "Servisin adı", (r) => r.name),
  money("Tutar", "Bir dönemde ödenen", (r) => r.amountMinor),
  text("Para Birimi", "TRY, USD, EUR…", (r) => r.currency),
  enumeration("Tutar Tipi", "Sabit · Değişken (değişkende tutar tahmindir)", (r) => r.amountMode, AMOUNT_MODES),
  enumeration("Döngü", "Aylık · Yıllık · Özel", (r) => r.cycle, SUBSCRIPTION_CYCLES),
  whole("Kaç Ayda Bir", "Aylıkta 1, yıllıkta 12", (r) => r.intervalMonths),
  whole("Ödeme Günü", "Ayın kaçında çekiliyor", (r) => r.billingDay),
  date("Sonraki Ödeme", "Bir sonraki çekim tarihi", (r) => r.nextDueDate),
  date("Deneme Bitişi", "Deneme sürümündeyse bitiş tarihi", (r) => r.trialEndDate),
  text("Kategori", "Hangi kaleme yazılıyor", (r) => r.category),
  text("Ödeme Yöntemi", "Hangi karttan ya da hesaptan çekiliyor", (r) => r.source),
  text("Kişi", "Kimin aboneliği; boşsa senin", (r) => r.person),
  flag("Otomatik Ödeme", "Kendiliğinden çekiliyorsa: evet", (r) => r.autoPay),
  flag("Aktif", "İptal ettiysen boş kalır", (r) => r.isActive),
  text("Site", "Logosunun bulunduğu adres", (r) => r.websiteDomain),
  money("Aylık Yük", "Yıllık bir aboneliğin aya düşen payı", (r) => r.monthlyLoadMinor),
];

export const INVESTMENT_COLUMNS: WorkbookColumn<InvestmentRow>[] = [
  text("Ürün", "Gram Altın, Dolar, THYAO gibi varlığın adı", (r) => r.product),
  enumeration("Varlık Türü", "Metal · Döviz · Hisse · Fon · Kripto · Emeklilik", (r) => r.assetType, ASSET_TYPES),
  text("Fiyat Takip Kodu", "Canlı fiyat takibi için uygulamanın verdiği kod", (r) => r.marketCode),
  date("İşlem Tarihi", "İşlemin yapıldığı gün", (r) => r.operationDate),
  enumeration("İşlem", "Mevcut · Alış · Satış · Katkı", (r) => r.kind, OPERATION_KINDS),
  text("Adet", "Küsuratlı olabilir", (r) => r.quantity),
  money("Birim Fiyat", "Bir adedin fiyatı", (r) => r.unitPriceMinor),
  money("Toplam", "Adet çarpı birim fiyat", (r) => r.totalMinor),
  text("Not", "Serbest metin", (r) => r.note),
];

export const WORKBOOK_COLUMNS = {
  subscriptions: SUBSCRIPTION_COLUMNS,
  investments: INVESTMENT_COLUMNS,
} as const;

/* ------------------------------------------------------------- month grid */

/** One category's total for one month, as the export's `GROUP BY` returns it. */
export interface LedgerTotal {
  item: string;
  /** `YYYY-MM`. */
  month: string;
  minor: number;
}

/**
 * Pivot monthly totals into the grid the import wizard reads.
 *
 * One grid per year, because a sheet carries ONE dominant year: two years in a
 * sheet would put both under whichever had more months, and the wizard's own
 * per-year column membership would then be wrong for half the file.
 *
 * Pure, and here rather than beside the query, so the step that decides whether
 * the export is importable can be tested without a database — which is the
 * check the first version of this feature did not have and needed.
 *
 * `monthNames` is passed in rather than imported so this module stays free of
 * the translation table; the wizard matches "Ocak 2026" by name.
 */
export function buildLedgerGrids(
  totals: readonly LedgerTotal[],
  monthNames: readonly string[],
): [year: number, grid: string[][]][] {
  const byYear = new Map<number, { months: Set<string>; items: Map<string, Map<string, number>> }>();
  for (const total of totals) {
    const year = Number(total.month.slice(0, 4));
    const index = Number(total.month.slice(5, 7));
    if (!Number.isInteger(year) || !(index >= 1 && index <= 12)) continue;
    const bucket = byYear.get(year) ?? { months: new Set<string>(), items: new Map<string, Map<string, number>>() };
    bucket.months.add(total.month);
    const cells = bucket.items.get(total.item) ?? new Map<string, number>();
    // A repeated (item, month) is summed rather than overwritten: the query
    // groups, but a caller that did not would otherwise lose rows silently.
    cells.set(total.month, (cells.get(total.month) ?? 0) + total.minor);
    bucket.items.set(total.item, cells);
    byYear.set(year, bucket);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, bucket]) => {
      const months = [...bucket.months].sort();
      const items = [...bucket.items.keys()].sort((a, b) => a.localeCompare(b, "tr"));
      const grid: string[][] = [
        // The corner stays empty: the wizard reads the header row ABOVE the
        // months, so a label there would become an extra item column.
        ["", ...items.map(neutralizeFormula)],
        ...months.map((month) => [
          `${monthNames[Number(month.slice(5, 7)) - 1] ?? month} ${year}`,
          ...items.map((item) => {
            const value = bucket.items.get(item)?.get(month);
            return value == null ? "" : writeMoney(value);
          }),
        ]),
      ];
      return [year, grid] as [number, string[][]];
    });
}

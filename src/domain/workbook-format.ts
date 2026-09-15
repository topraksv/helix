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
 * **Abonelikler** and **Yatırımlar** are records: one row per subscription or
 * investment operation, written to be read by a person and by Excel, and read
 * back so the owner can edit them there and import them again (owner decision,
 * 2026-09-14). This file is their column table in both directions — one
 * heading table, so a column the writer renames is a column the reader finds.
 *
 * `.claude/rules/export-import-contract.md` states the standing rule: a new
 * user-facing field on a subscription or an investment is not finished until it
 * has a column here.
 */
import { deneutralizeFormula, neutralizeFormula } from "./workbook-format-guard";
import { normalizedMonthlyLoadMinor } from "./analytics";
import { isISODate, type ISODate } from "./dates";
import type { InvestmentAssetType, InvestmentOperationKind } from "./investments";
import { isSupportedMinorAmount, readTRAmount, type Minor } from "./money";
import { tr } from "../i18n/tr";

export { neutralizeFormula, deneutralizeFormula } from "./workbook-format-guard";

/** Sheet names, in the language the file is read in. */
export const WORKBOOK_SHEETS = {
  /** Suffixed with the year: one sheet carries one year's grid. */
  ledger: "Mali Tablo",
  subscriptions: "Abonelikler",
  investments: "Yatırımlar",
} as const;

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
type WorkbookCell = string;

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

/**
 * The labels a closed set is written with, taken from the app's own vocabulary
 * wherever the app already has one.
 *
 * `ASSET_TYPES` did not, and it cost: this file had invented "Metal", "Hisse"
 * and "Emeklilik" while every screen says "Kıymetli Maden", "Borsa" and "BES".
 * A workbook that names a holding differently from the screen it was exported
 * from is a second vocabulary for one concept, and the owner is the person who
 * has to reconcile them.
 *
 * `OPERATION_KINDS` is the deliberate exception. `tr.investments` has labels
 * for these, but they are ACTIONS — "Mevcut yatırımı ekle", "Alış ekle" — and a
 * table column holds a noun. Sentences in a cell would be the same mistake from
 * the other side.
 */
const AMOUNT_MODES = { fixed: "Sabit", variable: "Değişken" } as const;
const SUBSCRIPTION_CYCLES = {
  monthly: tr.subs.monthly,
  yearly: tr.subs.yearly,
  custom: tr.subs.custom,
} as const;
const ASSET_TYPES = tr.investments.types;
const OPERATION_KINDS = {
  existing: "Mevcut",
  buy: "Alış",
  sell: "Satış",
  contribution: "Katkı",
} as const;

/** Each record sheet's headings, named once for the writer and the reader. */
export const SUBSCRIPTION_HEADERS = {
  name: "Abonelik", amount: "Tutar", currency: "Para Birimi", amountMode: "Tutar Tipi", cycle: "Döngü",
  interval: "Kaç Ayda Bir", billingDay: "Ödeme Günü", nextDue: "Sonraki Ödeme", trialEnd: "Deneme Bitişi",
  category: "Kategori", source: "Ödeme Yöntemi", person: "Kişi", autoPay: "Otomatik Ödeme", active: "Aktif",
  site: "Site", monthlyLoad: "Aylık Yük",
} as const;

export const INVESTMENT_HEADERS = {
  product: "Ürün", assetType: "Varlık Türü", marketCode: "Fiyat Takip Kodu", date: "İşlem Tarihi", kind: "İşlem",
  quantity: "Adet", unitPrice: "Birim Fiyat", total: "Toplam", note: "Not",
} as const;

const S = SUBSCRIPTION_HEADERS;
const I = INVESTMENT_HEADERS;

export const SUBSCRIPTION_COLUMNS: WorkbookColumn<SubscriptionRow>[] = [
  text(S.name, "Servisin adı", (r) => r.name),
  money(S.amount, "Bir dönemde ödenen", (r) => r.amountMinor),
  text(S.currency, "TRY, USD, EUR…", (r) => r.currency),
  enumeration(S.amountMode, "Sabit · Değişken (değişkende tutar tahmindir)", (r) => r.amountMode, AMOUNT_MODES),
  enumeration(S.cycle, "Aylık · Yıllık · Özel", (r) => r.cycle, SUBSCRIPTION_CYCLES),
  whole(S.interval, "Aylıkta 1, yıllıkta 12", (r) => r.intervalMonths),
  whole(S.billingDay, "Ayın kaçında çekiliyor", (r) => r.billingDay),
  date(S.nextDue, "Bir sonraki çekim tarihi", (r) => r.nextDueDate),
  date(S.trialEnd, "Deneme sürümündeyse bitiş tarihi", (r) => r.trialEndDate),
  text(S.category, "Hangi kaleme yazılıyor", (r) => r.category),
  text(S.source, "Hangi karttan ya da hesaptan çekiliyor", (r) => r.source),
  text(S.person, "Kimin aboneliği; boşsa senin", (r) => r.person),
  flag(S.autoPay, "Kendiliğinden çekiliyorsa: evet", (r) => r.autoPay),
  flag(S.active, "İptal ettiysen boş kalır", (r) => r.isActive),
  text(S.site, "Logosunun bulunduğu adres", (r) => r.websiteDomain),
  money(S.monthlyLoad, "Yıllık bir aboneliğin aya düşen payı; geri okunmaz", (r) => r.monthlyLoadMinor),
];

export const INVESTMENT_COLUMNS: WorkbookColumn<InvestmentRow>[] = [
  text(I.product, "Gram Altın, Dolar, THYAO gibi varlığın adı", (r) => r.product),
  enumeration(I.assetType, "Metal · Döviz · Hisse · Fon · Kripto · Emeklilik", (r) => r.assetType, ASSET_TYPES),
  text(I.marketCode, "Canlı fiyat takibi için uygulamanın verdiği kod", (r) => r.marketCode),
  date(I.date, "İşlemin yapıldığı gün", (r) => r.operationDate),
  enumeration(I.kind, "Mevcut · Alış · Satış · Katkı", (r) => r.kind, OPERATION_KINDS),
  text(I.quantity, "Küsuratlı olabilir", (r) => r.quantity),
  money(I.unitPrice, "Bir adedin fiyatı", (r) => r.unitPriceMinor),
  money(I.total, "Adet çarpı birim fiyat", (r) => r.totalMinor),
  text(I.note, "Serbest metin", (r) => r.note),
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
 * The wizard matches "Ocak 2026" by name, so the month names come from the
 * same table the wizard reads.
 */
export function buildLedgerGrids(totals: readonly LedgerTotal[]): [year: number, grid: string[][]][] {
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
          `${tr.months[Number(month.slice(5, 7)) - 1] ?? month} ${year}`,
          ...items.map((item) => {
            const value = bucket.items.get(item)?.get(month);
            return value == null ? "" : writeMoney(value);
          }),
        ]),
      ];
      return [year, grid] as [number, string[][]];
    });
}

/* ------------------------------------------------------- database → sheet */

/**
 * The step between a query and a sheet, kept here and not beside the query.
 *
 * `services/export-import.ts` imports `react-native` and SQLite, so nothing in
 * it can be loaded by the node test environment — and a hundred lines of row
 * mapping living there is a hundred lines nothing measures. It showed up as the
 * mutation gate reporting that file detecting LESS than it used to, which is
 * exactly what an untested addition looks like from the outside.
 *
 * So the file keeps the SQL and this keeps the decisions.
 */
const str = (value: unknown): string => (value == null ? "" : String(value));
const num = (value: unknown): number => Number(value) || 0;

export function toLedgerTotal(row: Record<string, unknown>, uncategorized: string): LedgerTotal {
  return { item: str(row.item) || uncategorized, month: str(row.month), minor: num(row.total) };
}

export function toSubscriptionRow(row: Record<string, unknown>): SubscriptionRow {
  const amountMinor = num(row.amount_minor);
  // A subscription with no interval is monthly, not divided by zero.
  const intervalMonths = num(row.interval_months) || 1;
  return {
    name: str(row.name),
    amountMinor,
    currency: str(row.currency),
    amountMode: str(row.amount_mode),
    cycle: str(row.cycle),
    intervalMonths,
    billingDay: num(row.billing_day),
    nextDueDate: str(row.next_due_date),
    trialEndDate: str(row.trial_end_date),
    category: str(row.category),
    source: str(row.source),
    person: str(row.person),
    autoPay: Boolean(row.auto_pay),
    isActive: Boolean(row.is_active),
    websiteDomain: str(row.website_domain),
    // A derived figure, so a stored amount the domain will not accept costs
    // this ONE cell rather than the whole export.
    monthlyLoadMinor: isSupportedMinorAmount(amountMinor)
      ? normalizedMonthlyLoadMinor(amountMinor, intervalMonths)
      : 0,
  };
}

export function toInvestmentRow(row: Record<string, unknown>): InvestmentRow {
  return {
    product: str(row.product),
    assetType: str(row.asset_type),
    marketCode: str(row.market_code),
    operationDate: str(row.operation_date),
    kind: str(row.kind),
    // Quantities are stored with a decimal dot and read with a comma, like
    // every other number on the sheet.
    quantity: str(row.quantity).replace(".", ","),
    unitPriceMinor: num(row.unit_price_minor),
    totalMinor: num(row.total_minor),
    note: str(row.note),
  };
}

/* ------------------------------------------------------- sheet → record */

/** A subscription as its sheet row states it, before any name is matched to a record. */
export interface SubscriptionRecord {
  /** The row as a person counts it, the heading row being 1. */
  row: number;
  name: string;
  amountMinor: Minor;
  currency: string;
  amountMode: "fixed" | "variable";
  cycle: "monthly" | "yearly" | "custom";
  intervalMonths: number;
  billingDay: number;
  nextDueDate: ISODate;
  trialEndDate: ISODate | null;
  category: string;
  source: string;
  person: string;
  autoPay: boolean;
  isActive: boolean;
  websiteDomain: string;
}

/** An investment operation as its sheet row states it. */
export interface InvestmentRecord {
  row: number;
  product: string;
  assetType: InvestmentAssetType;
  marketCode: string;
  operationDate: ISODate;
  kind: InvestmentOperationKind;
  quantity: string | null;
  unitPriceMinor: Minor | null;
  totalMinor: Minor | null;
  note: string;
}

export interface RecordProblem {
  sheet: string;
  row: number;
  /** The heading whose cell did not read, or null when the row read and could not be saved. */
  column: string | null;
}

export interface RecordSheet<T> {
  records: T[];
  problems: RecordProblem[];
}

/**
 * How two cells are compared: case and surrounding space do not make a
 * different record. Turkish lower-casing turns the Latin capital I of
 * "NETFLIX" into a dotless ı, so the two i's are folded together as well.
 */
export const folded = (text: string): string => text.trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i");

/** One key from several parts, compared the way `folded` compares a cell. */
export const recordKey = (...parts: (string | number | null)[]): string =>
  parts.map((part) => folded(String(part ?? ""))).join("\u0000");

/** A quantity as a number reads it, so "12,50" written and "12.5" stored are one quantity. */
export const quantityKey = (quantity: string | null): string =>
  quantity == null || quantity.trim() === "" ? "" : String(Number(quantity.replace(",", ".")));

/** A closed set read back from its label, or from the stored value itself. */
function labelReader<Key extends string>(labels: Readonly<Record<Key, string>>): (text: string) => Key | undefined {
  const byText = new Map<string, Key>();
  for (const [key, label] of Object.entries(labels) as [Key, string][]) {
    byText.set(folded(label), key);
    byText.set(folded(key), key);
  }
  return (text) => byText.get(folded(text));
}

/** Money as the sheet writes it, or as a spreadsheet retyped it with a decimal dot. */
export function readMoney(text: string): Minor | undefined {
  const read = readTRAmount(/^-?\d+\.\d{1,2}$/.test(text) ? text.replace(".", ",") : text);
  return read.ok ? read.minor : undefined;
}

/** `GG.AA.YYYY` as written, or the ISO day a spreadsheet converted it to. */
export function readDate(text: string): ISODate | undefined {
  const written = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = written ? `${written[3]}-${written[2]!.padStart(2, "0")}-${written[1]!.padStart(2, "0")}` : text;
  return isISODate(iso) ? iso : undefined;
}

const blankOr = <T>(read: (text: string) => T | undefined, blank: T) => (text: string): T | undefined =>
  text === "" ? blank : read(text);
const named = (text: string): string | undefined => deneutralizeFormula(text).trim() || undefined;
const free = (text: string): string => deneutralizeFormula(text).trim();
const wholeOf = (text: string): number | undefined => (/^\d+$/.test(text) ? Number(text) : undefined);
const flagOf = (text: string): boolean | undefined => ({ "": false, evet: true, "hayır": false } as Record<string, boolean>)[folded(text)];
const quantityOf = (text: string): string | undefined => (/^\d+([.,]\d+)?$/.test(text) ? text.replace(",", ".") : undefined);

/**
 * Each field's heading, how its cell reads — `undefined` meaning it did not —
 * and, for a column a person may delete, what its absence means.
 */
type FieldReaders<T> = { [K in keyof T]: [header: string, read: (text: string) => T[K] | undefined, missing?: T[K]] };

const SUBSCRIPTION_FIELDS: FieldReaders<Omit<SubscriptionRecord, "row">> = {
  name: [S.name, named],
  amountMinor: [S.amount, readMoney],
  currency: [S.currency, (text) => text.toUpperCase() || "TRY"],
  amountMode: [S.amountMode, blankOr(labelReader(AMOUNT_MODES), "fixed")],
  cycle: [S.cycle, labelReader(SUBSCRIPTION_CYCLES)],
  // Blank is filled from the cycle below; zero stands for "not written".
  intervalMonths: [S.interval, blankOr(wholeOf, 0)],
  billingDay: [S.billingDay, wholeOf],
  nextDueDate: [S.nextDue, readDate],
  trialEndDate: [S.trialEnd, blankOr<ISODate | null>(readDate, null)],
  category: [S.category, free],
  source: [S.source, free],
  person: [S.person, free],
  autoPay: [S.autoPay, flagOf],
  // A blank cell is a cancelled subscription; a deleted column says nothing about it.
  isActive: [S.active, flagOf, true],
  websiteDomain: [S.site, free],
};

const INVESTMENT_FIELDS: FieldReaders<Omit<InvestmentRecord, "row">> = {
  product: [I.product, named],
  assetType: [I.assetType, labelReader(ASSET_TYPES as Readonly<Record<InvestmentAssetType, string>>)],
  marketCode: [I.marketCode, free],
  operationDate: [I.date, readDate],
  kind: [I.kind, labelReader(OPERATION_KINDS)],
  quantity: [I.quantity, blankOr<string | null>(quantityOf, null)],
  unitPriceMinor: [I.unitPrice, blankOr<Minor | null>(readMoney, null)],
  totalMinor: [I.total, blankOr<Minor | null>(readMoney, null)],
  note: [I.note, free],
};

/** One row through its readers: the record, or the heading of the first cell that did not read. */
function readFields<T>(fields: FieldReaders<T>, cell: (header: string) => string | null): T | string {
  const out: Partial<T> = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const [header, read, missing] = fields[key];
    const text = cell(header);
    const value = text == null && missing !== undefined ? missing : read(text ?? "");
    if (value === undefined) return header;
    out[key] = value;
  }
  return out as T;
}

/**
 * A record sheet's rows, each read or reported — or null when its headings are
 * not the sheet's, which is how an owner's own "Yatırım" sheet is told apart.
 *
 * Read by heading rather than by position, because a person moves a column
 * before they retype a value; a row that does not read is left out and named
 * by its row and heading, because a guessed record is worse than a missing one.
 * Each cell is trimmed once, here, so no reader above trims its own.
 */
function readRecordSheet<T extends { row: number }>(
  sheet: string,
  grid: readonly (readonly string[])[],
  fields: FieldReaders<Omit<T, "row">>,
  required: readonly string[],
): RecordSheet<T> | null {
  const headings = (grid[0] ?? []).map((cell) => cell.trim());
  if (!required.every((header) => headings.includes(header))) return null;
  const sheetRows: RecordSheet<T> = { records: [], problems: [] };
  grid.slice(1).forEach((cells, index) => {
    if (cells.every((cell) => cell.trim() === "")) return;
    const read = readFields(fields, (header) => (headings.includes(header) ? cells[headings.indexOf(header)]?.trim() ?? "" : null));
    if (typeof read === "string") sheetRows.problems.push({ sheet, row: index + 2, column: read });
    else sheetRows.records.push({ ...read, row: index + 2 } as T);
  });
  return sheetRows;
}

export function readSubscriptionSheet(grid: readonly (readonly string[])[]): RecordSheet<SubscriptionRecord> | null {
  const sheet = readRecordSheet<SubscriptionRecord>(WORKBOOK_SHEETS.subscriptions, grid, SUBSCRIPTION_FIELDS, [S.name, S.amount, S.cycle]);
  if (!sheet) return null;
  const intervalFor = (record: SubscriptionRecord) => record.intervalMonths || (record.cycle === "yearly" ? 12 : 1);
  return { ...sheet, records: sheet.records.map((record) => ({ ...record, intervalMonths: intervalFor(record) })) };
}

export function readInvestmentSheet(grid: readonly (readonly string[])[]): RecordSheet<InvestmentRecord> | null {
  const sheet = readRecordSheet<InvestmentRecord>(WORKBOOK_SHEETS.investments, grid, INVESTMENT_FIELDS, [I.product, I.assetType, I.kind]);
  if (!sheet) return null;
  // A contribution entered as an amount alone is written with a zero unit
  // price, and a zero unit price with no quantity means exactly that again.
  const amountOnly = (record: InvestmentRecord) => record.quantity == null && record.unitPriceMinor === 0;
  return { ...sheet, records: sheet.records.map((record) => (amountOnly(record) ? { ...record, unitPriceMinor: null } : record)) };
}

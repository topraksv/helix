import { isSupportedMinorAmount, type Minor } from "./money";

export const INVESTMENT_QUANTITY_SCALE = 8;
const QUANTITY_FACTOR = 100_000_000n;
const QUANTITY_LIMIT_ATOMS = 999_999_999_999n * QUANTITY_FACTOR;

export type InvestmentAssetType =
  | "metal"
  | "currency"
  | "equity"
  | "fund"
  | "crypto"
  | "pension";

export type InvestmentOperationKind = "existing" | "buy" | "sell" | "contribution";

export class InvestmentDomainError extends Error {
  constructor(
    public readonly code:
      | "invalid_quantity"
      | "invalid_money"
      | "quote_incomplete"
      | "quote_inconsistent"
      | "unknown_product"
      | "invalid_operation"
      | "insufficient_cash"
      | "unknown_quantity"
      | "oversold",
  ) {
    super({
      invalid_quantity: "invalid investment quantity",
      invalid_money: "invalid investment money",
      quote_incomplete: "two investment quote fields are required",
      quote_inconsistent: "investment quote fields are inconsistent",
      unknown_product: "investment product does not exist",
      invalid_operation: "investment operation does not match product type",
      insufficient_cash: "insufficient investment cash",
      unknown_quantity: "investment quantity is unknown",
      oversold: "sale exceeds holding",
    }[code]);
    this.name = "InvestmentDomainError";
  }
}

export interface ParsedInvestmentQuantity {
  normalized: string;
  atoms: bigint;
}

function normalizedDecimalInput(raw: string): string {
  const compact = raw.trim().replace(/\s/g, "");
  if (!compact || compact.startsWith("-") || compact.startsWith("+")) {
    throw new InvestmentDomainError("invalid_quantity");
  }
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  const decimalIndex = comma >= 0 && dot >= 0
    ? Math.max(comma, dot)
    : comma >= 0
      ? comma
      : dot;
  const integerRaw = decimalIndex >= 0 ? compact.slice(0, decimalIndex) : compact;
  const fractionRaw = decimalIndex >= 0 ? compact.slice(decimalIndex + 1) : "";
  const integer = integerRaw.replace(/[.,]/g, "");
  if (!/^\d+$/.test(integer) || (fractionRaw !== "" && !/^\d+$/.test(fractionRaw))) {
    throw new InvestmentDomainError("invalid_quantity");
  }
  if (fractionRaw.length > INVESTMENT_QUANTITY_SCALE) {
    throw new InvestmentDomainError("invalid_quantity");
  }
  return `${integer.replace(/^0+(?=\d)/, "") || "0"}${fractionRaw ? `.${fractionRaw}` : ""}`;
}

function quantityFromAtoms(atoms: bigint): string {
  if (atoms <= 0n || atoms > QUANTITY_LIMIT_ATOMS) {
    throw new InvestmentDomainError("invalid_quantity");
  }
  const integer = atoms / QUANTITY_FACTOR;
  const fraction = (atoms % QUANTITY_FACTOR).toString().padStart(INVESTMENT_QUANTITY_SCALE, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

export function formatInvestmentQuantityAtoms(atoms: bigint): string {
  return atoms === 0n ? "0" : quantityFromAtoms(atoms);
}

export function parseInvestmentQuantity(raw: string): ParsedInvestmentQuantity {
  const normalized = normalizedDecimalInput(raw);
  const [integer, fraction = ""] = normalized.split(".");
  const atoms = BigInt(integer!) * QUANTITY_FACTOR
    + BigInt(fraction.padEnd(INVESTMENT_QUANTITY_SCALE, "0"));
  return { normalized: quantityFromAtoms(atoms), atoms };
}

function positiveMoney(value: number | null | undefined): value is Minor {
  return value != null && Number.isSafeInteger(value) && value > 0 && isSupportedMinorAmount(value);
}

/** Positive-only round-half-away division. */
function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new InvestmentDomainError("invalid_money");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function ceilDivision(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new InvestmentDomainError("invalid_money");
  return (numerator + denominator - 1n) / denominator;
}

/** The stored unit price is precise to one kuruş and quantity to 1e-8. When
 * either value is derived, its representational rounding can accumulate in
 * the reconstructed total. This is the smallest tolerance that covers both
 * boundaries; it does not grant an arbitrary percentage error. */
function quoteToleranceMinor(quantityAtoms: bigint, unitPriceMinor: number): bigint {
  const fromUnitRounding = ceilDivision(quantityAtoms, 2n * QUANTITY_FACTOR);
  const fromQuantityRounding = ceilDivision(BigInt(unitPriceMinor), 2n * QUANTITY_FACTOR);
  return [1n, fromUnitRounding, fromQuantityRounding].reduce((largest, value) =>
    value > largest ? value : largest
  );
}

function safeMinor(value: bigint): Minor {
  const result = Number(value);
  if (!positiveMoney(result)) throw new InvestmentDomainError("invalid_money");
  return result;
}

export interface InvestmentQuoteInput {
  quantity?: string | null;
  unitPriceMinor?: number | null;
  totalMinor?: number | null;
}

export interface ResolvedInvestmentQuote {
  quantity: string;
  unitPriceMinor: Minor;
  totalMinor: Minor;
}

/**
 * Resolve quantity × unit price = total with fixed-point quantity and integer
 * kuruş. At least two fields are required. A supplied triple may differ by one
 * kuruş because unit-price display cannot preserve sub-kuruş precision.
 */
export function resolveInvestmentQuote(input: InvestmentQuoteInput): ResolvedInvestmentQuote {
  const quantity = input.quantity ? parseInvestmentQuantity(input.quantity) : null;
  const unitPriceMinor = positiveMoney(input.unitPriceMinor) ? input.unitPriceMinor : null;
  const totalMinor = positiveMoney(input.totalMinor) ? input.totalMinor : null;
  const fieldCount = Number(quantity != null) + Number(unitPriceMinor != null) + Number(totalMinor != null);
  if (fieldCount < 2) throw new InvestmentDomainError("quote_incomplete");
  if (input.unitPriceMinor != null && unitPriceMinor == null) throw new InvestmentDomainError("invalid_money");
  if (input.totalMinor != null && totalMinor == null) throw new InvestmentDomainError("invalid_money");

  if (quantity && unitPriceMinor != null) {
    const calculatedTotal = safeMinor(roundedDivision(quantity.atoms * BigInt(unitPriceMinor), QUANTITY_FACTOR));
    const tolerance = Number(quoteToleranceMinor(quantity.atoms, unitPriceMinor));
    if (totalMinor != null && Math.abs(calculatedTotal - totalMinor) > tolerance) {
      throw new InvestmentDomainError("quote_inconsistent");
    }
    return {
      quantity: quantity.normalized,
      unitPriceMinor,
      totalMinor: totalMinor ?? calculatedTotal,
    };
  }

  if (quantity && totalMinor != null) {
    const derivedUnitPrice = safeMinor(
      roundedDivision(BigInt(totalMinor) * QUANTITY_FACTOR, quantity.atoms),
    );
    const reconstructedTotal = safeMinor(
      roundedDivision(quantity.atoms * BigInt(derivedUnitPrice), QUANTITY_FACTOR),
    );
    if (Math.abs(reconstructedTotal - totalMinor) > Number(quoteToleranceMinor(quantity.atoms, derivedUnitPrice))) {
      throw new InvestmentDomainError("quote_inconsistent");
    }
    return {
      quantity: quantity.normalized,
      unitPriceMinor: derivedUnitPrice,
      totalMinor,
    };
  }

  const derivedAtoms = roundedDivision(BigInt(totalMinor!) * QUANTITY_FACTOR, BigInt(unitPriceMinor!));
  const reconstructedTotal = safeMinor(
    roundedDivision(derivedAtoms * BigInt(unitPriceMinor!), QUANTITY_FACTOR),
  );
  if (Math.abs(reconstructedTotal - totalMinor!) > Number(quoteToleranceMinor(derivedAtoms, unitPriceMinor!))) {
    throw new InvestmentDomainError("quote_inconsistent");
  }
  return {
    quantity: quantityFromAtoms(derivedAtoms),
    unitPriceMinor: unitPriceMinor!,
    totalMinor: totalMinor!,
  };
}

export interface InvestmentProductLike {
  id: string;
  assetType: InvestmentAssetType;
  name: string;
}

export interface InvestmentOperationLike {
  id: string;
  productId: string;
  kind: InvestmentOperationKind;
  operationDate: string;
  quantity: string | null;
  unitPriceMinor: number | null;
  totalMinor: number;
}

export interface InvestmentCashEvent {
  id: string;
  date: string;
  /** Signed: transfer into investments is positive, refund is negative. */
  amountMinor: number;
}

export interface InvestmentProductState extends InvestmentProductLike {
  quantity: string | null;
  costMinor: Minor;
  averageCostMinor: Minor | null;
  realizedProfitLossMinor: number;
  active: boolean;
}

interface MutableProductState extends InvestmentProductLike {
  quantityAtoms: bigint | null;
  costMinor: number;
  realizedProfitLossMinor: number;
}

export interface InvestmentState {
  cashMinor: Minor;
  investedCostMinor: Minor;
  realizedProfitLossMinor: number;
  products: InvestmentProductState[];
  operationResults: Map<string, { costBasisMinor: Minor; realizedProfitLossMinor: number }>;
}

function eventPriority(event: { source: "cash" | "operation"; amountMinor?: number; kind?: InvestmentOperationKind }): number {
  if (event.source === "cash") return (event.amountMinor ?? 0) >= 0 ? 0 : 4;
  if (event.kind === "existing") return 1;
  if (event.kind === "sell") return 3;
  return 2;
}

function checkedCash(value: number): Minor {
  if (!Number.isSafeInteger(value) || !isSupportedMinorAmount(value)) {
    throw new InvestmentDomainError("invalid_money");
  }
  if (value < 0) throw new InvestmentDomainError("insufficient_cash");
  return value;
}

/**
 * Deterministic replay is the source of truth for wallet, holdings and sale
 * cost basis. Stored sale result columns are caches for sync/export only; a
 * caller writes the values returned in `operationResults`.
 */
export function buildInvestmentState(input: {
  startedOn: string;
  openingCashMinor: number;
  products: readonly InvestmentProductLike[];
  operations: readonly InvestmentOperationLike[];
  cashEvents: readonly InvestmentCashEvent[];
}): InvestmentState {
  let cashMinorExact = BigInt(checkedCash(input.openingCashMinor));
  const states = new Map<string, MutableProductState>(
    input.products.map((product) => [product.id, {
      ...product,
      quantityAtoms: 0n,
      costMinor: 0,
      realizedProfitLossMinor: 0,
    }]),
  );
  const operationResults = new Map<string, { costBasisMinor: Minor; realizedProfitLossMinor: number }>();
  const events = [
    ...input.cashEvents
      .filter((event) => event.date >= input.startedOn)
      .map((event) => ({ source: "cash" as const, id: event.id, date: event.date, amountMinor: event.amountMinor })),
    ...input.operations.map((operation) => ({
      source: "operation" as const,
      id: operation.id,
      date: operation.operationDate,
      kind: operation.kind,
      operation,
    })),
  ].sort((a, b) =>
    a.date.localeCompare(b.date)
    || eventPriority(a) - eventPriority(b)
    || a.id.localeCompare(b.id),
  );

  for (const event of events) {
    if (event.source === "cash") {
      if (!Number.isSafeInteger(event.amountMinor) || !isSupportedMinorAmount(event.amountMinor)) {
        throw new InvestmentDomainError("invalid_money");
      }
      cashMinorExact += BigInt(event.amountMinor);
      continue;
    }

    const operation = event.operation;
    if (!positiveMoney(operation.totalMinor)) throw new InvestmentDomainError("invalid_money");
    const state = states.get(operation.productId);
    if (!state) throw new InvestmentDomainError("unknown_product");
    if (operation.kind === "contribution" && state.assetType !== "pension") {
      throw new InvestmentDomainError("invalid_operation");
    }
    const quantity = operation.quantity ? parseInvestmentQuantity(operation.quantity) : null;

    if (operation.kind === "sell") {
      if (state.quantityAtoms == null) throw new InvestmentDomainError("unknown_quantity");
      if (!quantity) throw new InvestmentDomainError("invalid_quantity");
      if (quantity.atoms > state.quantityAtoms) throw new InvestmentDomainError("oversold");
      const costBasis = quantity.atoms === state.quantityAtoms
        ? state.costMinor
        : Number(roundedDivision(BigInt(state.costMinor) * quantity.atoms, state.quantityAtoms));
      if (!Number.isSafeInteger(costBasis) || costBasis < 0) throw new InvestmentDomainError("invalid_money");
      const realized = operation.totalMinor - costBasis;
      state.quantityAtoms -= quantity.atoms;
      state.costMinor -= costBasis;
      state.realizedProfitLossMinor += realized;
      cashMinorExact += BigInt(operation.totalMinor);
      operationResults.set(operation.id, {
        costBasisMinor: costBasis,
        realizedProfitLossMinor: realized,
      });
      continue;
    }

    if (operation.kind === "buy" || operation.kind === "contribution") {
      cashMinorExact -= BigInt(operation.totalMinor);
    }
    state.costMinor += operation.totalMinor;
    if (!Number.isSafeInteger(state.costMinor) || !isSupportedMinorAmount(state.costMinor)) {
      throw new InvestmentDomainError("invalid_money");
    }
    if (!quantity) {
      if (operation.kind !== "contribution") throw new InvestmentDomainError("invalid_quantity");
      state.quantityAtoms = null;
    } else if (state.quantityAtoms != null) {
      state.quantityAtoms += quantity.atoms;
      if (state.quantityAtoms > QUANTITY_LIMIT_ATOMS) throw new InvestmentDomainError("invalid_quantity");
    }
  }

  const cashMinor = checkedCash(Number(cashMinorExact));
  const products = [...states.values()]
    .map<InvestmentProductState>((state) => {
      const quantity = state.quantityAtoms == null
        ? null
        : state.quantityAtoms === 0n
          ? "0"
          : quantityFromAtoms(state.quantityAtoms);
      const averageCostMinor = state.quantityAtoms && state.quantityAtoms > 0n
        ? Number(roundedDivision(BigInt(state.costMinor) * QUANTITY_FACTOR, state.quantityAtoms))
        : null;
      return {
        id: state.id,
        assetType: state.assetType,
        name: state.name,
        quantity,
        costMinor: state.costMinor,
        averageCostMinor,
        realizedProfitLossMinor: state.realizedProfitLossMinor,
        active: state.costMinor > 0 || state.quantityAtoms == null || (state.quantityAtoms ?? 0n) > 0n,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "tr") || a.id.localeCompare(b.id));
  const investedCostMinor = products.reduce((sum, product) => sum + product.costMinor, 0);
  const realizedProfitLossMinor = products.reduce((sum, product) => sum + product.realizedProfitLossMinor, 0);
  if (!isSupportedMinorAmount(investedCostMinor) || !Number.isSafeInteger(realizedProfitLossMinor)) {
    throw new InvestmentDomainError("invalid_money");
  }
  return {
    cashMinor,
    investedCostMinor,
    realizedProfitLossMinor,
    products,
    operationResults,
  };
}

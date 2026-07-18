/**
 * Local SQLite schema (Drizzle). Mirrors the Supabase Postgres schema in
 * supabase/migrations for tables and columns. Conventions:
 * - ids are client-generated UUIDv7 strings
 * - money is integer minor units (kuruş), columns end with `_minor`
 * - dates are `YYYY-MM-DD`, months `YYYY-MM`, timestamps ISO-8601 UTC strings
 * - soft delete only: `deleted_at` tombstones (sync requires them)
 *
 * Uniqueness constraints (settings key, fx_rates currency/date, one live
 * cell note per month/category) are DELIBERATELY not mirrored locally: they
 * are enforced by deterministic ids at write time and by Postgres at push
 * time. A local unique index would wedge pull merges — rows sharing one
 * server `updated_at` arrive in id order, so a tombstone can land after the
 * row that replaces it within the same page.
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const syncColumns = {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
};

export const persons = sqliteTable("persons", {
  ...syncColumns,
  name: text("name").notNull(),
  isSelf: integer("is_self", { mode: "boolean" }).notNull().default(false),
});

export const paymentSources = sqliteTable("payment_sources", {
  ...syncColumns,
  name: text("name").notNull(),
  type: text("type", {
    enum: ["credit_card", "debit_card", "virtual_card", "e_wallet", "cash", "direct_debit", "bank_transfer"],
  }).notNull(),
  personId: text("person_id").notNull(),
  dueDay: integer("due_day"),
  statementDay: integer("statement_day"), // card cut-off day; drives credit_card_statements periods
  color: text("color"),
  logoSource: text("logo_source", { enum: ["brand", "favicon", "manual", "initials"] })
    .notNull()
    .default("initials"),
  logoRef: text("logo_ref"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const categories = sqliteTable("categories", {
  ...syncColumns,
  name: text("name").notNull(),
  kind: text("kind", { enum: ["expense", "income"] }).notNull(),
  icon: text("icon"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  isColumn: integer("is_column", { mode: "boolean" }).notNull().default(false),
});

export const computedColumns = sqliteTable("computed_columns", {
  ...syncColumns,
  name: text("name").notNull(),
  /** Zod-validated JSON, see src/domain/computed-columns.ts */
  definition: text("definition").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const installmentPlans = sqliteTable("installment_plans", {
  ...syncColumns,
  title: text("title").notNull(),
  kind: text("kind", { enum: ["card_installment", "loan"] }).notNull(),
  totalAmountMinor: integer("total_amount_minor"),
  monthlyAmountMinor: integer("monthly_amount_minor"),
  installmentCount: integer("installment_count").notNull(),
  currency: text("currency").notNull().default("TRY"),
  startMonth: text("start_month").notNull(), // YYYY-MM
  dueDay: integer("due_day"),
  paymentSourceId: text("payment_source_id"),
  personId: text("person_id").notNull(),
  categoryId: text("category_id"),
  note: text("note"),
});

/**
 * Immutable statement dates per card/period. Amount is intentionally derived
 * from linked transactions so refunds and edits cannot leave a stale cached
 * total. Old periods stay available after the card's cycle settings change.
 */
export const creditCardStatements = sqliteTable(
  "credit_card_statements",
  {
    ...syncColumns,
    paymentSourceId: text("payment_source_id").notNull(),
    periodMonth: text("period_month").notNull(),
    statementDate: text("statement_date").notNull(),
    dueDate: text("due_date").notNull(),
  },
  (t) => [
    index("idx_card_statement_source_period").on(t.paymentSourceId, t.periodMonth),
    index("idx_card_statement_due").on(t.dueDate),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    ...syncColumns,
    type: text("type", { enum: ["expense", "income", "transfer"] }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("TRY"),
    fxRate: text("fx_rate"), // decimal string, null for TRY
    amountTryMinor: integer("amount_try_minor").notNull(),
    entryDate: text("entry_date").notNull(),
    /** Real-world purchase/occurrence date. For card expenses, effectiveDate
     *  is the statement due date that affects the ledger. */
    purchaseDate: text("purchase_date"),
    effectiveDate: text("effective_date").notNull(),
    status: text("status", { enum: ["pending", "realized"] }).notNull(),
    categoryId: text("category_id"),
    paymentSourceId: text("payment_source_id"),
    personId: text("person_id").notNull(),
    installmentPlanId: text("installment_plan_id"),
    installmentNo: integer("installment_no"),
    cardStatementId: text("card_statement_id"),
    subscriptionId: text("subscription_id"),
    isAggregate: integer("is_aggregate", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
  },
  (t) => [
    index("idx_tx_effective").on(t.effectiveDate),
    index("idx_tx_category_effective").on(t.categoryId, t.effectiveDate),
    index("idx_tx_plan").on(t.installmentPlanId),
    index("idx_tx_card_statement").on(t.cardStatementId),
    index("idx_tx_subscription").on(t.subscriptionId),
  ],
);

export const subscriptions = sqliteTable("subscriptions", {
  ...syncColumns,
  name: text("name").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("TRY"),
  cycle: text("cycle", { enum: ["monthly", "yearly", "custom"] }).notNull(),
  intervalMonths: integer("interval_months").notNull().default(1),
  billingDay: integer("billing_day").notNull(),
  nextDueDate: text("next_due_date").notNull(),
  paymentSourceId: text("payment_source_id"),
  categoryId: text("category_id"),
  personId: text("person_id").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  canceledAt: text("canceled_at"),
  trialEndDate: text("trial_end_date"),
  autoPay: integer("auto_pay", { mode: "boolean" }).notNull().default(false),
  websiteDomain: text("website_domain"),
  logoSource: text("logo_source", { enum: ["brand", "favicon", "manual", "initials"] })
    .notNull()
    .default("initials"),
  logoRef: text("logo_ref"),
  note: text("note"),
});

export const priceHistory = sqliteTable("price_history", {
  ...syncColumns,
  subscriptionId: text("subscription_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  effectiveFrom: text("effective_from").notNull(),
});

export const recurringIncomes = sqliteTable("recurring_incomes", {
  ...syncColumns,
  name: text("name").notNull(),
  kind: text("kind", { enum: ["salary", "rent", "allowance", "other"] })
    .notNull()
    .default("salary"),
  defaultAmountMinor: integer("default_amount_minor").notNull(),
  currency: text("currency").notNull().default("TRY"),
  payDay: integer("pay_day").notNull(),
  recurrence: text("recurrence", { enum: ["monthly", "weekly", "biweekly"] }).notNull().default("monthly"),
  anchorDate: text("anchor_date"),
  personId: text("person_id").notNull(),
  categoryId: text("category_id"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  note: text("note"),
});

export const categoryBudgets = sqliteTable(
  "category_budgets",
  {
    ...syncColumns,
    categoryId: text("category_id").notNull(),
    month: text("month").notNull(),
    amountMinor: integer("amount_minor").notNull(),
  },
  (t) => [index("idx_budget_month_category").on(t.month, t.categoryId)],
);

export const expectedPayments = sqliteTable(
  "expected_payments",
  {
    ...syncColumns,
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    kind: text("kind", { enum: ["subscription", "installment", "loan", "recurring_income"] }).notNull(),
    refId: text("ref_id").notNull(),
    dueDate: text("due_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("TRY"),
    status: text("status", { enum: ["pending", "paid", "late", "skipped"] }).notNull().default("pending"),
    paidAt: text("paid_at"),
    autoConfirmed: integer("auto_confirmed", { mode: "boolean" }).notNull().default(false),
    transactionId: text("transaction_id"),
  },
  (t) => [index("idx_expected_status_due").on(t.status, t.dueDate)],
);

export const balanceAdjustments = sqliteTable("balance_adjustments", {
  ...syncColumns,
  date: text("date").notNull(),
  amountMinor: integer("amount_minor").notNull(), // signed
  note: text("note"),
});

export const cellNotes = sqliteTable("cell_notes", {
  ...syncColumns,
  month: text("month").notNull(), // YYYY-MM
  categoryId: text("category_id").notNull(),
  body: text("body").notNull(),
});

export const settings = sqliteTable("settings", {
  ...syncColumns,
  key: text("key").notNull(),
  value: text("value").notNull(), // JSON-encoded
});

export const fxRates = sqliteTable("fx_rates", {
  ...syncColumns,
  currency: text("currency").notNull(),
  rateDate: text("rate_date").notNull(),
  rateTry: text("rate_try").notNull(), // decimal string
});

/** Local-only: outbox of pending mutations to push (never synced itself). */
export const outbox = sqliteTable("outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  op: text("op", { enum: ["upsert"] }).notNull().default("upsert"),
  payload: text("payload").notNull(), // JSON row snapshot
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

/** Local-only quarantine. Invalid/cross-account outbox payloads are preserved
 *  for diagnostics instead of being silently discarded or blocking sync. */
export const syncDeadLetters = sqliteTable("sync_dead_letters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  outboxId: integer("outbox_id").notNull().unique(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  payload: text("payload").notNull(),
  reason: text("reason", { enum: ["malformed_payload", "wrong_user", "invalid_row"] }).notNull(),
  quarantinedAt: text("quarantined_at").notNull(),
});

/** Local-only: per-table pull cursor. */
export const syncState = sqliteTable("sync_state", {
  tableName: text("table_name").primaryKey(),
  lastPulledAt: text("last_pulled_at").notNull(),
});

/** Tables that participate in Supabase sync, in FK-safe upsert order. */
export const SYNCED_TABLES = {
  persons,
  categories: categories,
  category_budgets: categoryBudgets,
  payment_sources: paymentSources,
  computed_columns: computedColumns,
  installment_plans: installmentPlans,
  credit_card_statements: creditCardStatements,
  subscriptions,
  transactions,
  price_history: priceHistory,
  recurring_incomes: recurringIncomes,
  expected_payments: expectedPayments,
  balance_adjustments: balanceAdjustments,
  cell_notes: cellNotes,
  settings,
  fx_rates: fxRates,
} as const;

export type SyncedTableName = keyof typeof SYNCED_TABLES;

import type { SyncedTableName } from "./schema";

/**
 * Row-level foreign keys enforced by Supabase. Owner columns are deliberately
 * omitted: `user_id` is rebound to the importing account, while these scalar
 * ids are the relationships a backup restore must remap.
 */
export const RELATIONS = [
  ["payment_sources", "person_id", "persons"],
  ["installment_plans", "payment_source_id", "payment_sources"],
  ["installment_plans", "person_id", "persons"],
  ["credit_card_statements", "payment_source_id", "payment_sources"],
  ["transactions", "category_id", "categories"],
  ["transactions", "payment_source_id", "payment_sources"],
  ["transactions", "person_id", "persons"],
  ["transactions", "installment_plan_id", "installment_plans"],
  ["transactions", "card_statement_id", "credit_card_statements"],
  ["transactions", "subscription_id", "subscriptions"],
  ["subscriptions", "payment_source_id", "payment_sources"],
  ["subscriptions", "category_id", "categories"],
  ["subscriptions", "person_id", "persons"],
  ["price_history", "subscription_id", "subscriptions"],
  ["recurring_incomes", "person_id", "persons"],
  ["recurring_incomes", "category_id", "categories"],
  ["installment_plans", "category_id", "categories"],
  ["category_budgets", "category_id", "categories"],
  ["investment_operations", "product_id", "investment_products"],
  ["expected_payments", "transaction_id", "transactions"],
  ["cell_notes", "category_id", "categories"],
  ["attachments", "transaction_id", "transactions"],
] as const satisfies readonly (readonly [SyncedTableName, string, SyncedTableName])[];

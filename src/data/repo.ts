/**
 * Stable public repository surface.
 *
 * Implementations are grouped by data-domain boundary under `data/repo/`.
 * Existing callers keep importing this file so the split does not alter the
 * application API or create route-level migration churn.
 */

export {
  CreditCardCycleRequiredError,
  FxRateUnavailableError,
  InstallmentHistoryConflictError,
  ReferencedRecordError,
  SubscriptionCategoryRequiredError,
} from "./repo/errors";

export {
  TEMPLATE_CATEGORIES,
  TEMPLATE_EXTRA_CATEGORIES,
  applyOnboardingBalance,
  finalizeOnboarding,
  seedWorkspace,
} from "./repo/onboarding";
export type { SeedInput, TemplateCategory } from "./repo/onboarding";

export {
  deleteUnreferencedPaymentSource,
  deleteUnreferencedPerson,
  paymentSourceReferenceUsage,
  personReferenceUsage,
  reassignAndDeletePaymentSource,
  reassignAndDeletePerson,
  upsertPaymentSource,
} from "./repo/accounts";
export type {
  PaymentSourceInput,
  PaymentSourceReferenceUsage,
  PersonReferenceUsage,
} from "./repo/accounts";

export {
  addTransaction,
  bulkMonthEntry,
  countTransactionsForCategory,
  deleteTransaction,
  setCurrentBalance,
  updateTransaction,
} from "./repo/transactions";
export type { NewTransaction, TransactionPatch } from "./repo/transactions";

export {
  countInstallmentsForPlan,
  createInstallmentPlan,
  deletePlan,
  updateInstallmentPlan,
} from "./repo/installments";
export type { NewPlan } from "./repo/installments";

export {
  deleteRecurringIncomeWithExpected,
  deleteSubscriptionWithExpected,
  ensureSubscriptionCategory,
  restoreDeletedRule,
  upsertRecurringIncome,
  upsertSubscription,
} from "./repo/rules";
export type {
  RecurringIncomeInput,
  RuleDeleteSnapshot,
  SubscriptionInput,
} from "./repo/rules";

export {
  confirmExpected,
  revertExpected,
  skipExpected,
} from "./repo/expected";

export {
  hasImportedData,
  importSheets,
  importedYears,
} from "./repo/imports";
export type { ImportRequest } from "./repo/imports";

export { runMaintenance } from "./repo/maintenance";

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
  ImportBatchUnreadableError,
  SubscriptionCategoryRequiredError,
} from "./repo/errors";

export {
  TEMPLATE_CATEGORIES,
  TEMPLATE_EXTRA_CATEGORIES,
  applyOnboardingBalance,
  finalizeOnboarding,
  seedWorkspace,
  setOpeningBalance,
} from "./repo/onboarding";
export type { SeedInput, TemplateCategory } from "./repo/onboarding";

export {
  deleteUnreferencedPaymentSource,
  deleteUnreferencedPerson,
  createPerson,
  paymentSourceReferenceUsage,
  personReferenceUsage,
  reassignAndDeletePaymentSource,
  reassignAndDeletePerson,
  renamePerson,
  restorePaymentSource,
  restorePerson,
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
  deleteBalanceAdjustment,
  restoreBalanceAdjustment,
  restoreTransaction,
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
  unskipExpected,
} from "./repo/expected";

export {
  hasImportedData,
  importSheets,
  importedYears,
} from "./repo/imports";
export type { ImportRequest } from "./repo/imports";

export { runMaintenance } from "./repo/maintenance";

export { saveCellNote } from "./cell-notes";

export {
  restoreCategoryBudget,
  deleteCategoryBudget,
  deleteCategoryWithBudgets,
  restoreCategoryWithBudgets,
  upsertCategoryBudget,
  type CategoryDeleteSnapshot,
} from "./repo/budgets";

export {
  addTemplateCategories,
  createCategory,
  reorderCategoryGroup,
  updateCategory,
} from "./repo/categories";

export {
  deleteComputedColumn,
  reorderComputedColumns,
  restoreComputedColumn,
  saveComputedColumn,
  setComputedColumnsHidden,
} from "./repo/computed";

export {
  createRecordId,
  pendingSyncChangeCount,
  setAccountFrozen,
  setPendingTableVisibility,
  setReminderDays,
} from "./repo/settings";

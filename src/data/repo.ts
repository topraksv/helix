/**
 * Stable public repository surface.
 *
 * Implementations are grouped by data-domain boundary under `data/repo/`.
 * Existing callers keep importing this file so the split does not alter the
 * application API or create route-level migration churn.
 */

export {
  AttachmentRejectedError,
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
  PaymentSourceDeleteSnapshot,
  PersonReferenceUsage,
} from "./repo/accounts";

export {
  addTransaction,
  bulkMonthEntry,
  deleteTransaction,
  deleteBalanceAdjustment,
  restoreBalanceAdjustment,
  restoreTransaction,
  setCurrentBalance,
  updateTransaction,
} from "./repo/transactions";
export type { NewTransaction, TransactionPatch } from "./repo/transactions";

export {
  addInvestmentOperation,
  deleteInvestmentOperation,
  removeInvestmentProductHistory,
  restoreInvestmentOperation,
  saveInvestmentProduct,
  setupInvestments,
  updateInvestmentOperation,
} from "./repo/investments";
export type {
  InvestmentOperationInput,
  InvestmentProductInput,
  InvestmentSetupInput,
} from "./repo/investments";

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
  setExpectedAmount,
  skipExpected,
  unskipExpected,
} from "./repo/expected";

export {
  hasImportedData,
  importSheets,
  importedYears,
  openingBalanceFromSheets,
} from "./repo/imports";
export type { ImportRequest } from "./repo/imports";

export { runMaintenance } from "./repo/maintenance";

export {
  performDataReset,
  previewDataReset,
  RESET_SCOPES,
  UNDATED_SCOPES,
} from "./repo/reset";
export type { ResetPreview, ResetRange, ResetScope, ResetSelection } from "./repo/reset";

export { saveCellNote } from "./repo/cell-notes";

export {
  restoreCategoryBudget,
  deleteCategoryBudget,
  categoryReferenceUsage,
  deleteCategoryWithBudgets,
  restoreCategoryWithBudgets,
  upsertCategoryBudget,
  type CategoryDeleteSnapshot,
  type CategoryReferenceUsage,
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
  dismissSyncDeadLetter,
  pendingSyncChangeCount,
  retrySyncDeadLetter,
  setAccountFrozen,
  setAttentionState,
  setBalanceDeclaration,
  setMatrixColorLabels,
  setPendingTableVisibility,
  setReminderDays,
} from "./repo/settings";

export {
  addAttachment,
  deleteAttachment,
  liveAttachmentNames,
  restoreAttachment,
  type AttachmentRow,
  type AttachmentSnapshot,
  type NewAttachment,
} from "./repo/attachments";

export { setMatrixColor, type ColorTarget } from "./repo/matrix-colors";

export {
  commitStatementRows,
  type AcceptedStatementRow,
  type StatementCommitResult,
} from "./repo/statement-import";

// The repository's public surface; screens import from here, never from `db/`.

export {
  AttachmentRejectedError,
  CreditCardCycleRequiredError,
  FxRateUnavailableError,
  InstallmentHistoryConflictError,
  ReferencedRecordError,
  ImportBatchUnreadableError,
  InstallmentRefundNothingLeftError,
  InstallmentRefundTooLargeError,
  InstallmentTotalTooSmallError,
  RefundExceedsExpenseError,
  StatementPaymentTooLargeError,
  SubscriptionCategoryRequiredError,
} from "./repo/errors";

export {
  TEMPLATE_CATEGORIES,
  TEMPLATE_EXTRA_CATEGORIES,
  finalizeOnboarding,
  seedWorkspace,
  setOpeningBalance,
} from "./repo/onboarding";
export type { TemplateCategory } from "./repo/categories";

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
export type { PaymentSourceReferenceUsage, PersonReferenceUsage } from "./repo/accounts";

export {
  addTransaction,
  bulkMonthEntry,
  deleteTransaction,
  deleteBalanceAdjustment,
  restoreBalanceAdjustment,
  restoreTransaction,
  setCurrentBalance,
  addStatementPayment,
  deleteStatementPayment,
  restoreStatementPayment,
  declareMonthOpeningBalance,
  updateTransaction,
} from "./repo/transactions";

export {
  addInvestmentOperation,
  deleteInvestmentOperation,
  removeInvestmentProductHistory,
  restoreInvestmentOperation,
  saveInvestmentProduct,
  setupInvestments,
  updateInvestmentOperation,
} from "./repo/investments";

export {
  addInstallmentRefund,
  closeInstallmentPlan,
  reopenInstallmentPlan,
  countInstallmentsForPlan,
  createInstallmentPlan,
  deletePlan,
  restorePlan,
  updateInstallmentPlan,
} from "./repo/installments";

export {
  deleteRecurringIncomeWithExpected,
  deleteSubscriptionWithExpected,
  ensureSubscriptionCategory,
  restoreDeletedRule,
  upsertRecurringIncome,
  upsertSubscription,
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
  importWorkbookRecords,
  openingBalanceFromSheets,
  planWorkbookRecords,
} from "./repo/imports";
export type { RecordImportPlan } from "./repo/imports";

export { runMaintenance } from "./repo/maintenance";

export {
  performDataReset,
  previewDataReset,
  RESET_SCOPES,
  UNDATED_SCOPES,
} from "./repo/reset";
export type { ResetPreview, ResetRange, ResetScope } from "./repo/reset";

export { saveCellNote } from "./repo/cell-notes";

export {
  restoreCategoryBudget,
  deleteCategoryBudget,
  categoryReferenceUsage,
  deleteCategoryWithBudgets,
  restoreCategoryWithBudgets,
  upsertCategoryBudget,
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
  setBalanceColumns,
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
} from "./repo/attachments";

export { setMatrixColor } from "./repo/matrix-colors";

export {
  commitStatementRows,
  type AcceptedStatementRow,
} from "./repo/statement-import";

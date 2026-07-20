export class ReferencedRecordError extends Error {
  constructor() {
    super("Record still has live references");
    this.name = "ReferencedRecordError";
  }
}

export class CreditCardCycleRequiredError extends Error {
  constructor() {
    super("Credit-card statement and due dates are required");
    this.name = "CreditCardCycleRequiredError";
  }
}

export class InstallmentHistoryConflictError extends Error {
  constructor() {
    super("Realized installments cannot be removed or rewritten");
    this.name = "InstallmentHistoryConflictError";
  }
}

export class SubscriptionCategoryRequiredError extends Error {
  constructor() {
    super("Subscription category is required");
    this.name = "SubscriptionCategoryRequiredError";
  }
}

export class FxRateUnavailableError extends Error {
  constructor(public readonly currency: string) {
    super(`No FX rate available for ${currency}`);
    this.name = "FxRateUnavailableError";
  }
}

/**
 * A replace-mode import found an import-batch record it cannot read, so it
 * cannot know which previously imported rows to tombstone.
 *
 * Silently continuing would downgrade "replace" into "add": the old rows stay
 * live and the new ones land on top, doubling a year's data without any error.
 * Destructive semantics must never change silently, so the import refuses.
 */
export class ImportBatchUnreadableError extends Error {
  constructor(public readonly years: number[]) {
    super(`Import batch unreadable for year(s): ${years.join(", ")}`);
    this.name = "ImportBatchUnreadableError";
  }
}

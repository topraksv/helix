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

/**
 * A refund larger than what is left of the purchase it is recorded against.
 * Carries that figure, so the screen can say how much IS left.
 */
export class InstallmentRefundTooLargeError extends Error {
  constructor(public readonly remainingMinor: number) {
    super(`Refund exceeds what is left of the purchase (${remainingMinor})`);
    this.name = "InstallmentRefundTooLargeError";
  }
}

export class InstallmentRefundNothingLeftError extends Error {
  constructor() {
    super("No unpaid instalments left to spread a refund over");
    this.name = "InstallmentRefundNothingLeftError";
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
 * A statement payment larger than what is still owed on the statement: a
 * typo, or a payment that belongs to another statement. Carries what is left.
 */
export class StatementPaymentTooLargeError extends Error {
  constructor(public readonly remainingMinor: number) {
    super(`Payment exceeds what is owed on the statement (${remainingMinor})`);
    this.name = "StatementPaymentTooLargeError";
  }
}

/**
 * A refund larger than what is left of the expense it returns — the expense
 * less the refunds already linked to it. Carries what is left.
 */
export class RefundExceedsExpenseError extends Error {
  constructor(public readonly remainingMinor: number) {
    super(`Refund exceeds what is left of the expense (${remainingMinor})`);
    this.name = "RefundExceedsExpenseError";
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

/**
 * A picked file the app will not store. Carries the machine-readable reason so
 * the screen can say WHICH rule was broken rather than "olmadı".
 */
export class AttachmentRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`Attachment rejected: ${reason}`);
    this.name = "AttachmentRejectedError";
  }
}


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

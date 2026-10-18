/**
 * "+ Yeni ekle" inside a picker: ask a name, create the record, select it, and
 * stay in the form. Leaving for Settings lost the draft the person was writing.
 */
import { createCategory, upsertPaymentSource } from "../data/repo";
import type { PaymentSourceType } from "../domain/types";
import { scheduleSync } from "../sync/engine";
import { tr } from "../i18n/tr";
import { appAlert, appPrompt } from "./dialog";
import { devError } from "../services/logger";
import type { CreateAction } from "./selection-controls";

interface NamedRow { id: string; name: string }

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("tr") === b.trim().toLocaleLowerCase("tr");

async function askName(title: string, message: string, placeholder: string): Promise<string | null> {
  const name = (await appPrompt(title, message, { placeholder, confirmLabel: tr.common.add }))?.trim();
  return name ? name : null;
}

export function categoryCreateAction(input: {
  userId: string;
  kind: "expense" | "income";
  isTransfer: boolean;
  categories: readonly (NamedRow & { kind: string; sortOrder: number })[];
  onCreated: (id: string) => void;
}): CreateAction {
  return {
    label: tr.tx.addCategory,
    run: () => void (async () => {
      const name = await askName(tr.inlineCreate.categoryTitle, tr.inlineCreate.categoryBody, tr.inlineCreate.categoryPlaceholder);
      if (!name) return;
      const same = input.categories.find((category) => category.kind === input.kind && sameName(category.name, name));
      if (same) return input.onCreated(same.id);
      try {
        const sortOrder = Math.max(-1, ...input.categories.filter((category) => category.kind === input.kind).map((category) => category.sortOrder)) + 1;
        input.onCreated(await createCategory(input.userId, { name, kind: input.kind, isTransfer: input.isTransfer, sortOrder }));
        scheduleSync(input.userId);
      } catch (error) {
        devError("inline-create.category", error);
        void appAlert(tr.errors.saveFailed, tr.errors.title);
      }
    })(),
  };
}

/**
 * A credit card needs its statement and due days, which a name cannot give,
 * so it keeps its own action to the Payment Methods screen; anything else is
 * created here, as cash when the name says so and as a debit card otherwise.
 */
export function sourceCreateActions(input: {
  userId: string;
  ownerId: string | null;
  sources: readonly NamedRow[];
  onCreated: (id: string) => void;
  openCardSetup: () => void;
}): CreateAction[] {
  return [
    {
      label: tr.tx.addSource,
      run: () => void (async () => {
        if (!input.ownerId) return;
        const name = await askName(tr.inlineCreate.sourceTitle, tr.inlineCreate.sourceBody, tr.inlineCreate.sourcePlaceholder);
        if (!name) return;
        const same = input.sources.find((source) => sameName(source.name, name));
        if (same) return input.onCreated(same.id);
        const type: PaymentSourceType = /nakit|cash/i.test(name) ? "cash" : "debit_card";
        try {
          input.onCreated(await upsertPaymentSource(input.userId, { name, type, personId: input.ownerId, dueDay: null, statementDay: null }));
          scheduleSync(input.userId);
        } catch (error) {
          devError("inline-create.source", error);
          void appAlert(tr.errors.saveFailed, tr.errors.title);
        }
      })(),
    },
    { label: tr.inlineCreate.addCreditCard, run: input.openCardSetup },
  ];
}

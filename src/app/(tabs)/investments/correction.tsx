import React, { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import ArrowUpFromLine from "lucide-react-native/icons/arrow-up-from-line";
import Landmark from "lucide-react-native/icons/landmark";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { removeInvestmentProductHistory } from "../../../data/repo";
import {
  useAllTransactionsState,
  useInvestmentCategoriesState,
  useInvestmentOperationsState,
  useInvestmentProductsState,
  useInvestmentProfilesState,
  usePersonsState,
  useUserId,
} from "../../../data/hooks";
import { combineLiveStates } from "../../../data/live-state";
import { todayISO } from "../../../domain/dates";
import { InvestmentDomainError } from "../../../domain/investments";
import { formatMinorCompact } from "../../../domain/money";
import { singleParam } from "../../../domain/route-params";
import { userMessage } from "../../../domain/user-error";
import { tr } from "../../../i18n/tr";
import { scheduleSync } from "../../../sync/engine";
import { Button, Card, ChoiceTile, DataStateNotice, EmptyState, PanelHeader, Screen, SectionHeader } from "../../../ui/components";
import { appAlert, appConfirm } from "../../../ui/dialog";
import { useOperationGuard } from "../../../ui/operation-guard";
import { radius, spacing, type, useTheme } from "../../../ui/theme";

function correctionError(error: unknown): string {
  if (!(error instanceof InvestmentDomainError)) return userMessage(error, tr.errors.deleteFailed);
  if (error.code === "insufficient_cash") return tr.investments.correctionNeedsTransfer;
  if (error.code === "invalid_operation") return tr.investments.correctionInvalidSelection;
  return userMessage(error, tr.errors.deleteFailed);
}

export default function InvestmentCorrectionScreen() {
  const productId = singleParam(useLocalSearchParams<{ productId?: string | string[] }>().productId);
  const router = useRouter();
  const userId = useUserId();
  const operationGuard = useOperationGuard();
  const { palette } = useTheme();
  const profilesState = useInvestmentProfilesState();
  const productsState = useInvestmentProductsState();
  const operationsState = useInvestmentOperationsState();
  const transactionsState = useAllTransactionsState();
  const categoriesState = useInvestmentCategoriesState();
  const personsState = usePersonsState();
  const { status, ready, retry } = combineLiveStates([
    profilesState,
    productsState,
    operationsState,
    transactionsState,
    categoriesState,
    personsState,
  ]);
  const [selectedTransferIds, setSelectedTransferIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  // SQLite subscriptions may publish the tombstone before the awaited write
  // resumes. Remember this deliberate removal synchronously, so the stale-link
  // Redirect below cannot dispatch alongside the stack pop on native.
  const removalCompleted = useRef(false);
  const removalProductName = useRef<string | null>(null);
  const profile = profilesState.data[0];
  const product = productsState.data.find((candidate) => candidate.id === productId);
  const productName = product?.name ?? removalProductName.current;
  const productOperations = useMemo(
    () => operationsState.data
      .filter((operation) => operation.productId === productId)
      .sort((a, b) => a.operationDate.localeCompare(b.operationDate) || a.id.localeCompare(b.id)),
    [operationsState.data, productId],
  );
  const candidates = useMemo(() => {
    if (!profile) return [];
    const firstSaleDate = productOperations.find((operation) => operation.kind === "sell")?.operationDate;
    if (!firstSaleDate) return [];
    const transferCategoryIds = new Set(
      categoriesState.data
        .filter((category) => category.deletedAt == null && category.isTransfer)
        .map((category) => category.id),
    );
    const selfPersonIds = new Set(
      personsState.data.filter((person) => person.deletedAt == null && person.isSelf).map((person) => person.id),
    );
    return transactionsState.data
      .filter((transaction) =>
        transaction.deletedAt == null
        && transaction.type === "transfer"
        && transaction.status === "realized"
        && transaction.amountTryMinor < 0
        && transaction.effectiveDate >= firstSaleDate
        && transaction.effectiveDate >= profile.startedOn
        && transaction.effectiveDate <= todayISO()
        && transaction.categoryId != null
        && transferCategoryIds.has(transaction.categoryId)
        && selfPersonIds.has(transaction.personId),
      )
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id.localeCompare(a.id));
  }, [categoriesState.data, personsState.data, productOperations, profile, transactionsState.data]);
  const categoryById = useMemo(
    () => new Map(categoriesState.data.map((category) => [category.id, category])),
    [categoriesState.data],
  );

  const toggleTransfer = (id: string) => {
    setSelectedTransferIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const remove = async () => {
    if (!productId || !product || busy) return;
    const transferIds = [...selectedTransferIds];
    if (!(await appConfirm(
      tr.investments.removeProductHistoryTitle,
      tr.investments.removeProductHistoryBody(product.name, productOperations.length, transferIds.length),
      { confirmLabel: tr.investments.removeProductHistoryAction, danger: true },
    ))) return;
    await operationGuard.run(async () => {
      setBusy(true);
      removalCompleted.current = true;
      removalProductName.current = product.name;
      try {
        const removed = await removeInvestmentProductHistory(userId, productId, transferIds);
        if (!removed) {
          removalCompleted.current = false;
          removalProductName.current = null;
          return;
        }
        scheduleSync(userId);
        // This is a completed correction, not Back: unwind only this nested
        // investment stack. A direct link has no stack history, so replace its
        // deterministic parent instead of leaving the correction on screen.
        if (router.canDismiss()) router.dismissAll();
        else router.replace("/(tabs)/investments");
      } catch (error) {
        removalCompleted.current = false;
        removalProductName.current = null;
        void appAlert(correctionError(error), tr.errors.title);
      } finally {
        setBusy(false);
      }
    });
  };

  if (!ready) {
    return <Screen><DataStateNotice status={status} retry={retry} /></Screen>;
  }
  if (!removalCompleted.current && (!profile || !productId || !productName)) return <Redirect href="/(tabs)/investments" />;
  if (!profile || !productId || !productName) return <Screen><DataStateNotice status={status} retry={retry} /></Screen>;

  return (
    <Screen width="form">
      <Stack.Screen options={{ title: tr.investments.removeProductHistoryTitle }} />
      <Card style={{ marginBottom: spacing.lg }}>
        <PanelHeader
          icon={TriangleAlert}
          tone="error"
          title={tr.investments.removeProductHistoryTitle}
          description={tr.investments.removeProductHistoryLead(productName)}
        />
        <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.error + "12", gap: spacing.xs }}>
          <Text style={[type.label, { color: palette.textStrong }]}>{productName}</Text>
          <Text style={[type.small, { color: palette.textSecondary }]}>
            {tr.investments.removeProductHistorySummary(productOperations.length)}
          </Text>
        </View>
      </Card>

      <SectionHeader description={tr.investments.correctionTransfersHint}>{tr.investments.correctionTransfers}</SectionHeader>
      {candidates.length === 0 ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <EmptyState icon={Landmark} title={tr.investments.correctionNoTransfers} hint={tr.investments.correctionNoTransfersHint} />
        </Card>
      ) : (
        <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
          {candidates.map((transaction) => {
            const category = transaction.categoryId ? categoryById.get(transaction.categoryId) : null;
            const selected = selectedTransferIds.has(transaction.id);
            return (
              <ChoiceTile
                key={transaction.id}
                testID={`investment-correction-transfer-${transaction.id}`}
                accessibilityRole="button"
                layout="row"
                selected={selected}
                label={tr.investments.correctionTransferLabel(transaction.effectiveDate, category?.name ?? tr.investments.refundShort)}
                description={tr.investments.correctionTransferAmount(formatMinorCompact(Math.abs(transaction.amountTryMinor)))}
                onPress={() => toggleTransfer(transaction.id)}
              >
                <View style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: selected ? palette.error + "20" : palette.surfaceAlt }}>
                  <ArrowUpFromLine accessible={false} size={17} color={selected ? palette.destructive : palette.textSecondary} />
                </View>
              </ChoiceTile>
            );
          })}
        </View>
      )}

      <Button
        size="sm"
        variant="danger"
        label={tr.investments.removeProductHistoryAction}
        disabled={busy}
        loading={busy}
        onPress={() => void remove()}
      />
    </Screen>
  );
}

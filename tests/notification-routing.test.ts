/**
 * Tapping a reminder must land on the thing the reminder named.
 *
 * The payload that makes that possible is stored by the operating system, so
 * these tests hold two lines at once: the routing is exact, and the payload
 * stays free of the financial detail the visible copy is already careful with.
 */
import { describe, expect, it } from "vitest";
import {
  notificationRoute,
  notificationTapRoute,
  notificationTargetPayload,
  privateNotificationTarget,
  readNotificationTarget,
  type NotificationTarget,
} from "../src/domain/notifications";

const SUBSCRIPTION: NotificationTarget = { kind: "subscription", id: "sub-42" };
const PLAN: NotificationTarget = { kind: "installmentPlan", id: "plan-7" };

describe("notification tap targets", () => {
  it("round-trips every target through the payload the OS stores", () => {
    for (const target of [SUBSCRIPTION, PLAN, { kind: "expected" } as const]) {
      expect(readNotificationTarget(notificationTargetPayload(target))).toEqual(target);
    }
  });

  it("opens the exact record a reminder is about", () => {
    expect(notificationRoute(SUBSCRIPTION)).toEqual({ pathname: "/subscription-form", params: { id: "sub-42" } });
    expect(notificationRoute(PLAN)).toEqual({ pathname: "/installment-new", params: { id: "plan-7" } });
    expect(notificationRoute({ kind: "expected" })).toEqual({ pathname: "/upcoming" });
  });

  /**
   * A payload can predate an app update, name a deleted record, or be missing
   * entirely on a notification an older build scheduled. None of those may
   * resolve to a plausible-looking wrong destination.
   */
  it("refuses a payload it cannot trust instead of guessing one", () => {
    for (const payload of [
      undefined,
      null,
      "helixTarget",
      42,
      {},
      { helixTarget: null },
      { helixTarget: "subscription" },
      { helixTarget: { kind: "unknownKind", id: "x" } },
      { helixTarget: { kind: "subscription" } },
      { helixTarget: { kind: "subscription", id: "" } },
      { helixTarget: { kind: "subscription", id: "   " } },
      { helixTarget: { kind: "subscription", id: 7 } },
      { helixTarget: { kind: "installmentPlan", id: null } },
      { otherApp: { kind: "subscription", id: "sub-42" } },
    ]) {
      expect(readNotificationTarget(payload)).toBeNull();
      expect(notificationTapRoute(payload)).toBeNull();
    }
  });

  it("routes a trusted payload end to end", () => {
    expect(notificationTapRoute(notificationTargetPayload(SUBSCRIPTION)))
      .toEqual({ pathname: "/subscription-form", params: { id: "sub-42" } });
  });

  /**
   * With details off, one neutral reminder stands for a whole day's items, so
   * naming a single record would both re-attach the identity the user hid and
   * send the tap to an arbitrary member of that group.
   */
  it("drops the record identity when detailed content is turned off", () => {
    expect(privateNotificationTarget(false, SUBSCRIPTION)).toEqual({ kind: "expected" });
    expect(privateNotificationTarget(false, PLAN)).toEqual({ kind: "expected" });
    expect(privateNotificationTarget(true, SUBSCRIPTION)).toEqual(SUBSCRIPTION);
  });

  /** The payload is readable wherever the notification is. It carries identity only. */
  it("never carries an amount, a name or any other financial detail", () => {
    const serialized = JSON.stringify(notificationTargetPayload(SUBSCRIPTION));
    expect(serialized).toBe('{"helixTarget":{"kind":"subscription","id":"sub-42"}}');
    expect(Object.keys(readNotificationTarget(notificationTargetPayload(PLAN)) ?? {}).sort())
      .toEqual(["id", "kind"]);
  });
});
